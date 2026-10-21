//! Finding R installations.
//!
//! People often have more than one R: the CRAN installer, Homebrew, rig, and
//! system packages all put R in different places. We look in each standard
//! place, read the version of what we find, and let the person choose rather
//! than silently picking one (error prevention, Nielsen 1994).

use serde::Serialize;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct RInstall {
    /// Version as R reports it, for example "4.5.1".
    pub version: String,
    /// The R_HOME directory ark needs.
    pub home: PathBuf,
    /// Where the person would recognize it from, shown under the version.
    pub source: String,
}

/// Every R we can find, newest first, with duplicates removed.
pub fn find_installations() -> Vec<RInstall> {
    let mut by_home: BTreeMap<PathBuf, RInstall> = BTreeMap::new();
    for (home, source) in candidate_homes() {
        // Symlinks such as Versions/Current point at a real version folder,
        // so compare resolved paths to avoid listing one R twice.
        let Ok(real) = home.canonicalize() else { continue };
        if by_home.contains_key(&real) || !looks_like_r_home(&real) {
            continue;
        }
        let Some(version) = read_version(&real) else { continue };
        by_home.insert(real.clone(), RInstall { version, home: real, source });
    }
    let mut found: Vec<RInstall> = by_home.into_values().collect();
    found.sort_by(|a, b| compare_versions(&b.version, &a.version));
    found
}

/// Every place an R_HOME might be, with a label the person will recognize.
/// Duplicates and folders without R are filtered out later.
fn candidate_homes() -> Vec<(PathBuf, String)> {
    let mut homes = Vec::new();
    if let Ok(home) = std::env::var("R_HOME") {
        homes.push((PathBuf::from(home), "R_HOME setting".to_string()));
    }
    if cfg!(target_os = "macos") {
        let framework = Path::new("/Library/Frameworks/R.framework/Versions");
        for dir in sorted_children(framework) {
            if dir.file_name().is_some_and(|name| name == "Current") {
                continue;
            }
            homes.push((dir.join("Resources"), "CRAN installer".to_string()));
        }
        for cellar in ["/opt/homebrew/Cellar/r", "/usr/local/Cellar/r"] {
            for dir in sorted_children(Path::new(cellar)) {
                homes.push((dir.join("lib/R"), "Homebrew".to_string()));
            }
        }
    }
    if cfg!(target_os = "linux") {
        for fixed in ["/usr/lib/R", "/usr/lib64/R", "/usr/local/lib/R"] {
            homes.push((PathBuf::from(fixed), "System package".to_string()));
        }
        for dir in sorted_children(Path::new("/opt/R")) {
            homes.push((dir.join("lib/R"), "rig or /opt/R".to_string()));
        }
    }
    if cfg!(target_os = "windows") {
        for root in ["C:\\Program Files\\R", "C:\\Program Files (x86)\\R"] {
            for dir in sorted_children(Path::new(root)) {
                homes.push((dir, "CRAN installer".to_string()));
            }
        }
    }
    // Whatever `R` on the PATH reports covers installs in unusual places.
    if let Some(home) = r_home_from_path() {
        homes.push((home, "R on the PATH".to_string()));
    }
    homes
}

/// Folder contents in a stable order, so the list does not shuffle between
/// launches. A missing folder simply has no children.
fn sorted_children(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut children: Vec<PathBuf> = entries.flatten().map(|entry| entry.path()).collect();
    children.sort();
    children
}

fn looks_like_r_home(home: &Path) -> bool {
    home.join("bin").join(if cfg!(windows) { "R.exe" } else { "R" }).exists()
        || home.join("bin").join("x64").join("R.exe").exists()
}

fn r_home_from_path() -> Option<PathBuf> {
    let output = Command::new("R").arg("RHOME").output().ok()?;
    let text = String::from_utf8(output.stdout).ok()?;
    let line = text.lines().next()?.trim();
    (!line.is_empty()).then(|| PathBuf::from(line))
}

/// Reads the version from the installed header when we can find it, which
/// is instant, and only starts R itself as a fallback.
fn read_version(home: &Path) -> Option<String> {
    let headers = [home.join("include/Rversion.h"), PathBuf::from("/usr/share/R/include/Rversion.h")];
    for header in headers {
        let Ok(text) = std::fs::read_to_string(&header) else { continue };
        // The shared Debian header belongs to the system R only.
        if header.starts_with("/usr/share") && !home.starts_with("/usr/lib") {
            continue;
        }
        if let Some(version) = parse_version_header(&text) {
            return Some(version);
        }
    }
    let rscript = home.join("bin").join(if cfg!(windows) { "Rscript.exe" } else { "Rscript" });
    let output = Command::new(rscript).args(["-e", "cat(as.character(getRversion()))"]).output().ok()?;
    let version = String::from_utf8(output.stdout).ok()?.trim().to_string();
    (!version.is_empty()).then_some(version)
}

fn parse_version_header(text: &str) -> Option<String> {
    let field = |name: &str| {
        text.lines()
            .find(|line| line.contains(name))
            .and_then(|line| line.split('"').nth(1))
            .map(str::to_string)
    };
    let major = field("R_MAJOR")?;
    let minor = field("R_MINOR")?;
    Some(format!("{major}.{minor}"))
}

/// Orders "4.10.0" after "4.9.1", which plain string comparison gets wrong.
pub fn compare_versions(a: &str, b: &str) -> std::cmp::Ordering {
    let parts = |v: &str| v.split('.').map(|p| p.parse::<u32>().unwrap_or(0)).collect::<Vec<_>>();
    parts(a).cmp(&parts(b))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_header_is_parsed() {
        let text = "#define R_MAJOR  \"4\"\n#define R_MINOR  \"5.1\"\n";
        assert_eq!(parse_version_header(text).as_deref(), Some("4.5.1"));
    }

    #[test]
    fn versions_compare_numerically() {
        assert_eq!(compare_versions("4.10.0", "4.9.1"), std::cmp::Ordering::Greater);
        assert_eq!(compare_versions("4.5.1", "4.5.1"), std::cmp::Ordering::Equal);
    }
}
