//! Renders real reports with the Quarto and R on this computer.
//!
//! Each test needs R with the rmarkdown and knitr packages, and the Quarto
//! tests need Quarto too. When one is missing, the test says so and passes
//! without rendering, since many machines that build the app have no reason
//! to carry a full publishing setup. The continuous integration machine has
//! all of them, so there every test renders.

use render::run::{run, Stopper};
use render::{plan, Failure, Finished, Line, Target, Tools};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// The R home of the R on the PATH, which stands in for the R chosen in
/// the app.
fn r_home() -> Option<PathBuf> {
    let output = std::process::Command::new("R").args(["RHOME"]).output().ok()?;
    let home = PathBuf::from(String::from_utf8_lossy(&output.stdout).trim());
    home.is_dir().then_some(home)
}

/// The tools, or None with a note when this computer cannot render.
fn tools(need_quarto: bool) -> Option<Tools> {
    let Some(home) = r_home() else {
        eprintln!("R was not found, so this render test was skipped");
        return None;
    };
    let tools = Tools::locate(&home);
    let packages = std::process::Command::new(&tools.rscript)
        .args(["-e", "quit(status = !all(c('rmarkdown', 'knitr') %in% rownames(installed.packages())))"])
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    if !packages {
        eprintln!("rmarkdown or knitr is not installed, so this render test was skipped");
        return None;
    }
    if need_quarto && tools.quarto.is_none() {
        eprintln!("Quarto was not found, so this render test was skipped");
        return None;
    }
    Some(tools)
}

fn write(dir: &Path, name: &str, text: &str) -> PathBuf {
    let path = dir.join(name);
    std::fs::write(&path, text).unwrap();
    path
}

/// Renders and returns the outcome with the progress lines seen.
async fn render(source: &Path, target: Target, tools: &Tools) -> (render::Outcome, Vec<(u32, u32)>) {
    let plan = plan::plan(source, target, tools).unwrap();
    let mut progress = Vec::new();
    let outcome = run(&plan, Arc::new(Stopper::default()), |_, line| {
        if let Line::Progress { done, total, .. } = line {
            progress.push((*done, *total));
        }
    })
    .await
    .unwrap();
    (outcome, progress)
}

const GOOD_QMD: &str = "---\ntitle: \"Penguins\"\nformat: html\n---\n\n```{r setup}\nx <- c(3, 4, 5)\n```\n\nThe mean is `r mean(x)`.\n\n```{r plot-it}\nplot(x)\n```\n";

#[tokio::test]
async fn a_quarto_document_renders_to_html_with_progress() {
    let Some(tools) = tools(true) else { return };
    let dir = tempfile::tempdir().unwrap();
    let source = write(dir.path(), "report.qmd", GOOD_QMD);
    let (outcome, progress) = render(&source, Target::AsWritten, &tools).await;
    assert_eq!(outcome.finished, Finished::Done, "{}", outcome.lines.join("\n"));
    assert_eq!(outcome.outputs, vec![dir.path().join("report.html")]);
    assert!(dir.path().join("report.html").is_file());
    assert!(progress.iter().any(|(done, total)| *done == *total), "progress reached the end: {progress:?}");
}

#[tokio::test]
async fn a_quarto_document_renders_to_word_and_to_pdf_without_latex() {
    let Some(tools) = tools(true) else { return };
    let dir = tempfile::tempdir().unwrap();
    let source = write(dir.path(), "report.qmd", GOOD_QMD);
    let (word, _) = render(&source, Target::Word, &tools).await;
    assert_eq!(word.outputs, vec![dir.path().join("report.docx")]);
    let (pdf, _) = render(&source, Target::Pdf, &tools).await;
    assert_eq!(pdf.finished, Finished::Done, "{}", pdf.lines.join("\n"));
    assert_eq!(pdf.outputs, vec![dir.path().join("report.pdf")]);
    // Typst makes the PDF directly, so no LaTeX files are left behind.
    assert!(!dir.path().join("report.tex").exists());
}

#[tokio::test]
async fn a_failing_quarto_chunk_is_named_with_its_lines_and_message() {
    let Some(tools) = tools(true) else { return };
    let dir = tempfile::tempdir().unwrap();
    let text = "---\ntitle: \"Test\"\nformat: html\n---\n\n```{r setup}\nx <- 1:3\n```\n\n```{r totals}\nmean(x)\nnosuchthing\n```\n";
    let source = write(dir.path(), "broken.qmd", text);
    let (outcome, _) = render(&source, Target::AsWritten, &tools).await;
    match outcome.finished {
        Finished::Failed(Failure::Chunk { from, to, label, message }) => {
            // Lines 11 to 13 are the chunk's two lines of code and its fence.
            assert_eq!((from, to, label.as_str()), (11, 13, "totals"));
            assert!(message.contains("object 'nosuchthing' not found"), "{message}");
        }
        other => panic!("expected a chunk failure, got {other:?}\n{}", outcome.lines.join("\n")),
    }
}

#[tokio::test]
async fn an_r_markdown_document_renders_with_rmarkdown_and_reports_full_paths() {
    let Some(tools) = tools(false) else { return };
    if tools.pandoc_dir.is_none() && std::process::Command::new("pandoc").arg("--version").output().is_err() {
        eprintln!("Pandoc was not found, so this render test was skipped");
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let source = write(dir.path(), "notes.Rmd", "---\ntitle: \"Notes\"\noutput: html_document\n---\n\n```{r}\nsummary(cars)\n```\n");
    let (outcome, _) = render(&source, Target::AsWritten, &tools).await;
    assert_eq!(outcome.finished, Finished::Done, "{}", outcome.lines.join("\n"));
    assert_eq!(outcome.outputs.len(), 1);
    let made = std::fs::canonicalize(&outcome.outputs[0]).unwrap();
    assert_eq!(made, std::fs::canonicalize(dir.path().join("notes.html")).unwrap());
}

#[tokio::test]
async fn a_missing_package_in_r_markdown_is_reported_from_its_chunk() {
    let Some(tools) = tools(false) else { return };
    let dir = tempfile::tempdir().unwrap();
    let source = write(dir.path(), "notes.Rmd", "---\ntitle: \"Notes\"\noutput: html_document\n---\n\n```{r}\nlibrary(notapackageatall)\n```\n");
    let (outcome, _) = render(&source, Target::AsWritten, &tools).await;
    match outcome.finished {
        Finished::Failed(Failure::Chunk { from, message, .. }) => {
            assert_eq!(from, 7);
            assert!(message.contains("there is no package called"), "{message}");
        }
        other => panic!("expected a chunk failure, got {other:?}"),
    }
}

#[tokio::test]
async fn stop_ends_a_long_render_and_every_r_it_started() {
    let Some(tools) = tools(true) else { return };
    let dir = tempfile::tempdir().unwrap();
    let source = write(dir.path(), "slow.qmd", "---\ntitle: \"Slow\"\n---\n\n```{r}\nwriteLines(as.character(Sys.getpid()), 'r.pid')\nSys.sleep(60)\n```\n");
    let plan = plan::plan(&source, Target::AsWritten, &tools).unwrap();
    let stopper = Arc::new(Stopper::default());
    let pressed = stopper.clone();
    let pid_file = dir.path().join("r.pid");
    let watcher = pid_file.clone();
    // Stop is pressed once R is inside the slow chunk.
    tokio::spawn(async move {
        while !watcher.exists() {
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        pressed.stop();
    });
    let started = Instant::now();
    let outcome = run(&plan, stopper, |_, _| {}).await.unwrap();
    assert_eq!(outcome.finished, Finished::Failed(Failure::Stopped));
    assert!(started.elapsed() < Duration::from_secs(40), "stopped well before the chunk would end");
    // The R that Quarto started is gone too.
    let pid = std::fs::read_to_string(&pid_file).unwrap();
    tokio::time::sleep(Duration::from_millis(500)).await;
    // A process that has ended but whose parent has not yet collected it
    // shows as a zombie, which is no longer running.
    if cfg!(target_os = "linux") {
        let status = std::fs::read_to_string(format!("/proc/{}/status", pid.trim())).unwrap_or_default();
        let state = status.lines().find(|line| line.starts_with("State:")).unwrap_or("State: gone").to_string();
        assert!(state.contains("gone") || state.contains("Z"), "R process {} still running: {state}", pid.trim());
    }
}
