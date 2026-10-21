//! Everything that can be updated, checked in one place: this app, R, and
//! Ollama. Packages and models are asked of R and Ollama themselves.
//!
//! The newest versions are read from where each is published: this app's
//! releases on GitHub, CRAN's own note of the current R, and Ollama's
//! releases on GitHub. Reading them uses curl, as the Ollama download does,
//! with redirects kept to HTTPS. Nothing is sent but the request itself.
//!
//! The app updates itself through Tauri's updater, which downloads the new
//! version, checks its signature against the public key built into this
//! one, and replaces the app in place. A build made without that key, such
//! as one from source, falls back to opening the release page.

use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;

const RELEASES: &str = "https://api.github.com/repos/drabhikroy/goodR/releases/latest";
const RELEASE_PAGE: &str = "https://github.com/drabhikroy/goodR/releases/latest";
const R_VERSION_INFO: &str = "https://cran.r-project.org/src/base/VERSION-INFO.dcf";
const OLLAMA_RELEASES: &str = "https://api.github.com/repos/ollama/ollama/releases/latest";

/// The key that signs this app's updates, set when a release is built. A
/// build without it cannot update itself and says so.
const UPDATE_KEY: Option<&str> = option_env!("GOODR_UPDATER_PUBKEY");

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Latest {
    /// The newest version of this app, or empty when it could not be read.
    pub app: String,
    /// Whether the app can update itself, rather than send people to the
    /// release page.
    pub app_in_place: bool,
    pub app_page: String,
    pub r: String,
    pub ollama: String,
}

/// Reads a short text from the web, or nothing when it cannot be reached.
async fn fetch(url: &str) -> Option<String> {
    let output = tokio::time::timeout(
        Duration::from_secs(20),
        tokio::process::Command::new("curl")
            .args(["--location", "--proto-redir", "=https", "--fail", "--silent", "--max-time", "15", "--header", "Accept: application/json", "--user-agent", "goodr"])
            .arg(url)
            .output(),
    )
    .await
    .ok()?
    .ok()?;
    output.status.success().then(|| String::from_utf8_lossy(&output.stdout).to_string())
}

/// The version in a GitHub release, from its tag, without a leading v.
fn release_version(json: &str) -> String {
    serde_json::from_str::<serde_json::Value>(json)
        .ok()
        .and_then(|value| value.get("tag_name")?.as_str().map(|tag| tag.trim_start_matches('v').to_string()))
        .unwrap_or_default()
}

/// The current R release, from CRAN's VERSION-INFO.dcf, which has a line
/// such as "Release: 4.5.1".
fn r_release(text: &str) -> String {
    text.lines().find_map(|line| line.strip_prefix("Release:")).map(|version| version.trim().to_string()).unwrap_or_default()
}

/// The newest versions of the app, R, and Ollama, each empty when its
/// source could not be reached.
#[tauri::command]
pub async fn latest_versions() -> Latest {
    let (app, r, ollama) = tokio::join!(fetch(RELEASES), fetch(R_VERSION_INFO), fetch(OLLAMA_RELEASES));
    Latest {
        app: app.map(|json| release_version(&json)).unwrap_or_default(),
        app_in_place: UPDATE_KEY.is_some_and(|key| !key.is_empty()),
        app_page: RELEASE_PAGE.into(),
        r: r.map(|text| r_release(&text)).unwrap_or_default(),
        ollama: ollama.map(|json| release_version(&json)).unwrap_or_default(),
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    done: usize,
    total: Option<u64>,
}

/// Downloads and installs the newest version of the app, with progress as
/// "update-progress" events, and checks its signature first. It returns the
/// version installed, or none when there is nothing newer. The app restarts
/// only when the user says so.
#[tauri::command]
pub async fn install_app_update(app: AppHandle) -> Result<Option<String>, String> {
    let Some(key) = UPDATE_KEY.filter(|key| !key.is_empty()) else {
        return Err("This copy of the app cannot update itself. Download the new version from the release page.".into());
    };
    let updater = app.updater_builder().pubkey(key).build().map_err(|error| error.to_string())?;
    let Some(update) = updater.check().await.map_err(|error| format!("Could not reach the update. {error}"))? else { return Ok(None) };
    let version = update.version.clone();
    let mut done = 0;
    let events = app.clone();
    update
        .download_and_install(
            move |chunk, total| {
                done += chunk;
                let _ = events.emit("update-progress", Progress { done, total });
            },
            || {},
        )
        .await
        .map_err(|error| format!("The update could not be installed. {error} The new version can also be downloaded from the release page."))?;
    Ok(Some(version))
}

/// Starts the new version after an update.
#[tauri::command]
pub fn restart_app(app: AppHandle) {
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_are_read_from_each_source() {
        assert_eq!(release_version(r#"{"tag_name":"v0.3.0","name":"0.3.0"}"#), "0.3.0");
        assert_eq!(release_version("not json"), "");
        assert_eq!(r_release("Release: 4.5.1\nDevel: 4.6.0\n"), "4.5.1");
        assert_eq!(r_release(""), "");
    }
}
