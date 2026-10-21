//! File access, limited to the scripts the person chose.
//!
//! A path becomes readable and writable only when the person picks it in
//! an Open or Save dialog, drops it on the window, opens it from Finder, or
//! reopens it from the recent list the app itself recorded. Opening a
//! project adds the scripts inside that project's folder, and nothing else
//! there: the app lists data files by name so they can be loaded into R,
//! but never reads them itself. The interface cannot grant access on its
//! own, so a bug or a hostile file name in the interface cannot reach any
//! other file on the disk.

use anyhow::{anyhow, Context, Result};
use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;

/// The kinds of file the editor opens: R scripts, R Markdown, and Quarto.
pub const EXTENSIONS: &[&str] = &["R", "r", "Rmd", "rmd", "qmd"];

/// True for a path whose extension marks it as something the editor opens.
pub fn is_script(path: &Path) -> bool {
    path.extension().and_then(|ext| ext.to_str()).is_some_and(|ext| EXTENSIONS.contains(&ext))
}

/// Data files the project sidebar lists by name, so they can be loaded
/// into R with one click. The app itself never opens them.
pub const DATA_EXTENSIONS: &[&str] = &["csv", "tsv", "xlsx", "xls", "rds", "RData", "rdata", "sav", "dta", "sas7bdat", "parquet", "feather", "json"];

/// Files the Import Data dialog offers. Dialog filters match case exactly
/// on some systems, so both spellings of the common ones are listed.
pub const IMPORT_EXTENSIONS: &[&str] = &[
    "csv", "CSV", "tsv", "txt", "xlsx", "xls", "XLSX", "rds", "RDS", "RData", "rdata", "rda", "sav", "dta", "sas7bdat", "parquet", "feather", "json",
];

/// The set of files the person has chosen in this run of the app, plus
/// the scripts of the open project.
#[derive(Default)]
pub struct Allowed {
    paths: HashSet<PathBuf>,
    project: Option<PathBuf>,
}

impl Allowed {
    /// Adds a file the person chose. Existing files are stored in their
    /// resolved form, so two spellings of one path count as the same file.
    pub fn grant(&mut self, path: &Path) -> Result<PathBuf> {
        let resolved = resolve(path)?;
        self.paths.insert(resolved.clone());
        Ok(resolved)
    }

    /// Confirms a path was chosen by the person, or is a script inside the
    /// open project, before anything touches it.
    pub fn check(&self, path: &Path) -> Result<PathBuf> {
        let resolved = resolve(path)?;
        let in_project = self.project.as_ref().is_some_and(|root| resolved.starts_with(root) && is_script(&resolved));
        if self.paths.contains(&resolved) || in_project {
            Ok(resolved)
        } else {
            Err(anyhow!("{} was not opened in this app. Open it with File, Open first.", path.display()))
        }
    }

    /// Makes the scripts inside a project folder available, replacing any
    /// project opened before. `None` closes the project.
    pub fn set_project(&mut self, root: Option<&Path>) -> Result<()> {
        self.project = match root {
            Some(root) => Some(root.canonicalize().context("the project folder is not available")?),
            None => None,
        };
        Ok(())
    }
}

/// Resolves links and relative parts. A file that does not exist yet, such
/// as a new save target, is resolved through its folder.
fn resolve(path: &Path) -> Result<PathBuf> {
    if path.exists() {
        return Ok(path.canonicalize()?);
    }
    let parent = path.parent().ok_or_else(|| anyhow!("{} has no folder", path.display()))?;
    let name = path.file_name().ok_or_else(|| anyhow!("{} has no file name", path.display()))?;
    Ok(parent.canonicalize()?.join(name))
}

/// Files above this size open slowly in an editor and are almost always
/// data rather than a script.
const MAX_TEXT_BYTES: u64 = 5 * 1024 * 1024;

pub fn read_text(path: &Path) -> Result<String> {
    let size = std::fs::metadata(path)?.len();
    if size > MAX_TEXT_BYTES {
        return Err(anyhow!("{} is {} MB, too large to open as a script", path.display(), size / 1024 / 1024));
    }
    let bytes = std::fs::read(path)?;
    String::from_utf8(bytes).map_err(|_| anyhow!("{} is not a text file", path.display()))
}

/// Writes through a temporary file and a rename, so a crash during a save
/// never leaves a half written script behind.
pub fn write_bytes(path: &Path, bytes: &[u8]) -> Result<()> {
    let temp = path.with_extension("goodfor-saving");
    std::fs::write(&temp, bytes)?;
    std::fs::rename(&temp, path)?;
    Ok(())
}

/// What the project sidebar shows: the scripts and the data files, by path
/// relative to the project folder.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub name: String,
    pub root: String,
    pub file: String,
    pub scripts: Vec<String>,
    pub data: Vec<String>,
}

/// Folders that hold tool bookkeeping or installed packages rather than
/// the person's work.
const SKIP_DIRS: &[&str] = &["renv", "packrat", "node_modules", "rsconnect", "__pycache__"];

/// The deepest folder level searched. Projects are rarely nested deeper,
/// and a limit keeps a project pointed at a huge folder from stalling.
const MAX_DEPTH: usize = 5;
const MAX_ENTRIES: usize = 4000;

/// Lists the scripts and data files in a project folder. Only names are
/// read, never contents.
pub fn scan_project(project_file: &Path) -> Result<ProjectInfo> {
    let root = project_file.parent().ok_or_else(|| anyhow!("the project file has no folder"))?.canonicalize()?;
    let mut scripts = Vec::new();
    let mut data = Vec::new();
    let mut seen = 0;
    let mut stack = vec![(root.clone(), 0)];
    while let Some((dir, depth)) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            seen += 1;
            if seen > MAX_ENTRIES {
                break;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            let path = entry.path();
            let Ok(kind) = entry.file_type() else { continue };
            if kind.is_dir() {
                if depth + 1 < MAX_DEPTH && !SKIP_DIRS.contains(&name.as_str()) {
                    stack.push((path, depth + 1));
                }
                continue;
            }
            let relative = path.strip_prefix(&root).unwrap_or(&path).to_string_lossy().replace('\\', "/");
            let ext = path.extension().and_then(|ext| ext.to_str()).unwrap_or("");
            if is_script(&path) {
                scripts.push(relative);
            } else if DATA_EXTENSIONS.contains(&ext) {
                data.push(relative);
            }
        }
    }
    // Top level files first, then by path, so the main script is near the top.
    let order = |a: &String, b: &String| a.matches('/').count().cmp(&b.matches('/').count()).then_with(|| a.to_lowercase().cmp(&b.to_lowercase()));
    scripts.sort_by(order);
    data.sort_by(order);
    let name = project_file.file_stem().map(|stem| stem.to_string_lossy().to_string()).unwrap_or_default();
    Ok(ProjectInfo { name, root: root.to_string_lossy().to_string(), file: project_file.to_string_lossy().to_string(), scripts, data })
}

/// True when git can be run, which decides whether a new project offers
/// to keep a history.
pub fn git_available() -> bool {
    Command::new("git").arg("--version").output().is_ok_and(|output| output.status.success())
}

const RPROJ: &str = "Version: 1.0\n\nRestoreWorkspace: No\nSaveWorkspace: No\nAlwaysSaveHistory: Default\n\nEnableCodeIndexing: Yes\nUseSpacesForTab: Yes\nNumSpacesForTab: 2\nEncoding: UTF-8\n";

const GITIGNORE: &str = ".Rproj.user/\n.Rhistory\n.RData\n.Ruserdata\n";

const ANALYSIS: &str = "# Analysis\n#\n# Run a line with Command Return, or the whole file with Command Shift Return.\n\n# First look ----\nhead(mtcars)\n\n# A simple model ----\nfit <- lm(mpg ~ wt, data = mtcars)\nconfint(fit)\n\nplot(mpg ~ wt, data = mtcars)\n";

const REPORT: &str = "---\ntitle: \"Report\"\nformat: html\n---\n\n## Overview\n\n```{r}\nsummary(mtcars$mpg)\n```\n";

const SHINY: &str = "library(shiny)\n\nui <- fluidPage(\n  titlePanel(\"Old Faithful\"),\n  sliderInput(\"bins\", \"Number of bins\", min = 5, max = 50, value = 20),\n  plotOutput(\"waiting_plot\")\n)\n\nserver <- function(input, output) {\n  output$waiting_plot <- renderPlot({\n    hist(faithful$waiting, breaks = input$bins, col = \"#1F5F8B\", border = \"white\",\n         main = \"Waiting time between eruptions\", xlab = \"Minutes\")\n  })\n}\n\nshinyApp(ui, server)\n";

/// Creates a project and returns its project file. "existing" turns a
/// folder the person already has into a project by adding the project file
/// and nothing else.
pub fn create_project(parent: &Path, name: &str, template: &str, git: bool) -> Result<PathBuf> {
    if template != "existing" && (name.trim().is_empty() || name.contains(['/', '\\', ':']) || name.starts_with('.')) {
        return Err(anyhow!("A project name cannot be empty, start with a period, or contain / \\ or :"));
    }
    let folder = if template == "existing" { parent.to_path_buf() } else { parent.join(name.trim()) };
    if template != "existing" {
        if folder.exists() {
            return Err(anyhow!("{} already exists. Choose another name.", folder.display()));
        }
        std::fs::create_dir_all(&folder)?;
    }
    let project_name = folder.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| name.to_string());
    let project_file = folder.join(format!("{project_name}.Rproj"));
    if !project_file.exists() {
        std::fs::write(&project_file, RPROJ)?;
    }
    match template {
        "analysis" => {
            std::fs::create_dir_all(folder.join("data"))?;
            std::fs::create_dir_all(folder.join("figures"))?;
            std::fs::write(folder.join("analysis.R"), ANALYSIS)?;
        }
        "report" => {
            std::fs::create_dir_all(folder.join("data"))?;
            std::fs::write(folder.join("report.qmd"), REPORT)?;
        }
        "shiny" => std::fs::write(folder.join("app.R"), SHINY)?,
        "existing" => {}
        other => return Err(anyhow!("unknown project template {other}")),
    }
    if git {
        if !folder.join(".gitignore").exists() {
            std::fs::write(folder.join(".gitignore"), GITIGNORE)?;
        }
        if !folder.join(".git").exists() {
            let status = Command::new("git").args(["init", "-q", "-b", "main"]).current_dir(&folder).status()?;
            if !status.success() {
                return Err(anyhow!("git could not start a history in {}", folder.display()));
            }
        }
    }
    Ok(project_file)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_chosen_files_pass() {
        let dir = tempfile::tempdir().unwrap();
        let chosen = dir.path().join("analysis.R");
        let other = dir.path().join("secret.txt");
        std::fs::write(&chosen, "1").unwrap();
        std::fs::write(&other, "2").unwrap();
        let mut allowed = Allowed::default();
        allowed.grant(&chosen).unwrap();
        assert!(allowed.check(&chosen).is_ok());
        assert!(allowed.check(&other).is_err());
        // A second spelling of the chosen file is the same file.
        assert!(allowed.check(&dir.path().join(".").join("analysis.R")).is_ok());
    }

    #[test]
    fn a_new_save_target_can_be_granted_before_it_exists() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("new.R");
        let mut allowed = Allowed::default();
        allowed.grant(&target).unwrap();
        write_bytes(&target, b"x <- 1\n").unwrap();
        assert!(allowed.check(&target).is_ok());
        assert_eq!(read_text(&target).unwrap(), "x <- 1\n");
        assert!(!dir.path().join("new.goodfor-saving").exists());
    }

    #[test]
    fn a_project_opens_its_scripts_and_lists_data_by_name_only() {
        let dir = tempfile::tempdir().unwrap();
        let project = create_project(dir.path(), "study", "analysis", false).unwrap();
        let root = project.parent().unwrap();
        std::fs::write(root.join("data/survey.csv"), "a,b\n1,2\n").unwrap();
        std::fs::write(root.join("notes.txt"), "private").unwrap();
        std::fs::create_dir_all(root.join("renv/library")).unwrap();
        std::fs::write(root.join("renv/library/skip.R"), "").unwrap();
        let info = scan_project(&project).unwrap();
        assert_eq!(info.name, "study");
        assert_eq!(info.scripts, vec!["analysis.R"]);
        assert_eq!(info.data, vec!["data/survey.csv"]);

        let mut allowed = Allowed::default();
        allowed.set_project(Some(root)).unwrap();
        assert!(allowed.check(&root.join("analysis.R")).is_ok());
        assert!(allowed.check(&root.join("new-script.R")).is_ok());
        // Data and other files stay out of reach of the app's own commands.
        assert!(allowed.check(&root.join("data/survey.csv")).is_err());
        assert!(allowed.check(&root.join("notes.txt")).is_err());
        assert!(allowed.check(&dir.path().join("outside.R")).is_err());
        allowed.set_project(None).unwrap();
        assert!(allowed.check(&root.join("analysis.R")).is_err());
    }

    #[test]
    fn each_template_creates_its_files() {
        let dir = tempfile::tempdir().unwrap();
        let report = create_project(dir.path(), "paper", "report", false).unwrap();
        assert!(report.ends_with("paper/paper.Rproj") && dir.path().join("paper/report.qmd").exists());
        let shiny = create_project(dir.path(), "app", "shiny", false).unwrap();
        assert!(shiny.parent().unwrap().join("app.R").exists());
        assert!(create_project(dir.path(), "paper", "report", false).is_err());
        assert!(create_project(dir.path(), "../x", "analysis", false).is_err());
        let existing = dir.path().join("mine");
        std::fs::create_dir_all(&existing).unwrap();
        assert!(create_project(&existing, "", "existing", false).unwrap().ends_with("mine/mine.Rproj"));
    }

    #[test]
    fn git_history_is_started_when_asked() {
        if !git_available() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let project = create_project(dir.path(), "tracked", "report", true).unwrap();
        let root = project.parent().unwrap();
        assert!(root.join(".git").is_dir() && root.join(".gitignore").exists());
    }

    #[test]
    fn scripts_are_recognized_by_extension() {
        assert!(is_script(Path::new("/a/analysis.R")));
        assert!(is_script(Path::new("/a/report.qmd")));
        assert!(is_script(Path::new("/a/notes.Rmd")));
        assert!(!is_script(Path::new("/a/data.csv")));
        assert!(!is_script(Path::new("/a/folder")));
    }
}
