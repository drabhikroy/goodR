//! Commands for running Shiny apps. The work itself lives in the `render`
//! crate's `shiny` module. This file checks that the file is one the
//! person opened, finds the R they chose, and turns what the app prints
//! into "app-event" events for the interface.
//!
//! One app runs at a time, as in RStudio's viewer. Running another app, or
//! the same one again, stops the one before it. Open hands only the
//! running app's own loopback address to the browser.
//!
//! An app can also be exported as a web page that runs without R, with
//! shinylive, into a folder the user chooses in the system dialog. A
//! preview of that page takes the running app's place in its window,
//! served on a loopback port. Only folders an export made in this session
//! can be previewed or shown in Finder.

use crate::AppState;
use render::run::{follow, Stopper};
use render::serve::{serve, StaticServer};
use render::shiny::{self, AppFailure, AppLine};
use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex as StdMutex};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, State, WebviewUrl};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

/// What is on show in the app's window: an app's own R, or a preview of an
/// exported web page served from its folder.
enum Runner {
    Process(Arc<Stopper>),
    Preview(StaticServer),
}

/// The app that is running, so Stop and Open can reach it.
struct Running {
    id: String,
    runner: Runner,
    /// Set once the app answers at its address.
    url: Option<String>,
}

impl Running {
    /// Stops the app. A process ends on its own and reports it; a preview
    /// just stops answering.
    fn stop(&self) {
        match &self.runner {
            Runner::Process(stopper) => stopper.stop(),
            Runner::Preview(server) => server.stop(),
        }
    }

    /// Ends the app and everything it started before returning, for when
    /// this app is quitting and nothing would be left to finish the job.
    fn end_now(&self) {
        match &self.runner {
            Runner::Process(stopper) => stopper.end_now(),
            Runner::Preview(server) => server.stop(),
        }
    }
}

#[derive(Default)]
pub struct ShinyState {
    running: StdMutex<Option<Running>>,
    /// The folders exports made in this session.
    exports: StdMutex<HashSet<PathBuf>>,
    /// The export under way, so Stop can reach it.
    exporting: StdMutex<Option<Arc<Stopper>>>,
}

impl ShinyState {
    /// Stops the app and any export, as when the window closes.
    pub fn shutdown(&self) {
        if let Some(running) = self.running.lock().unwrap().take() {
            running.end_now();
        }
        if let Some(stopper) = self.exporting.lock().unwrap().take() {
            stopper.end_now();
        }
    }

    /// Puts a new run on show, stopping the one before it. A preview that
    /// is replaced says it ended, since no process will.
    fn replace(&self, app: &AppHandle, next: Running) {
        let previous = self.running.lock().unwrap().replace(next);
        if let Some(previous) = previous {
            previous.stop();
            if matches!(previous.runner, Runner::Preview(_)) {
                let _ = app.emit("app-event", AppEvent::Ended { id: previous.id, failure: Some(AppFailure::Stopped) });
            }
        }
    }
}

type CommandResult<T> = Result<T, String>;

/// What the app is doing, tagged with the run it belongs to, so a late
/// line from an app that was just replaced cannot be mistaken for the new
/// one's.
#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum AppEvent {
    /// The app answers at `url`.
    Ready { id: String, url: String },
    /// Code inside the running app failed. The app carries on.
    Problem { id: String, message: String },
    Line { id: String, text: String },
    /// The app's R has ended. No failure means the app closed itself, as
    /// with `stopApp()`.
    Ended { id: String, failure: Option<AppFailure> },
}

/// Starts the app in a file the user opened, with the R chosen in the
/// app, and returns at once. What follows arrives as "app-event" events.
#[tauri::command]
pub async fn app_start(app: AppHandle, state: State<'_, AppState>, apps: State<'_, ShinyState>, id: String, file: String) -> CommandResult<()> {
    let source = state.allowed.lock().unwrap().check(Path::new(&file)).map_err(|error| error.to_string())?;
    let r_home = state.settings.lock().unwrap().r_home.clone();
    let ended = |failure: AppFailure| {
        let _ = app.emit("app-event", AppEvent::Ended { id: id.clone(), failure: Some(failure) });
        Ok(())
    };
    if r_home.is_empty() {
        return ended(AppFailure::NoR);
    }
    let port = shiny::free_port().map_err(|error| format!("No port was free for the app: {error}"))?;
    let plan = match shiny::plan(&source, &render::find::rscript(Path::new(&r_home)), port) {
        Ok(plan) => plan,
        Err(failure) => return ended(failure),
    };
    let stopper = Arc::new(Stopper::default());
    // The app before this one, if any, is stopped first. Its own task sends
    // its ending under its own id, which the interface no longer follows.
    apps.replace(&app, Running { id: id.clone(), runner: Runner::Process(stopper.clone()), url: None });
    tauri::async_runtime::spawn(watch(app.clone(), id, plan, stopper, port));
    Ok(())
}

/// Follows the app's R from start to end, sending each line on. Only an
/// address on `port`, the one the app was given, can make it ready.
async fn watch(app: AppHandle, id: String, plan: render::Plan, stopper: Arc<Stopper>, port: u16) {
    let emitter = app.clone();
    let tag = id.clone();
    let followed = follow(&plan, stopper, move |text| {
        let event = match shiny::classify(text) {
            AppLine::Listening(url) if shiny::is_own_address(&url, port) => {
                // Readiness is checked away from the line reader, so lines
                // keep flowing while the app finishes starting.
                let (app, id) = (emitter.clone(), tag.clone());
                tauri::async_runtime::spawn(async move {
                    if shiny::wait_until_answering(&url).await {
                        ready(&app, &id, url);
                    }
                });
                AppEvent::Line { id: tag.clone(), text: text.to_string() }
            }
            AppLine::Problem(message) => AppEvent::Problem { id: tag.clone(), message },
            // An address on some other port is only text the app printed.
            AppLine::Listening(_) | AppLine::Text => AppEvent::Line { id: tag.clone(), text: text.to_string() },
        };
        let _ = emitter.emit("app-event", event);
    })
    .await;
    let failure = match followed {
        Err(error) => Some(AppFailure::Ended { message: format!("R could not start: {error}") }),
        Ok(followed) if followed.stopped => Some(AppFailure::Stopped),
        Ok(followed) if followed.status.success() => None,
        Ok(followed) => Some(shiny::diagnose(&Vec::from(followed.lines))),
    };
    let apps = app.state::<ShinyState>();
    let mut running = apps.running.lock().unwrap();
    if running.as_ref().is_some_and(|running| running.id == id) {
        running.take();
    }
    drop(running);
    let _ = app.emit("app-event", AppEvent::Ended { id, failure });
}

/// Records the address of the app with `id`, if it is still the one
/// running, and tells the interface.
fn ready(app: &AppHandle, id: &str, url: String) {
    let apps = app.state::<ShinyState>();
    let mut running = apps.running.lock().unwrap();
    let Some(current) = running.as_mut().filter(|running| running.id == id) else { return };
    current.url = Some(url.clone());
    drop(running);
    let _ = app.emit("app-event", AppEvent::Ready { id: id.to_string(), url });
}

/// Stops the running app and every R it started. Doing nothing when none
/// is running keeps a late press harmless.
#[tauri::command]
pub fn app_stop(app: AppHandle, apps: State<'_, ShinyState>) {
    let mut running = apps.running.lock().unwrap();
    let Some(current) = running.as_ref() else { return };
    current.stop();
    // A preview has no process to report its own ending, so it is
    // reported here and forgotten.
    if matches!(current.runner, Runner::Preview(_)) {
        let id = current.id.clone();
        running.take();
        drop(running);
        let _ = app.emit("app-event", AppEvent::Ended { id, failure: Some(AppFailure::Stopped) });
    }
}

/// The files an export would bundle, for the Share dialog to list before
/// anything is made.
#[derive(Serialize)]
pub struct BundleList {
    files: Vec<String>,
    /// Whether the listing stopped at its limit.
    more: bool,
}

/// The code of the app a file the user opened belongs to, read so the
/// interface can check ids across all of its files. Only .R and .js files
/// inside that app's own folder are returned.
#[tauri::command]
pub async fn app_code(state: State<'_, AppState>, file: String) -> CommandResult<Vec<shiny::CodeFile>> {
    let source = state.allowed.lock().unwrap().check(Path::new(&file)).map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || shiny::app_code(&source)).await.map_err(|error| error.to_string())
}

#[tauri::command]
pub fn app_bundle_files(state: State<'_, AppState>, file: String) -> CommandResult<BundleList> {
    let source = state.allowed.lock().unwrap().check(Path::new(&file)).map_err(|error| error.to_string())?;
    let (files, more) = shiny::bundled_files(&source);
    Ok(BundleList { files, more })
}

/// How an export ended: the folder it made, or why it did not.
#[derive(Serialize)]
pub struct ExportResult {
    status: &'static str,
    folder: Option<String>,
    failure: Option<AppFailure>,
}

/// Lines an export prints, tagged with the export they belong to.
#[derive(Clone, Serialize)]
struct ExportLine {
    id: String,
    text: String,
}

/// Exports an app the user opened as a web page. The system dialog asks
/// where it goes, and a new folder named after the app is made there, so
/// an export never writes into a folder that already holds something.
/// Returns nothing when the dialog is canceled.
#[tauri::command]
pub async fn app_export(app: AppHandle, state: State<'_, AppState>, apps: State<'_, ShinyState>, id: String, file: String) -> CommandResult<Option<ExportResult>> {
    let source = state.allowed.lock().unwrap().check(Path::new(&file)).map_err(|error| error.to_string())?;
    let r_home = state.settings.lock().unwrap().r_home.clone();
    let failed = |failure: AppFailure| Ok(Some(ExportResult { status: if failure == AppFailure::Stopped { "stopped" } else { "failed" }, folder: None, failure: Some(failure) }));
    if r_home.is_empty() {
        return failed(AppFailure::NoR);
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut dialog = app.dialog().file().set_title("Choose Where the Web Version Goes");
    if let Some(parent) = source.parent().and_then(Path::parent) {
        dialog = dialog.set_directory(parent);
    }
    dialog.pick_folder(move |picked| {
        let _ = tx.send(picked);
    });
    let Some(picked) = rx.await.map_err(|error| error.to_string())? else { return Ok(None) };
    let parent = picked.into_path().map_err(|error| error.to_string())?;
    let dest = unused_folder(&parent, &export_name(&source));
    let plan = match shiny::export_plan(&source, &dest, &render::find::rscript(Path::new(&r_home))) {
        Ok(plan) => plan,
        Err(failure) => return failed(failure),
    };
    let stopper = Arc::new(Stopper::default());
    {
        let mut exporting = apps.exporting.lock().unwrap();
        if exporting.is_some() {
            return Err("An app is already being exported. Wait for it to finish, or stop it first.".into());
        }
        *exporting = Some(stopper.clone());
    }
    let emitter = app.clone();
    let tag = id.clone();
    let followed = follow(&plan, stopper, move |text| {
        let _ = emitter.emit("export-event", ExportLine { id: tag.clone(), text: text.to_string() });
    })
    .await;
    apps.exporting.lock().unwrap().take();
    let followed = followed.map_err(|error| format!("R could not start the export: {error}"))?;
    if followed.stopped {
        return failed(AppFailure::Stopped);
    }
    if !followed.status.success() || !dest.join("index.html").is_file() {
        return failed(shiny::diagnose_export(&Vec::from(followed.lines)));
    }
    let folder = dest.canonicalize().unwrap_or(dest);
    apps.exports.lock().unwrap().insert(folder.clone());
    Ok(Some(ExportResult { status: "done", folder: Some(folder.to_string_lossy().to_string()), failure: None }))
}

/// Stops the export under way, along with its R.
#[tauri::command]
pub fn app_export_stop(apps: State<'_, ShinyState>) {
    if let Some(stopper) = apps.exporting.lock().unwrap().as_ref() {
        stopper.stop();
    }
}

/// The name of an export's folder: the app's folder for an app.R, or the
/// script's own name, followed by "-web".
fn export_name(source: &Path) -> String {
    let named = matches!(source.file_name().and_then(|name| name.to_str()), Some("app.R" | "ui.R" | "server.R" | "global.R"));
    let base = if named { source.parent().and_then(Path::file_name) } else { source.file_stem() };
    format!("{}-web", base.map(|name| name.to_string_lossy().to_string()).unwrap_or_else(|| "app".into()))
}

/// A folder under `parent` named `name`, or with a number after it when
/// that name is taken.
fn unused_folder(parent: &Path, name: &str) -> PathBuf {
    let mut candidate = parent.join(name);
    let mut number = 2;
    while candidate.exists() {
        candidate = parent.join(format!("{name}-{number}"));
        number += 1;
    }
    candidate
}

/// Previews an exported web page in the App pane, served from its folder
/// on a loopback port. Only a folder an export made in this session can be
/// served.
#[tauri::command]
pub async fn app_preview(app: AppHandle, apps: State<'_, ShinyState>, id: String, folder: String) -> CommandResult<()> {
    let folder = Path::new(&folder).canonicalize().map_err(|error| error.to_string())?;
    if !apps.exports.lock().unwrap().contains(&folder) {
        return Err("Only a web version this app made can be previewed here.".into());
    }
    let server = serve(&folder).await.map_err(|error| format!("The preview could not start: {error}"))?;
    let url = server.url();
    apps.replace(&app, Running { id: id.clone(), runner: Runner::Preview(server), url: Some(url.clone()) });
    let _ = app.emit("app-event", AppEvent::Ready { id, url });
    Ok(())
}

/// Shows an exported folder in Finder, to copy or upload. Only folders an
/// export made can be shown this way.
#[tauri::command]
pub fn app_reveal(app: AppHandle, apps: State<'_, ShinyState>, folder: String) -> CommandResult<()> {
    let folder = Path::new(&folder).canonicalize().map_err(|error| error.to_string())?;
    if !apps.exports.lock().unwrap().contains(&folder) {
        return Err("Only a web version this app made can be shown from here.".into());
    }
    app.opener().reveal_item_in_dir(&folder).map_err(|error| error.to_string())
}

/// Opens the running app in the system's browser. The address comes from
/// the app's own R, never from the interface, so this cannot open anything
/// else.
#[tauri::command]
pub fn app_open(app: AppHandle, apps: State<'_, ShinyState>) -> CommandResult<()> {
    let url = apps.running.lock().unwrap().as_ref().and_then(|running| running.url.clone()).ok_or("No app is running.")?;
    app.opener().open_url(url, None::<&str>).map_err(|error| error.to_string())
}

/// The label of the window a running app opens in.
pub const APP_WINDOW: &str = "app";
/// The bar along the top of that window, a small page of this app's own
/// with the address, Open in browser, and Reload.
const APP_BAR: &str = "app-bar";
/// The app itself, below the bar.
const APP_PAGE: &str = "app-page";
/// The bar's height, in points.
const BAR_HEIGHT: f64 = 52.0;

/// The running app's address, checked to be one on this computer.
fn running_url(apps: &ShinyState) -> Result<tauri::Url, String> {
    let url = apps.running.lock().unwrap().as_ref().and_then(|running| running.url.clone()).ok_or("No app is running.")?;
    let parsed: tauri::Url = url.parse().map_err(|_| "The app's address could not be read.".to_string())?;
    if parsed.scheme() != "http" || parsed.host_str() != Some("127.0.0.1") {
        return Err("The app's address is not on this computer.".into());
    }
    Ok(parsed)
}

/// Shows the running app in a window of its own, as RStudio does, or brings
/// that window forward and loads the app again.
///
/// The window holds two views. Along the top is a small page of this app's
/// own with the address, Reload, and Open in browser. Below it is the app,
/// loaded straight from its address. The app cannot sit in a frame on a
/// page of this app's own, because WebKit, which draws the window on macOS
/// and Linux, blocks a plain http page inside a page from a secure origin,
/// even one on this computer, and shows nothing instead. The app's view has
/// no access to this app at all, and it can go only to its own address.
/// Links elsewhere open in the browser. The address comes from the app's
/// own R, never from the interface, so the window can show nothing else.
#[tauri::command]
pub async fn app_window(app: AppHandle, title: String, mode: String) -> CommandResult<()> {
    let url = running_url(&app.state::<ShinyState>())?;
    if let Some(window) = app.get_window(APP_WINDOW) {
        if let Some(page) = app.get_webview(APP_PAGE) {
            page.navigate(url.clone()).map_err(|error| error.to_string())?;
        }
        if let Some(bar) = app.get_webview(APP_BAR) {
            let quoted = serde_json::to_string(url.as_str()).map_err(|error| error.to_string())?;
            let _ = bar.eval(format!("window.showAddress && window.showAddress({quoted})"));
        }
        let _ = window.set_title(&title);
        let _ = window.unminimize();
        let _ = window.set_focus();
        return Ok(());
    }
    // The address and the appearance ride in the bar's fragment, which its
    // page reads and checks.
    let mode = if ["light", "dark", "paper"].contains(&mode.as_str()) { mode } else { "light".into() };
    let escaped = url.as_str().replace('%', "%25").replace('&', "%26").replace('#', "%23").replace('+', "%2B");
    let (width, height) = (1100.0, 820.0);
    let window = tauri::window::WindowBuilder::new(&app, APP_WINDOW)
        .title(title)
        .inner_size(width, height)
        .min_inner_size(480.0, 360.0)
        .build()
        .map_err(|error| error.to_string())?;
    let bar = tauri::webview::WebviewBuilder::new(APP_BAR, WebviewUrl::App(format!("app-window.html#mode={mode}&url={escaped}").into()));
    window.add_child(bar, LogicalPosition::new(0.0, 0.0), LogicalSize::new(width, BAR_HEIGHT)).map_err(|error| error.to_string())?;
    let origin = url.origin();
    let handle = app.clone();
    let page = tauri::webview::WebviewBuilder::new(APP_PAGE, WebviewUrl::External(url))
        // The app stays at its own address. A link elsewhere opens in the
        // browser, as it would from an app open there.
        .on_navigation(move |next| {
            if next.origin() == origin || next.scheme() == "about" {
                return true;
            }
            if matches!(next.scheme(), "http" | "https") {
                let _ = handle.opener().open_url(next.as_str(), None::<&str>);
            }
            false
        })
        .on_new_window({
            let handle = app.clone();
            move |next, _| {
                if matches!(next.scheme(), "http" | "https") {
                    let _ = handle.opener().open_url(next.as_str(), None::<&str>);
                }
                tauri::webview::NewWindowResponse::Deny
            }
        })
        // A file the app offers for download goes to Downloads, as it would
        // from the browser.
        .on_download({
            let downloads = app.path().download_dir().ok();
            move |_, event| match event {
                tauri::webview::DownloadEvent::Requested { destination, .. } => match (&downloads, destination.file_name().map(|name| name.to_owned())) {
                    (Some(folder), Some(name)) => {
                        *destination = folder.join(name);
                        true
                    }
                    _ => false,
                },
                _ => true,
            }
        });
    window
        .add_child(page, LogicalPosition::new(0.0, BAR_HEIGHT), LogicalSize::new(width, height - BAR_HEIGHT))
        .map_err(|error| error.to_string())?;
    Ok(())
}

/// Keeps the bar along the top of the app's window and the app below it
/// as the window changes size.
pub fn app_window_resized(window: &tauri::Window) {
    let Ok(size) = window.inner_size() else { return };
    let Ok(scale) = window.scale_factor() else { return };
    let size = size.to_logical::<f64>(scale);
    if let Some(bar) = window.app_handle().get_webview(APP_BAR) {
        let _ = bar.set_size(LogicalSize::new(size.width, BAR_HEIGHT));
    }
    if let Some(page) = window.app_handle().get_webview(APP_PAGE) {
        let _ = page.set_position(LogicalPosition::new(0.0, BAR_HEIGHT));
        let _ = page.set_size(LogicalSize::new(size.width, (size.height - BAR_HEIGHT).max(0.0)));
    }
}

/// Loads the app again in its window, from the bar's Reload.
#[tauri::command]
pub fn app_reload(app: AppHandle, apps: State<'_, ShinyState>) -> CommandResult<()> {
    let url = running_url(&apps)?;
    let page = app.get_webview(APP_PAGE).ok_or("The app's window is not open.")?;
    page.navigate(url).map_err(|error| error.to_string())
}

/// Closes the app's window, once the app has ended.
#[tauri::command]
pub fn app_window_close(app: AppHandle) {
    if let Some(window) = app.get_window(APP_WINDOW) {
        let _ = window.destroy();
    }
}

/// Stops the app when its window is closed, as RStudio does.
pub fn app_window_closed(app: &AppHandle) {
    app_stop(app.clone(), app.state::<ShinyState>());
}

/// Ends the app when the window closes, so no R is left running.
pub fn shutdown(app: &AppHandle) {
    app.state::<ShinyState>().shutdown();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_export_gets_a_new_folder_named_after_the_app() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(export_name(&dir.path().join("faithful/app.R")), "faithful-web");
        assert_eq!(export_name(&dir.path().join("explore.R")), "explore-web");
        assert_eq!(unused_folder(dir.path(), "faithful-web"), dir.path().join("faithful-web"));
        // A name that is taken gets a number, so nothing is written into a
        // folder that already holds something.
        std::fs::create_dir_all(dir.path().join("faithful-web")).unwrap();
        std::fs::create_dir_all(dir.path().join("faithful-web-2")).unwrap();
        assert_eq!(unused_folder(dir.path(), "faithful-web"), dir.path().join("faithful-web-3"));
    }
}
