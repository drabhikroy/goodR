//! Commands for the optional assistant. The work itself lives in the
//! `assistant` crate. This file holds the state that outlives one command,
//! such as the private Ollama process, and turns progress into events the
//! interface listens for:
//!
//! - "assistant-setup" while Ollama or a model downloads,
//! - "assistant-answer" while an answer streams in.
//!
//! One setup step runs at a time. Pressing Download twice, or Install while
//! a model downloads, is refused with a plain message rather than starting
//! a second transfer that would fight the first.

use assistant::catalog::{self, Fit, Model};
use assistant::ollama::{ChatMessage, Client, Installed, PRIVATE_URL, SYSTEM_URL};
use assistant::prompts::{self, Context, Task};
use assistant::runtime::{self, Found, Paths};
use assistant::specs::{self, Specs};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;

pub struct AssistantState {
    paths: Paths,
    /// The server in use, once one is connected.
    client: Mutex<Option<(String, Client)>>,
    /// An Ollama the app started, private copy or system program, so it
    /// can be stopped when the app quits.
    child: StdMutex<Option<tokio::process::Child>>,
    setup_busy: AtomicBool,
    setup_cancel: StdMutex<Arc<AtomicBool>>,
    answer_cancel: StdMutex<Arc<AtomicBool>>,
}

impl AssistantState {
    /// The assistant's files live under the app's data folder, which the
    /// person never has to visit and which removal clears in one step.
    pub fn new() -> Self {
        let base = dirs::data_dir().unwrap_or_else(std::env::temp_dir);
        AssistantState {
            paths: Paths::new(base.join("app.goodfor.ide").join("assistant")),
            client: Mutex::new(None),
            child: StdMutex::new(None),
            setup_busy: AtomicBool::new(false),
            setup_cancel: StdMutex::new(Arc::new(AtomicBool::new(false))),
            answer_cancel: StdMutex::new(Arc::new(AtomicBool::new(false))),
        }
    }

    /// Ends any Ollama the app started. Called when the window closes.
    pub fn shutdown(&self) {
        if let Some(mut child) = self.child.lock().unwrap().take() {
            let _ = child.start_kill();
        }
    }
}

type CommandResult<T> = Result<T, String>;

fn text_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    found: Found,
    /// "system" or "private" when a server is connected, otherwise empty.
    connected: String,
    version: String,
    installed: Vec<Installed>,
}

/// What is on this computer and what is connected. Reads nothing but the
/// usual install locations and the two local server addresses.
#[tauri::command]
pub async fn assistant_status(state: State<'_, AssistantState>) -> CommandResult<Status> {
    // A version reply means the system's server is up right now. No reply
    // is not an error here, only a fact for the setup steps to show.
    let system = Client::new(SYSTEM_URL).map_err(text_error)?;
    let system_version = system.version().await.unwrap_or_default();
    let found = Found {
        system_path: runtime::system_path().map(|path| path.to_string_lossy().to_string()),
        system_running: !system_version.is_empty(),
        system_version,
        private_installed: runtime::private_installed(&state.paths),
        private_supported: cfg!(target_os = "macos"),
        private_version: runtime::VERSION,
    };
    let connected = state.client.lock().await.clone();
    let (route, version, installed) = match connected {
        Some((route, client)) => match client.version().await {
            Ok(version) => (route, version, client.installed().await.unwrap_or_default()),
            Err(_) => (String::new(), String::new(), Vec::new()),
        },
        None => (String::new(), String::new(), Vec::new()),
    };
    Ok(Status { found, connected: route, version, installed })
}

/// Connects to the system's Ollama, starting it if it is installed but not
/// running, or to the private copy, starting it. Returns the version.
#[tauri::command]
pub async fn assistant_connect(state: State<'_, AssistantState>, route: String) -> CommandResult<String> {
    let (url, start): (&str, Option<std::path::PathBuf>) = match route.as_str() {
        "system" => (SYSTEM_URL, runtime::system_path()),
        "private" => (PRIVATE_URL, None),
        _ => return Err("Choose the Ollama on this computer or the private copy.".into()),
    };
    let client = Client::new(url).map_err(text_error)?;
    // Only a server that is not answering is started. One the person runs
    // already is used as it is and never stopped by the app.
    if client.version().await.is_err() {
        let child = if route == "private" {
            if !runtime::private_installed(&state.paths) {
                return Err("The private copy of Ollama is not installed yet.".into());
            }
            runtime::start(&state.paths).map_err(text_error)?
        } else {
            let path = start.ok_or("Ollama is not installed on this computer. Install it from ollama.com, or choose the private copy.")?;
            tokio::process::Command::new(path)
                .arg("serve")
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .kill_on_drop(true)
                .spawn()
                .map_err(|error| format!("Ollama could not be started: {error}"))?
        };
        // Switching between the two routes ends the server started before.
        if let Some(mut old) = state.child.lock().unwrap().replace(child) {
            let _ = old.start_kill();
        }
    }
    let version = runtime::wait_ready(&client, 30).await.map_err(text_error)?;
    *state.client.lock().await = Some((route, client));
    Ok(version)
}

/// This computer's memory, disk, and chip. The interface calls this only
/// after the person agrees to the check.
#[tauri::command]
pub fn assistant_specs(state: State<'_, AssistantState>) -> Specs {
    specs::read(&state.paths.models())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntry {
    #[serde(flatten)]
    model: Model,
    /// How well it suits this computer, when the specs were read.
    fit: Option<Fit>,
    memory_needed_gb: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    models: Vec<CatalogEntry>,
    suggested: &'static str,
}

#[tauri::command]
pub fn assistant_catalog(specs: Option<Specs>) -> Catalog {
    let models = catalog::MODELS
        .iter()
        .map(|model| CatalogEntry {
            model: model.clone(),
            fit: specs.as_ref().map(|specs| catalog::fit(model.size_gb, specs)),
            memory_needed_gb: (catalog::memory_needed(model.size_gb) * 10.0).round() / 10.0,
        })
        .collect();
    Catalog { models, suggested: catalog::suggested(specs.as_ref()) }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SetupEvent {
    /// "runtime" or a model id.
    target: String,
    stage: String,
    completed: u64,
    total: u64,
    done: bool,
    error: String,
}

/// Claims the single setup slot, or says what is already running.
fn claim(state: &AssistantState) -> CommandResult<Arc<AtomicBool>> {
    if state.setup_busy.swap(true, Ordering::SeqCst) {
        return Err("Another download is still running. Wait for it to finish, or cancel it first.".into());
    }
    let cancel = Arc::new(AtomicBool::new(false));
    *state.setup_cancel.lock().unwrap() = Arc::clone(&cancel);
    Ok(cancel)
}

/// Installs the private copy of Ollama and starts it.
#[tauri::command]
pub async fn assistant_install_runtime(app: AppHandle, state: State<'_, AssistantState>) -> CommandResult<()> {
    let cancel = claim(&state)?;
    let send = |stage: &str, completed: u64, total: u64, done: bool, error: &str| {
        let _ = app.emit("assistant-setup", SetupEvent { target: "runtime".into(), stage: stage.into(), completed, total, done, error: error.into() });
    };
    let outcome = runtime::install(&state.paths, cancel, |completed, total, stage| send(stage, completed, total, false, "")).await;
    // The slot is freed whatever happened, so a failed download can be
    // tried again at once.
    state.setup_busy.store(false, Ordering::SeqCst);
    match outcome {
        Ok(()) => {
            send("Installed", 1, 1, true, "");
            Ok(())
        }
        Err(error) => {
            send("Failed", 0, 0, true, &error.to_string());
            Err(error.to_string())
        }
    }
}

/// Downloads a model through the connected server.
#[tauri::command]
pub async fn assistant_pull(app: AppHandle, state: State<'_, AssistantState>, model: String) -> CommandResult<()> {
    let client = connected(&state).await?;
    let cancel = claim(&state)?;
    let target = model.clone();
    let outcome = client
        .pull(&model, cancel, |step| {
            let stage = plain_stage(&step.status);
            let _ = app.emit("assistant-setup", SetupEvent { target: target.clone(), stage, completed: step.completed, total: step.total, done: false, error: String::new() });
        })
        .await;
    state.setup_busy.store(false, Ordering::SeqCst);
    let error = outcome.as_ref().err().map(|error| error.to_string()).unwrap_or_default();
    let _ = app.emit("assistant-setup", SetupEvent { target: model, stage: if error.is_empty() { "Installed".into() } else { "Failed".into() }, completed: 0, total: 0, done: true, error: error.clone() });
    outcome.map_err(text_error)
}

/// Ollama's progress words, such as "pulling manifest", in plainer terms.
fn plain_stage(status: &str) -> String {
    if status.starts_with("pulling manifest") {
        "Getting ready".into()
    } else if status.starts_with("pulling") {
        "Downloading".into()
    } else if status.starts_with("verifying") {
        "Checking the download".into()
    } else if status.starts_with("writing") {
        "Saving".into()
    } else if status == "success" {
        "Installed".into()
    } else {
        status.to_string()
    }
}

#[tauri::command]
pub fn assistant_cancel_setup(state: State<'_, AssistantState>) {
    state.setup_cancel.lock().unwrap().store(true, Ordering::SeqCst);
}

#[tauri::command]
pub async fn assistant_delete(state: State<'_, AssistantState>, model: String) -> CommandResult<()> {
    connected(&state).await?.delete(&model).await.map_err(text_error)
}

/// Stops and removes the private copy and the models it holds.
#[tauri::command]
pub async fn assistant_remove_runtime(state: State<'_, AssistantState>) -> CommandResult<()> {
    let route = state.client.lock().await.as_ref().map(|(route, _)| route.clone());
    if route.as_deref() == Some("private") {
        *state.client.lock().await = None;
        state.shutdown();
        // The process needs a moment to let go of its files.
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    runtime::remove(&state.paths).map_err(text_error)
}

async fn connected(state: &AssistantState) -> CommandResult<Client> {
    state.client.lock().await.as_ref().map(|(_, client)| client.clone()).ok_or_else(|| "The assistant is not connected to Ollama yet.".to_string())
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnswerEvent {
    id: String,
    text: String,
    done: bool,
    error: String,
}

/// Asks the model. The answer streams as "assistant-answer" events tagged
/// with `id`, so the interface can tell one answer from the next.
#[tauri::command]
pub async fn assistant_ask(app: AppHandle, state: State<'_, AssistantState>, id: String, model: String, task: Task, context: Context, history: Vec<ChatMessage>) -> CommandResult<()> {
    let client = connected(&state).await?;
    let cancel = Arc::new(AtomicBool::new(false));
    *state.answer_cancel.lock().unwrap() = Arc::clone(&cancel);
    // Models outside the catalog are assumed not to think out loud, which is
    // true of most, and an unknown option would only be ignored.
    let thinks = catalog::MODELS.iter().any(|known| known.id == model && known.thinks);
    let messages = prompts::messages(&task, &context, &history);
    let outcome = client
        .chat(&model, &messages, thinks, cancel, |text| {
            let _ = app.emit("assistant-answer", AnswerEvent { id: id.clone(), text: text.to_string(), done: false, error: String::new() });
        })
        .await;
    let error = outcome.as_ref().err().map(|error| error.to_string()).unwrap_or_default();
    let _ = app.emit("assistant-answer", AnswerEvent { id, text: String::new(), done: true, error });
    outcome.map(|_| ()).map_err(text_error)
}

#[tauri::command]
pub fn assistant_stop(state: State<'_, AssistantState>) {
    state.answer_cancel.lock().unwrap().store(true, Ordering::SeqCst);
}
