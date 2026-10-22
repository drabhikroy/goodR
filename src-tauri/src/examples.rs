//! The example project that ships inside the app. Its files are compiled
//! in, so they are always there, and copied into a folder the user can
//! see and change: R Examples, in their Documents folder.
//!
//! Opening the examples again brings that folder up to date without ever
//! overwriting the user's own work. A deleted file comes back. A file
//! still exactly as some version of the app shipped it is replaced by the
//! current one, and one the app no longer ships is removed. A file the
//! person has changed is left exactly as it is. Every shipped version is
//! recognized by a hash of its contents, listed in SHIPPED.

use anyhow::{anyhow, Result};
use std::path::{Path, PathBuf};

/// Each file as its path inside the project and its contents.
const FILES: &[(&str, &str)] = &[
    ("README.md", include_str!("../../examples/README.md")),
    ("01-first-steps.R", include_str!("../../examples/01-first-steps.R")),
    ("02-data-frames.R", include_str!("../../examples/02-data-frames.R")),
    ("03-plots.R", include_str!("../../examples/03-plots.R")),
    ("04-a-model.R", include_str!("../../examples/04-a-model.R")),
    ("05-when-things-go-wrong.R", include_str!("../../examples/05-when-things-go-wrong.R")),
    ("06-report.qmd", include_str!("../../examples/06-report.qmd")),
    ("07-notebook.Rmd", include_str!("../../examples/07-notebook.Rmd")),
    ("08-rmarkdown-basics.Rmd", include_str!("../../examples/08-rmarkdown-basics.Rmd")),
    ("shiny-basic/app.R", include_str!("../../examples/shiny-basic/app.R")),
    ("shiny-launches/app.R", include_str!("../../examples/shiny-launches/app.R")),
    ("shiny-launches/launches_by_year.csv", include_str!("../../examples/shiny-launches/launches_by_year.csv")),
    ("shiny-mistakes/app.R", include_str!("../../examples/shiny-mistakes/app.R")),
    ("shiny-night-sky/app.R", include_str!("../../examples/shiny-night-sky/app.R")),
    ("data/meteorites.csv", include_str!("../../examples/data/meteorites.csv")),
    ("data/exoplanets.csv", include_str!("../../examples/data/exoplanets.csv")),
    ("data/exoplanets-license.txt", include_str!("../../examples/data/exoplanets-license.txt")),
    ("data/launches.csv", include_str!("../../examples/data/launches.csv")),
    ("data/bright_stars.csv", include_str!("../../examples/data/bright_stars.csv")),
    ("data/bright_stars-license.txt", include_str!("../../examples/data/bright_stars-license.txt")),
];

/// Every version of every example file the app has shipped, as its path
/// and the FNV-1a hash of its contents. A file in the folder with one of
/// these hashes has not been changed by the user, so it is safe to
/// update or remove. A test checks that the current files are listed.
const SHIPPED: &[(&str, u64)] = &[
    ("01-first-steps.R", 0x0a6012c0a9e76142),
    ("01-first-steps.R", 0x170dba5f206c4a2d),
    ("01-first-steps.R", 0xb1f85c3bbb4e577d),
    ("01-first-steps.R", 0xe9ebeaeba57b2cf6),
    ("02-data-frames.R", 0x3b24d150684775a1),
    ("02-data-frames.R", 0xcec965f33abbb182),
    ("02-data-frames.R", 0xf6e33abef77222c1),
    ("03-plots.R", 0x3730aaefec521143),
    ("03-plots.R", 0x7f380193a0bc2610),
    ("03-plots.R", 0xcab865bb6e062c4c),
    ("04-a-model.R", 0x222a867dfd8565aa),
    ("04-a-model.R", 0xf1644e847391026d),
    ("04-a-model.R", 0xc54f3ebd0ce2ccff),
    ("05-when-things-go-wrong.R", 0xac5c2e37d0e0c27b),
    ("05-when-things-go-wrong.R", 0xbf83879d3a8c3d9d),
    ("06-report.qmd", 0x019702e3e0a85591),
    ("06-report.qmd", 0x90e7f853303106a5),
    ("06-report.qmd", 0xbc0a7f2311c549bf),
    ("06-report.qmd", 0xf2360d799baeeacc),
    ("07-notebook.Rmd", 0x6ab18e70d0c13d05),
    ("07-notebook.Rmd", 0x9631e298d0672660),
    ("08-rmarkdown-basics.Rmd", 0x9e9c0527a954eb2d),
    ("08-rmarkdown-basics.Rmd", 0xdbe371d1c800734f),
    ("README.md", 0x1523a9bcd707e01c),
    ("README.md", 0xc90bf564ac1c5281),
    ("README.md", 0xdd7444f52d24fae9),
    ("README.md", 0xe4668f1d00b5ae59),
    ("README.md", 0xa283e74c2419e435),
    ("app/app.R", 0x5bbb3ee716a9757e),
    ("app/app.R", 0x5e93be08b65ce3ee),
    ("data/bird_nights.csv", 0xb7ea7ee146213ce6),
    ("data/bird_species.csv", 0x415e72d39ded704f),
    ("data/bright_stars-license.txt", 0x96334f0917daec58),
    ("data/bright_stars.csv", 0xd68f3e67d17599f5),
    ("data/exoplanets-license.txt", 0x411c0422c37b7d38),
    ("data/exoplanets.csv", 0xdc5a596fafe650c2),
    ("data/garden.csv", 0x2e0e6d95a843a52e),
    ("data/launches.csv", 0xf7d5b78e59c482fa),
    ("data/meteorites.csv", 0x77419cf1167a5f76),
    ("shiny-basic/app.R", 0xedeb2ff066b683b1),
    ("shiny-basic/app.R", 0xf4e7083c612eb4df),
    ("shiny-launches/app.R", 0x3446057f6dc71b43),
    ("shiny-launches/launches_by_year.csv", 0x1d353b76f1864be9),
    ("shiny-mistakes/app.R", 0x72e35bb984bd72b2),
    ("shiny-mistakes/app.R", 0xd00b973a6bc458c0),
    ("shiny-night-sky/app.R", 0x7bf7e08bbc9d8681),
];

/// The FNV-1a hash of some bytes, which stays the same on every system and
/// in every version of Rust, unlike the standard library's hasher.
fn fnv(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf29ce484222325, |hash, byte| (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3))
}

/// Whether a file's contents are exactly as some version of the app
/// shipped them at that path.
fn as_shipped(relative: &str, bytes: &[u8]) -> bool {
    let hash = fnv(bytes);
    SHIPPED.iter().any(|(path, known)| *path == relative && *known == hash)
}

/// The project file's name, which is also the project's name in the app.
const PROJECT_FILE: &str = "R Examples.Rproj";

const RPROJ: &str = "Version: 1.0\n\nRestoreWorkspace: No\nSaveWorkspace: No\nAlwaysSaveHistory: Default\n\nEnableCodeIndexing: Yes\nUseSpacesForTab: Yes\nNumSpacesForTab: 2\nEncoding: UTF-8\n";

/// Brings the examples in `folder` up to date and returns the project
/// file: missing files are added, unchanged ones from an earlier version
/// are replaced or removed, and changed ones are kept.
pub fn install(folder: &Path) -> Result<PathBuf> {
    std::fs::create_dir_all(folder)?;
    for (relative, contents) in FILES {
        let path = folder.join(relative);
        if path.exists() {
            let current = std::fs::read(&path)?;
            if current == contents.as_bytes() || !as_shipped(relative, &current) {
                continue;
            }
        }
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&path, contents)?;
    }
    // Files an earlier version shipped and this one does not, still as they
    // came, are removed, along with a folder they leave empty.
    for (relative, _) in SHIPPED {
        if FILES.iter().any(|(path, _)| path == relative) {
            continue;
        }
        let path = folder.join(relative);
        let Ok(current) = std::fs::read(&path) else { continue };
        if as_shipped(relative, &current) {
            std::fs::remove_file(&path)?;
            if let Some(parent) = path.parent().filter(|parent| *parent != folder) {
                let _ = std::fs::remove_dir(parent);
            }
        }
    }
    let project = folder.join(PROJECT_FILE);
    if !project.exists() {
        std::fs::write(&project, RPROJ)?;
    }
    Ok(project)
}

/// Where the examples go: R Examples in the Documents folder, or in the
/// home folder on a system without one.
pub fn default_folder() -> Result<PathBuf> {
    let base = dirs::document_dir().or_else(dirs::home_dir).ok_or_else(|| anyhow!("There is no Documents or home folder to put the examples in."))?;
    Ok(base.join("R Examples"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installs_every_file_and_keeps_changes() {
        let dir = std::env::temp_dir().join(format!("goodr-examples-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let project = install(&dir).unwrap();
        assert!(project.ends_with(PROJECT_FILE));
        for (relative, _) in FILES {
            assert!(dir.join(relative).exists(), "{relative} was not copied");
        }
        // A changed file stays changed, and a deleted one comes back.
        std::fs::write(dir.join("01-first-steps.R"), "x <- 1\n").unwrap();
        std::fs::remove_file(dir.join("03-plots.R")).unwrap();
        install(&dir).unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("01-first-steps.R")).unwrap(), "x <- 1\n");
        assert!(dir.join("03-plots.R").exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn unchanged_old_files_are_updated_or_removed_and_changed_ones_kept() {
        let dir = std::env::temp_dir().join(format!("goodr-examples-old-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("data")).unwrap();
        // A script the user edited is kept as they left it.
        std::fs::write(dir.join("01-first-steps.R"), "# my own notes\n").unwrap();
        install(&dir).unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("01-first-steps.R")).unwrap(), "# my own notes\n");
        // A file that is exactly a shipped version is brought up to date.
        let current = FILES.iter().find(|(path, _)| *path == "03-plots.R").unwrap().1;
        assert!(as_shipped("03-plots.R", current.as_bytes()));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn every_current_file_is_listed_as_shipped() {
        for (relative, contents) in FILES {
            assert!(as_shipped(relative, contents.as_bytes()), "{relative} changed; add its hash to SHIPPED: {:#018x}", fnv(contents.as_bytes()));
        }
    }

    /// Every file in the examples folder is listed, so none is left out of
    /// the app by mistake when a new one is added.
    #[test]
    fn every_example_file_is_listed() {
        fn walk(dir: &Path, root: &Path, found: &mut Vec<String>) {
            for entry in std::fs::read_dir(dir).unwrap().flatten() {
                let path = entry.path();
                if path.is_dir() {
                    walk(&path, root, found);
                } else {
                    found.push(path.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/"));
                }
            }
        }
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../examples");
        let mut found = Vec::new();
        walk(&root, &root, &mut found);
        for file in found {
            assert!(FILES.iter().any(|(relative, _)| *relative == file), "{file} is in examples but not in FILES");
        }
    }
}
