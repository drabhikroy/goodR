//! Finding and ending what a run left behind.
//!
//! Stopping a run ends its process group, which covers R, Pandoc, and most
//! of what R starts. It misses a program that put itself in a group of its
//! own, and callr and processx do exactly that for every background worker
//! they start. Such a worker outlives the app that asked for it, still
//! running and holding memory, because nothing else knows it exists.
//!
//! Every run is therefore started with a token in its environment, and a
//! program inherits its parent's environment wherever it sits in the
//! process tree. Once the run has ended, or has been stopped, whatever
//! still carries its token belongs to it and is ended too. The token is
//! unique to the run, so nothing else is ever named.
//!
//! On Windows the program and everything under it are ended by walking the
//! tree, so there is nothing to sweep.

use std::sync::atomic::{AtomicU64, Ordering};

/// The environment variable that carries a run's token.
pub const TOKEN_NAME: &str = "GOODR_RUN_TOKEN";

/// A token no other run has, in this app or in an earlier one.
pub fn token() -> String {
    static COUNT: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|since| since.as_nanos()).unwrap_or(0);
    format!("goodr-{}-{}-{}", std::process::id(), nanos, COUNT.fetch_add(1, Ordering::Relaxed))
}

/// Ends every process that still carries `token`, politely first and then
/// for good if any is left after `grace`. Does nothing when none is.
#[cfg(unix)]
pub fn end(token: &str, grace: std::time::Duration) {
    let mine = std::process::id() as i32;
    let alive = || members(token).into_iter().filter(|pid| *pid > 1 && *pid != mine).collect::<Vec<_>>();
    let found = alive();
    if found.is_empty() {
        return;
    }
    for pid in &found {
        // SAFETY: the pid is of a process that carries this run's own token.
        unsafe {
            libc::kill(*pid, libc::SIGTERM);
        }
    }
    let until = std::time::Instant::now() + grace;
    while std::time::Instant::now() < until {
        if alive().is_empty() {
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    for pid in alive() {
        // SAFETY: as above.
        unsafe {
            libc::kill(pid, libc::SIGKILL);
        }
    }
}

#[cfg(not(unix))]
pub fn end(_token: &str, _grace: std::time::Duration) {}

/// The processes whose environment holds `token`. The environment of a
/// process is readable only by its owner, so no one else's is ever seen.
#[cfg(unix)]
fn members(token: &str) -> Vec<i32> {
    let wanted = format!("{TOKEN_NAME}={token}");
    // Linux keeps each process's environment in /proc.
    if std::path::Path::new("/proc/self/environ").exists() {
        let Ok(entries) = std::fs::read_dir("/proc") else { return Vec::new() };
        return entries
            .flatten()
            .filter_map(|entry| {
                let pid: i32 = entry.file_name().to_str()?.parse().ok()?;
                let environment = std::fs::read(entry.path().join("environ")).ok()?;
                let found = environment.split(|byte| *byte == 0).any(|pair| pair == wanted.as_bytes());
                found.then_some(pid)
            })
            .collect();
    }
    // macOS shows a process's environment after its command in ps.
    let Ok(listing) = std::process::Command::new("ps").args(["-axww", "-E", "-o", "pid=,command="]).output() else { return Vec::new() };
    String::from_utf8_lossy(&listing.stdout)
        .lines()
        .filter(|line| line.split_whitespace().any(|word| word == wanted))
        .filter_map(|line| line.split_whitespace().next()?.parse().ok())
        .collect()
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn tokens_are_never_repeated() {
        assert_ne!(token(), token());
    }

    /// A program in a session of its own is found by its token and ended,
    /// and one without the token is left alone.
    #[test]
    fn a_worker_outside_the_group_is_ended_and_a_stranger_is_not() {
        let mine = token();
        let spawn = |value: &str| {
            std::process::Command::new("perl")
                .args(["-MPOSIX", "-e", "POSIX::setsid(); exec q(sleep), q(60)"])
                .env(TOKEN_NAME, value)
                .spawn()
                .unwrap()
        };
        let mut worker = spawn(&mine);
        let mut stranger = spawn(&token());
        std::thread::sleep(std::time::Duration::from_millis(500));
        assert!(members(&mine).contains(&(worker.id() as i32)));
        end(&mine, std::time::Duration::from_secs(2));
        assert!(worker.wait().is_ok(), "the worker should have ended");
        assert!(stranger.try_wait().unwrap().is_none(), "a run's sweep must not touch another run");
        stranger.kill().unwrap();
        let _ = stranger.wait();
    }
}
