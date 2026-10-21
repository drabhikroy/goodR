//! The command behind Check it runs from scratch. The check itself lives
//! in the render crate. This file finds the folder the script's paths are
//! relative to, writes the code to a file of its own, and keeps one check
//! at a time so Stop can reach it.

use crate::AppState;
use render::fresh::{self, Checked};
use render::run::{follow, Stopper};
use std::path::Path;
use std::sync::{Arc, Mutex as StdMutex};
use tauri::State;

type CommandResult<T> = Result<T, String>;

#[derive(Default)]
pub struct FreshState {
    running: StdMutex<Option<Arc<Stopper>>>,
}

/// Runs `code` in a new R and says whether it ran to the end. `file` is
/// the script it came from, which must be one the user opened, and sets
/// the folder: its project's, or its own. Untitled code runs in a
/// temporary folder. One check runs at a time.
#[tauri::command]
pub async fn fresh_check(state: State<'_, AppState>, fresh_state: State<'_, FreshState>, file: Option<String>, code: String) -> CommandResult<Checked> {
    let r_home = state.settings.lock().unwrap().r_home.clone();
    if r_home.is_empty() {
        return Err("Choose an R first.".into());
    }
    let source = match file {
        Some(file) => Some(state.allowed.lock().unwrap().check(Path::new(&file)).map_err(|error| error.to_string())?),
        None => None,
    };
    let stopper = Arc::new(Stopper::default());
    {
        let mut running = fresh_state.running.lock().unwrap();
        if running.is_some() {
            return Err("A check is already running.".into());
        }
        *running = Some(stopper.clone());
    }
    let checked = check(Path::new(&r_home), source.as_deref(), &code, stopper).await;
    // Cleared whatever happened, so a failed start never blocks the next check.
    fresh_state.running.lock().unwrap().take();
    checked
}

/// Runs one check from a private folder of its own, which holds the code
/// and is the working folder for untitled code. The folder is removed on
/// every path out.
async fn check(r_home: &Path, source: Option<&Path>, code: &str, stopper: Arc<Stopper>) -> CommandResult<Checked> {
    let scratch = crate::files::private_dir("goodr-check").map_err(|error| error.to_string())?;
    // A script's paths are relative to its project's folder, or its own.
    let dir = source
        .and_then(|path| crate::files::find_project(path).and_then(|project| project.parent().map(Path::to_path_buf)).or_else(|| path.parent().map(Path::to_path_buf)))
        .unwrap_or_else(|| scratch.clone());
    let code_file = scratch.join("check.R");
    let followed = match std::fs::write(&code_file, code) {
        Ok(()) => {
            let plan = fresh::check_plan(&render::find::rscript(r_home), &code_file, &dir);
            follow(&plan, stopper, |_| {}).await.map_err(|error| format!("R could not start: {error}"))
        }
        Err(error) => Err(error.to_string()),
    };
    let _ = std::fs::remove_dir_all(&scratch);
    let followed = followed?;
    if followed.stopped {
        return Err("The check was stopped.".into());
    }
    let lines: Vec<String> = followed.lines.into_iter().collect();
    Ok(fresh::read_result(&lines))
}

/// Stops the check under way.
#[tauri::command]
pub fn fresh_stop(fresh_state: State<'_, FreshState>) {
    if let Some(stopper) = fresh_state.running.lock().unwrap().as_ref() {
        stopper.stop();
    }
}
