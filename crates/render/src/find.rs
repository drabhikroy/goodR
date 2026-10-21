//! Finding the programs a render needs.
//!
//! Apps opened from the Dock or Finder on a Mac do not see the PATH a
//! terminal sets up, so Quarto is looked for in the places its installer
//! and the IDEs that bundle it put it, as well as on the PATH. R is never
//! searched for here: the app already knows which R the person chose, and a
//! report renders with that same R.

use std::path::{Path, PathBuf};

/// The programs one render may use.
#[derive(Clone, Debug)]
pub struct Tools {
    /// Quarto, when it is installed. R Markdown can render without it.
    pub quarto: Option<PathBuf>,
    /// The Rscript of the R chosen in the app.
    pub rscript: PathBuf,
    /// The folder holding a Pandoc that R Markdown can use, when one was
    /// found. Quarto carries its own, which serves both.
    pub pandoc_dir: Option<PathBuf>,
}

impl Tools {
    /// Finds Quarto and its Pandoc, and names the Rscript of `r_home`.
    pub fn locate(r_home: &Path) -> Tools {
        let quarto = find_quarto();
        let pandoc_dir = quarto.as_deref().and_then(pandoc_dir);
        Tools { quarto, rscript: rscript(r_home), pandoc_dir }
    }
}

/// The Rscript program inside an R installation.
pub fn rscript(r_home: &Path) -> PathBuf {
    let name = if cfg!(windows) { "Rscript.exe" } else { "Rscript" };
    r_home.join("bin").join(name)
}

/// Quarto, from QUARTO_PATH, the PATH, or a known install location.
pub fn find_quarto() -> Option<PathBuf> {
    // An explicit setting wins, which is also how the tests point at a
    // particular copy.
    if let Some(path) = std::env::var_os("QUARTO_PATH").map(PathBuf::from) {
        if path.is_file() {
            return Some(path);
        }
    }
    let name = if cfg!(windows) { "quarto.exe" } else { "quarto" };
    let on_path = std::env::var_os("PATH")
        .map(|paths| std::env::split_paths(&paths).map(|dir| dir.join(name)).collect::<Vec<_>>())
        .unwrap_or_default();
    on_path.into_iter().chain(known_locations()).find(|path| path.is_file())
}

/// Where Quarto's own installer puts it, and where RStudio and Positron
/// keep the copy they bundle, on each system.
fn known_locations() -> Vec<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    if cfg!(target_os = "macos") {
        vec![
            PathBuf::from("/Applications/quarto/bin/quarto"),
            PathBuf::from("/usr/local/bin/quarto"),
            PathBuf::from("/opt/homebrew/bin/quarto"),
            home.join("Applications/quarto/bin/quarto"),
            PathBuf::from("/Applications/RStudio.app/Contents/Resources/app/quarto/bin/quarto"),
            PathBuf::from("/Applications/Positron.app/Contents/Resources/app/quarto/bin/quarto"),
        ]
    } else if cfg!(windows) {
        let programs = std::env::var_os("ProgramFiles").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("C:\\Program Files"));
        let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_default();
        vec![
            programs.join("Quarto\\bin\\quarto.exe"),
            local.join("Programs\\Quarto\\bin\\quarto.exe"),
            programs.join("RStudio\\resources\\app\\bin\\quarto\\bin\\quarto.exe"),
            programs.join("Positron\\resources\\app\\quarto\\bin\\quarto.exe"),
        ]
    } else {
        vec![
            PathBuf::from("/usr/local/bin/quarto"),
            PathBuf::from("/opt/quarto/bin/quarto"),
            home.join(".local/bin/quarto"),
            PathBuf::from("/usr/lib/rstudio/resources/app/bin/quarto/bin/quarto"),
            PathBuf::from("/usr/share/positron/resources/app/quarto/bin/quarto"),
        ]
    }
}

/// The folder of the Pandoc that ships inside Quarto. Quarto keeps it in
/// bin/tools, under a folder for the processor on recent versions.
pub fn pandoc_dir(quarto: &Path) -> Option<PathBuf> {
    // The quarto on the PATH is often a link to the real install, and the
    // tools sit beside the real one.
    let real = std::fs::canonicalize(quarto).unwrap_or_else(|_| quarto.to_path_buf());
    let tools = real.parent()?.join("tools");
    let name = if cfg!(windows) { "pandoc.exe" } else { "pandoc" };
    let arch = if cfg!(target_arch = "aarch64") { "aarch64" } else { "x86_64" };
    [tools.join(arch), tools.clone(), tools.join("pandoc")]
        .into_iter()
        .find(|dir| dir.join(name).is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rscript_is_inside_the_chosen_r() {
        let path = rscript(Path::new("/opt/R/4.5.1/lib/R"));
        assert!(path.starts_with("/opt/R/4.5.1/lib/R/bin"));
    }

    #[test]
    fn pandoc_is_found_beside_a_linked_quarto() {
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("quarto/bin");
        let tools = bin.join("tools").join(if cfg!(target_arch = "aarch64") { "aarch64" } else { "x86_64" });
        std::fs::create_dir_all(&tools).unwrap();
        std::fs::write(bin.join("quarto"), "").unwrap();
        std::fs::write(tools.join(if cfg!(windows) { "pandoc.exe" } else { "pandoc" }), "").unwrap();
        assert_eq!(pandoc_dir(&bin.join("quarto")), Some(tools));
    }
}
