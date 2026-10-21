//! Talks to a running Ollama server on this computer over its local HTTP
//! interface. Downloads report progress as they go, and answers stream in
//! word by word, so the user always sees that something is happening.

use anyhow::{anyhow, Context, Result};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

/// Where the system's own Ollama listens.
pub const SYSTEM_URL: &str = "http://127.0.0.1:11434";
/// Where the app's private copy listens. A port of its own keeps it from
/// clashing with an Ollama the user runs separately.
pub const PRIVATE_URL: &str = "http://127.0.0.1:11435";

#[derive(Clone)]
pub struct Client {
    base: String,
    http: reqwest::Client,
}

/// A model already on this computer, as Ollama lists it.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    pub id: String,
    pub size_gb: f64,
    /// Such as "7.6B", when Ollama reports it.
    pub parameters: String,
}

/// One step of a download.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub status: String,
    pub completed: u64,
    pub total: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

impl Client {
    pub fn new(base: &str) -> Result<Self> {
        // The server is on this computer, so any proxy set for the internet
        // must be bypassed, or requests would leave the machine.
        let http = reqwest::Client::builder().no_proxy().connect_timeout(Duration::from_secs(3)).build()?;
        Ok(Client { base: base.trim_end_matches('/').to_string(), http })
    }

    // Every endpoint hangs off the same base, the system's or the private
    // copy's address, so one client serves either.
    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base, path)
    }

    /// The server's version, which also proves it is running. The short
    /// timeout keeps the setup steps quick when nothing is listening.
    pub async fn version(&self) -> Result<String> {
        let reply: Value = self.http.get(self.url("/api/version")).timeout(Duration::from_secs(3)).send().await?.error_for_status()?.json().await?;
        Ok(reply["version"].as_str().unwrap_or_default().to_string())
    }

    /// The models already downloaded, including any the user pulled with
    /// Ollama outside this app, so they can be chosen here too.
    pub async fn installed(&self) -> Result<Vec<Installed>> {
        let reply: Value = self.http.get(self.url("/api/tags")).timeout(Duration::from_secs(10)).send().await?.error_for_status()?.json().await?;
        Ok(parse_installed(&reply))
    }

    /// Downloads a model, calling `on_progress` as pieces arrive. Stops
    /// early when `cancel` is set.
    pub async fn pull(&self, model: &str, cancel: Arc<AtomicBool>, mut on_progress: impl FnMut(Progress)) -> Result<()> {
        let response = self.http.post(self.url("/api/pull")).json(&json!({ "model": model, "stream": true })).send().await?.error_for_status()?;
        let mut lines = LineReader::default();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            if cancel.load(Ordering::SeqCst) {
                return Err(anyhow!("The download was canceled."));
            }
            for line in lines.push(&chunk?) {
                let value: Value = serde_json::from_str(&line).with_context(|| format!("unexpected reply from Ollama: {line}"))?;
                if let Some(error) = value["error"].as_str() {
                    return Err(anyhow!("{error}"));
                }
                on_progress(Progress {
                    status: value["status"].as_str().unwrap_or_default().to_string(),
                    completed: value["completed"].as_u64().unwrap_or(0),
                    total: value["total"].as_u64().unwrap_or(0),
                });
            }
        }
        Ok(())
    }

    /// Removes a downloaded model from this computer.
    pub async fn delete(&self, model: &str) -> Result<()> {
        self.http.delete(self.url("/api/delete")).json(&json!({ "model": model })).send().await?.error_for_status()?;
        Ok(())
    }

    /// Asks a model, streaming its answer piece by piece through `on_text`,
    /// and returns the whole answer. Answers are kept steady with a low
    /// temperature, since code should not change much between asks.
    pub async fn chat(&self, model: &str, messages: &[ChatMessage], thinks: bool, cancel: Arc<AtomicBool>, mut on_text: impl FnMut(&str)) -> Result<String> {
        let mut body = json!({
            "model": model,
            "messages": messages,
            "stream": true,
            "options": { "temperature": 0.2, "num_ctx": 8192 },
        });
        // A model that reasons out loud is asked to skip it. The reasoning
        // is slow to read and the answer is what the user came for.
        if thinks {
            body["think"] = json!(false);
        }
        let response = self.http.post(self.url("/api/chat")).json(&body).send().await?;
        // A model that is not installed, or a request Ollama refuses, comes
        // back as an error status with a JSON message worth showing as is.
        if !response.status().is_success() {
            let text = response.text().await.unwrap_or_default();
            let message = serde_json::from_str::<Value>(&text).ok().and_then(|value| value["error"].as_str().map(str::to_string)).unwrap_or(text);
            return Err(anyhow!("{message}"));
        }
        let mut lines = LineReader::default();
        let mut stream = response.bytes_stream();
        let mut answer = String::new();
        while let Some(chunk) = stream.next().await {
            if cancel.load(Ordering::SeqCst) {
                break;
            }
            for line in lines.push(&chunk?) {
                let value: Value = serde_json::from_str(&line).with_context(|| format!("unexpected reply from Ollama: {line}"))?;
                if let Some(error) = value["error"].as_str() {
                    return Err(anyhow!("{error}"));
                }
                if let Some(text) = value["message"]["content"].as_str() {
                    if !text.is_empty() {
                        answer.push_str(text);
                        on_text(text);
                    }
                }
            }
        }
        Ok(answer)
    }
}

/// Reads Ollama's model list into the shape the interface shows.
pub fn parse_installed(reply: &Value) -> Vec<Installed> {
    let Some(models) = reply["models"].as_array() else { return Vec::new() };
    models
        .iter()
        .filter_map(|model| {
            let id = model["name"].as_str().or_else(|| model["model"].as_str())?.to_string();
            // Ollama counts bytes in powers of ten, as its own model pages do,
            // so sizes here match what the user sees on ollama.com.
            let size = model["size"].as_u64().unwrap_or(0) as f64 / 1_000_000_000.0;
            let parameters = model["details"]["parameter_size"].as_str().unwrap_or_default().to_string();
            Some(Installed { id, size_gb: (size * 10.0).round() / 10.0, parameters })
        })
        .collect()
}

/// Splits a stream of bytes into whole lines. Ollama sends one JSON object
/// per line, and a network piece can end in the middle of one.
#[derive(Default)]
pub struct LineReader {
    pending: Vec<u8>,
}

impl LineReader {
    pub fn push(&mut self, bytes: &[u8]) -> Vec<String> {
        self.pending.extend_from_slice(bytes);
        let mut lines = Vec::new();
        while let Some(end) = self.pending.iter().position(|byte| *byte == b'\n') {
            let line: Vec<u8> = self.pending.drain(..=end).collect();
            let text = String::from_utf8_lossy(&line).trim().to_string();
            if !text.is_empty() {
                lines.push(text);
            }
        }
        lines
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    /// A one request server that answers with `body`, enough to check how
    /// replies are read without a real Ollama.
    async fn serve(body: &'static str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buffer = vec![0u8; 8192];
            let _ = socket.read(&mut buffer).await;
            let reply = format!("HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body);
            socket.write_all(reply.as_bytes()).await.unwrap();
        });
        format!("http://{address}")
    }

    #[test]
    fn lines_split_across_pieces_are_joined() {
        let mut reader = LineReader::default();
        assert!(reader.push(b"{\"a\":").is_empty());
        assert_eq!(reader.push(b"1}\n{\"b\":2}\n{\"c\""), vec!["{\"a\":1}", "{\"b\":2}"]);
        assert_eq!(reader.push(b":3}\n"), vec!["{\"c\":3}"]);
    }

    #[test]
    fn the_model_list_reads_names_and_sizes() {
        let reply = json!({ "models": [{ "name": "qwen2.5-coder:7b", "size": 4_683_087_332u64, "details": { "parameter_size": "7.6B" } }] });
        assert_eq!(parse_installed(&reply), vec![Installed { id: "qwen2.5-coder:7b".into(), size_gb: 4.7, parameters: "7.6B".into() }]);
    }

    #[tokio::test]
    async fn chat_streams_pieces_and_returns_the_whole_answer() {
        let base = serve("{\"message\":{\"content\":\"Use \"},\"done\":false}\n{\"message\":{\"content\":\"mean().\"},\"done\":false}\n{\"message\":{\"content\":\"\"},\"done\":true}\n").await;
        let client = Client::new(&base).unwrap();
        let mut pieces = Vec::new();
        let answer = client.chat("m", &[], false, Arc::new(AtomicBool::new(false)), |text| pieces.push(text.to_string())).await.unwrap();
        assert_eq!(answer, "Use mean().");
        assert_eq!(pieces, vec!["Use ", "mean()."]);
    }

    #[tokio::test]
    async fn a_download_reports_progress_and_surfaces_errors() {
        let base = serve("{\"status\":\"pulling\",\"total\":100,\"completed\":40}\n{\"status\":\"success\"}\n").await;
        let client = Client::new(&base).unwrap();
        let mut steps = Vec::new();
        client.pull("m", Arc::new(AtomicBool::new(false)), |step| steps.push(step)).await.unwrap();
        assert_eq!(steps[0], Progress { status: "pulling".into(), completed: 40, total: 100 });
        assert_eq!(steps[1].status, "success");

        let base = serve("{\"error\":\"pull model manifest: file does not exist\"}\n").await;
        let client = Client::new(&base).unwrap();
        let error = client.pull("nope", Arc::new(AtomicBool::new(false)), |_| {}).await.unwrap_err();
        assert!(error.to_string().contains("does not exist"));
    }
}
