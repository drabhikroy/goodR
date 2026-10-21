//! The desktop shell: holds app state and exposes commands to the interface.
//!
//! The interface never touches R or the disk directly. It calls the commands
//! below, and R output reaches it as "r-event" events. Keeping that boundary
//! narrow means the interface code can be tested in a browser against a
//! stand-in backend, and that the file rules in `files.rs` cannot be skipped.

mod assistant;
mod files;
mod menu;
mod render;
mod settings;

use rsession::{parse_helper_json, Event, RInstall, Session, SessionConfig};
use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tokio::sync::Mutex;

struct AppState {
    settings_path: PathBuf,
    settings: StdMutex<settings::Settings>,
    /// The files the person chose. Every read and write checks this first.
    allowed: StdMutex<files::Allowed>,
    /// Files handed to the app before the interface was ready to open them,
    /// from the command line or from Finder at launch.
    pending: StdMutex<Vec<String>>,
    /// The open project's folder, which R starts in and stays in.
    project: StdMutex<Option<PathBuf>>,
    /// The last folder chosen in the New Project dialog. Creating a project
    /// is allowed only there, so the interface cannot create one anywhere
    /// it likes.
    chosen_folder: StdMutex<Option<PathBuf>>,
    session: Mutex<Option<Arc<Session>>>,
    /// Counts sessions. Each event is tagged with the session that sent it,
    /// so a late message from a session that was just restarted cannot be
    /// mistaken for output from the new one.
    generation: AtomicU64,
}

/// Commands return text errors because the interface shows them to people.
type CommandResult<T> = Result<T, String>;

fn text_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[derive(Clone, Serialize)]
struct TaggedEvent {
    generation: u64,
    event: Event,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionInfo {
    generation: u64,
    version: String,
    working_dir: String,
    log_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    name: &'static str,
    version: &'static str,
    ark_version: &'static str,
    platform: &'static str,
    git: bool,
}

/// Name, versions, and platform for the About dialog and the opening screen.
#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        name: "R: What Is It Good For?",
        version: env!("CARGO_PKG_VERSION"),
        ark_version: "0.1.252",
        platform: std::env::consts::OS,
        git: files::git_available(),
    }
}

/// Every R on this computer, newest first, for the first run chooser and
/// the Choose R Version dialog.
#[tauri::command]
fn list_r_installs() -> Vec<RInstall> {
    rsession::find_installations()
}

/// The settings loaded at launch. The interface owns them from then on and
/// sends back the whole set whenever something changes.
#[tauri::command]
fn load_settings(state: State<'_, AppState>) -> settings::Settings {
    state.settings.lock().unwrap().clone()
}

/// Saves preferences to disk right away, so a crash never loses a change
/// someone just made. The recent list and the reopened files are kept from
/// the app's own copy, since only the app may decide which files those are.
#[tauri::command]
fn save_settings(state: State<'_, AppState>, settings: settings::Settings) -> CommandResult<()> {
    let mut current = state.settings.lock().unwrap();
    let merged = settings::Settings {
        recent_files: current.recent_files.clone(),
        session_files: current.session_files.clone(),
        session_active: current.session_active.clone(),
        recent_projects: current.recent_projects.clone(),
        session_project: current.session_project.clone(),
        ..settings
    };
    settings::save(&state.settings_path, &merged).map_err(text_error)?;
    *current = merged;
    Ok(())
}

/// The recent scripts and projects, newest first, for File, Open Recent.
fn recent_paths(state: &AppState) -> (Vec<String>, Vec<String>) {
    let settings = state.settings.lock().unwrap();
    let paths = |list: &[settings::RecentFile]| list.iter().map(|recent| recent.path.clone()).collect();
    (paths(&settings.recent_files), paths(&settings.recent_projects))
}

/// Saves the app's settings after the app itself changed them.
fn persist(state: &AppState) {
    let settings = state.settings.lock().unwrap().clone();
    let _ = settings::save(&state.settings_path, &settings);
}

/// Rebuilds the menu bar. Check marks and the Essentials or Everything
/// layer change which items appear, and native menus cannot hide items in
/// place, so the whole bar is rebuilt. It is small, so this is instant.
#[tauri::command]
fn update_menu(app: AppHandle, state: State<'_, AppState>, menu_state: menu::MenuState) -> CommandResult<()> {
    let (recent, projects) = recent_paths(&state);
    let built = menu::build(&app, &menu_state, &recent, &projects).map_err(text_error)?;
    app.set_menu(built).map_err(text_error)?;
    Ok(())
}

/// Grants access to files the person chose outside the interface, from a
/// drop, Finder, or the command line, and records them as recent. Anything
/// that is not an existing script is skipped.
fn accept(state: &AppState, paths: impl IntoIterator<Item = PathBuf>) -> Vec<String> {
    let mut accepted = Vec::new();
    {
        let mut allowed = state.allowed.lock().unwrap();
        for path in paths {
            if path.is_file() && files::is_script(&path) {
                if let Ok(resolved) = allowed.grant(&path) {
                    accepted.push(resolved.to_string_lossy().to_string());
                }
            }
        }
    }
    if !accepted.is_empty() {
        let mut settings = state.settings.lock().unwrap();
        for path in &accepted {
            settings.note_recent(path);
        }
    }
    persist(state);
    accepted
}

/// Shows the system Open dialog for scripts and returns the files chosen.
/// The dialog runs here rather than in the interface so that the paths it
/// returns are known to come from the person.
#[tauri::command]
async fn choose_files(app: AppHandle, state: State<'_, AppState>) -> CommandResult<Vec<String>> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Open R Scripts")
        .add_filter("R scripts and documents", files::EXTENSIONS)
        .pick_files(move |picked| {
            let _ = tx.send(picked.unwrap_or_default());
        });
    let picked = rx.await.map_err(text_error)?;
    let paths = picked.into_iter().filter_map(|file| file.into_path().ok());
    Ok(accept(&state, paths))
}

/// Shows the system Save dialog and grants access to the file named there.
/// Returns nothing when the person cancels.
#[tauri::command]
async fn choose_save_path(app: AppHandle, state: State<'_, AppState>, suggested: String) -> CommandResult<Option<String>> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut dialog = app.dialog().file().set_title("Save R Script").add_filter("R script", &["R"]).set_file_name(&suggested);
    if let Some(documents) = dirs::document_dir() {
        dialog = dialog.set_directory(documents);
    }
    dialog.save_file(move |picked| {
        let _ = tx.send(picked);
    });
    let Some(picked) = rx.await.map_err(text_error)? else { return Ok(None) };
    let path = picked.into_path().map_err(text_error)?;
    let resolved = state.allowed.lock().unwrap().grant(&path).map_err(text_error)?;
    let text = resolved.to_string_lossy().to_string();
    state.settings.lock().unwrap().note_recent(&text);
    persist(&state);
    Ok(Some(text))
}

/// Reopens a file from the recent list or from the last session. Both lists
/// are written only by this file, so a path in them was chosen by the person
/// at some point. Files that have since been deleted or moved are dropped
/// from the list, and the interface is told plainly.
#[tauri::command]
fn reopen(state: State<'_, AppState>, path: String) -> CommandResult<String> {
    let known = {
        let settings = state.settings.lock().unwrap();
        settings.recent_files.iter().any(|recent| recent.path == path) || settings.session_files.contains(&path)
    };
    if !known {
        return Err(format!("{path} is not in the recent list"));
    }
    if !Path::new(&path).is_file() {
        state.settings.lock().unwrap().recent_files.retain(|recent| recent.path != path);
        persist(&state);
        return Err(format!("{path} has been moved or deleted"));
    }
    state.allowed.lock().unwrap().grant(Path::new(&path)).map_err(text_error)?;
    state.settings.lock().unwrap().note_recent(&path);
    persist(&state);
    Ok(path)
}

/// Removes a file from the recent list, at the person's request.
#[tauri::command]
fn forget_recent(state: State<'_, AppState>, path: String) {
    state.settings.lock().unwrap().recent_files.retain(|recent| recent.path != path);
    persist(&state);
}

/// Records which files are open, so the next launch reopens them. Only
/// files already granted are kept.
#[tauri::command]
fn remember_session(state: State<'_, AppState>, files: Vec<String>, active: String) {
    let kept: Vec<String> = {
        let allowed = state.allowed.lock().unwrap();
        files.into_iter().filter(|file| allowed.check(Path::new(file)).is_ok()).collect()
    };
    {
        let mut settings = state.settings.lock().unwrap();
        settings.session_active = if kept.contains(&active) { active } else { String::new() };
        settings.session_files = kept;
    }
    persist(&state);
}

/// Opens a project from its project file: grants its scripts, records it
/// as recent and as the session's project, and lists what it holds.
fn open_project_file(state: &AppState, file: &Path) -> CommandResult<files::ProjectInfo> {
    let info = files::scan_project(file).map_err(text_error)?;
    state.allowed.lock().unwrap().set_project(Some(Path::new(&info.root))).map_err(text_error)?;
    *state.project.lock().unwrap() = Some(PathBuf::from(&info.root));
    {
        let mut settings = state.settings.lock().unwrap();
        settings.note_project(&info.file);
        settings.session_project = info.file.clone();
    }
    persist(state);
    Ok(info)
}

/// Shows the system Open dialog for a project file (.Rproj).
#[tauri::command]
async fn choose_project(app: AppHandle, state: State<'_, AppState>) -> CommandResult<Option<files::ProjectInfo>> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().set_title("Open a Project").add_filter("R project", &["Rproj"]).pick_file(move |picked| {
        let _ = tx.send(picked);
    });
    let Some(picked) = rx.await.map_err(text_error)? else { return Ok(None) };
    let path = picked.into_path().map_err(text_error)?;
    open_project_file(&state, &path).map(Some)
}

/// Reopens a project from the recent list or the last session.
#[tauri::command]
fn reopen_project(state: State<'_, AppState>, file: String) -> CommandResult<files::ProjectInfo> {
    let known = {
        let settings = state.settings.lock().unwrap();
        settings.recent_projects.iter().any(|recent| recent.path == file) || settings.session_project == file
    };
    if !known {
        return Err(format!("{file} is not in the recent list"));
    }
    if !Path::new(&file).is_file() {
        state.settings.lock().unwrap().recent_projects.retain(|recent| recent.path != file);
        persist(&state);
        return Err(format!("{file} has been moved or deleted"));
    }
    open_project_file(&state, Path::new(&file))
}

/// Lists the open project again, after a save adds a script to it.
#[tauri::command]
fn refresh_project(state: State<'_, AppState>) -> CommandResult<Option<files::ProjectInfo>> {
    let file = state.settings.lock().unwrap().session_project.clone();
    if file.is_empty() || state.project.lock().unwrap().is_none() {
        return Ok(None);
    }
    files::scan_project(Path::new(&file)).map(Some).map_err(text_error)
}

/// Closes the project. Its scripts that were opened one by one stay open.
#[tauri::command]
fn close_project(state: State<'_, AppState>) -> CommandResult<()> {
    state.allowed.lock().unwrap().set_project(None).map_err(text_error)?;
    *state.project.lock().unwrap() = None;
    state.settings.lock().unwrap().session_project.clear();
    persist(&state);
    Ok(())
}

/// Removes a project from the recent list. Its files are untouched.
#[tauri::command]
fn forget_project(state: State<'_, AppState>, file: String) {
    state.settings.lock().unwrap().recent_projects.retain(|recent| recent.path != file);
    persist(&state);
}

/// Shows the system folder picker for where a new project goes.
#[tauri::command]
async fn choose_project_folder(app: AppHandle, state: State<'_, AppState>, existing: bool) -> CommandResult<Option<String>> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let title = if existing { "Choose the Folder to Turn into a Project" } else { "Choose Where the Project Goes" };
    let mut dialog = app.dialog().file().set_title(title);
    if let Some(documents) = dirs::document_dir() {
        dialog = dialog.set_directory(documents);
    }
    dialog.pick_folder(move |picked| {
        let _ = tx.send(picked);
    });
    let Some(picked) = rx.await.map_err(text_error)? else { return Ok(None) };
    let path = picked.into_path().map_err(text_error)?;
    *state.chosen_folder.lock().unwrap() = Some(path.clone());
    Ok(Some(path.to_string_lossy().to_string()))
}

/// Creates a project in the folder chosen in the dialog, then opens it.
#[tauri::command]
fn create_project(state: State<'_, AppState>, parent: String, name: String, template: String, git: bool) -> CommandResult<files::ProjectInfo> {
    let chosen = state.chosen_folder.lock().unwrap().clone();
    if chosen.as_deref() != Some(Path::new(&parent)) {
        return Err("Choose where the project goes first.".into());
    }
    let file = files::create_project(Path::new(&parent), &name, &template, git).map_err(text_error)?;
    open_project_file(&state, &file)
}

/// Files that arrived before the interface was listening, handed over once.
#[tauri::command]
fn take_pending(state: State<'_, AppState>) -> Vec<String> {
    std::mem::take(&mut *state.pending.lock().unwrap())
}

#[tauri::command]
fn read_text(state: State<'_, AppState>, path: String) -> CommandResult<String> {
    let path = state.allowed.lock().unwrap().check(Path::new(&path)).map_err(text_error)?;
    files::read_text(&path).map_err(text_error)
}

#[tauri::command]
fn write_text(state: State<'_, AppState>, path: String, contents: String) -> CommandResult<()> {
    let path = state.allowed.lock().unwrap().check(Path::new(&path)).map_err(text_error)?;
    files::write_bytes(&path, contents.as_bytes()).map_err(text_error)
}

/// Saves a plot image wherever the person chooses in the Save dialog. The
/// data arrives as base64 text because that is how R hands plots over.
#[tauri::command]
async fn save_plot(app: AppHandle, data: String, suggested: String) -> CommandResult<Option<String>> {
    let bytes = rsession::decode_plot(&data).map_err(text_error)?;
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut dialog = app.dialog().file().set_title("Save Plot").add_filter("PNG image", &["png"]).set_file_name(&suggested);
    if let Some(pictures) = dirs::picture_dir() {
        dialog = dialog.set_directory(pictures);
    }
    dialog.save_file(move |picked| {
        let _ = tx.send(picked);
    });
    let Some(picked) = rx.await.map_err(text_error)? else { return Ok(None) };
    let path = picked.into_path().map_err(text_error)?;
    files::write_bytes(&path, &bytes).map_err(text_error)?;
    Ok(Some(path.to_string_lossy().to_string()))
}

/// Exports a plot at a chosen size and format. The person picks where the
/// file goes in the Save dialog, then R draws the plot again from the code
/// that made it, so a PDF or SVG stays sharp at any size rather than being
/// a screen image enlarged.
#[tauri::command]
async fn export_plot(app: AppHandle, state: State<'_, AppState>, code: String, format: String, width: f64, height: f64, dpi: u32, suggested: String) -> CommandResult<Option<String>> {
    let (label, extension) = match format.as_str() {
        "png" => ("PNG image", "png"),
        "pdf" => ("PDF document", "pdf"),
        "svg" => ("SVG image", "svg"),
        _ => return Err("That file format is not offered.".into()),
    };
    // Sizes outside these bounds are mistakes, and R would either refuse
    // them or make a file far larger than anyone meant to.
    if !(0.5..=60.0).contains(&width) || !(0.5..=60.0).contains(&height) {
        return Err("Width and height must each be between 0.5 and 60 inches.".into());
    }
    let dpi = dpi.clamp(72, 1200);
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut dialog = app.dialog().file().set_title("Export Plot").add_filter(label, &[extension]).set_file_name(&suggested);
    // Inside a project, figures belong with the project: its figures
    // folder when it has one, as the analysis template makes, or else its
    // root. Outside a project, the Pictures folder.
    let root = state.project.lock().unwrap().clone();
    let start = root.map(|root| if root.join("figures").is_dir() { root.join("figures") } else { root }).or_else(dirs::picture_dir);
    if let Some(start) = start {
        dialog = dialog.set_directory(start);
    }
    dialog.save_file(move |picked| {
        let _ = tx.send(picked);
    });
    let Some(picked) = rx.await.map_err(text_error)? else { return Ok(None) };
    let mut path = picked.into_path().map_err(text_error)?;
    if path.extension().and_then(|value| value.to_str()).map(|value| value.to_lowercase()) != Some(extension.to_string()) {
        path.set_extension(extension);
    }
    let call = rsession::helpers::export_call(&code, &path.to_string_lossy(), extension, width, height, dpi);
    let text = current(&state).await?.query(&call).await.map_err(text_error)?;
    let value = parse_helper_json(&text).map_err(text_error)?;
    if let Some(problem) = value.get("error").and_then(Value::as_str) {
        return Err(format!("R could not draw the plot again: {problem}"));
    }
    Ok(Some(path.to_string_lossy().to_string()))
}

/// Moves R to the folder of a script the person chose, before running code
/// from it. Returns the folder so the console can say where R now is.
#[tauri::command]
async fn r_set_working_dir(state: State<'_, AppState>, file: String) -> CommandResult<String> {
    let path = state.allowed.lock().unwrap().check(Path::new(&file)).map_err(text_error)?;
    let dir = path.parent().ok_or("the file has no folder")?.to_string_lossy().to_string();
    let text = current(&state).await?.query(&rsession::helpers::setwd_call(&dir)).await.map_err(text_error)?;
    let value = parse_helper_json(&text).map_err(text_error)?;
    Ok(value.as_str().unwrap_or(&dir).to_string())
}

/// The bundled ark sits next to the app's own executable, where Tauri
/// places programs listed under externalBin. GOODFOR_ARK overrides it for
/// development against a locally built ark.
fn ark_path() -> CommandResult<PathBuf> {
    if let Ok(path) = std::env::var("GOODFOR_ARK") {
        return Ok(PathBuf::from(path));
    }
    let exe = std::env::current_exe().map_err(text_error)?;
    let name = if cfg!(windows) { "ark.exe" } else { "ark" };
    let path = exe.parent().ok_or("the app folder could not be found")?.join(name);
    if path.exists() {
        Ok(path)
    } else {
        Err(format!("The R kernel is missing from {}. Reinstalling the app restores it.", path.display()))
    }
}

/// Starts R, replacing any session already running. R begins in the folder
/// of `file` when it is a script the person opened, and in the home folder
/// otherwise, which is where R itself starts from a terminal. With a project
/// open, R starts in the project folder instead.
#[tauri::command]
async fn start_session(app: AppHandle, state: State<'_, AppState>, r_home: String, file: Option<String>) -> CommandResult<SessionInfo> {
    let project = state.project.lock().unwrap().clone();
    let folder = project
        .or_else(|| file.and_then(|file| state.allowed.lock().unwrap().check(Path::new(&file)).ok()).and_then(|path| path.parent().map(Path::to_path_buf)))
        .or_else(dirs::home_dir)
        .unwrap_or_else(std::env::temp_dir);
    let mut slot = state.session.lock().await;
    if let Some(old) = slot.take() {
        old.shutdown().await;
    }
    let generation = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    let runtime_dir = std::env::temp_dir().join("goodfor").join(format!("session-{}-{generation}", std::process::id()));
    let config = SessionConfig {
        ark_path: ark_path()?,
        r_home: PathBuf::from(&r_home),
        working_dir: folder,
        runtime_dir,
    };

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    let forwarder = app.clone();
    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            let _ = forwarder.emit("r-event", TaggedEvent { generation, event });
        }
    });

    let session = Session::start(config, tx).await.map_err(text_error)?;
    let info = parse_helper_json(&session.query(".gf_info()").await.map_err(text_error)?).map_err(text_error)?;
    let result = SessionInfo {
        generation,
        version: info["version"].as_str().unwrap_or_default().to_string(),
        working_dir: info["wd"].as_str().unwrap_or_default().to_string(),
        log_path: session.log_path.to_string_lossy().to_string(),
    };
    *slot = Some(session);
    Ok(result)
}

/// Names that could complete the text before the cursor, from R's own
/// completion engine.
#[tauri::command]
async fn r_complete(state: State<'_, AppState>, line: String, cursor: usize) -> CommandResult<Value> {
    let text = current(&state).await?.query(&rsession::helpers::complete_call(&line, cursor)).await.map_err(text_error)?;
    parse_helper_json(&text).map_err(text_error)
}

/// A help page for the Help pane, by topic or by file within a package.
#[tauri::command]
async fn r_help(state: State<'_, AppState>, topic: String, package: String, file: String) -> CommandResult<Value> {
    let text = current(&state).await?.query(&rsession::helpers::help_call(&topic, &package, &file)).await.map_err(text_error)?;
    parse_helper_json(&text).map_err(text_error)
}

/// Installed packages for the Packages pane.
#[tauri::command]
async fn r_packages(state: State<'_, AppState>) -> CommandResult<Value> {
    let text = current(&state).await?.query(".gf_packages()").await.map_err(text_error)?;
    parse_helper_json(&text).map_err(text_error)
}

/// The first rows of a data file as R reads them, for the Import Data
/// preview. R reads the file; the app itself never opens data files.
#[tauri::command]
async fn r_preview(state: State<'_, AppState>, code: String) -> CommandResult<Value> {
    let text = current(&state).await?.query(&rsession::helpers::preview_call(&code)).await.map_err(text_error)?;
    parse_helper_json(&text).map_err(text_error)
}

/// Where R's parser stops on code that will not parse, as R words it with
/// the line and column. Empty when the code parses. Nothing runs.
#[tauri::command]
async fn r_parse_problem(state: State<'_, AppState>, code: String) -> CommandResult<String> {
    let text = current(&state).await?.query(&rsession::helpers::parse_problem_call(&code)).await.map_err(text_error)?;
    let value = parse_helper_json(&text).map_err(text_error)?;
    Ok(value["message"].as_str().unwrap_or_default().to_string())
}

/// Asks which data file to import. The path is only ever handed to R in
/// the import code; it is not added to the files the app may open.
#[tauri::command]
async fn choose_data_file(app: AppHandle, state: State<'_, AppState>) -> CommandResult<Option<String>> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut dialog = app.dialog().file().set_title("Import Data").add_filter("Data files", files::IMPORT_EXTENSIONS);
    let root = state.project.lock().unwrap().clone();
    if let Some(start) = root.map(|root| if root.join("data").is_dir() { root.join("data") } else { root }) {
        dialog = dialog.set_directory(start);
    }
    dialog.pick_file(move |picked| {
        let _ = tx.send(picked);
    });
    let Some(picked) = rx.await.map_err(text_error)? else { return Ok(None) };
    Ok(Some(picked.into_path().map_err(text_error)?.to_string_lossy().to_string()))
}

/// The R session already running, if any. When the window reloads, the
/// interface starts over but R does not, so the interface asks for this
/// first and reconnects instead of starting a second R and losing the
/// person's objects.
#[tauri::command]
async fn current_session(state: State<'_, AppState>) -> CommandResult<Option<SessionInfo>> {
    let session = state.session.lock().await.clone();
    let Some(session) = session.filter(|session| session.is_running()) else { return Ok(None) };
    let info = parse_helper_json(&session.query(".gf_info()").await.map_err(text_error)?).map_err(text_error)?;
    Ok(Some(SessionInfo {
        generation: state.generation.load(Ordering::SeqCst),
        version: info["version"].as_str().unwrap_or_default().to_string(),
        working_dir: info["wd"].as_str().unwrap_or_default().to_string(),
        log_path: session.log_path.to_string_lossy().to_string(),
    }))
}

/// The running session, cloned out of the lock so a long R call does not
/// block other commands such as Stop.
async fn current(state: &State<'_, AppState>) -> CommandResult<Arc<Session>> {
    state.session.lock().await.clone().ok_or_else(|| "R is not running".to_string())
}

/// Ends R, used before choosing another R version.
#[tauri::command]
async fn shutdown_session(state: State<'_, AppState>) -> CommandResult<()> {
    if let Some(session) = state.session.lock().await.take() {
        session.shutdown().await;
    }
    Ok(())
}

/// Runs code the person asked for and returns the run id output will carry.
#[tauri::command]
async fn execute(state: State<'_, AppState>, code: String, run_id: String) -> CommandResult<String> {
    current(&state).await?.execute_as(&code, &run_id).await.map_err(text_error)
}

#[tauri::command]
async fn is_complete(state: State<'_, AppState>, code: String) -> CommandResult<String> {
    current(&state).await?.is_complete(&code).await.map_err(text_error)
}

#[tauri::command]
async fn interrupt(state: State<'_, AppState>) -> CommandResult<()> {
    current(&state).await?.interrupt().await.map_err(text_error)
}

#[tauri::command]
async fn send_input(state: State<'_, AppState>, value: String) -> CommandResult<()> {
    current(&state).await?.send_input(&value).await.map_err(text_error)
}

/// The Objects list, refreshed after every visible run finishes.
#[tauri::command]
async fn r_objects(state: State<'_, AppState>) -> CommandResult<Value> {
    let text = current(&state).await?.query(".gf_objects()").await.map_err(text_error)?;
    parse_helper_json(&text).map_err(text_error)
}

/// The columns of a data frame, for the data viewer's headers.
#[tauri::command]
async fn r_data_meta(state: State<'_, AppState>, name: String) -> CommandResult<Value> {
    let text = current(&state).await?.query(&rsession::helpers::data_meta_call(&name)).await.map_err(text_error)?;
    parse_helper_json(&text).map_err(text_error)
}

/// One page of a data frame's rows. Pages are capped so a request can
/// never ask R to format a whole large table at once.
#[tauri::command]
async fn r_data_rows(state: State<'_, AppState>, name: String, offset: u32, count: u32, sort_by: String, descending: bool) -> CommandResult<Value> {
    let call = rsession::helpers::data_rows_call(&name, offset, count.min(500), &sort_by, descending);
    let text = current(&state).await?.query(&call).await.map_err(text_error)?;
    parse_helper_json(&text).map_err(text_error)
}

/// Which of the packages a file uses are not installed, for the banner that
/// offers to install them.
#[tauri::command]
async fn r_missing_packages(state: State<'_, AppState>, names: Vec<String>) -> CommandResult<Vec<String>> {
    if names.is_empty() {
        return Ok(Vec::new());
    }
    let call = rsession::helpers::missing_call(&names);
    let text = current(&state).await?.query(&call).await.map_err(text_error)?;
    serde_json::from_value(parse_helper_json(&text).map_err(text_error)?).map_err(text_error)
}

/// Matches new plots to the inspector's size and the display's pixel
/// density, so plots arrive sharp instead of being scaled after the fact.
/// Sets the default plot colors to the chosen color vision palette, for
/// base graphics and for ggplot2 discrete scales. Only hex colors pass, so
/// nothing but colors can reach R through this call.
#[tauri::command]
async fn r_set_palette(state: State<'_, AppState>, colors: Vec<String>) -> CommandResult<()> {
    let valid = colors.iter().all(|color| color.len() == 7 && color.starts_with('#') && color[1..].chars().all(|c| c.is_ascii_hexdigit()));
    if !valid || colors.is_empty() {
        return Err("plot colors must be hex values such as #1F5F8B".into());
    }
    let list: Vec<String> = colors.iter().map(|color| format!("\"{color}\"")).collect();
    let call = format!(".gf_palette(c({}))", list.join(", "));
    current(&state).await?.query(&call).await.map(|_| ()).map_err(text_error)
}

#[tauri::command]
async fn r_set_plot_size(state: State<'_, AppState>, width: f64, height: f64, ratio: f64) -> CommandResult<()> {
    // Rounded and bounded so a pane being dragged to nothing cannot ask R
    // for an impossible plot.
    let width = width.clamp(160.0, 4000.0).round();
    let height = height.clamp(120.0, 4000.0).round();
    let ratio = ratio.clamp(1.0, 4.0);
    let call = format!(".gf_plot_size({width}, {height}, {ratio})");
    current(&state).await?.query(&call).await.map(|_| ()).map_err(text_error)
}

/// Hands newly accepted files to the interface. They are also queued, in
/// case the interface is still starting and not yet listening.
fn deliver(app: &AppHandle, paths: Vec<PathBuf>) {
    let state = app.state::<AppState>();
    let accepted = accept(&state, paths);
    if accepted.is_empty() {
        return;
    }
    state.pending.lock().unwrap().extend(accepted.iter().cloned());
    let _ = app.emit("open-files", accepted);
}

/// Builds the app: plugins, shared state, the menu bar, and the commands
/// the interface may call. Anything not listed in `generate_handler!` cannot
/// be called from the interface at all.
pub fn run() {
    let settings_path = settings::settings_path();
    let loaded = settings::load(&settings_path);
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            settings_path,
            settings: StdMutex::new(loaded.clone()),
            allowed: StdMutex::new(files::Allowed::default()),
            pending: StdMutex::new(Vec::new()),
            project: StdMutex::new(None),
            chosen_folder: StdMutex::new(None),
            session: Mutex::new(None),
            generation: AtomicU64::new(0),
        })
        .manage(assistant::AssistantState::new())
        .manage(render::RenderState::default())
        .setup(move |app| {
            let state = menu::MenuState {
                layer: loaded.layer.clone(),
                output_layout: loaded.output_layout.clone(),
                auto_install: loaded.missing_packages == "auto",
                live_output: false,
            };
            let recent: Vec<String> = loaded.recent_files.iter().map(|recent| recent.path.clone()).collect();
            let projects: Vec<String> = loaded.recent_projects.iter().map(|recent| recent.path.clone()).collect();
            app.set_menu(menu::build(app.handle(), &state, &recent, &projects)?)?;
            // Scripts named on the command line, which is how Windows and
            // Linux pass a file that was double clicked.
            let arguments: Vec<PathBuf> = std::env::args().skip(1).map(PathBuf::from).collect();
            deliver(app.handle(), arguments);
            Ok(())
        })
        // Menu clicks become "menu" events carrying the command id, so the
        // interface runs the same code a shortcut or the palette would.
        .on_menu_event(|app, event| {
            let _ = app.emit("menu", event.id().0.clone());
        })
        .on_window_event(|window, event| match event {
            // Scripts dropped on the window open as tabs. Other files are
            // ignored, and the interface says which were skipped.
            tauri::WindowEvent::DragDrop(drop) => match drop {
                tauri::DragDropEvent::Enter { paths, .. } => {
                    let scripts = paths.iter().filter(|path| files::is_script(path)).count();
                    let _ = window.emit("drop-hover", scripts);
                }
                tauri::DragDropEvent::Leave => {
                    let _ = window.emit("drop-hover", -1);
                }
                tauri::DragDropEvent::Drop { paths, .. } => {
                    let _ = window.emit("drop-hover", -1);
                    let skipped = paths.iter().filter(|path| !files::is_script(path)).count();
                    if skipped > 0 {
                        let _ = window.emit("drop-skipped", skipped);
                    }
                    deliver(window.app_handle(), paths.clone());
                }
                _ => {}
            },
            // R is ended along with the window so no stray process remains.
            tauri::WindowEvent::Destroyed => {
                let state = window.app_handle().state::<AppState>();
                let session = state.session.try_lock().ok().and_then(|mut slot| slot.take());
                if let Some(session) = session {
                    tauri::async_runtime::block_on(session.shutdown());
                }
                // An Ollama the app started goes with it too.
                window.app_handle().state::<assistant::AssistantState>().shutdown();
                // So does a report still rendering, with every R it started.
                render::shutdown(window.app_handle());
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            list_r_installs,
            load_settings,
            save_settings,
            update_menu,
            choose_files,
            choose_save_path,
            reopen,
            forget_recent,
            remember_session,
            take_pending,
            choose_project,
            reopen_project,
            refresh_project,
            close_project,
            forget_project,
            choose_project_folder,
            create_project,
            read_text,
            write_text,
            save_plot,
            export_plot,
            current_session,
            r_complete,
            r_help,
            r_packages,
            r_preview,
            r_parse_problem,
            choose_data_file,
            start_session,
            shutdown_session,
            execute,
            is_complete,
            interrupt,
            send_input,
            r_objects,
            r_missing_packages,
            r_set_plot_size,
            r_set_palette,
            r_set_working_dir,
            r_data_meta,
            r_data_rows,
            assistant::assistant_status,
            assistant::assistant_connect,
            assistant::assistant_specs,
            assistant::assistant_catalog,
            assistant::assistant_install_runtime,
            assistant::assistant_pull,
            assistant::assistant_cancel_setup,
            assistant::assistant_delete,
            assistant::assistant_remove_runtime,
            assistant::assistant_ask,
            assistant::assistant_stop,
            render::render_start,
            render::render_stop,
            render::render_open,
        ])
        .build(tauri::generate_context!())
        .expect("the app could not start");

    app.run(|handle, event| {
        // Finder sends files opened with the app, or dropped on its Dock
        // icon, as this event rather than as command line arguments.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = &event {
            let paths = urls.iter().filter_map(|url| url.to_file_path().ok()).collect();
            deliver(handle, paths);
        }
        let _ = (handle, event);
    });
}
