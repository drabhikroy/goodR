//! Earlier versions of each file, kept as the file is saved and as its
//! code runs.
//!
//! Every save keeps a copy of what was saved, in the app's own folder, so a
//! person can see what changed since and take back all or part of an
//! earlier version. Each file has a folder of its own, named by a hash of
//! its path, holding one text file per version, named by the time it was
//! saved in milliseconds. Saves within the same five minutes, as autosave
//! makes them, fold into one version, so steady autosave keeps one version
//! every five minutes rather than hundreds.
//!
//! A version is also kept when code from the file runs without a problem,
//! whether or not it was saved, and is marked as one that ran (its name
//! ends in -ran). That is what lets a failed line offer the last version
//! that worked. A later save in the same five minutes never folds a
//! version that ran into itself, so that version stays.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

/// Saves in the same window of this many milliseconds replace each other.
const FOLD_MS: u64 = 5 * 60 * 1000;
/// The most versions kept for one file. The oldest go first.
const KEEP: usize = 100;

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
}

/// The time and the ran mark from a version's id, such as 1700000000000
/// or 1700000000000-ran. Anything else is not a version.
fn parse_id(id: &str) -> Option<(u64, bool)> {
    let (digits, ran) = match id.strip_suffix("-ran") {
        Some(digits) => (digits, true),
        None => (id, false),
    };
    if digits.is_empty() || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    Some((digits.parse().ok()?, ran))
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
            let (saved_at, ran) = parse_id(&id)?;
            Some(Version { id, saved_at, ran })
        })
        .collect();
    versions.sort_by(|a, b| b.saved_at.cmp(&a.saved_at));
    versions
}

/// One version's text. The id must be digits, with -ran at most, so
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
pub fn keep(root: &Path, file: &Path, contents: &str) -> io::Result<()> {
    keep_at(root, file, contents, now(), false)
}

/// Keeps a version of a file as it stood when its code ran without a
/// problem. If the latest version already holds this text, it is marked
/// as one that ran instead of being kept twice.
pub fn keep_ran(root: &Path, file: &Path, contents: &str) -> io::Result<()> {
    keep_at(root, file, contents, now(), true)
}

fn keep_at(root: &Path, file: &Path, contents: &str, time: u64, ran: bool) -> io::Result<()> {
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
        // A save in the same five minutes as the last one replaces it,
        // unless that one is the only version, kept as the starting point,
        // or it ran and this one did not.
        if latest.saved_at / FOLD_MS == time / FOLD_MS && versions.len() > 1 && (ran || !latest.ran) {
            fs::remove_file(dir.join(format!("{}.txt", latest.id)))?;
        }
    }
    let name = if ran { format!("{time}-ran.txt") } else { format!("{time}.txt") };
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
    fn saves_fold_together_and_the_first_state_is_kept() {
        let root = std::env::temp_dir().join(format!("goodr-history-{}", now()));
        let file = root.join("analysis.R");
        fs::create_dir_all(&root).unwrap();
        fs::write(&file, "x <- 1\n").unwrap();
        let store = root.join("history");
        keep_at(&store, &file, "x <- 2\n", 1_000_000, false).unwrap();
        // The file as it was, and the save.
        assert_eq!(list(&store, &file).len(), 2);
        // A save a minute later replaces the last one, not the first.
        keep_at(&store, &file, "x <- 3\n", 1_060_000, false).unwrap();
        let versions = list(&store, &file);
        assert_eq!(versions.len(), 2);
        assert_eq!(read(&store, &file, &versions[0].id).unwrap(), "x <- 3\n");
        assert_eq!(read(&store, &file, &versions[1].id).unwrap(), "x <- 1\n");
        // Saving the same text again adds nothing; an hour later adds one.
        // (5_000_000 is in a later five minutes than 1_060_000.)
        keep_at(&store, &file, "x <- 3\n", 5_000_000, false).unwrap();
        keep_at(&store, &file, "x <- 4\n", 5_000_000, false).unwrap();
        assert_eq!(list(&store, &file).len(), 3);
        assert!(read(&store, &file, "../settings").is_err());
        // An id that steps out of the file's folder is refused even when
        // there is a file to find there.
        fs::write(store.join("elsewhere.txt"), "not a version").unwrap();
        assert!(read(&store, &file, "../elsewhere").is_err());
        // Steady saves every 30 seconds for an hour keep one version per
        // five minutes, not one in all.
        for step in 0..120u64 {
            keep_at(&store, &file, &format!("x <- {step}\n"), 9_000_000 + step * 30_000, false).unwrap();
        }
        assert!(list(&store, &file).len() >= 13);
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_version_that_ran_is_marked_and_kept() {
        let root = std::env::temp_dir().join(format!("goodr-history-ran-{}", now()));
        let file = root.join("analysis.R");
        fs::create_dir_all(&root).unwrap();
        fs::write(&file, "x <- 1\n").unwrap();
        let store = root.join("history");
        keep_at(&store, &file, "x <- 2\n", 1_000_000, false).unwrap();
        // Running the text just saved marks that version rather than
        // keeping a second copy.
        keep_at(&store, &file, "x <- 2\n", 1_010_000, true).unwrap();
        let versions = list(&store, &file);
        assert_eq!(versions.len(), 2);
        assert!(versions[0].ran);
        assert_eq!(versions[0].id, "1000000-ran");
        assert_eq!(read(&store, &file, "1000000-ran").unwrap(), "x <- 2\n");
        // A save in the same five minutes keeps the version that ran.
        keep_at(&store, &file, "x <- oops\n", 1_060_000, false).unwrap();
        let versions = list(&store, &file);
        assert_eq!(versions.len(), 3);
        assert!(!versions[0].ran && versions[1].ran);
        // Unsaved text that ran is kept too, and replaces the save beside it.
        keep_at(&store, &file, "x <- 5\n", 1_070_000, true).unwrap();
        let versions = list(&store, &file);
        assert_eq!(versions.len(), 3);
        assert_eq!(read(&store, &file, &versions[0].id).unwrap(), "x <- 5\n");
        assert!(versions[0].ran && versions[1].ran);
        // Only digits with -ran at the end name a version.
        assert!(read(&store, &file, "1000000-ran/../x").is_err());
        assert!(read(&store, &file, "-ran").is_err());
        fs::remove_dir_all(&root).unwrap();
    }
}
