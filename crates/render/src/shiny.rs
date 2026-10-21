//! Running Shiny apps with the user's own R.
//!
//! An app runs in its own Rscript, as a report renders, so the console
//! stays free to try things while the app is open, and the app sees only
//! what its own code makes. It listens on a loopback port chosen here, so
//! nothing outside the computer can reach it, and the App pane shows it
//! from that address.
//!
//! Shiny watches the app's folder while it runs and reloads the app when a
//! file in it is saved, so editing an app is: change a line, save, look.

use crate::parse;
use crate::plan::Plan;
use serde::Serialize;
use std::ffi::OsString;
use std::path::Path;

/// What the app's R prints when Shiny is not installed, so that case can be
/// told apart from every other failure without reading R's wording, which
/// changes with the language R runs in.
pub const NO_SHINY_MARKER: &str = "@@goodr-no-shiny@@";

/// The R that runs an app. The app and port arrive as command line
/// arguments rather than inside the code, so no path can change what the
/// code does.
const APP_CALL: &str = r#"args <- commandArgs(TRUE)
if (!requireNamespace("shiny", quietly = TRUE)) {
  cat("@@goodr-no-shiny@@\n")
  quit(status = 3)
}
options(shiny.autoreload = TRUE)
shiny::runApp(args[1], port = as.integer(args[2]), host = "127.0.0.1", launch.browser = FALSE)"#;

/// What the export's R prints when shinylive is not installed.
pub const NO_SHINYLIVE_MARKER: &str = "@@goodr-no-shinylive@@";

/// The R that exports an app as a web page with shinylive. The page runs
/// R in the browser through WebAssembly, so whoever opens it needs no R.
/// shinylive bundles every file in the app's folder. A single file app is
/// copied alone into a folder of its own first, as app.R, so nothing else
/// beside it is bundled.
const EXPORT_CALL: &str = r#"args <- commandArgs(TRUE)
if (!requireNamespace("shinylive", quietly = TRUE)) {
  cat("@@goodr-no-shinylive@@
")
  quit(status = 4)
}
app <- args[1]
if (identical(args[3], "file")) {
  folder <- file.path(tempdir(), "app")
  dir.create(folder)
  file.copy(app, file.path(folder, "app.R"))
  app <- folder
}
shinylive::export(app, args[2])"#;

/// Why an app stopped running, in a form the interface can explain.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AppFailure {
    /// The R chosen in the app is no longer where it was.
    NoR,
    /// The shiny package is not installed in that R.
    NoShiny,
    /// The shinylive package, which exports an app as a web page, is not
    /// installed in that R.
    NoShinylive,
    /// A file of the app would not parse. Lines and columns count from one,
    /// as R's parser gives them, and `file` is the full path R read.
    #[serde(rename_all = "camelCase")]
    Parse { file: String, line: u32, column: u32, message: String },
    /// The app's R ended with an error, with the clearest lines of R's
    /// own message.
    Ended { message: String },
    /// The user pressed Stop.
    Stopped,
}

/// What one printed line means while an app runs.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AppLine {
    /// Shiny is ready, at this address.
    Listening(String),
    /// Something inside the running app failed, such as code in a render
    /// function. The app keeps running, and the message is R's own.
    Problem(String),
    /// Anything else, kept for the log.
    Text,
}

/// Whether a file is one Shiny treats as part of an app folder by its name
/// alone. Such an app runs from its folder, so ui.R and server.R are read
/// together. Any other script runs as a single file app.
fn is_app_file_name(path: &Path) -> bool {
    matches!(path.file_name().and_then(|name| name.to_str()), Some("app.R" | "ui.R" | "server.R" | "global.R"))
}

/// Decides how to run the app in `source` with `rscript`, on `port`.
pub fn plan(source: &Path, rscript: &Path, port: u16) -> Result<Plan, AppFailure> {
    if !rscript.is_file() {
        return Err(AppFailure::NoR);
    }
    let dir = source.parent().map(Path::to_path_buf).unwrap_or_default();
    // The app runs in its own folder, so "data.csv" in its code means the
    // file beside it, as it will when the app is shared.
    let app: OsString = if is_app_file_name(source) { ".".into() } else { source.file_name().unwrap_or_default().to_os_string() };
    let env = vec![("NO_COLOR".to_string(), OsString::from("1"))];
    let args = vec![OsString::from("-e"), OsString::from(APP_CALL), app, OsString::from(port.to_string())];
    Ok(Plan { program: rscript.to_path_buf(), args, env, dir })
}

/// Plans exporting the app in `source` as a web page into `dest`, a
/// folder that does not exist yet.
pub fn export_plan(source: &Path, dest: &Path, rscript: &Path) -> Result<Plan, AppFailure> {
    if !rscript.is_file() {
        return Err(AppFailure::NoR);
    }
    let dir = source.parent().map(Path::to_path_buf).unwrap_or_default();
    let (app, kind): (OsString, &str) = if is_app_file_name(source) { (".".into(), "folder") } else { (source.as_os_str().to_os_string(), "file") };
    let env = vec![("NO_COLOR".to_string(), OsString::from("1"))];
    let args = vec![OsString::from("-e"), OsString::from(EXPORT_CALL), app, dest.as_os_str().to_os_string(), OsString::from(kind)];
    Ok(Plan { program: rscript.to_path_buf(), args, env, dir })
}

// A web page for a large folder is slow to load and is almost never what
// was meant, so the listing stops here and says so.
const MAX_BUNDLED: usize = 400;

/// The files an export bundles, by path relative to the app's folder: every
/// file in the folder but hidden ones, as shinylive lists them, or the
/// script alone for a single file app. Only names are read. The interface
/// shows this list before anything is made, since a web page can be seen
/// by anyone it is shared with.
pub fn bundled_files(source: &Path) -> (Vec<String>, bool) {
    if !is_app_file_name(source) {
        return (vec![source.file_name().map(|name| name.to_string_lossy().to_string()).unwrap_or_default()], false);
    }
    let Some(root) = source.parent() else { return (Vec::new(), false) };
    let mut found = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            if entry.file_name().to_string_lossy().starts_with('.') {
                continue;
            }
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else {
                found.push(path.strip_prefix(root).unwrap_or(&path).to_string_lossy().replace('\\', "/"));
                if found.len() >= MAX_BUNDLED {
                    found.sort();
                    return (found, true);
                }
            }
        }
    }
    found.sort();
    (found, false)
}

/// Works out why an export failed, from the lines its R printed.
pub fn diagnose_export(lines: &[String]) -> AppFailure {
    if lines.iter().any(|line| line.trim() == NO_SHINYLIVE_MARKER) {
        return AppFailure::NoShinylive;
    }
    match diagnose(lines) {
        AppFailure::NoShiny => AppFailure::NoShinylive,
        other => other,
    }
}

/// A port on the loopback address that nothing is using right now. The
/// system picks it, so two apps, or this app and another program, never
/// ask for the same one.
pub fn free_port() -> std::io::Result<u16> {
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0))?;
    Ok(listener.local_addr()?.port())
}

/// Waits until something accepts connections at `url`, for up to ten
/// seconds. Shiny prints its address a moment before it starts answering,
/// and a pane that loaded in that moment would show the web view's own
/// error page instead of the app.
pub async fn wait_until_answering(url: &str) -> bool {
    let address = url.trim_start_matches("http://").trim_end_matches('/').to_string();
    for _ in 0..100 {
        if tokio::net::TcpStream::connect(&address).await.is_ok() {
            return true;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    false
}

/// Reads one line, already free of color codes.
pub fn classify(line: &str) -> AppLine {
    let trimmed = line.trim();
    if let Some(url) = trimmed.strip_prefix("Listening on ") {
        // Shiny prints the address it bound, which is always loopback here.
        // Anything else is not the app's own line.
        // Only a bare port may follow the address, so a line such as
        // http://127.0.0.1:80@example.com cannot pass for it.
        let url = url.trim();
        let port = url.strip_prefix("http://127.0.0.1:").map(|rest| rest.trim_end_matches('/'));
        if port.is_some_and(|port| port.parse::<u16>().is_ok()) {
            return AppLine::Listening(url.to_string());
        }
    }
    // Shiny reports an error inside a running app as a warning, so the app
    // can carry on: "Warning: Error in f: message", then a stack trace.
    if let Some(rest) = trimmed.strip_prefix("Warning: Error in ") {
        let message = rest.split_once(": ").map(|(_, message)| message).unwrap_or(rest);
        return AppLine::Problem(message.trim().to_string());
    }
    AppLine::Text
}

/// Works out why an app's R ended with an error, from the lines it printed.
pub fn diagnose(lines: &[String]) -> AppFailure {
    if lines.iter().any(|line| line.trim() == NO_SHINY_MARKER) {
        return AppFailure::NoShiny;
    }
    // A parse error names the file, line, and column on the line after
    // "Error in parse(", so the spot can be marked in the editor.
    if let Some(index) = lines.iter().position(|line| line.trim_start().starts_with("Error in parse(")) {
        if let Some(failure) = lines.get(index + 1).and_then(|line| parse_spot(line.trim())) {
            return failure;
        }
    }
    let message = parse::error_message(lines).unwrap_or_else(|| {
        let useful: Vec<&str> = lines.iter().map(|line| line.trim()).filter(|line| !line.is_empty() && *line != "Execution halted").collect();
        useful[useful.len().saturating_sub(4)..].join("\n")
    });
    AppFailure::Ended { message }
}

/// Reads "/path/app.R:4:0: unexpected end of input". The path itself may
/// hold colons, as on Windows, so the numbers are found from the right.
fn parse_spot(line: &str) -> Option<AppFailure> {
    let (head, message) = line.split_once(": ").filter(|(head, _)| head.matches(':').count() >= 2)?;
    // The first ": " can fall inside a Windows path only before the drive's
    // backslash, which never has a space after it, so this split is safe.
    let mut parts = head.rsplitn(3, ':');
    let column: u32 = parts.next()?.parse().ok()?;
    let line_number: u32 = parts.next()?.parse().ok()?;
    let file = parts.next()?.to_string();
    Some(AppFailure::Parse { file, line: line_number, column, message: message.trim().to_string() })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn rscript(dir: &Path) -> PathBuf {
        let path = dir.join("Rscript");
        std::fs::write(&path, "").unwrap();
        path
    }

    #[test]
    fn an_app_folder_runs_from_the_folder_and_a_single_file_runs_alone() {
        let dir = tempfile::tempdir().unwrap();
        let rscript = rscript(dir.path());
        let folder = plan(&dir.path().join("app.R"), &rscript, 4321).unwrap();
        assert_eq!(folder.args[2..], [OsString::from("."), OsString::from("4321")]);
        assert_eq!(folder.dir, dir.path());
        // ui.R and server.R are read together, so either one runs the folder.
        assert_eq!(plan(&dir.path().join("server.R"), &rscript, 1).unwrap().args[2], OsString::from("."));
        let single = plan(&dir.path().join("explore.R"), &rscript, 4321).unwrap();
        assert_eq!(single.args[2], OsString::from("explore.R"));
    }

    #[test]
    fn an_export_bundles_the_app_folder_or_the_single_file_alone() {
        let dir = tempfile::tempdir().unwrap();
        let rscript = rscript(dir.path());
        let app = dir.path().join("app");
        std::fs::create_dir_all(app.join("data")).unwrap();
        std::fs::write(app.join("app.R"), "").unwrap();
        std::fs::write(app.join("data/survey.csv"), "").unwrap();
        std::fs::write(app.join(".Rhistory"), "").unwrap();
        let dest = dir.path().join("app-web");
        let plan = export_plan(&app.join("app.R"), &dest, &rscript).unwrap();
        assert_eq!(plan.args[2..], [OsString::from("."), dest.clone().into_os_string(), OsString::from("folder")]);
        assert_eq!(plan.dir, app);
        // Hidden files stay out, as they do in shinylive's own listing.
        assert_eq!(bundled_files(&app.join("app.R")), (vec!["app.R".to_string(), "data/survey.csv".to_string()], false));
        let single = dir.path().join("explore.R");
        std::fs::write(&single, "").unwrap();
        assert_eq!(export_plan(&single, &dest, &rscript).unwrap().args[4], OsString::from("file"));
        assert_eq!(bundled_files(&single), (vec!["explore.R".to_string()], false));
        assert_eq!(diagnose_export(&["@@goodr-no-shinylive@@".to_string()]), AppFailure::NoShinylive);
    }

    #[test]
    fn a_missing_r_is_named() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(plan(&dir.path().join("app.R"), &dir.path().join("missing"), 1).unwrap_err(), AppFailure::NoR);
    }

    #[test]
    fn the_port_is_free_and_on_loopback() {
        let port = free_port().unwrap();
        assert!(port > 0);
        assert!(std::net::TcpListener::bind(("127.0.0.1", port)).is_ok());
    }

    #[test]
    fn readiness_and_problems_are_read() {
        assert_eq!(classify("Listening on http://127.0.0.1:5123"), AppLine::Listening("http://127.0.0.1:5123".into()));
        // Only a loopback address counts, so a line printed by the app's own
        // code cannot point the pane somewhere else.
        assert_eq!(classify("Listening on http://example.com:80"), AppLine::Text);
        assert_eq!(classify("Listening on http://127.0.0.1:80@example.com/"), AppLine::Text);
        assert_eq!(classify("Warning: Error in renderPlot: object 'bins' not found"), AppLine::Problem("object 'bins' not found".into()));
        assert_eq!(classify("Warning: Error in : boom"), AppLine::Problem("boom".into()));
        assert_eq!(classify("Loading required package: shiny"), AppLine::Text);
    }

    #[test]
    fn failures_are_named() {
        let lines = |text: &str| text.lines().map(str::to_string).collect::<Vec<_>>();
        assert_eq!(diagnose(&lines("@@goodr-no-shiny@@")), AppFailure::NoShiny);
        assert_eq!(
            diagnose(&lines("Error in shinyAppDir(x) : App dir must contain either app.R or server.R.\nCalls: <Anonymous> ...\nExecution halted")),
            AppFailure::Ended { message: "App dir must contain either app.R or server.R.".into() }
        );
        assert_eq!(diagnose(&lines("Error: object 'ui' not found\nExecution halted")), AppFailure::Ended { message: "object 'ui' not found".into() });
        // As R 4.3 with shiny 1.8 prints a syntax error in app.R.
        let parse = lines("Loading required package: shiny\nError in parse(file, keep.source = FALSE, srcfile = src, encoding = enc) : \n  /work/app/app.R:4:0: unexpected end of input\n2: ui <- fluidPage(\n3: shinyApp(ui, server)\n  ^\nError in sourceUTF8(fullpath, envir = new.env(parent = sharedEnv)) : \nExecution halted");
        assert_eq!(diagnose(&parse), AppFailure::Parse { file: "/work/app/app.R".into(), line: 4, column: 0, message: "unexpected end of input".into() });
        assert_eq!(parse_spot("C:\\work\\app.R:3:7: unexpected symbol"), Some(AppFailure::Parse { file: "C:\\work\\app.R".into(), line: 3, column: 7, message: "unexpected symbol".into() }));
        assert_eq!(diagnose(&lines("something odd\nExecution halted")), AppFailure::Ended { message: "something odd".into() });
    }
}
