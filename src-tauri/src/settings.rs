//! Preferences and recent files, kept as one JSON file in the app's
//! configuration folder on this computer. Nothing here leaves the machine.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Every field has a default so a settings file written by an older version
/// still loads after an update.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    /// The R_HOME the person chose. Empty until they choose one.
    pub r_home: String,
    /// Files opened before, newest first. Only the app's own code adds to
    /// this list, never the interface, because a file listed here can be
    /// reopened without a dialog.
    pub recent_files: Vec<RecentFile>,
    /// The files that were open at the last quit, reopened at launch the
    /// way Mac document apps restore their windows.
    pub session_files: Vec<String>,
    pub session_active: String,
    /// Project files (.Rproj) opened before, newest first, kept by the app's
    /// own code for the same reason as `recent_files`.
    pub recent_projects: Vec<RecentFile>,
    /// The project open at the last quit, reopened at launch.
    pub session_project: String,
    /// Height of the console in pixels, as the person last left it.
    pub console_height: u32,
    /// Height of the console's typing box in pixels.
    pub console_input_height: u32,
    /// Width of the right column in pixels.
    pub inspector_width: u32,
    /// Share of the right column given to its top pane, in percent.
    pub pane_split: u32,
    /// "system", "light", or "dark".
    pub appearance: String,
    /// "standard", "deuteranopia", "protanopia", "tritanopia", or "monochrome".
    pub palette: String,
    /// Interface text size as a percentage, 90 to 140.
    pub text_size: u32,
    pub reduce_motion: bool,
    /// "essentials" or "everything".
    pub layer: String,
    /// "inline", "side", or "stacked".
    pub output_layout: String,
    /// "ask" or "auto".
    pub missing_packages: String,
    /// The code typeface: "dm-mono", "jetbrains-mono", "ibm-plex-mono",
    /// "fira-code", "source-code-pro", or "system".
    pub code_font: String,
    /// Code size in pixels, 11 to 24, separate from the interface text size.
    pub code_size: u32,
    /// "compact", "normal", or "relaxed".
    pub line_spacing: String,
    pub ligatures: bool,
    pub line_numbers: bool,
    pub highlight_line: bool,
    pub wrap_lines: bool,
    /// Spaces per indent, 2 or 4.
    pub tab_width: u32,
    pub close_brackets: bool,
    pub rainbow_brackets: bool,
    /// "cards" or "plain".
    pub result_style: String,
    /// Whether copying a selection that crosses results includes them.
    pub copy_results: bool,
    /// Which Ollama the assistant uses: "system", "private", or empty when
    /// the assistant has not been set up. It is optional and off until then.
    pub assistant_route: String,
    /// The model the assistant answers with.
    pub assistant_model: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct RecentFile {
    pub path: String,
    /// Seconds since 1970, so the interface can group by day.
    pub opened_at: u64,
}

/// How many recent files are kept. More than this stops being a quick
/// list to scan and becomes a search problem.
const RECENT_LIMIT: usize = 12;

/// Moves a path to the top of a recent list, keeping the list short.
fn bump(list: &mut Vec<RecentFile>, path: &str) {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    list.retain(|recent| recent.path != path);
    list.insert(0, RecentFile { path: path.to_string(), opened_at: now });
    list.truncate(RECENT_LIMIT);
}

impl Settings {
    /// Moves a file to the top of the recent list.
    pub fn note_recent(&mut self, path: &str) {
        bump(&mut self.recent_files, path);
    }

    /// Moves a project file to the top of the recent projects.
    pub fn note_project(&mut self, path: &str) {
        bump(&mut self.recent_projects, path);
    }
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            r_home: String::new(),
            recent_files: Vec::new(),
            session_files: Vec::new(),
            session_active: String::new(),
            recent_projects: Vec::new(),
            session_project: String::new(),
            console_height: 260,
            console_input_height: 96,
            inspector_width: 360,
            pane_split: 45,
            appearance: "system".into(),
            palette: "standard".into(),
            text_size: 100,
            reduce_motion: false,
            layer: "essentials".into(),
            output_layout: "inline".into(),
            missing_packages: "ask".into(),
            code_font: "dm-mono".into(),
            code_size: 15,
            line_spacing: "normal".into(),
            ligatures: false,
            line_numbers: true,
            highlight_line: true,
            wrap_lines: false,
            tab_width: 2,
            close_brackets: true,
            rainbow_brackets: false,
            result_style: "cards".into(),
            copy_results: true,
            assistant_route: String::new(),
            assistant_model: String::new(),
        }
    }
}

pub fn settings_path() -> PathBuf {
    let base = dirs::config_dir().unwrap_or_else(std::env::temp_dir);
    base.join("app.goodfor.ide").join("settings.json")
}

pub fn load(path: &Path) -> Settings {
    // A damaged file falls back to defaults rather than blocking the app
    // from opening. The damaged copy is kept so nothing is silently lost.
    let Ok(text) = std::fs::read_to_string(path) else { return Settings::default() };
    match serde_json::from_str(&text) {
        Ok(settings) => settings,
        Err(_) => {
            let _ = std::fs::rename(path, path.with_extension("damaged.json"));
            Settings::default()
        }
    }
}

pub fn save(path: &Path, settings: &Settings) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    // Writing to a temporary file and renaming it means a crash mid-write
    // never leaves a half written settings file behind.
    let temp = path.with_extension("tmp");
    std::fs::write(&temp, serde_json::to_vec_pretty(settings)?)?;
    std::fs::rename(temp, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn older_files_missing_fields_still_load() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, r#"{"rHome": "/opt/R/4.5.1/lib/R"}"#).unwrap();
        let settings = load(&path);
        assert_eq!(settings.r_home, "/opt/R/4.5.1/lib/R");
        assert_eq!(settings.palette, "standard");
    }

    #[test]
    fn a_damaged_file_is_kept_aside() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, "{ not json").unwrap();
        assert_eq!(load(&path), Settings::default());
        assert!(dir.path().join("settings.damaged.json").exists());
    }

    #[test]
    fn recent_files_move_to_the_top_without_repeating() {
        let mut settings = Settings::default();
        settings.note_recent("/a.R");
        settings.note_recent("/b.R");
        settings.note_recent("/a.R");
        let paths: Vec<&str> = settings.recent_files.iter().map(|recent| recent.path.as_str()).collect();
        assert_eq!(paths, vec!["/a.R", "/b.R"]);
        for index in 0..20 {
            settings.note_recent(&format!("/{index}.R"));
        }
        assert_eq!(settings.recent_files.len(), RECENT_LIMIT);
    }

    #[test]
    fn saving_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested/settings.json");
        let mut settings = Settings::default();
        settings.layer = "everything".into();
        save(&path, &settings).unwrap();
        assert_eq!(load(&path), settings);
    }
}
