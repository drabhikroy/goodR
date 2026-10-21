//! Commands for rendering reports. The work itself lives in the `render`
//! crate. This file checks that the file is one the user opened, finds
//! the R they chose, and turns progress into "render-event" events for the
//! interface.
//!
//! One render runs at a time. A finished render's files are remembered so
//! the preview can show them and Open can hand them to the system, and
//! nothing else can be opened that way.

use crate::AppState;
use render::run::{run, Stopper};
use render::{plan, Failure, Finished, Line, Target, Tools};
use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex as StdMutex};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;

#[derive(Default)]
pub struct RenderState {
    /// The render under way, if any, so Stop can reach it.
    running: StdMutex<Option<Arc<Stopper>>>,
    /// Every file a render made in this session.
    outputs: StdMutex<HashSet<PathBuf>>,
}

impl RenderState {
    /// Stops any render, as when the window closes.
    pub fn shutdown(&self) {
        if let Some(stopper) = self.running.lock().unwrap().take() {
            stopper.stop();
        }
    }
}

type CommandResult<T> = Result<T, String>;

/// Progress for the interface, tagged with the render it belongs to.
#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum RenderEvent {
    Progress { id: String, done: u32, total: u32, label: Option<String> },
    Line { id: String, text: String },
}

/// How a render ended, the files it made, and why it failed when it did.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderResult {
    status: &'static str,
    outputs: Vec<String>,
    failure: Option<Failure>,
}

fn failed(failure: Failure) -> RenderResult {
    let status = if failure == Failure::Stopped { "stopped" } else { "failed" };
    RenderResult { status, outputs: Vec::new(), failure: Some(failure) }
}

/// Renders a report the user opened, with the R chosen in the app, and
/// returns once it has finished, failed, or been stopped.
#[tauri::command]
pub async fn render_start(app: AppHandle, state: State<'_, AppState>, renders: State<'_, RenderState>, id: String, file: String, target: Target) -> CommandResult<RenderResult> {
    let source = state.allowed.lock().unwrap().check(Path::new(&file)).map_err(|error| error.to_string())?;
    let (r_home, pdf_engine, latex_dir) = {
        let settings = state.settings.lock().unwrap();
        (settings.r_home.clone(), settings.pdf_engine.clone(), settings.latex_dir.clone())
    };
    if r_home.is_empty() {
        return Ok(failed(Failure::NoR));
    }
    // Looking for Quarto and LaTeX touches only a handful of fixed paths.
    let mut tools = Tools::locate(Path::new(&r_home));
    tools.latex = render::latex::choose(&crate::latex::builtin_root(), &latex_dir);
    // Left to the app, a PDF uses LaTeX when there is one. Typst is the
    // fallback that needs nothing installed.
    tools.pdf_with_latex = match pdf_engine.as_str() {
        "latex" => true,
        "typst" => false,
        _ => tools.latex.is_some(),
    };
    let plan = match plan::plan(&source, target, &tools) {
        Ok(plan) => plan,
        Err(failure) => return Ok(failed(failure)),
    };
    let stopper = Arc::new(Stopper::default());
    {
        let mut running = renders.running.lock().unwrap();
        if running.is_some() {
            return Err("A report is already rendering. Stop it first, or wait for it to finish.".into());
        }
        *running = Some(stopper.clone());
    }
    let emitter = app.clone();
    let tag = id.clone();
    let outcome = run(&plan, stopper, move |text, line| {
        let event = match line {
            Line::Progress { done, total, label } => RenderEvent::Progress { id: tag.clone(), done: *done, total: *total, label: label.clone() },
            _ => RenderEvent::Line { id: tag.clone(), text: text.to_string() },
        };
        let _ = emitter.emit("render-event", event);
    })
    .await;
    renders.running.lock().unwrap().take();
    let outcome = outcome.map_err(|error| format!("The render could not start: {error}"))?;
    if let Finished::Failed(failure) = outcome.finished {
        return Ok(failed(failure));
    }
    // The preview may load the report and the files beside it, such as
    // its figures and styles, and nothing outside that folder.
    let scope = app.asset_protocol_scope();
    let mut known = renders.outputs.lock().unwrap();
    for output in &outcome.outputs {
        if let Some(folder) = output.parent() {
            let _ = scope.allow_directory(folder, true);
        }
        known.insert(output.clone());
    }
    let outputs = outcome.outputs.iter().map(|path| path.to_string_lossy().to_string()).collect();
    Ok(RenderResult { status: "done", outputs, failure: None })
}

/// Stops the render under way. Doing nothing when none is running keeps a
/// late press harmless.
#[tauri::command]
pub fn render_stop(renders: State<'_, RenderState>) {
    if let Some(stopper) = renders.running.lock().unwrap().as_ref() {
        stopper.stop();
    }
}

/// Opens a rendered file in the system's own app for it, such as Word for
/// a .docx, or shows it in Finder. Only files a render made can be opened.
#[tauri::command]
pub fn render_open(app: AppHandle, renders: State<'_, RenderState>, path: String, reveal: bool) -> CommandResult<()> {
    let path = PathBuf::from(path);
    if !renders.outputs.lock().unwrap().contains(&path) {
        return Err("Only a report this app rendered can be opened from here.".into());
    }
    let opener = app.opener();
    let result = if reveal { opener.reveal_item_in_dir(&path) } else { opener.open_path(path.to_string_lossy(), None::<&str>) };
    result.map_err(|error| error.to_string())
}

/// Ends a render when the app quits, so no R is left running.
pub fn shutdown(app: &AppHandle) {
    app.state::<RenderState>().shutdown();
}
