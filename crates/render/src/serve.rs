//! A small web server for previewing an exported web app on this computer.
//!
//! An app exported with shinylive is a folder of files that runs R in the
//! browser. Browsers run it only from a web address, not from a file, so
//! the preview serves the folder on a loopback port. Only GET and HEAD are
//! answered, only files inside the folder are served, and nothing outside
//! this computer can connect.

use std::path::{Component, Path, PathBuf};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::task::JoinHandle;

/// A running preview. Dropping it, or calling `stop`, ends it.
pub struct StaticServer {
    pub port: u16,
    task: JoinHandle<()>,
}

impl StaticServer {
    /// The address the folder is served at.
    pub fn url(&self) -> String {
        format!("http://127.0.0.1:{}/", self.port)
    }

    /// Stops answering and frees the port.
    pub fn stop(&self) {
        self.task.abort();
    }
}

impl Drop for StaticServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

/// Starts serving `root` on a free loopback port.
pub async fn serve(root: &Path) -> std::io::Result<StaticServer> {
    let root = root.canonicalize()?;
    let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
    let port = listener.local_addr()?.port();
    let task = tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            let root = root.clone();
            tokio::spawn(async move {
                let _ = answer(stream, &root).await;
            });
        }
    });
    Ok(StaticServer { port, task })
}

// A request line and headers longer than this are not from a browser
// asking for a file, and are refused rather than read further.
const MAX_REQUEST: usize = 16 * 1024;

/// Answers one request on a connection.
async fn answer(mut stream: TcpStream, root: &Path) -> std::io::Result<()> {
    let mut request = Vec::new();
    let mut chunk = [0u8; 2048];
    while !request.windows(4).any(|window| window == b"\r\n\r\n") {
        let read = stream.read(&mut chunk).await?;
        if read == 0 || request.len() > MAX_REQUEST {
            return Ok(());
        }
        request.extend_from_slice(&chunk[..read]);
    }
    let text = String::from_utf8_lossy(&request);
    let mut parts = text.lines().next().unwrap_or_default().split_whitespace();
    let method = parts.next().unwrap_or_default();
    let target = parts.next().unwrap_or("/");
    if method != "GET" && method != "HEAD" {
        return respond(&mut stream, "405 Method Not Allowed", "text/plain", b"Only GET and HEAD are answered.", method == "HEAD").await;
    }
    let Some(path) = resolve(root, target) else {
        return respond(&mut stream, "404 Not Found", "text/plain", b"Not found.", method == "HEAD").await;
    };
    match tokio::fs::read(&path).await {
        Ok(body) => respond(&mut stream, "200 OK", content_type(&path), &body, method == "HEAD").await,
        Err(_) => respond(&mut stream, "404 Not Found", "text/plain", b"Not found.", method == "HEAD").await,
    }
}

/// Writes a whole response and closes the connection.
async fn respond(stream: &mut TcpStream, status: &str, kind: &str, body: &[u8], head_only: bool) -> std::io::Result<()> {
    // The preview always shows the latest export, so nothing is cached.
    let header = format!("HTTP/1.1 {status}\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n", body.len());
    stream.write_all(header.as_bytes()).await?;
    if !head_only {
        stream.write_all(body).await?;
    }
    stream.shutdown().await
}

/// The file a request names, or None when it falls outside the folder.
/// A folder's own address serves its index.html, as web hosts do.
fn resolve(root: &Path, target: &str) -> Option<PathBuf> {
    let path = target.split(['?', '#']).next().unwrap_or("/");
    let decoded = percent_decode(path)?;
    let mut resolved = root.to_path_buf();
    for component in Path::new(decoded.trim_start_matches('/')).components() {
        match component {
            Component::Normal(part) => resolved.push(part),
            Component::CurDir => {}
            // A parent step or an absolute part could reach outside the
            // folder, so the request is refused rather than cleaned up.
            _ => return None,
        }
    }
    if resolved.is_dir() {
        resolved.push("index.html");
    }
    // Links inside the folder could still point outside it.
    let real = resolved.canonicalize().ok()?;
    real.starts_with(root).then_some(real)
}

/// Decodes %XX escapes. Malformed escapes and anything that is not text
/// make the request fail.
fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = text.get(index + 1..index + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// The content type for a file, by extension. WebAssembly must be served
/// as application/wasm for browsers to compile it as it downloads.
fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|ext| ext.to_str()).unwrap_or("").to_ascii_lowercase().as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json",
        "wasm" => "application/wasm",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "txt" | "r" | "md" => "text/plain; charset=utf-8",
        "csv" => "text/csv; charset=utf-8",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn get(port: u16, target: &str) -> String {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        stream.write_all(format!("GET {target} HTTP/1.1\r\nHost: localhost\r\n\r\n").as_bytes()).await.unwrap();
        let mut response = Vec::new();
        stream.read_to_end(&mut response).await.unwrap();
        String::from_utf8_lossy(&response).to_string()
    }

    #[tokio::test]
    async fn serves_the_folder_with_the_right_types_and_nothing_outside_it() {
        let dir = tempfile::tempdir().unwrap();
        let site = dir.path().join("site");
        std::fs::create_dir_all(site.join("shinylive")).unwrap();
        std::fs::write(site.join("index.html"), "<title>App</title>").unwrap();
        std::fs::write(site.join("shinylive/webr.wasm"), b"\0asm").unwrap();
        std::fs::write(dir.path().join("secret.txt"), "private").unwrap();
        let server = serve(&site).await.unwrap();

        let index = get(server.port, "/").await;
        assert!(index.starts_with("HTTP/1.1 200 OK"));
        assert!(index.contains("Content-Type: text/html") && index.contains("<title>App</title>"));
        let wasm = get(server.port, "/shinylive/webr.wasm?v=1").await;
        assert!(wasm.contains("Content-Type: application/wasm"));
        // Parent steps, encoded or not, never leave the folder.
        for target in ["/../secret.txt", "/%2e%2e/secret.txt", "/shinylive/../../secret.txt", "/missing.html"] {
            let response = get(server.port, target).await;
            assert!(response.starts_with("HTTP/1.1 404"), "{target} was answered: {response}");
            assert!(!response.contains("private"));
        }

        server.stop();
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert!(TcpStream::connect(("127.0.0.1", server.port)).await.is_err(), "the preview still answered after Stop");
    }

    #[test]
    fn escapes_decode_and_bad_ones_fail() {
        assert_eq!(percent_decode("/a%20b").as_deref(), Some("/a b"));
        assert_eq!(percent_decode("/bad%2"), None);
        assert_eq!(percent_decode("/bad%zz"), None);
    }
}
