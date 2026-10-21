//! Runs real Shiny apps with the R on this computer.
//!
//! Each test needs R with the shiny package. When either is missing, the
//! test says so and passes without running, as the render tests do. The
//! continuous integration machine has both, so there every test runs.

use render::run::{follow, Stopper};
use render::shiny::{self, AppFailure, AppLine};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

/// The Rscript of the R on the PATH, or None with a note when this
/// computer cannot run an app.
fn rscript() -> Option<PathBuf> {
    let output = std::process::Command::new("R").args(["RHOME"]).output().ok()?;
    let home = PathBuf::from(String::from_utf8_lossy(&output.stdout).trim());
    let rscript = render::find::rscript(&home);
    let has_shiny = std::process::Command::new(&rscript)
        .args(["-e", "quit(status = !requireNamespace('shiny', quietly = TRUE))"])
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    if !has_shiny {
        eprintln!("R or the shiny package was not found, so this app test was skipped");
        return None;
    }
    Some(rscript)
}

/// The page at `url`, read with a plain request so the test needs no web
/// client library.
fn fetch(url: &str) -> String {
    let address = url.trim_start_matches("http://");
    let mut stream = std::net::TcpStream::connect(address).unwrap();
    stream.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
    write!(stream, "GET / HTTP/1.0\r\nHost: {address}\r\n\r\n").unwrap();
    let mut page = String::new();
    let _ = stream.read_to_string(&mut page);
    page
}

const APP: &str = "library(shiny)\nui <- fluidPage(titlePanel(\"Old Faithful\"))\nserver <- function(input, output) {}\nshinyApp(ui, server)\n";

/// Starts the app in `dir`, and returns the address it listens on once it
/// is ready, with the handle to the run and its stopper.
async fn start(source: &Path, rscript: &Path) -> (String, Arc<Stopper>, tokio::task::JoinHandle<render::run::Followed>) {
    let plan = shiny::plan(source, rscript, shiny::free_port().unwrap()).unwrap();
    let stopper = Arc::new(Stopper::default());
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    let running = stopper.clone();
    let task = tokio::spawn(async move {
        follow(&plan, running, move |text| {
            if let AppLine::Listening(url) = shiny::classify(text) {
                let _ = tx.send(url);
            }
        })
        .await
        .unwrap()
    });
    let url = tokio::time::timeout(Duration::from_secs(60), rx.recv()).await.expect("the app was not ready within a minute").expect("the app ended before it was ready");
    assert!(shiny::wait_until_answering(&url).await, "the app named its address but never answered there");
    (url, stopper, task)
}

#[tokio::test]
async fn an_app_runs_reloads_when_saved_and_stops() {
    let Some(rscript) = rscript() else { return };
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("app.R");
    std::fs::write(&source, APP).unwrap();
    let (url, stopper, task) = start(&source, &rscript).await;
    assert!(url.starts_with("http://127.0.0.1:"));
    assert!(fetch(&url).contains("<title>Old Faithful</title>"));

    // Saving the app is enough for Shiny to serve the new version.
    std::fs::write(&source, APP.replace("Old Faithful", "Eruptions")).unwrap();
    let mut reloaded = false;
    for _ in 0..40 {
        tokio::time::sleep(Duration::from_millis(250)).await;
        if fetch(&url).contains("<title>Eruptions</title>") {
            reloaded = true;
            break;
        }
    }
    assert!(reloaded, "the app did not reload after its file changed");

    // Stop ends the app's R, so the port is free again.
    stopper.stop();
    let followed = tokio::time::timeout(Duration::from_secs(10), task).await.unwrap().unwrap();
    assert!(followed.stopped);
    let address = url.trim_start_matches("http://");
    assert!(std::net::TcpStream::connect(address).is_err(), "the app was still answering after Stop");
}

#[tokio::test]
async fn a_single_file_app_runs_from_its_own_name() {
    let Some(rscript) = rscript() else { return };
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("explore.R");
    std::fs::write(&source, APP).unwrap();
    let (url, stopper, task) = start(&source, &rscript).await;
    assert!(fetch(&url).contains("Old Faithful"));
    stopper.stop();
    task.await.unwrap();
}

#[tokio::test]
async fn an_app_that_will_not_start_says_why_and_where() {
    let Some(rscript) = rscript() else { return };
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("app.R");
    let run = |text: &str| {
        std::fs::write(&source, text).unwrap();
        let plan = shiny::plan(&source, &rscript, shiny::free_port().unwrap()).unwrap();
        async move {
            let followed = follow(&plan, Arc::new(Stopper::default()), |_| {}).await.unwrap();
            assert!(!followed.status.success());
            shiny::diagnose(&Vec::from(followed.lines))
        }
    };
    match run("library(shiny)\nui <- fluidPage(\nshinyApp(ui, server)\n").await {
        AppFailure::Parse { file, line, message, .. } => {
            assert!(file.ends_with("app.R"));
            assert_eq!(line, 4);
            assert!(message.contains("unexpected end of input"));
        }
        other => panic!("expected a parse failure, got {other:?}"),
    }
    assert_eq!(run("library(shiny)\nshinyApp(ui, server)\n").await, AppFailure::Ended { message: "object 'server' not found".into() });
}

/// Whether the shinylive package is installed, with a note when it is not.
fn has_shinylive(rscript: &Path) -> bool {
    let found = std::process::Command::new(rscript)
        .args(["-e", "quit(status = !requireNamespace('shinylive', quietly = TRUE))"])
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    if !found {
        eprintln!("The shinylive package was not found, so the export test was skipped");
    }
    found
}

#[tokio::test]
async fn an_app_exports_as_a_web_page_that_the_preview_serves() {
    let Some(rscript) = rscript() else { return };
    if !has_shinylive(&rscript) {
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let folder = dir.path().join("faithful");
    std::fs::create_dir_all(&folder).unwrap();
    std::fs::write(folder.join("app.R"), APP).unwrap();
    let dest = dir.path().join("faithful-web");
    let plan = shiny::export_plan(&folder.join("app.R"), &dest, &rscript).unwrap();
    // The first export downloads shinylive's web files, which takes a while.
    let followed = tokio::time::timeout(Duration::from_secs(600), follow(&plan, Arc::new(Stopper::default()), |_| {})).await.expect("the export finished within ten minutes").unwrap();
    assert!(followed.status.success(), "the export failed: {:?}", shiny::diagnose_export(&Vec::from(followed.lines)));
    assert!(dest.join("index.html").is_file());
    // The app's own code travels inside the page.
    let bundled = std::fs::read_to_string(dest.join("app.json")).unwrap();
    assert!(bundled.contains("Old Faithful"));
    let server = render::serve::serve(&dest).await.unwrap();
    assert!(fetch(server.url().trim_end_matches('/')).contains("200 OK"));
    server.stop();
}
