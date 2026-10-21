//! Preferences and recent files, kept as one JSON file in the app's
//! configuration folder on this computer. Nothing here leaves the machine.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// Every field has a default so a settings file written by an older version
/// still loads after an update.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    /// The R_HOME the user chose. Empty until they choose one.
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
    /// Height of the console in pixels, as the user last left it.
    pub console_height: u32,
    /// Height of the console's typing box in pixels.
    pub console_input_height: u32,
    /// Height of the strip of earlier results under the stage, in pixels.
    pub timeline_height: u32,
    /// Which parts of the window are on show.
    pub show_sidebar: bool,
    pub show_canvas: bool,
    pub show_prompt: bool,
    pub show_timeline: bool,
    /// Width of the right column in pixels.
    pub inspector_width: u32,
    /// Share of the right column given to its top pane, in percent.
    pub pane_split: u32,
    /// "system", "light", "dark", or "paper".
    pub appearance: String,
    /// "standard", "deuteranopia", "protanopia", "tritanopia", or "monochrome".
    pub palette: String,
    /// Interface text size as a percentage, 90 to 140.
    pub text_size: u32,
    pub reduce_motion: bool,
    /// "essentials" or "everything".
    pub layer: String,
    /// "canvas" or "inline".
    pub output_layout: String,
    /// Set once the user chooses where results go. Until then results go
    /// to the canvas, whatever an earlier version saved.
    pub layout_chosen: bool,
    /// Set once the tour has been seen, so it opens by itself only once.
    pub tour_seen: bool,
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
    /// What the Run button does for a file the user chose a default
    /// for, by path: "line", "chunk", or "file". Files not listed run a
    /// line in a script and a chunk in a document.
    pub run_defaults: BTreeMap<String, String>,
    /// Whether R keeps the objects as they were before each run, so the
    /// last run can be undone. On by default.
    pub undo_runs: bool,
    /// Whether package installs and updates show R's own log rather than
    /// progress by package. Off by default.
    pub show_package_log: bool,
    /// "auto" looks for updates once a day at most, "manual" only when
    /// asked.
    pub update_checks: String,
    /// When updates were last looked for, in milliseconds since 1970.
    pub last_update_check: u64,
    /// Whether edited files are saved by themselves shortly after typing
    /// stops. Off by default, since it changes what Save means.
    pub autosave: bool,
    /// Whether a report rendered once renders again each time it is saved.
    pub render_on_save: bool,
    /// How Render as PDF makes a PDF: "auto", LaTeX when there is one and
    /// Typst otherwise, or "typst", or "latex".
    pub pdf_engine: String,
    /// The folder of the LaTeX to use, or empty to use the first found.
    pub latex_dir: String,
    /// Whether the editor points out habits that cause trouble later.
    pub hints: bool,
    /// Whether Return tidies the line it finishes.
    pub format_on_type: bool,
    /// Whether comments use a script italic beside the code's typeface.
    pub script_italics: bool,
    /// Whether results are kept and shown again when the app opens.
    pub keep_results: bool,
    /// Whether new plots take the app's colors and type.
    pub plot_style: bool,
    /// Tighter spacing around panes.
    pub compact: bool,
    /// Whether document text keeps to a comfortable line length.
    pub reading_width: bool,
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
            console_height: 230,
            console_input_height: 96,
            timeline_height: 184,
            show_sidebar: true,
            show_canvas: true,
            show_prompt: true,
            show_timeline: true,
            inspector_width: 520,
            pane_split: 45,
            appearance: "system".into(),
            palette: "standard".into(),
            text_size: 100,
            reduce_motion: false,
            layer: "essentials".into(),
            output_layout: "canvas".into(),
            layout_chosen: false,
            tour_seen: false,
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
            run_defaults: BTreeMap::new(),
            undo_runs: true,
            show_package_log: false,
            update_checks: "auto".into(),
            last_update_check: 0,
            autosave: false,
            render_on_save: true,
            pdf_engine: "auto".into(),
            latex_dir: String::new(),
            hints: true,
            format_on_type: true,
            script_italics: false,
            keep_results: true,
            plot_style: false,
            compact: false,
            reading_width: true,
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
