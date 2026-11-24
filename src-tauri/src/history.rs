//! Earlier versions of each file, kept as the file is saved and as its
//! code runs.
//!
//! Every save keeps a copy of what was saved, in the app's own folder, so a
//! person can see what changed since and take back all or part of an
//! earlier version. Each file has a folder of its own, named by a hash of
//! its path, holding one text file per version, named by the time it was
//! saved in milliseconds. Every save a person makes keeps its own version,
//! however soon after the last, since each is a step they chose to mark.
//! Only saves that autosave makes on its own fold together, one version for
//! each five minutes of steady typing rather than hundreds; those are named
//! with -auto at the end.
//!
//! A version is also kept when code from the file runs without a problem,
//! whether or not it was saved, and is marked as one that ran (its name
//! ends in -ran). That is what lets a failed line offer the last version
//! that worked. A version that ran is never folded into a later one.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

/// Autosaves in the same window of this many milliseconds replace each other.
const FOLD_MS: u64 = 5 * 60 * 1000;
/// The most versions kept for one file. The oldest go first.
const KEEP: usize = 200;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Version {
    /// The time it was saved, in milliseconds since 1970, which is also its
    /// name on disk.
    pub id: String,
    pub saved_at: u64,
    /// Set when this is how the file stood when its code ran without a
    /// problem.
    pub ran: bool,
    /// Set when autosave kept it, so a later autosave may replace it.
    #[serde(skip)]
    pub auto: bool,
}

/// The time and marks from a version's id, such as 1700000000000,
/// 1700000000000-ran, or 1700000000000-auto. Anything else is not a version.
fn parse_id(id: &str) -> Option<(u64, bool, bool)> {
    let (digits, ran, auto) = if let Some(digits) = id.strip_suffix("-ran") {
        (digits, true, false)
    } else if let Some(digits) = id.strip_suffix("-auto") {
        (digits, false, true)
    } else {
        (id, false, false)
    };
    if digits.is_empty() || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    Some((digits.parse().ok()?, ran, auto))
}

/// The folder for one file's versions.
fn folder(root: &Path, file: &Path) -> PathBuf {
    let hash = file.to_string_lossy().bytes().fold(0xcbf29ce484222325u64, |hash, byte| (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3));
    root.join(format!("{hash:016x}"))
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|time| time.as_millis() as u64).unwrap_or(0)
}

/// A file's versions, newest first.
pub fn list(root: &Path, file: &Path) -> Vec<Version> {
    let Ok(entries) = fs::read_dir(folder(root, file)) else { return Vec::new() };
    let mut versions: Vec<Version> = entries
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            let id = name.strip_suffix(".txt")?.to_string();
            let (saved_at, ran, auto) = parse_id(&id)?;
            Some(Version { id, saved_at, ran, auto })
        })
        .collect();
    versions.sort_by(|a, b| b.saved_at.cmp(&a.saved_at));
    versions
}

/// One version's text. The id must be digits, with -ran or -auto at most, so
/// nothing outside the file's folder can be named.
pub fn read(root: &Path, file: &Path, id: &str) -> io::Result<String> {
    if parse_id(id).is_none() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "not a version"));
    }
    fs::read_to_string(folder(root, file).join(format!("{id}.txt")))
}

/// Keeps a version of a file as it is about to be written. The first time,
/// the file as it was on disk is kept too, so the first save already has
/// something to compare with. A save that changes nothing adds nothing.
pub fn keep(root: &Path, file: &Path, contents: &str, automatic: bool) -> io::Result<()> {
    keep_at(root, file, contents, now(), if automatic { Kind::Auto } else { Kind::Saved })
}

/// Keeps a version of a file as it stood when its code ran without a
/// problem. If the latest version already holds this text, it is marked
/// as one that ran instead of being kept twice.
pub fn keep_ran(root: &Path, file: &Path, contents: &str) -> io::Result<()> {
    keep_at(root, file, contents, now(), Kind::Ran)
}

/// How a version came to be kept.
#[derive(Clone, Copy, PartialEq)]
enum Kind {
    /// A save the person made.
    Saved,
    /// A save autosave made on its own.
    Auto,
    /// The text as it stood when its code ran without a problem.
    Ran,
}

fn keep_at(root: &Path, file: &Path, contents: &str, time: u64, kind: Kind) -> io::Result<()> {
    let ran = kind == Kind::Ran;
    let dir = folder(root, file);
    fs::create_dir_all(&dir)?;
    // Versions can hold anything a script does, so only the user can read
    // them, whatever the script's own permissions.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(root, fs::Permissions::from_mode(0o700));
    }
    let mut versions = list(root, file);
    if versions.is_empty() {
        if let Ok(before) = fs::read_to_string(file) {
            if before != contents {
                fs::write(dir.join(format!("{}.txt", time.saturating_sub(1))), before)?;
                versions = list(root, file);
            }
        }
    }
    if let Some(latest) = versions.first() {
        if read(root, file, &latest.id).map(|text| text == contents).unwrap_or(false) {
            if ran && !latest.ran {
                fs::rename(dir.join(format!("{}.txt", latest.id)), dir.join(format!("{}-ran.txt", latest.saved_at)))?;
            }
            return Ok(());
        }
        // An autosave in the same five minutes as an earlier autosave
        // replaces it. Nothing else is replaced: not a save the person made,
        // not a version that ran, and not the starting point.
        if kind == Kind::Auto && latest.auto && latest.saved_at / FOLD_MS == time / FOLD_MS && versions.len() > 1 {
            fs::remove_file(dir.join(format!("{}.txt", latest.id)))?;
        }
    }
    let name = match kind {
        Kind::Ran => format!("{time}-ran.txt"),
        Kind::Auto => format!("{time}-auto.txt"),
        Kind::Saved => format!("{time}.txt"),
    };
    fs::write(dir.join(name), contents)?;
    for old in list(root, file).into_iter().skip(KEEP) {
        let _ = fs::remove_file(dir.join(format!("{}.txt", old.id)));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_save_is_kept_and_only_autosaves_fold() {
        let root = std::env::temp_dir().join(format!("goodr-history-{}", now()));
        let file = root.join("analysis.R");
        fs::create_dir_all(&root).unwrap();
        fs::write(&file, "x <- 1\n").unwrap();
        let store = root.join("history");
        keep_at(&store, &file, "x <- 2\n", 1_000_000, Kind::Saved).unwrap();
        // The file as it was, and the save.
        assert_eq!(list(&store, &file).len(), 2);
        // Saves a minute apart are each kept, as the person made each one.
        keep_at(&store, &file, "x <- 3\n", 1_060_000, Kind::Saved).unwrap();
        keep_at(&store, &file, "x <- 4\n", 1_070_000, Kind::Saved).unwrap();
        let versions = list(&store, &file);
        assert_eq!(versions.len(), 4);
        assert_eq!(read(&store, &file, &versions[0].id).unwrap(), "x <- 4\n");
        assert_eq!(read(&store, &file, &versions[3].id).unwrap(), "x <- 1\n");
        // Saving the same text again adds nothing.
        keep_at(&store, &file, "x <- 4\n", 1_080_000, Kind::Saved).unwrap();
        assert_eq!(list(&store, &file).len(), 4);
        // Autosaves in the same five minutes fold into one, but never into
        // a save the person made.
        keep_at(&store, &file, "x <- 5\n", 1_090_000, Kind::Auto).unwrap();
        keep_at(&store, &file, "x <- 6\n", 1_100_000, Kind::Auto).unwrap();
        let versions = list(&store, &file);
        assert_eq!(versions.len(), 5);
        assert_eq!(read(&store, &file, &versions[0].id).unwrap(), "x <- 6\n");
        assert_eq!(read(&store, &file, &versions[1].id).unwrap(), "x <- 4\n");
        assert!(read(&store, &file, "../settings").is_err());
        // An id that steps out of the file's folder is refused even when
        // there is a file to find there.
        fs::write(store.join("elsewhere.txt"), "not a version").unwrap();
        assert!(read(&store, &file, "../elsewhere").is_err());
        // Steady autosaves every 30 seconds for an hour keep about one
        // version per five minutes, not one each.
        for step in 0..120u64 {
            keep_at(&store, &file, &format!("x <- {step}\n"), 9_000_000 + step * 30_000, Kind::Auto).unwrap();
        }
        let count = list(&store, &file).len();
        assert!((15..=20).contains(&count), "{count}");
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_version_that_ran_is_marked_and_kept() {
        let root = std::env::temp_dir().join(format!("goodr-history-ran-{}", now()));
        let file = root.join("analysis.R");
        fs::create_dir_all(&root).unwrap();
        fs::write(&file, "x <- 1\n").unwrap();
        let store = root.join("history");
        keep_at(&store, &file, "x <- 2\n", 1_000_000, Kind::Saved).unwrap();
        // Running the text just saved marks that version rather than
        // keeping a second copy.
        keep_at(&store, &file, "x <- 2\n", 1_010_000, Kind::Ran).unwrap();
        let versions = list(&store, &file);
        assert_eq!(versions.len(), 2);
        assert!(versions[0].ran);
        assert_eq!(versions[0].id, "1000000-ran");
        assert_eq!(read(&store, &file, "1000000-ran").unwrap(), "x <- 2\n");
        // A later save keeps the version that ran.
        keep_at(&store, &file, "x <- oops\n", 1_060_000, Kind::Saved).unwrap();
        let versions = list(&store, &file);
        assert_eq!(versions.len(), 3);
        assert!(!versions[0].ran && versions[1].ran);
        // Unsaved text that ran is kept too, as a version of its own.
        keep_at(&store, &file, "x <- 5\n", 1_070_000, Kind::Ran).unwrap();
        let versions = list(&store, &file);
        assert_eq!(versions.len(), 4);
        assert_eq!(read(&store, &file, &versions[0].id).unwrap(), "x <- 5\n");
        assert!(versions[0].ran && !versions[1].ran && versions[2].ran);
        // Only digits with -ran at the end name a version.
        assert!(read(&store, &file, "1000000-ran/../x").is_err());
        assert!(read(&store, &file, "-ran").is_err());
        assert!(read(&store, &file, "-auto").is_err());
        fs::remove_dir_all(&root).unwrap();
    }
}
