//! LaTeX for PDFs: the one on this computer, or a private TinyTeX.
//!
//! A PDF made with LaTeX is what journals and many templates expect, and
//! a document may contain LaTeX commands that only LaTeX understands. Most
//! people do not have LaTeX, and a full install is several gigabytes. So
//! the app looks for one the user already has, in the places the usual
//! installers put it, and otherwise offers to install TinyTeX, a small
//! LaTeX kept up by Posit that adds missing pieces as a document needs
//! them. The app's copy lives in its own data folder, so it is never
//! confused with one the user installed, and removing it is one step.
//!
//! Finding looks only at whether files exist. Naming a LaTeX, which runs
//! it once to ask its version, is separate, since it is slower.

use crate::plan::Plan;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

/// The programs that make a PDF from LaTeX. A folder with any of them is
/// a LaTeX.
const ENGINES: [&str; 3] = ["pdflatex", "xelatex", "lualatex"];

/// One LaTeX found: the folder holding its programs, and whether it is the
/// app's own copy.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Found {
    pub dir: PathBuf,
    pub builtin: bool,
}

fn program(dir: &Path, name: &str) -> PathBuf {
    dir.join(if cfg!(windows) { format!("{name}.exe") } else { name.to_string() })
}

/// Whether a folder holds a LaTeX engine.
pub fn has_engine(dir: &Path) -> bool {
    ENGINES.iter().any(|name| program(dir, name).is_file())
}

/// The folder of programs inside a TinyTeX, which sits under bin in a
/// folder named for the system, such as universal-darwin.
pub fn tinytex_bin(root: &Path) -> Option<PathBuf> {
    let bin = root.join("bin");
    let mut dirs: Vec<PathBuf> = std::fs::read_dir(&bin).ok()?.flatten().map(|entry| entry.path()).filter(|path| path.is_dir()).collect();
    dirs.sort();
    dirs.into_iter().find(|dir| has_engine(dir))
}

/// Folders in a pattern such as /usr/local/texlive/*/bin/*, newest year
/// first, for the places where each TeX Live year gets its own folder.
fn yearly(base: &Path, tail: &[&str]) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(base) else { return Vec::new() };
    let mut years: Vec<PathBuf> = entries.flatten().map(|entry| entry.path()).collect();
    years.sort();
    years.reverse();
    let mut found = Vec::new();
    for year in years {
        let mut dir = year;
        for part in tail {
            dir = dir.join(part);
        }
        if let Ok(platforms) = std::fs::read_dir(&dir) {
            found.extend(platforms.flatten().map(|entry| entry.path()));
        }
    }
    found
}

/// Where LaTeX installers put their programs on each system, besides the
/// PATH, which apps opened from the Dock or Finder on a Mac do not see.
fn known_locations() -> Vec<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    if cfg!(target_os = "macos") {
        let mut dirs = vec![
            PathBuf::from("/Library/TeX/texbin"),
            home.join("Library/TinyTeX/bin/universal-darwin"),
            home.join("Library/TinyTeX/bin/x86_64-darwin"),
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/usr/local/bin"),
        ];
        dirs.extend(yearly(Path::new("/usr/local/texlive"), &["bin"]));
        dirs
    } else if cfg!(windows) {
        let appdata = std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_default();
        let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_default();
        let programs = std::env::var_os("ProgramFiles").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("C:\\Program Files"));
        let mut dirs = vec![
            appdata.join("TinyTeX\\bin\\windows"),
            appdata.join("TinyTeX\\bin\\win32"),
            local.join("Programs\\MiKTeX\\miktex\\bin\\x64"),
            programs.join("MiKTeX\\miktex\\bin\\x64"),
        ];
        dirs.extend(yearly(Path::new("C:\\texlive"), &["bin"]));
        dirs
    } else {
        let mut dirs = vec![home.join(".TinyTeX/bin/x86_64-linux"), home.join(".TinyTeX/bin/aarch64-linux"), PathBuf::from("/usr/bin"), PathBuf::from("/usr/local/bin")];
        dirs.extend(yearly(Path::new("/usr/local/texlive"), &["bin"]));
        dirs
    }
}

/// Every LaTeX on this computer, the app's own first, then the rest in
/// the order the PATH and the usual install places give them, each once.
pub fn find(builtin_root: &Path) -> Vec<Found> {
    let mut found: Vec<Found> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut add = |dir: PathBuf, builtin: bool, found: &mut Vec<Found>| {
        let key = std::fs::canonicalize(&dir).unwrap_or_else(|_| dir.clone());
        if has_engine(&dir) && seen.insert(key) {
            found.push(Found { dir, builtin });
        }
    };
    if let Some(dir) = tinytex_bin(builtin_root) {
        add(dir, true, &mut found);
    }
    let on_path = std::env::var_os("PATH").map(|paths| std::env::split_paths(&paths).collect::<Vec<_>>()).unwrap_or_default();
    for dir in on_path.into_iter().chain(known_locations()) {
        add(dir, false, &mut found);
    }
    found
}

/// The LaTeX a render uses: the folder the user chose, when it still
/// has a LaTeX, or else the first found.
pub fn choose(builtin_root: &Path, chosen: &str) -> Option<PathBuf> {
    let all = find(builtin_root);
    if !chosen.is_empty() {
        if let Some(found) = all.iter().find(|found| found.dir == Path::new(chosen)) {
            return Some(found.dir.clone());
        }
    }
    all.into_iter().next().map(|found| found.dir)
}

/// A LaTeX's name in words, such as "TeX Live 2025" or "MiKTeX", read from
/// what its engine says about itself. A TinyTeX says so in its path.
pub fn describe(dir: &Path) -> String {
    let path = dir.to_string_lossy();
    let tinytex = path.contains("TinyTeX");
    let first_line = ENGINES
        .iter()
        .map(|name| program(dir, name))
        .find(|engine| engine.is_file())
        .and_then(|engine| std::process::Command::new(engine).arg("--version").output().ok())
        .map(|output| String::from_utf8_lossy(&output.stdout).lines().next().unwrap_or_default().to_string())
        .unwrap_or_default();
    name_from_version(&first_line, tinytex)
}

/// The distribution named in an engine's first line of --version, such
/// as "pdfTeX 3.141592653-2.6-1.40.26 (TeX Live 2024)".
pub fn name_from_version(line: &str, tinytex: bool) -> String {
    let year = line.split("TeX Live ").nth(1).and_then(|rest| rest.get(..4)).filter(|year| year.chars().all(|c| c.is_ascii_digit()));
    if tinytex {
        return year.map(|year| format!("TinyTeX, from TeX Live {year}")).unwrap_or_else(|| "TinyTeX".into());
    }
    if line.contains("MiKTeX") {
        return "MiKTeX".into();
    }
    year.map(|year| format!("TeX Live {year}")).unwrap_or_else(|| "LaTeX".into())
}

/// The R that installs TinyTeX into a folder of the app's own. It uses
/// the tinytex package, which Posit keeps up to date with where TinyTeX is
/// published, and installs that package first when it is missing. The
/// folder arrives as an argument, never inside the code.
const INSTALL_CALL: &str = r#"args <- commandArgs(TRUE)
if (!requireNamespace("tinytex", quietly = TRUE)) {
  if (identical(unname(getOption("repos")["CRAN"]), "@CRAN@")) options(repos = c(CRAN = "https://cloud.r-project.org"))
  install.packages("tinytex")
}
options(timeout = max(900, getOption("timeout")))
tinytex::install_tinytex(force = TRUE, dir = args[1], add_path = FALSE)
cat("\n@@goodr-latex-installed@@\n")"#;

/// The line printed once TinyTeX is in place.
pub const INSTALLED_MARKER: &str = "@@goodr-latex-installed@@";

/// How to install TinyTeX into `root` with the R at `rscript`.
pub fn install_plan(rscript: &Path, root: &Path) -> Plan {
    let dir = root.parent().map(Path::to_path_buf).unwrap_or_else(std::env::temp_dir);
    Plan {
        program: rscript.to_path_buf(),
        args: vec![OsString::from("-e"), OsString::from(INSTALL_CALL), root.as_os_str().to_os_string()],
        env: vec![("NO_COLOR".to_string(), OsString::from("1"))],
        dir,
    }
}

/// PATH with a LaTeX's folder first, so Pandoc, Quarto, and tinytex all
/// find that LaTeX before any other.
pub fn path_with(dir: &Path) -> OsString {
    let mut paths = vec![dir.to_path_buf()];
    if let Some(current) = std::env::var_os("PATH") {
        paths.extend(std::env::split_paths(&current));
    }
    std::env::join_paths(paths).unwrap_or_else(|_| dir.as_os_str().to_os_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_latex(dir: &Path) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(program(dir, "pdflatex"), "").unwrap();
    }

    #[test]
    fn the_apps_own_tinytex_is_found_first() {
        let root = tempfile::tempdir().unwrap();
        let bin = root.path().join("bin").join("universal-darwin");
        fake_latex(&bin);
        assert_eq!(tinytex_bin(root.path()), Some(bin.clone()));
        let found = find(root.path());
        assert_eq!(found[0], Found { dir: bin, builtin: true });
    }

    #[test]
    fn a_chosen_latex_is_used_while_it_exists() {
        let root = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        let bin = root.path().join("bin").join("x86_64-linux");
        fake_latex(&bin);
        // A folder that has no LaTeX any more falls back to the first one.
        assert_eq!(choose(root.path(), &other.path().to_string_lossy()), Some(bin.clone()));
        assert_eq!(choose(root.path(), ""), Some(bin));
        let empty = tempfile::tempdir().unwrap();
        assert!(tinytex_bin(empty.path()).is_none());
    }

    #[test]
    fn distributions_are_named_from_their_version_line() {
        assert_eq!(name_from_version("pdfTeX 3.141592653-2.6-1.40.26 (TeX Live 2024)", false), "TeX Live 2024");
        assert_eq!(name_from_version("pdfTeX 3.141592653-2.6-1.40.27 (TeX Live 2025)", true), "TinyTeX, from TeX Live 2025");
        assert_eq!(name_from_version("MiKTeX-pdfTeX 4.19 (MiKTeX 24.1)", false), "MiKTeX");
        assert_eq!(name_from_version("", false), "LaTeX");
    }

    #[test]
    fn the_install_passes_the_folder_as_an_argument() {
        let plan = install_plan(Path::new("/opt/R/bin/Rscript"), Path::new("/data/app/TinyTeX"));
        assert_eq!(plan.args.last().unwrap(), "/data/app/TinyTeX");
        assert_eq!(plan.dir, Path::new("/data/app"));
    }

    #[test]
    fn the_chosen_latex_comes_first_on_the_path() {
        let path = path_with(Path::new("/tex/bin"));
        assert_eq!(std::env::split_paths(&path).next().unwrap(), Path::new("/tex/bin"));
    }
}
