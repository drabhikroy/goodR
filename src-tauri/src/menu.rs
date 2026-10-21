//! The native menu bar.
//!
//! Menu items carry ids that match the interface's command ids, so a menu
//! click, a keyboard shortcut, and the command palette all run the same
//! command. Items marked as advanced appear only in the Everything layer.
//! Only commands that work in this version are listed. A menu full of
//! disabled promises teaches people that the menus cannot be trusted.

use serde::Deserialize;
use tauri::menu::{CheckMenuItemBuilder, Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, Submenu, SubmenuBuilder};
use tauri::{AppHandle, Runtime};

/// The parts of interface state the menus show as check marks.
#[derive(Clone, Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MenuState {
    pub layer: String,
    pub output_layout: String,
    pub auto_install: bool,
    pub live_output: bool,
}

/// Control Command S is the Mac convention for sidebars. Other systems have
/// no Command key, so they use the common Control B instead.
const SIDEBAR_KEY: &str = if cfg!(target_os = "macos") { "Cmd+Ctrl+S" } else { "Ctrl+B" };

/// One custom item: id, label, shortcut, and whether it belongs only to the
/// Everything layer.
type Item = (&'static str, &'static str, Option<&'static str>, bool);

/// Builds the full menu bar for the given state. Item order follows the
/// macOS convention: app, File, Edit, View, then the app's own menus, then
/// Window and Help, so items sit where Mac users already look for them.
pub fn build<R: Runtime>(app: &AppHandle<R>, state: &MenuState, recent: &[String], projects: &[String]) -> tauri::Result<Menu<R>> {
    let everything = state.layer == "everything";
    let app_menu = SubmenuBuilder::new(app, "Good For")
        .item(&MenuItemBuilder::with_id("help.about", "About R: What Is It Good For?").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("app.settings", "Settings").accelerator("CmdOrCtrl+,").build(app)?)
        .separator()
        .item(&PredefinedMenuItem::services(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, Some("Hide Good For"))?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, Some("Quit Good For"))?)
        .build()?;

    // Open Recent lists files by name, as every Mac document app does. Its
    // item ids carry the position in the recent list, which the interface
    // looks up, so no path ever travels through a menu id.
    // Projects are listed first, then scripts, each under its own heading.
    let mut recent_menu = SubmenuBuilder::new(app, "Open Recent");
    let name_of = |path: &String| std::path::Path::new(path).file_stem().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| path.clone());
    for (index, path) in projects.iter().enumerate() {
        recent_menu = recent_menu.item(&MenuItemBuilder::with_id(format!("project.recent.{index}"), format!("{} (project)", name_of(path))).build(app)?);
    }
    if !projects.is_empty() && !recent.is_empty() {
        recent_menu = recent_menu.separator();
    }
    for (index, path) in recent.iter().enumerate() {
        let name = std::path::Path::new(path).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| path.clone());
        recent_menu = recent_menu.item(&MenuItemBuilder::with_id(format!("file.recent.{index}"), name).build(app)?);
    }
    if recent.is_empty() && projects.is_empty() {
        recent_menu = recent_menu.item(&MenuItemBuilder::with_id("file.recent.none", "Nothing Opened Yet").enabled(false).build(app)?);
    }
    let file = SubmenuBuilder::new(app, "File")
        .item(&MenuItemBuilder::with_id("file.new", "New Script").accelerator("CmdOrCtrl+N").build(app)?)
        .item(&MenuItemBuilder::with_id("project.new", "New Project...").accelerator("CmdOrCtrl+Shift+N").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("file.open", "Open Script...").accelerator("CmdOrCtrl+O").build(app)?)
        .item(&MenuItemBuilder::with_id("project.open", "Open Project...").accelerator("CmdOrCtrl+Shift+O").build(app)?)
        .item(&recent_menu.build()?)
        .separator()
        .item(&MenuItemBuilder::with_id("file.save", "Save").accelerator("CmdOrCtrl+S").build(app)?)
        .item(&MenuItemBuilder::with_id("file.saveAs", "Save As...").accelerator("CmdOrCtrl+Shift+S").build(app)?)
        .item(&MenuItemBuilder::with_id("file.saveAll", "Save All").accelerator("CmdOrCtrl+Alt+S").build(app)?)
        .item(&MenuItemBuilder::with_id("file.exportPlot", "Export Plot...").accelerator("CmdOrCtrl+Shift+E").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("file.close", "Close Tab").accelerator("CmdOrCtrl+W").build(app)?)
        .item(&MenuItemBuilder::with_id("project.close", "Close Project").build(app)?)
        .build()?;

    // Edit uses the system items so undo, copy, and paste reach whichever
    // field has focus, including the editor and the console.
    let edit = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .separator()
        .item(&MenuItemBuilder::with_id("edit.find", "Find and Replace").accelerator("CmdOrCtrl+F").build(app)?)
        .item(&MenuItemBuilder::with_id("edit.comment", "Comment Lines").accelerator("CmdOrCtrl+Shift+C").build(app)?)
        .separator()
        // RStudio's own shortcuts for the three things R code types most.
        .item(&MenuItemBuilder::with_id("edit.pipe", "Insert Pipe").accelerator("CmdOrCtrl+Shift+M").build(app)?)
        .item(&MenuItemBuilder::with_id("edit.assign", "Insert Assignment").accelerator("Alt+Minus").build(app)?)
        .item(&MenuItemBuilder::with_id("edit.section", "Insert Section").accelerator("CmdOrCtrl+Shift+R").build(app)?)
        .build()?;

    // The four output layouts behave as one choice, so exactly one carries
    // a check mark.
    let layout = |id: &str, label: &str, key: &str, value: &str| {
        CheckMenuItemBuilder::with_id(id, label).accelerator(key).checked(state.output_layout == value).build(app)
    };
    let mut view = SubmenuBuilder::new(app, "View")
        .item(&layout("view.output.inline", "Results Under Each Line", "CmdOrCtrl+Alt+1", "inline")?)
        .item(&layout("view.output.side", "Results Beside the Code", "CmdOrCtrl+Alt+2", "side")?)
        .item(&layout("view.output.stacked", "Results Below the Code", "CmdOrCtrl+Alt+3", "stacked")?)
        .item(&layout("view.output.console", "Results in the Console", "CmdOrCtrl+Alt+4", "console")?)
        .item(&CheckMenuItemBuilder::with_id("view.live", "Update Results as You Type").accelerator("CmdOrCtrl+Alt+L").checked(state.live_output).build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("view.sidebar", "Show or Hide Sidebar").accelerator(SIDEBAR_KEY).build(app)?)
        .item(&MenuItemBuilder::with_id("view.inspector", "Show or Hide Panes").accelerator("CmdOrCtrl+Alt+0").build(app)?)
        .item(&MenuItemBuilder::with_id("view.console", "Show or Hide Console History").accelerator("CmdOrCtrl+Shift+Y").build(app)?)
        .separator()
        .item(&CheckMenuItemBuilder::with_id("view.layer.essentials", "Essentials").checked(!everything).build(app)?)
        .item(&CheckMenuItemBuilder::with_id("view.layer.everything", "Everything").checked(everything).build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("view.palette", "Command Palette").accelerator("CmdOrCtrl+K").build(app)?)
        .item(&MenuItemBuilder::with_id("view.zoomIn", "Larger Text").accelerator("CmdOrCtrl+=").build(app)?)
        .item(&MenuItemBuilder::with_id("view.zoomOut", "Smaller Text").accelerator("CmdOrCtrl+-").build(app)?);
    if cfg!(target_os = "macos") {
        view = view.separator().item(&PredefinedMenuItem::fullscreen(app, None)?);
    }
    let view = view.build()?;

    let run = custom(app, "Run", everything, &[
        ("run.line", "Run Line or Selection", Some("CmdOrCtrl+Enter"), false),
        ("run.file", "Run File", Some("CmdOrCtrl+Shift+Enter"), false),
        ("run.toHere", "Run to Here", Some("CmdOrCtrl+Alt+B"), true),
        ("", "", None, false),
        ("run.stop", "Stop", Some("CmdOrCtrl+."), false),
        ("run.restart", "Restart R", Some("CmdOrCtrl+Shift+0"), false),
        ("run.restartRunAll", "Restart R and Run File", None, true),
        ("run.chooseR", "Choose R Version", None, false),
        ("", "", None, false),
        // Shift Command K is RStudio's Knit, so hands that know it find it.
        ("render.report", "Render Report", Some("CmdOrCtrl+Shift+K"), false),
        ("render.html", "Render as HTML", None, true),
        ("render.word", "Render as Word", None, true),
        ("render.pdf", "Render as PDF", None, true),
        ("render.stop", "Stop Rendering", None, false),
        ("", "", None, false),
        ("run.clearOutput", "Clear Output", None, false),
        ("run.clearConsole", "Clear Console", Some("CmdOrCtrl+L"), false),
    ])?;

    // Installing automatically is a standing preference, so it is a check
    // item rather than a one time action.
    let packages = SubmenuBuilder::new(app, "Packages")
        .item(&MenuItemBuilder::with_id("packages.install", "Install Packages").build(app)?)
        .item(&MenuItemBuilder::with_id("packages.installMissing", "Install Missing for This File").build(app)?)
        .separator()
        .item(&CheckMenuItemBuilder::with_id("packages.auto", "Install Missing Automatically").checked(state.auto_install).build(app)?)
        .build()?;

    // The assistant's requests act on the code at the cursor, as the run
    // commands do, so they get a menu of their own beside Run.
    let assistant = custom(app, "Assistant", everything, &[
        ("assistant.explain", "Explain This Code", Some("CmdOrCtrl+Alt+E"), false),
        ("assistant.comment", "Add Comments to This Code", None, false),
        ("assistant.improve", "Suggest a Clearer Version", None, false),
        ("assistant.write", "Write Code from a Description", None, false),
        ("", "", None, false),
        ("assistant.setup", "Set Up the Assistant and Models...", None, false),
    ])?;

    // Window keeps RStudio's focus shortcuts, Control and a number for each
    // pane, since people moving from RStudio already have them in their
    // hands.
    let window = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, Some("Zoom"))?)
        .separator()
        .item(&MenuItemBuilder::with_id("focus.editor", "Editor").accelerator("Ctrl+1").build(app)?)
        .item(&MenuItemBuilder::with_id("focus.console", "Console").accelerator("Ctrl+2").build(app)?)
        .item(&MenuItemBuilder::with_id("focus.help", "Help").accelerator("Ctrl+3").build(app)?)
        .item(&MenuItemBuilder::with_id("focus.history", "History").accelerator("Ctrl+4").build(app)?)
        .item(&MenuItemBuilder::with_id("focus.plots", "Plots").accelerator("Ctrl+6").build(app)?)
        .item(&MenuItemBuilder::with_id("focus.packages", "Packages").accelerator("Ctrl+7").build(app)?)
        .item(&MenuItemBuilder::with_id("focus.environment", "Environment").accelerator("Ctrl+8").build(app)?)
        .item(&MenuItemBuilder::with_id("assistant.show", "Assistant").accelerator("Ctrl+9").build(app)?)
        .build()?;

    let help = custom(app, "Help", everything, &[
        ("help.atCursor", "R Help for the Name at the Cursor", Some("F1"), false),
        ("focus.help", "Search R Help", None, false),
        ("", "", None, false),
        ("help.shortcuts", "Keyboard Shortcuts", Some("CmdOrCtrl+/"), false),
        ("help.license", "License and Version", None, false),
        ("help.report", "Report a Problem on GitHub", None, false),
    ])?;

    MenuBuilder::new(app).items(&[&app_menu, &file, &edit, &view, &run, &packages, &assistant, &window, &help]).build()
}

/// Builds a submenu of custom items. An empty id stands for a separator.
fn custom<R: Runtime>(app: &AppHandle<R>, title: &str, everything: bool, items: &[Item]) -> tauri::Result<Submenu<R>> {
    let mut menu = SubmenuBuilder::new(app, title);
    for (id, label, key, advanced) in items {
        if id.is_empty() {
            menu = menu.separator();
            continue;
        }
        if *advanced && !everything {
            continue;
        }
        let mut item = MenuItemBuilder::with_id(*id, *label);
        if let Some(key) = key {
            item = item.accelerator(*key);
        }
        menu = menu.item(&item.build(app)?);
    }
    menu.build()
}
