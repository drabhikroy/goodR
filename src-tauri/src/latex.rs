//! Commands for LaTeX: what is on this computer, and the app's own
//! TinyTeX, installed and removed on request. The finding and the install
//! itself live in the render crate. This file keeps one install at a time,
//! turns its lines into "latex-event" events for the interface, and keeps
//! the app's copy in its own data folder.

use crate::AppState;
use render::latex;
use render::run::{follow, Stopper};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex as StdMutex};
use tauri::{AppHandle, Emitter, State};

type CommandResult<T> = Result<T, String>;

pub struct LatexState {
    /// The install under way, if any, so Cancel can reach it.
    installing: StdMutex<Option<Arc<Stopper>>>,
}

impl LatexState {
    pub fn new() -> Self {
        LatexState { installing: StdMutex::new(None) }
    }

    /// Stops an install, as when the window closes.
    pub fn shutdown(&self) {
        if let Some(stopper) = self.installing.lock().unwrap().take() {
            stopper.stop();
        }
    }
}

/// Where the app's own TinyTeX lives, beside the assistant's files, in a
/// folder the user never has to visit.
pub fn builtin_root() -> PathBuf {
    dirs::data_dir().unwrap_or_else(std::env::temp_dir).join("app.goodfor.ide").join("TinyTeX")
}

/// One LaTeX, for the interface: its folder, its name, and whether it is
/// the app's own.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LatexInfo {
    dir: String,
    name: String,
    builtin: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LatexStatus {
    found: Vec<LatexInfo>,
    installing: bool,
}

#[derive(Clone, Serialize)]
struct LatexEvent {
    text: String,
}

/// Every LaTeX on this computer, named. Naming runs each one briefly, so
/// this is asked for when Settings shows them, not before each render.
#[tauri::command]
pub async fn latex_status(latex_state: State<'_, LatexState>) -> CommandResult<LatexStatus> {
    let installing = latex_state.installing.lock().unwrap().is_some();
    let found = tauri::async_runtime::spawn_blocking(|| {
        latex::find(&builtin_root())
            .into_iter()
            .map(|found| LatexInfo { name: latex::describe(&found.dir), dir: found.dir.to_string_lossy().to_string(), builtin: found.builtin })
            .collect::<Vec<_>>()
    })
    .await
    .map_err(|error| error.to_string())?;
    Ok(LatexStatus { found, installing })
}

/// Installs TinyTeX into the app's own folder with the R chosen in the
/// app, sending each line it prints, and returns once it has finished,
/// failed, or been canceled.
#[tauri::command]
pub async fn latex_install(app: AppHandle, state: State<'_, AppState>, latex_state: State<'_, LatexState>) -> CommandResult<()> {
    let r_home = state.settings.lock().unwrap().r_home.clone();
    if r_home.is_empty() {
        return Err("Choose an R first. The install runs in R.".into());
    }
    let rscript = render::find::rscript(Path::new(&r_home));
    let root = builtin_root();
    std::fs::create_dir_all(root.parent().unwrap_or(&root)).map_err(|error| error.to_string())?;
    let stopper = Arc::new(Stopper::default());
    {
        let mut installing = latex_state.installing.lock().unwrap();
        if installing.is_some() {
            return Err("LaTeX is already being installed.".into());
        }
        *installing = Some(stopper.clone());
    }
    let plan = latex::install_plan(&rscript, &root);
    let emitter = app.clone();
    let mut installed = false;
    let followed = follow(&plan, stopper, |text| {
        if text.contains(latex::INSTALLED_MARKER) {
            installed = true;
        } else {
            let _ = emitter.emit("latex-event", LatexEvent { text: text.to_string() });
        }
    })
    .await;
    latex_state.installing.lock().unwrap().take();
    let followed = followed.map_err(|error| format!("The install could not start: {error}"))?;
    if followed.stopped {
        let _ = std::fs::remove_dir_all(&root);
        return Err("The install was canceled.".into());
    }
    if !installed || latex::tinytex_bin(&root).is_none() {
        let last: Vec<String> = followed.lines.iter().rev().take(4).rev().cloned().collect();
        return Err(format!("TinyTeX did not install. {}", last.join(" ")));
    }
    Ok(())
}

/// Cancels the install under way.
#[tauri::command]
pub fn latex_cancel(latex_state: State<'_, LatexState>) {
    if let Some(stopper) = latex_state.installing.lock().unwrap().as_ref() {
        stopper.stop();
    }
}

/// Removes the app's own TinyTeX. A LaTeX the user installed is never
/// touched.
#[tauri::command]
pub fn latex_remove(latex_state: State<'_, LatexState>) -> CommandResult<()> {
    if latex_state.installing.lock().unwrap().is_some() {
        return Err("Wait for the install to finish, or cancel it, first.".into());
    }
    let root = builtin_root();
    if root.exists() {
        std::fs::remove_dir_all(&root).map_err(|error| error.to_string())?;
    }
    Ok(())
}
