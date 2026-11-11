//! Finding Ollama, or installing a private copy of it that only this app
//! uses. People choose in the setup steps: the Ollama already on their Mac,
//! or a copy kept inside the app's own folder that leaves no trace outside
//! it and can be removed from the app in one step.
//!
//! The private copy is a pinned release, checked against its published
//! SHA-256 before anything is unpacked, so a changed or damaged download is
//! refused rather than run.

use crate::windowless::Windowless;
use anyhow::{anyhow, Context, Result};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

/// The Ollama release the private copy installs, its address, published
/// checksum, and size. Updating the copy means changing all four together.
pub const VERSION: &str = "0.40.3";
pub const URL: &str = "https://github.com/ollama/ollama/releases/download/v0.40.3/ollama-darwin.tgz";
pub const SHA256: &str = "a2d1d906a2c8febd9cb18f5c183854d0a6db5dc522940d68b0c0ed048e8dfdea";
pub const SIZE: u64 = 167_455_486;

/// Where the app keeps its private copy and the models it downloads.
#[derive(Clone, Debug)]
pub struct Paths {
    pub root: PathBuf,
}

impl Paths {
    pub fn new(root: PathBuf) -> Self {
        Paths { root }
    }
    pub fn runtime(&self) -> PathBuf {
        self.root.join("runtime")
    }
    pub fn binary(&self) -> PathBuf {
        self.runtime().join("ollama")
    }
    pub fn models(&self) -> PathBuf {
        self.root.join("models")
    }
}

/// What the setup steps need to know about Ollama on this computer.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    /// Where the system's own Ollama program is, if it is installed.
    pub system_path: Option<String>,
    /// Whether the system's Ollama server is answering right now.
    pub system_running: bool,
    pub system_version: String,
    /// Whether the app's private copy is installed.
    pub private_installed: bool,
    /// Whether this computer can take the private copy, which is built for
    /// macOS.
    pub private_supported: bool,
    pub private_version: &'static str,
}

/// The usual places Ollama's program lives on a Mac, from the app
/// download and from Homebrew.
fn system_candidates() -> Vec<PathBuf> {
    let mut paths = vec![
        PathBuf::from("/Applications/Ollama.app/Contents/Resources/ollama"),
        PathBuf::from("/opt/homebrew/bin/ollama"),
        PathBuf::from("/usr/local/bin/ollama"),
        PathBuf::from("/usr/bin/ollama"),
    ];
    if let Some(home) = std::env::var_os("HOME") {
        paths.insert(1, PathBuf::from(home).join("Applications/Ollama.app/Contents/Resources/ollama"));
    }
    paths
}

pub fn system_path() -> Option<PathBuf> {
    system_candidates().into_iter().find(|path| path.is_file())
}

pub fn private_installed(paths: &Paths) -> bool {
    paths.binary().is_file()
}

/// Downloads, checks, and unpacks the private copy. `on_progress` hears
/// bytes downloaded and the total, then a total of zero while unpacking.
pub async fn install(paths: &Paths, cancel: Arc<AtomicBool>, on_progress: impl FnMut(u64, u64, &str)) -> Result<()> {
    if !cfg!(target_os = "macos") {
        return Err(anyhow!("The private copy is built for macOS. On this computer, install Ollama from ollama.com and choose Use the Ollama on this computer."));
    }
    install_from(paths, URL, SHA256, SIZE, cancel, on_progress).await
}

/// The install itself, with the source given, so tests can use a local
/// archive. The macOS tools curl and tar do the transfer and unpacking:
/// they ship with every Mac and handle redirects and links correctly.
pub async fn install_from(paths: &Paths, url: &str, sha256: &str, size: u64, cancel: Arc<AtomicBool>, mut on_progress: impl FnMut(u64, u64, &str)) -> Result<()> {
    std::fs::create_dir_all(&paths.root)?;
    let archive = paths.root.join("ollama-download.tgz");
    let _ = std::fs::remove_file(&archive);

    let mut child = tokio::process::Command::new("curl")
        .windowless()
        // Redirects may only lead to HTTPS. The checksum below is the real
        // guard, and this keeps the transfer itself off plain HTTP.
        .args(["--location", "--proto-redir", "=https", "--fail", "--silent", "--show-error", "--output"])
        .arg(&archive)
        .arg(url)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .context("could not start curl to download Ollama")?;

    // Progress is read from the file's size as it grows, which works for
    // any download without parsing curl's own display.
    loop {
        if cancel.load(Ordering::SeqCst) {
            let _ = child.kill().await;
            let _ = std::fs::remove_file(&archive);
            return Err(anyhow!("The download was canceled."));
        }
        if let Some(status) = child.try_wait()? {
            if !status.success() {
                let mut message = String::new();
                if let Some(mut stderr) = child.stderr.take() {
                    use tokio::io::AsyncReadExt;
                    let _ = stderr.read_to_string(&mut message).await;
                }
                let _ = std::fs::remove_file(&archive);
                return Err(anyhow!("Ollama could not be downloaded. {}", message.trim()));
            }
            break;
        }
        let now = std::fs::metadata(&archive).map(|meta| meta.len()).unwrap_or(0);
        on_progress(now, size, "Downloading Ollama");
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    on_progress(size, size, "Checking the download");

    let actual = sha256_of(&archive)?;
    if actual != sha256 {
        let _ = std::fs::remove_file(&archive);
        return Err(anyhow!("The download did not match Ollama's published checksum, so it was removed and not installed. Try again later."));
    }

    on_progress(0, 0, "Unpacking");
    // Unpacked beside the final folder and then moved into place, so a
    // failure halfway never leaves a broken copy that looks installed.
    let staging = paths.root.join("runtime-new");
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging)?;
    let status = tokio::process::Command::new("tar").windowless().arg("-xzf").arg(&archive).arg("-C").arg(&staging).status().await.context("could not start tar")?;
    let _ = std::fs::remove_file(&archive);
    if !status.success() || !staging.join("ollama").is_file() {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(anyhow!("The Ollama download could not be unpacked."));
    }
    let _ = std::fs::remove_dir_all(paths.runtime());
    std::fs::rename(&staging, paths.runtime())?;
    Ok(())
}

pub fn sha256_of(path: &Path) -> Result<String> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1 << 16];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex::encode(hasher.finalize()))
}

/// An Ollama server the app started. Stopping it, or dropping it, ends the
/// server and anything it started.
pub struct Server {
    child: tokio::process::Child,
    /// Whether the process leads a group of its own, which then ends whole.
    group: bool,
}

impl Server {
    /// A server started directly, such as the Ollama the person installed.
    pub fn new(child: tokio::process::Child) -> Self {
        Server { child, group: false }
    }

    pub fn stop(&mut self) {
        #[cfg(unix)]
        if self.group {
            if let Some(pid) = self.child.id() {
                // SAFETY: killpg only signals the group this app made with
                // process_group(0), whose id is the child's own id.
                unsafe {
                    libc::killpg(pid as libc::pid_t, libc::SIGKILL);
                }
            }
        }
        let _ = self.child.start_kill();
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Runs the server, then watches the app that started it. If that app is
/// gone, because it crashed or was forced to quit, the server is ended
/// within a couple of seconds, so a model is never left in memory. The
/// program and the app's process id arrive as arguments, never inside the
/// script, so no path can change what it does.
#[cfg(unix)]
const WATCH: &str = r#""$0" serve &
server=$!
while kill -0 "$1" 2>/dev/null && kill -0 "$server" 2>/dev/null; do
  sleep 2
done
kill "$server" 2>/dev/null
wait "$server" 2>/dev/null"#;

/// Starts the private copy on its own port, with its models kept in the
/// app's folder. It ends when the returned handle is dropped, and by itself
/// shortly after this app is gone.
pub fn start(paths: &Paths) -> Result<Server> {
    start_watching(paths, std::process::id())
}

fn start_watching(paths: &Paths, parent: u32) -> Result<Server> {
    std::fs::create_dir_all(paths.models())?;
    let log = std::fs::File::create(paths.root.join("ollama.log"))?;
    #[cfg(unix)]
    let mut command = {
        let mut command = tokio::process::Command::new("/bin/sh");
        command.arg("-c").arg(WATCH).arg(paths.binary()).arg(parent.to_string());
        command.process_group(0);
        command
    };
    #[cfg(not(unix))]
    let mut command = {
        let _ = parent;
        let mut command = tokio::process::Command::new(paths.binary());
        command.windowless().arg("serve");
        command
    };
    let child = command
        .env("OLLAMA_HOST", crate::ollama::PRIVATE_URL.trim_start_matches("http://"))
        .env("OLLAMA_MODELS", paths.models())
        .current_dir(paths.runtime())
        .stdin(Stdio::null())
        .stdout(Stdio::from(log.try_clone()?))
        .stderr(Stdio::from(log))
        .kill_on_drop(true)
        .spawn()
        .context("could not start the private Ollama")?;
    Ok(Server { child, group: cfg!(unix) })
}

/// Waits until a server answers, for up to `seconds`.
pub async fn wait_ready(client: &crate::ollama::Client, seconds: u64) -> Result<String> {
    for _ in 0..(seconds * 4) {
        if let Ok(version) = client.version().await {
            return Ok(version);
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    Err(anyhow!("Ollama did not start within {seconds} seconds."))
}

/// Removes the private copy and every model it downloaded.
pub fn remove(paths: &Paths) -> Result<()> {
    for dir in [paths.runtime(), paths.models()] {
        if dir.exists() {
            std::fs::remove_dir_all(&dir).with_context(|| format!("could not remove {}", dir.display()))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Builds a small archive shaped like Ollama's, with an executable
    /// named ollama at its top level.
    fn fake_archive(dir: &Path) -> (PathBuf, String) {
        let source = dir.join("source");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::write(source.join("ollama"), "#!/bin/sh\necho fake\n").unwrap();
        let archive = dir.join("fake.tgz");
        let status = std::process::Command::new("tar").arg("-czf").arg(&archive).arg("-C").arg(&source).arg("ollama").status().unwrap();
        assert!(status.success());
        let sum = sha256_of(&archive).unwrap();
        (archive, sum)
    }

    /// Whether a process is still running. A process that has ended but
    /// not been collected yet does not count.
    #[cfg(unix)]
    fn running(pid: &str) -> bool {
        let out = std::process::Command::new("ps").args(["-o", "stat=", "-p", pid]).output().unwrap();
        let state = String::from_utf8_lossy(&out.stdout);
        let state = state.trim();
        !state.is_empty() && !state.starts_with('Z')
    }

    /// Waits for the stand-in server to write its process id.
    #[cfg(unix)]
    async fn server_pid(paths: &Paths) -> String {
        let file = paths.runtime().join("pid");
        for _ in 0..80 {
            if let Ok(text) = std::fs::read_to_string(&file) {
                if !text.trim().is_empty() {
                    return text.trim().to_string();
                }
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        panic!("the stand-in server never started");
    }

    /// A private copy whose program is a stand-in that records its process
    /// id and then idles.
    #[cfg(unix)]
    fn stand_in(dir: &Path) -> Paths {
        use std::os::unix::fs::PermissionsExt;
        let paths = Paths::new(dir.join("app"));
        std::fs::create_dir_all(paths.runtime()).unwrap();
        std::fs::write(paths.binary(), "#!/bin/sh\necho $$ > \"$(dirname \"$0\")/pid\"\nexec sleep 300\n").unwrap();
        std::fs::set_permissions(paths.binary(), std::fs::Permissions::from_mode(0o755)).unwrap();
        paths
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn the_private_server_ends_when_the_app_that_started_it_is_gone() {
        let dir = tempfile::tempdir().unwrap();
        let paths = stand_in(dir.path());
        // A stand-in for the app, which then "crashes".
        let mut app = std::process::Command::new("sleep").arg("300").spawn().unwrap();
        let _server = start_watching(&paths, app.id()).unwrap();
        let pid = server_pid(&paths).await;
        assert!(running(&pid));
        app.kill().unwrap();
        app.wait().unwrap();
        for _ in 0..80 {
            if !running(&pid) {
                return;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        panic!("the server was still running long after its app was gone");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn stopping_the_private_server_ends_everything_it_started() {
        let dir = tempfile::tempdir().unwrap();
        let paths = stand_in(dir.path());
        let mut server = start_watching(&paths, std::process::id()).unwrap();
        let pid = server_pid(&paths).await;
        assert!(running(&pid));
        server.stop();
        for _ in 0..30 {
            if !running(&pid) {
                return;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        panic!("the server was still running after it was stopped");
    }

    #[tokio::test]
    async fn installs_from_a_checked_archive() {
        let dir = tempfile::tempdir().unwrap();
        let (archive, sum) = fake_archive(dir.path());
        let paths = Paths::new(dir.path().join("app"));
        let url = format!("file://{}", archive.display());
        let size = std::fs::metadata(&archive).unwrap().len();
        let mut stages = Vec::new();
        install_from(&paths, &url, &sum, size, Arc::new(AtomicBool::new(false)), |_, _, stage| stages.push(stage.to_string())).await.unwrap();
        assert!(private_installed(&paths));
        assert!(stages.contains(&"Unpacking".to_string()));
        assert!(!paths.root.join("ollama-download.tgz").exists());
        remove(&paths).unwrap();
        assert!(!private_installed(&paths));
    }

    #[tokio::test]
    async fn refuses_an_archive_whose_checksum_differs() {
        let dir = tempfile::tempdir().unwrap();
        let (archive, _) = fake_archive(dir.path());
        let paths = Paths::new(dir.path().join("app"));
        let url = format!("file://{}", archive.display());
        let error = install_from(&paths, &url, &"0".repeat(64), 10, Arc::new(AtomicBool::new(false)), |_, _, _| {}).await.unwrap_err();
        assert!(error.to_string().contains("checksum"));
        assert!(!private_installed(&paths));
    }
}
