// Every action the app can take, in one module, so menus, shortcuts, the
// command palette, and buttons all run the same code.
//
// Runs go through a queue and execute one at a time. That keeps output in
// the order code was sent, lets Run File stop at the first error the way
// sourcing a script does, and lets Stop cancel everything still waiting.

import { assistOnCode, initAssistant, openAssistantSetup } from "./assistant";
import { initReports, renderReport, stopRender } from "./report";
import { backend, type Backend } from "./backend";
import * as editor from "./editor";
import { describeProblem, explainError, type Explained } from "./errors";
import { referencedPackages } from "./packages";
import { isSupportedR, OLDEST_R } from "./rversion";
import { statementAt, statementRanges } from "./statements";
import { defaultSettings, getState, setState, updateBlock, type Block, type BottomPane, type TopPane, type ConsoleEntry, type OutputItem, type Tab } from "./store";
import { setCompleter } from "./completion";
import type { DataPreview, OutputLayout, PlotExport, ProjectInfo, ProjectTemplate, REvent, Settings } from "./types";
import { applyTheme, plotColors, watchSystemAppearance } from "../theme/theme";

// The backend is set once in init and used by every action below.
let api: Backend;

// One piece of code waiting to run. `batch` groups the statements of one
// Run File, so an error can cancel the rest of that batch and nothing else.
type Job = { code: string; batch: string; blockId?: string; console?: boolean; file?: string };
// Statements waiting their turn, and the one R is running now.
let queue: Job[] = [];
let current: { job: Job; run: string | null } | null = null;
// R tags output with a run id. This finds the card that output belongs to.
const runToBlock = new Map<string, string>();
let consoleId = 0;
// Whether anything has run since R last started. A fresh R can simply move
// into a project's folder rather than restart, which saves a second start.
let ranSinceStart = false;

// Package names already asked about, so R is queried once per name.
const knownInstalled = new Set<string>();
const knownMissing = new Set<string>();
const autoAttempted = new Set<string>();

const RELEASES = "https://github.com/drabhikroy/goodR/releases/latest";
const ISSUES = "https://github.com/drabhikroy/goodR/issues";
const CRAN = "https://cran.r-project.org/";
const OLLAMA = "https://ollama.com/download";

// Live runs that take longer than this are paused, so live output never
// makes typing wait on a slow model fit.
const LIVE_LIMIT_MS = 3000;
// Live output leaves alone anything that changes files or installs.
const LIVE_UNSAFE = /install\.packages|remove\.packages|write|save|saveRDS|unlink|file\.(remove|rename|copy|create)|system2?\(|download\.file|setwd|quit|q\(\)|Sys\.sleep|readline|menu\(/;

// Startup.

/**
 * Loads settings, R installations, and app details, applies the theme, and
 * subscribes to R events and menu clicks. Runs once at startup.
 */
export async function init() {
  api = await backend();
  const [info, loaded, installs] = await Promise.all([api.appInfo(), api.loadSettings(), api.listRInstalls()]);
  const settings: Settings = { ...defaultSettings, ...loaded };
  setState({ info, settings, installs, loaded: true });
  applyTheme(settings);
  watchSystemAppearance(() => applyTheme(getState().settings));
  editor.setInlineVisible(settings.outputLayout === "inline");
  editor.setPreferences(editorPrefs(settings));
  // A code typeface loads only when first chosen, and its letters are a
  // different width, so the editor measures again once it arrives. Without
  // this the line number margin can overlap the start of each line.
  document.fonts?.addEventListener?.("loadingdone", () => editor.requestMeasure());
  // Copying across results takes their text, as it would read in a console.
  editor.setResultText((id) => {
    const block = getState().blocks[id];
    return block ? resultAsText(block) : null;
  });
  editor.setQuietCheck((id) => {
    const block = getState().blocks[id];
    return Boolean(block && block.status === "ok" && block.items.length === 0 && !block.paused);
  });
  // A statement becomes a cell, input above output in one card, when it
  // has something to show. Quiet statements keep their gutter check only.
  editor.setCellInfo((id) => {
    const { blocks, settings } = getState();
    const block = blocks[id];
    if (!block || settings.outputLayout !== "inline") return null;
    if (block.status === "ok" && block.items.length === 0 && !block.paused) return null;
    return { status: block.status, span: block.toLine - block.fromLine };
  });
  // Completion asks R only when it is free. While code runs, R cannot
  // answer, and a late list would appear after the moment has passed.
  setCompleter((line, cursor) => (getState().r.status === "ready" ? api.complete(line, cursor) : Promise.resolve(null)));
  editor.setEditorHooks({ onChange: onDocumentChanged, onCursor: trackCursor, runLine, runFile, bindRunKeys: !api.native });
  await api.onREvent(handleEvent);
  await api.onMenu(runCommand);
  await api.onOpenFiles((paths) => openPaths(paths));
  await api.onDropHover((scripts) => setState({ dropHover: scripts }));
  await api.onDropSkipped((count) => notify(count === 1 ? "One file was skipped. Only R scripts, R Markdown, and Quarto files open here." : `${count} files were skipped. Only R scripts, R Markdown, and Quarto files open here.`));
  await syncMenu();
  await initAssistant(api);
  await initReports(api);
  // When only the window reloaded, R is still running with the person's
  // objects in it, so the interface reconnects rather than restarting it.
  // This comes first, before reopening files can start an R of its own.
  const reconnected = await reconnectR();
  if (!reconnected) chooseRIfNeeded(settings);
  await restoreSession(settings);
  restoreDrafts();
  if (reconnected) return;
  // R starts as the app opens, so it is ready before the first line runs.
  // With a project or a script restored, it starts in that folder.
  if (getState().r.status === "none") startR(getState().project ? null : activeSavedFile());
}

/** Reconnects to an R that kept running while the window reloaded. */
async function reconnectR() {
  const info = await api.currentSession().catch(() => null);
  if (!info) return false;
  ranSinceStart = true;
  setState((state) => ({ r: { ...state.r, status: "ready", version: info.version, generation: info.generation, workingDir: info.workingDir } }));
  appendConsole({ kind: "info", text: `The window reloaded. R ${info.version} kept running in ${shortPath(info.workingDir)}, so your objects are still there.` });
  await api.setPalette(plotColors(getState().settings.palette)).catch(() => {});
  await api.setPlotSize(plotArea.width, plotArea.height, window.devicePixelRatio || 1).catch(() => {});
  refreshObjects();
  return true;
}

// Unsaved work is copied to the window's session storage as it changes.
// That storage survives a reload of the window but not a quit, so a reload
// never loses an edit, and nothing lingers on disk afterward.
const DRAFTS_KEY = "goodfor.drafts";

function readDrafts(): Record<string, { name: string; text: string }> {
  try {
    return JSON.parse(sessionStorage.getItem(DRAFTS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

let draftTimer: ReturnType<typeof setTimeout> | undefined;

/** Records every tab with unsaved changes, shortly after each edit. */
function saveDrafts() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    const drafts: Record<string, { name: string; text: string }> = {};
    for (const tab of getState().tabs) {
      if (tab.kind !== "data" && (tab.dirty || (tab.untitled && editor.getText(tab.path)))) drafts[tab.path] = { name: tab.name, text: editor.getText(tab.path) };
    }
    try {
      sessionStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
    } catch {
      // Storage can be unavailable. Drafts are a safety net, not a store.
    }
  }, 300);
}

/** Puts unsaved work back after a reload: edits into files that reopened,
 * and untitled scripts as new tabs. */
function restoreDrafts() {
  const drafts = readDrafts();
  for (const [path, draft] of Object.entries(drafts)) {
    if (path.startsWith("untitled:")) {
      newFile();
      const active = getState().active;
      if (active) editor.replaceText(active, draft.text);
    } else if (getState().tabs.some((tab) => tab.path === path)) {
      editor.replaceText(path, draft.text);
    }
  }
}

/**
 * Reopens the project and files that were open at the last quit, as Mac
 * document apps do, then any files handed over at launch from Finder or the
 * command line.
 */
async function restoreSession(settings: Settings) {
  if (settings.sessionProject) {
    const info = await api.reopenProject(settings.sessionProject).catch(() => null);
    if (info) setProject(info);
  }
  for (const path of settings.sessionFiles) {
    const granted = await api.reopen(path).catch(() => null);
    if (granted) await openFile(granted, false);
  }
  const active = getState().tabs.find((tab) => tab.path === settings.sessionActive) ?? getState().tabs[0];
  if (active) activateTab(active.path);
  const pending = await api.takePending().catch(() => []);
  if (pending.length) await openPaths(pending);
}

let cursorFrame = 0;

/** Tracks the cursor line at most once per frame while typing, for the
 * section bar above the editor. */
function trackCursor(path: string) {
  cancelAnimationFrame(cursorFrame);
  cursorFrame = requestAnimationFrame(() => {
    if (path !== getState().active) return;
    const line = editor.cursor(path).line;
    if (line !== getState().cursorLine) setState({ cursorLine: line });
  });
}

/** Opens the R chooser only when the choice is not obvious. */
function chooseRIfNeeded(settings: Settings) {
  const { installs } = getState();
  if (installs.length === 0) {
    setState((state) => ({ r: { ...state.r, status: "missing" } }));
    return;
  }
  if (installs.some((install) => install.home === settings.rHome)) return;
  // One R needs no question. Two or more do, because guessing wrong would
  // quietly run someone's work on a version they did not expect.
  if (installs.length === 1) updateSettings({ rHome: installs[0].home });
  else setState((state) => ({ ui: { ...state.ui, dialog: "chooseR" } }));
}

/** Looks for R again, for someone who has just installed it. */
export function rescanR() {
  api.listRInstalls().then((installs) => {
    setState({ installs });
    if (installs.length) setState((state) => ({ r: { ...state.r, status: "none" } }));
    chooseRIfNeeded(getState().settings);
  });
}

// Settings.

// Settings are saved shortly after the last change, so dragging the text
// size slider writes the file once instead of on every step.
let saveTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Changes settings and applies whatever they affect straight away: theme,
 * output layout, plot colors in R, and menu check marks.
 */
export function updateSettings(patch: Partial<Settings>) {
  const settings = { ...getState().settings, ...patch };
  setState({ settings });
  applyTheme(settings);
  if (patch.outputLayout) editor.setInlineVisible(patch.outputLayout === "inline");
  if (EDITOR_KEYS.some((key) => key in patch)) editor.setPreferences(editorPrefs(settings));
  // A new code size, face, or spacing changes every line's height.
  if (patch.codeSize !== undefined || patch.codeFont || patch.lineSpacing || patch.textSize !== undefined) setTimeout(editor.requestMeasure, 60);
  if (patch.palette && isRunning()) api.setPalette(plotColors(settings.palette)).catch(() => {});
  if (patch.layer || patch.outputLayout || patch.missingPackages) syncMenu();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => api.saveSettings(getState().settings).catch((error) => notify(String(error), "error")), 250);
}

// Settings that change how the script editor behaves.
const EDITOR_KEYS = ["lineNumbers", "highlightLine", "wrapLines", "tabWidth", "closeBrackets", "rainbowBrackets", "copyResults"] as const;

function editorPrefs(settings: Settings): editor.EditorPrefs {
  return {
    lineNumbers: settings.lineNumbers,
    highlightLine: settings.highlightLine,
    wrapLines: settings.wrapLines,
    tabWidth: settings.tabWidth === 4 ? 4 : 2,
    closeBrackets: settings.closeBrackets,
    rainbowBrackets: settings.rainbowBrackets,
    copyResults: settings.copyResults,
  };
}

/** A result as plain text, the way it would read in a console. Used when a
 * copied selection crosses results, and by Copy on a result. */
export function resultAsText(block: Block): string {
  return block.items
    .map((item) => {
      if (item.type === "stream" || item.type === "value") return item.text.replace(/\n$/, "");
      if (item.type === "plot") return `[Plot ${item.plot + 1}]`;
      return `Error: ${explainError(item.message, [], block.code, item.traceback, item.parsed ?? "").original}`;
    })
    .filter(Boolean)
    .join("\n");
}

/** Sends the parts of state the menu bar shows as check marks. The recent
 * files in File, Open Recent come from the Rust side's own list. */
function syncMenu() {
  const { settings, live } = getState();
  return api.updateMenu({ layer: settings.layer, outputLayout: settings.outputLayout, autoInstall: settings.missingPackages === "auto", liveOutput: live }).catch(() => {});
}

/** Moves output inline, beside, or below the code. The editor is asked
 * to measure again because its width changes. */
export function setOutputLayout(outputLayout: OutputLayout) {
  updateSettings({ outputLayout });
  editor.refreshGutter();
  setTimeout(editor.requestMeasure, 50);
}

/** Live output is a session choice rather than a saved setting, so it is
 * always off when the app opens and nothing runs by surprise. */
export function toggleLive() {
  setState((state) => ({ live: !state.live }));
  syncMenu();
  notify(getState().live ? "Live output is on. The statement you are editing reruns when you pause." : "Live output is off.");
}

// Notices.

// Notices fade on their own. Errors stay longer because they need reading.
let noticeTimer: ReturnType<typeof setTimeout> | undefined;

/** Shows a short message at the bottom of the window. */
export function notify(text: string, tone: "info" | "error" = "info") {
  setState({ notice: { text, tone } });
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => setState({ notice: null }), tone === "error" ? 9000 : 4500);
}

/** Tells screen readers about a run result without moving focus. */
export function announce(text: string) {
  setState({ announce: text });
}

/** Opens one dialog, closing the palette, since only one can be open. */
export function openDialog(dialog: NonNullable<ReturnType<typeof getState>["ui"]["dialog"]> | null) {
  setState((state) => ({ ui: { ...state.ui, dialog, palette: false } }));
}

/** Opens or closes the command palette, optionally with a search filled in. */
export function togglePalette(query = "") {
  setState((state) => ({ ui: { ...state.ui, palette: !state.ui.palette, paletteQuery: query, dialog: null } }));
}

/** Shows or hides the inspector or the console history. The editor size
 * changes, so CodeMirror measures again once the layout settles. */
export function togglePane(pane: "inspector" | "consoleOpen" | "sidebar") {
  setState((state) => ({ ui: { ...state.ui, [pane]: !state.ui[pane] } }));
  setTimeout(editor.requestMeasure, 50);
}

// Files.

/** The last part of a path, used as a file name. Splits on both slash
 * styles so Windows paths work too. */
export function baseName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** The folder part of a path. */
export function folderOf(path: string) {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index > 0 ? path.slice(0, index) : path;
}

/** Shows the system Open dialog and opens every script chosen. */
export async function chooseAndOpen() {
  const paths = await api.chooseFiles().catch((error) => {
    notify(String(error), "error");
    return [] as string[];
  });
  await openPaths(paths);
}

/** Opens files that are already granted, activating the last one. */
async function openPaths(paths: string[]) {
  for (const path of paths) await openFile(path, false);
  const last = paths[paths.length - 1];
  if (last && getState().tabs.some((tab) => tab.path === last)) activateTab(last);
  refreshRecents();
}

/** Reopens a file from the recent list. A file that has moved or been
 * deleted is dropped from the list, and the notice says so. */
export async function openRecent(path: string) {
  try {
    const granted = await api.reopen(path);
    await openPaths([granted]);
  } catch (error) {
    notify(String(error), "error");
    refreshRecents();
  }
}

/** Removes a file from the recent list. The file itself is untouched. */
export async function forgetRecent(path: string) {
  await api.forgetRecent(path).catch(() => {});
  refreshRecents();
}

/** Reads the recent list back from the Rust side, which owns it. */
async function refreshRecents() {
  const loaded = await api.loadSettings().catch(() => null);
  if (!loaded) return;
  setState((state) => ({ settings: { ...state.settings, recentFiles: loaded.recentFiles, recentProjects: loaded.recentProjects } }));
  syncMenu();
}

/** Opens a file in a tab, or switches to it when it is already open. R
 * starts with the first file, in that file's folder. */
export async function openFile(path: string, activate = true) {
  if (!getState().tabs.some((tab) => tab.path === path)) {
    let text: string;
    try {
      text = await api.readText(path);
    } catch (error) {
      notify(String(error), "error");
      return;
    }
    editor.openDocument(path, text);
    setState((state) => ({ tabs: [...state.tabs, { path, name: baseName(path), dirty: false, untitled: false }] }));
  }
  if (activate) activateTab(path);
  ensureR(path);
  adoptFolder(path);
  rememberTabs();
}

// Projects.

/** Records the open project and shows its sidebar. */
function setProject(info: ProjectInfo | null) {
  setState((state) => ({ project: info, ui: { ...state.ui, sidebar: info ? true : state.ui.sidebar } }));
}

/**
 * Opens a project, closing any project already open. R restarts in the
 * project folder, as it does in RStudio, so relative paths mean the
 * project's own files and nothing is left over from other work.
 */
async function enterProject(info: ProjectInfo) {
  await leaveProjectFiles();
  // A project is its own context, as in RStudio. Saved scripts from other
  // work close, and stay one click away in the recent list. Anything with
  // unsaved changes stays open, so no work is ever lost by opening a project.
  for (const tab of getState().tabs) {
    const inside = tab.path.startsWith(`${info.root}/`);
    if (!inside && !tab.dirty) await closeTab(tab.path);
  }
  setProject(info);
  refreshRecents();
  // The project's main script opens, so there is something to work on.
  const main = info.scripts.find((script) => !script.includes("/")) ?? info.scripts[0];
  if (main) await openFile(joinPath(info.root, main));
  // A fresh, unused R moves into the project folder. One that has run
  // anything restarts, so no objects carry over from other work.
  const fresh = getState().r.status === "ready" && !ranSinceStart && main && !main.includes("/");
  const moved = fresh ? await api.setWorkingDir(joinPath(info.root, main)).catch(() => null) : null;
  if (moved) {
    setState((state) => ({ r: { ...state.r, workingDir: moved } }));
    appendConsole({ kind: "info", text: `Working in the project folder, ${shortPath(moved)}` });
  } else {
    await startR(null);
  }
  setTimeout(editor.requestMeasure, 50);
}

/** Closes the scripts that belonged to the project being left. */
async function leaveProjectFiles() {
  const { project, tabs } = getState();
  if (!project) return;
  for (const tab of tabs) if (tab.path.startsWith(`${project.root}/`)) await closeTab(tab.path);
}

/** Joins a project folder and a path inside it. */
function joinPath(root: string, relative: string) {
  return `${root}/${relative}`;
}

/** Shows the Open dialog for a project file, then opens the project. */
export async function chooseAndOpenProject() {
  const info = await api.chooseProject().catch((error) => {
    notify(String(error), "error");
    return null;
  });
  if (info) await enterProject(info);
}

/** Opens a project from the recent list. */
export async function openRecentProject(file: string) {
  try {
    await enterProject(await api.reopenProject(file));
  } catch (error) {
    notify(String(error), "error");
    refreshRecents();
  }
}

/** Removes a project from the recent list. Its files are untouched. */
export async function forgetProject(file: string) {
  await api.forgetProject(file).catch(() => {});
  refreshRecents();
}

/** Asks where a new project goes. Returns the folder, or null. */
export function chooseProjectFolder(existing: boolean) {
  return api.chooseProjectFolder(existing);
}

/** Creates a project from a template, then opens it. Recording package
 * versions runs renv in the console, where its progress is visible. */
export async function createProject(parent: string, name: string, template: ProjectTemplate, git: boolean, renv: boolean) {
  const info = await api.createProject(parent, name, template, git);
  openDialog(null);
  await enterProject(info);
  if (renv) {
    const code = 'if (!requireNamespace("renv", quietly = TRUE)) install.packages("renv")\nrenv::init(bare = TRUE, restart = FALSE)';
    runInConsole(code);
  }
}

/** Closes the project and its scripts. R keeps running. */
export async function closeProject() {
  await leaveProjectFiles();
  await api.closeProject().catch(() => {});
  setState((state) => ({ project: null, ui: { ...state.ui, sidebar: false } }));
}

/** Lists the project again, after a save may have added a script. */
async function refreshProject() {
  if (!getState().project) return;
  const info = await api.refreshProject().catch(() => null);
  if (info) setState({ project: info });
}

/** Opens a script from the project sidebar. */
export function openProjectScript(relative: string) {
  const { project } = getState();
  if (project) openFile(joinPath(project.root, relative));
}

let draftId = 0;

/** Puts code in the console input and moves focus there. */
export function setConsoleDraft(text: string) {
  draftId += 1;
  setState((state) => ({ consoleDraft: { id: draftId, text }, ui: { ...state.ui, consoleOpen: true } }));
  setTimeout(() => document.querySelector<HTMLElement>("#console-input")?.focus(), 30);
}

// Importing data.

/** Opens the Import Data dialog, with a file already chosen when one is
 * given, such as a data file from the project sidebar. */
export function openImport(path: string | null = null) {
  setState((state) => ({ importFile: path, ui: { ...state.ui, dialog: "importData" } }));
}

/** Asks which data file to import. */
export function chooseDataFile() {
  return api.chooseDataFile().catch((error) => {
    notify(String(error), "error");
    return null;
  });
}

/** The first rows R reads with the given code, for the preview. */
export function previewData(code: string): Promise<DataPreview> {
  if (getState().r.status !== "ready") return Promise.resolve({ error: "R is busy. The preview appears when it finishes." });
  return api.preview(code).catch((error): DataPreview => ({ error: String(error) }));
}

/** True when a package is installed. */
export async function hasPackage(name: string) {
  const missing = await api.missingPackages([name]).catch(() => [name]);
  return !missing.includes(name);
}

/**
 * Runs the import code in the console, so it is visible in the record.
 * It can also go into the script, so the analysis can be rerun from the
 * top, and the data can open in the viewer once R has it.
 */
export function runImport(code: string, name: string, addToScript: boolean, view: boolean) {
  runInConsole(code);
  if (addToScript) {
    const active = getState().active;
    if (!active || active.startsWith("data:")) newFile();
    editor.insertAtCursor(`${code}\n`);
  }
  if (!view || !name) return;
  // The viewer opens as soon as the object exists, so it never shows a
  // message about missing data while R is still reading the file.
  const started = Date.now();
  const timer = setInterval(() => {
    const ready = getState().objects.some((object) => object.name === name && object.kind === "data");
    if (ready) viewData(name);
    if (ready || Date.now() - started > 120000) clearInterval(timer);
  }, 250);
}

// The right column's panes.

/** Shows a tab in the right column's top pane. */
export function showTopPane(pane: TopPane) {
  setState((state) => ({ ui: { ...state.ui, inspector: true, topPane: pane } }));
}

/** Shows a tab in the right column's bottom pane. */
export function showBottomPane(pane: BottomPane) {
  setState((state) => ({ ui: { ...state.ui, inspector: true, bottomPane: pane } }));
  if (pane === "packages") refreshPackages();
}

// Help, from R's own documentation, shown in the Help pane.

/** Opens a help page by topic, as ?topic does, or by package and file, as
 * links between pages name them. */
export async function openHelp(topic: string, packageName = "", file = "", keepForward = false) {
  const name = topic.trim().replace(/^`|`$/g, "");
  if (!name && !file) return;
  showBottomPane("help");
  if (!requireR()) return;
  setState((state) => ({ help: { ...state.help, loading: true, missing: "" } }));
  try {
    const page = await api.help(name, packageName, file);
    if (!page.found) {
      setState((state) => ({ help: { ...state.help, loading: false, missing: name || file } }));
      return;
    }
    setState((state) => {
      const previous = state.help.page;
      const back = previous && previous.html ? [...state.help.back, { topic: previous.topic, package: previous.package, file: previous.file }].slice(-50) : state.help.back;
      return {
        help: {
          ...state.help,
          loading: false,
          query: name || file,
          back,
          forward: keepForward ? state.help.forward : [],
          page: { topic: name || file, package: page.package ?? packageName, file: page.file ?? file, html: page.html ?? "", choices: page.choices ?? [] },
        },
      };
    });
  } catch (error) {
    setState((state) => ({ help: { ...state.help, loading: false } }));
    notify(String(error), "error");
  }
}

/** Goes back to the help page shown before this one. */
export async function helpBack() {
  const { back, page, forward } = getState().help;
  const target = back[back.length - 1];
  if (!target) return;
  const here = page && page.html ? [{ topic: page.topic, package: page.package, file: page.file }] : [];
  setState((state) => ({ help: { ...state.help, back: back.slice(0, -1), forward: [...here, ...forward], page: null } }));
  await openHelp(target.topic, target.package, target.file, true);
}

/** Goes forward again after going back. */
export async function helpForward() {
  const { forward } = getState().help;
  const target = forward[0];
  if (!target) return;
  setState((state) => ({ help: { ...state.help, forward: forward.slice(1) } }));
  await openHelp(target.topic, target.package, target.file, true);
}

/** Shows a pane and moves focus to its tab, as RStudio's Control and
 * number shortcuts do. */
function focusPane(show: () => void, tab: string) {
  show();
  setTimeout(() => {
    const field = tab === "help" ? document.querySelector<HTMLElement>("#pane-panel-help input") : tab === "assistant" ? document.querySelector<HTMLElement>("#assistant-input") : null;
    (field ?? document.querySelector<HTMLElement>(`[data-tab="${tab}"]`))?.focus();
  }, 30);
}

/** Starts a new section at the cursor, with its name selected to type
 * over, as RStudio's Insert Section does. Sections appear in the section
 * menu above the editor. */
function insertSection() {
  const prefix = editor.cursorLineIsBlank() ? "" : "\n";
  const label = "Section";
  editor.insertAtCursor(`${prefix}# ${label} ----\n`, [prefix.length + 2, prefix.length + 2 + label.length]);
}

/** Help for the name at the cursor in the script, as F1 does in RStudio. */
export function helpAtCursor() {
  const word = editor.wordAtCursor();
  if (word) openHelp(word);
  else notify("Put the cursor on a function's name first, then ask for help.");
}

// Packages.

/** Reads the installed packages for the Packages pane. */
export async function refreshPackages() {
  if (getState().r.status !== "ready") return;
  const packages = await api.packages().catch(() => null);
  if (packages) setState({ packages });
}

/** Attaches or detaches a package, through the console so the code shows. */
export function setPackageAttached(name: string, attach: boolean) {
  // The box changes at once. The list is read again from R after the code
  // runs, which corrects it if attaching failed.
  setState((state) => ({ packages: state.packages?.map((item) => (item.name === name ? { ...item, loaded: attach } : item)) ?? null }));
  runInConsole(attach ? `library(${name})` : `detach("package:${name}", unload = TRUE)`);
}

// History.

/** Puts an earlier command in the console, to check and run again. */
export function historyToConsole(code: string) {
  setConsoleDraft(code);
}

/** Types an earlier command into the script at the cursor, on a line of
 * its own, so trying something in the console can become part of the
 * script. */
export function historyToScript(code: string) {
  const active = getState().active;
  if (!active || active.startsWith("data:")) newFile();
  editor.insertAtCursor(`${code}\n`);
}

/** Removes every object from the workspace, after asking, through the
 * console so the code shows. */
export async function clearWorkspace() {
  if (!getState().objects.length) return;
  const sure = await api.confirm("Remove every object from the workspace? Your scripts and files are not affected, and running the scripts again makes the objects again.", "Remove objects");
  if (sure) runInConsole("rm(list = ls())");
}

/** Runs code as if typed in the console, with the record open to show it. */
export function runInConsole(code: string) {
  if (!requireR()) return;
  if (!getState().ui.consoleOpen) togglePane("consoleOpen");
  echo(code);
  enqueue([{ code, batch: crypto.randomUUID(), console: true }]);
}

// Data viewer.

/** Opens a data frame in the data viewer, in a tab of its own. */
export function viewData(name: string) {
  const path = `data:${name}`;
  if (!getState().tabs.some((tab) => tab.path === path)) {
    setState((state) => ({ tabs: [...state.tabs, { path, name, dirty: false, untitled: false, kind: "data" }] }));
  }
  activateTab(path);
}

/** The data viewer's queries, passed through for its component. */
export function dataMeta(name: string) {
  return api.dataMeta(name);
}

export function dataRows(name: string, offset: number, count: number, sortBy: string, descending: boolean) {
  return api.dataRows(name, offset, count, sortBy, descending);
}

let untitledCount = 0;

/** Starts an untitled script. It gets a real name the first time it is saved. */
export function newFile() {
  untitledCount += 1;
  const path = `untitled:${untitledCount}`;
  editor.openDocument(path, "");
  setState((state) => ({ tabs: [...state.tabs, { path, name: `Untitled ${untitledCount}`, dirty: false, untitled: true }] }));
  activateTab(path);
  ensureR(null);
}

/** Shows a tab in the editor and refreshes what depends on the visible
 * file: the window title, the sections, the package check, and the list of
 * files to reopen next time. */
export function activateTab(path: string) {
  setState({ active: path, cursorLine: 0 });
  if (path.startsWith("data:")) {
    setState({ outline: [], missing: [] });
    api.setTitle(`${path.slice(5)}, R: What Is It Good For?`).catch(() => {});
    return;
  }
  editor.showDocument(path);
  const tab = getState().tabs.find((item) => item.path === path);
  api.setTitle(tab ? `${tab.name}, R: What Is It Good For?` : "R: What Is It Good For?").catch(() => {});
  updateOutline(path);
  checkPackages(path);
  rememberTabs();
}

/** Closes a tab, asking first when it has unsaved changes. Its output
 * goes with it. Closing the last tab returns to the opening screen, and R
 * keeps running so objects survive until the next file. */
export async function closeTab(path: string | null = getState().active) {
  if (!path) return;
  const tab = getState().tabs.find((item) => item.path === path);
  if (!tab) return;
  if (tab.dirty && !(await api.confirm(`${tab.name} has changes that are not saved. Close it anyway?`, "Close without saving"))) return;
  // The neighbor that takes over is the tab that slides into this one's
  // place, as in Safari and Xcode.
  const position = getState().tabs.findIndex((item) => item.path === path);
  const tabs = getState().tabs.filter((item) => item.path !== path);
  if (tab.kind !== "data") editor.closeDocument(path);
  const blocks = Object.values(getState().blocks).filter((block) => block.file === path).map((block) => block.id);
  setState((state) => ({
    tabs,
    blockOrder: state.blockOrder.filter((id) => !blocks.includes(id)),
  }));
  if (getState().active === path) {
    const next = tabs[Math.min(position, tabs.length - 1)]?.path ?? null;
    setState({ active: next, missing: [], outline: [] });
    editor.showDocument(next);
    if (next) activateTab(next);
    else api.setTitle("R: What Is It Good For?").catch(() => {});
  }
  rememberTabs();
  saveDrafts();
}

let rememberTimer: ReturnType<typeof setTimeout> | undefined;

/** Records the open files, so the next launch reopens them. */
function rememberTabs() {
  clearTimeout(rememberTimer);
  rememberTimer = setTimeout(() => {
    const { tabs, active } = getState();
    const files = tabs.filter((tab) => !tab.untitled && tab.kind !== "data").map((tab) => tab.path);
    api.rememberSession(files, active && files.includes(active) ? active : "").catch(() => {});
  }, 400);
}

/**
 * Saves a file. An untitled file, or Save As, asks for a name in the system
 * Save dialog first.
 */
export async function saveFile(path: string | null = getState().active, saveAs = false) {
  if (!path || path.startsWith("data:")) return;
  let target = path;
  if (path.startsWith("untitled:") || saveAs) {
    const tab = getState().tabs.find((item) => item.path === path);
    const suggested = tab ? (tab.untitled ? `${tab.name}.R` : tab.name) : "script.R";
    const chosen = await api.chooseSavePath(suggested).catch((error) => {
      notify(String(error), "error");
      return null;
    });
    if (!chosen) return;
    // Two tabs on one file would overwrite each other's saves.
    if (chosen !== path && getState().tabs.some((item) => item.path === chosen)) {
      notify(`${baseName(chosen)} is already open in another tab. Close it first, or save under another name.`, "error");
      return;
    }
    target = chosen;
  }
  try {
    await api.writeText(target, editor.getText(path));
  } catch (error) {
    notify(`Could not save. ${String(error)}`, "error");
    return;
  }
  if (target !== path) {
    editor.renameDocument(path, target);
    setState((state) => ({
      tabs: state.tabs.map((tab): Tab => (tab.path === path ? { path: target, name: baseName(target), dirty: false, untitled: false } : tab)),
      active: state.active === path ? target : state.active,
      blocks: Object.fromEntries(Object.entries(state.blocks).map(([id, block]) => [id, block.file === path ? { ...block, file: target } : block])),
    }));
    if (getState().active === target) activateTab(target);
    refreshRecents();
  } else {
    editor.markSaved(path);
  }
  setTabDirty(target, false);
  saveDrafts();
  checkPackages(target);
  rememberTabs();
  refreshProject();
  announce(`Saved ${baseName(target)}`);
}

/** Saves every tab with unsaved changes, one at a time. */
export async function saveAll() {
  for (const tab of getState().tabs) if (tab.dirty) await saveFile(tab.path);
}

/** Updates the edited mark on a tab, touching state only on a real change. */
function setTabDirty(path: string, dirty: boolean) {
  const tab = getState().tabs.find((item) => item.path === path);
  if (tab && tab.dirty !== dirty) setState((state) => ({ tabs: state.tabs.map((item) => (item.path === path ? { ...item, dirty } : item)) }));
}

// Work that follows typing waits for a pause, so typing never stutters.
let changeTimer: ReturnType<typeof setTimeout> | undefined;
let liveTimer: ReturnType<typeof setTimeout> | undefined;

/** Called on every edit. Cheap work happens now, the rest after a pause. */
function onDocumentChanged(path: string) {
  setTabDirty(path, editor.isDirty(path));
  saveDrafts();
  clearTimeout(changeTimer);
  changeTimer = setTimeout(() => {
    updateOutline(path);
    checkPackages(path);
  }, 1200);
  if (getState().live) {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => runLive(path), 500);
  }
}

// Outline.

/** Builds the section list from section comments, Quarto headings, and
 * function definitions. Plain text scanning keeps it instant. */
function updateOutline(path: string) {
  const lines = editor.getText(path).split("\n");
  const markdown = /\.(qmd|Rmd|rmd|md)$/.test(path);
  const outline: { label: string; line: number; level: number }[] = [];
  let inChunk = false;
  lines.forEach((text, line) => {
    if (markdown && /^```/.test(text)) inChunk = !inChunk;
    // RStudio style sections: a comment ending in four or more - = or #.
    const section = /^(#+)\s*(.+?)\s*(?:-{4,}|={4,}|#{4,})\s*$/.exec(text);
    const heading = markdown && !inChunk ? /^(#{1,6})\s+(.+)$/.exec(text) : null;
    const fn = /^([A-Za-z.][\w.]*)\s*(?:<-|=)\s*function\b/.exec(text);
    if (section && !markdown) outline.push({ label: section[2], line, level: section[1].length });
    else if (heading) outline.push({ label: heading[2], line, level: heading[1].length });
    else if (fn) outline.push({ label: `${fn[1]}()`, line, level: 3 });
  });
  if (getState().active === path) setState({ outline });
}

/** Moves the cursor to a section. */
export function goToLine(line: number) {
  const { active } = getState();
  if (active) editor.goToLine(active, line);
}

// R.

/** True when R can take code now or after the current run. */
function isRunning() {
  const status = getState().r.status;
  return status === "ready" || status === "busy";
}

// The inspector's plot box size, sent to R so plots fit it exactly.
let plotArea = { width: 560, height: 420 };

// R draws margins and text at fixed sizes, so a plot rendered at the
// narrow inspector's true size is mostly margin. Plots render at least this
// wide, in the inspector's shape, and are shown scaled to fit. Inline cards
// show them close to full size.
const MIN_PLOT_WIDTH = 560;

function renderSize(width: number, height: number) {
  const scale = Math.max(1, MIN_PLOT_WIDTH / width);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * Moves a fresh, unused R into the folder of the first script opened, so
 * it is already where the script expects to be when its first line runs.
 */
function adoptFolder(path: string) {
  if (getState().project || ranSinceStart || getState().r.status !== "ready" || path.startsWith("untitled:")) return;
  followScript(path);
}

/** Starts R for the first file opened, unless it is already running or
 * starting. Opening more files reuses the same session. */
function ensureR(file: string | null) {
  const { status } = getState().r;
  if (status === "none") startR(file && !file.startsWith("untitled:") ? file : null);
}

/**
 * Starts R with the chosen version, in the folder of `file` when there is
 * one. Any queued work from an earlier session is dropped, since that R no
 * longer exists.
 */
export async function startR(file: string | null = activeSavedFile()) {
  const { settings, installs } = getState();
  if (!installs.length) {
    setState((state) => ({ r: { ...state.r, status: "missing" } }));
    return;
  }
  if (!settings.rHome) {
    openDialog("chooseR");
    return;
  }
  const chosen = installs.find((install) => install.home === settings.rHome);
  if (chosen && !isSupportedR(chosen.version)) {
    const message = `R ${chosen.version} is older than ${OLDEST_R}, the oldest R this app runs. Install a newer R from CRAN, then choose it.`;
    setState((state) => ({ r: { ...state.r, status: "failed", message } }));
    return;
  }
  queue = [];
  current = null;
  runToBlock.clear();
  setState((state) => ({ r: { ...state.r, status: "starting", message: "", log: "" }, pendingInput: null }));
  try {
    const info = await api.startSession(settings.rHome, file);
    ranSinceStart = false;
    setState((state) => ({ r: { ...state.r, status: "ready", version: info.version, generation: info.generation, workingDir: info.workingDir } }));
    appendConsole({ kind: "info", text: `R ${info.version} started in ${shortPath(info.workingDir)}` });
    // A script opened while R was starting is caught up with here.
    const opened = activeSavedFile();
    if (opened && !getState().project) await followScript(opened);
    await api.setPalette(plotColors(settings.palette)).catch(() => {});
    await api.setPlotSize(plotArea.width, plotArea.height, window.devicePixelRatio || 1).catch(() => {});
    refreshObjects();
    if (getState().active) checkPackages(getState().active!);
  } catch (error) {
    setState((state) => ({ r: { ...state.r, status: "failed", message: String(error) } }));
  }
}

/** The visible file, if it has been saved somewhere. */
function activeSavedFile(): string | null {
  const { active } = getState();
  return active && !active.startsWith("untitled:") && !active.startsWith("data:") ? active : null;
}

/** Shortens a home folder path to ~ for display, as Finder and Terminal do. */
export function shortPath(path: string) {
  return path.replace(/^\/Users\/[^/]+|^\/home\/[^/]+|^[A-Z]:\\Users\\[^\\]+/, "~");
}

/** Starts a fresh R. Objects are gone afterward, as in any R restart. */
export async function restartR() {
  appendConsole({ kind: "info", text: "Restarting R" });
  failQueued("skipped");
  await startR();
}

/** Stops the running statement and cancels everything queued behind it. */
export async function stop() {
  if (getState().r.status !== "busy" && !queue.length) return;
  failQueued("skipped");
  await api.interrupt().catch(() => {});
}

/** Switches R version, restarting R when a file is open. */
export async function chooseR(home: string) {
  updateSettings({ rHome: home });
  openDialog(null);
  await startR();
}

/** Marks everything waiting in the queue as not run and empties it. */
function failQueued(status: "skipped" | "stopped") {
  for (const job of queue) if (job.blockId) updateBlock(job.blockId, { status });
  queue = [];
  editor.refreshGutter();
}

/** Adds work to the queue and starts it when R is free. */
function enqueue(jobs: Job[]) {
  queue.push(...jobs);
  pump();
}

/**
 * Moves R to the folder of the script about to run, when it is somewhere
 * else, so a path such as "data.csv" means the file beside the script. The
 * console says so each time, so the change is never silent.
 */
async function followScript(file: string | undefined) {
  // Inside a project R stays in the project folder, the convention the
  // here package and RStudio projects rely on.
  if (!file || file.startsWith("untitled:") || getState().project) return;
  const folder = folderOf(file);
  if (folder === getState().r.workingDir) return;
  const now = await api.setWorkingDir(file).catch(() => null);
  if (!now) return;
  setState((state) => ({ r: { ...state.r, workingDir: now } }));
  appendConsole({ kind: "info", text: `Working folder is now ${shortPath(now)}, where ${baseName(file)} is` });
}

/** Puts the running bar beside the statement R is working on, wherever
 * edits since it was queued have moved it. */
function markRunning(blockId: string) {
  const block = getState().blocks[blockId];
  if (!block) return;
  const to = editor.blockLines(block.file).get(blockId) ?? block.toLine;
  editor.markLines(block.file, "running", [to - (block.toLine - block.fromLine), to]);
}

/** Sends the next queued statement to R when nothing is running. */
async function pump() {
  if (current || !queue.length || !isRunning()) return;
  const job = queue.shift()!;
  // The id is chosen here and registered before the code is sent. Real R
  // can finish a short statement before the send call even returns, so the
  // mapping must already exist when its output arrives.
  const run = crypto.randomUUID();
  current = { job, run };
  ranSinceStart = true;
  await followScript(job.file);
  if (job.blockId) {
    runToBlock.set(run, job.blockId);
    updateBlock(job.blockId, { status: "running", started: Date.now() });
    markRunning(job.blockId);
    editor.refreshGutter();
    // With results in the console, the statement is echoed there as it
    // starts, the way RStudio and R itself show it.
    if (inConsole()) {
      if (!getState().ui.consoleOpen) togglePane("consoleOpen");
      appendConsole({ kind: "input", text: job.code });
    }
  }
  try {
    await api.execute(job.code, run);
  } catch (error) {
    runToBlock.delete(run);
    if (job.blockId) updateBlock(job.blockId, { status: "error", items: [{ type: "error", message: String(error), traceback: [] }] });
    current = null;
    pump();
  }
}

function appendConsole(entry: Omit<ConsoleEntry, "id">) {
  consoleId += 1;
  setState((state) => {
    const last = state.console[state.console.length - 1];
    // Consecutive text from the same stream joins into one entry, so a
    // progress bar printing many small pieces reads as one block.
    if (entry.kind === "stream" && last?.kind === "stream" && last.name === entry.name) {
      const merged = { ...last, text: last.text + entry.text };
      return { console: [...state.console.slice(0, -1), merged] };
    }
    const console = [...state.console, { ...entry, id: consoleId }];
    return { console: console.length > 2000 ? console.slice(-2000) : console };
  });
}

/** Empties the console record. R itself is unaffected. */
export function clearConsole() {
  setState({ console: [] });
}

/** Appends output to a card, joining text that streams in pieces. */
function addItem(blockId: string | undefined, item: OutputItem) {
  if (!blockId) return;
  updateBlock(blockId, (block) => {
    const last = block.items[block.items.length - 1];
    if (item.type === "stream" && last?.type === "stream" && last.name === item.name) {
      return { items: [...block.items.slice(0, -1), { ...last, text: last.text + item.text }] };
    }
    // A loop that keeps adding to one plot shows its latest picture once,
    // not one picture per step.
    if (item.type === "plot" && last?.type === "plot" && last.plot === item.plot) {
      return { items: [...block.items.slice(0, -1), item] };
    }
    return { items: [...block.items, item] };
  });
}

/** Whether results go to the console rather than beside the code, the
 * traditional arrangement. Runs still keep a record per statement, so the
 * gutter checks, error underlines, and Run File's stop at the first error
 * work the same either way. */
function inConsole() {
  return getState().settings.outputLayout === "console";
}

// ark's words for code that does not parse.
const SYNTAX = /Syntax error|unexpected|parse incomplete input/;

/** R's parser message for code that does not parse, or empty. A failure to
 * ask is treated as no answer, since the plain explanation still stands. */
function parseProblem(code: string): Promise<string> {
  return api.parseProblem(code).catch(() => "");
}

// The plain version of the latest console error, kept so a missing package
// can be offered as an install once the run ends.
let lastConsoleProblem: Explained | null = null;

// What went wrong on each card, in a few words, for the screen reader
// announcement that follows the run.
const problemTitles = new Map<string, string>();

/**
 * Underlines the part of the code that failed, in the editor, so the spot
 * can be found without reading the card. The card says the same in words.
 */
function showProblem(blockId: string, message: string, traceback: string[], parsed = "") {
  const block = getState().blocks[blockId];
  if (!block) return;
  const explained = explainError(message, getState().objects, block.code, traceback, parsed);
  problemTitles.set(blockId, explained.title);
  const where = explained.where;
  if (!where) return;
  const text = block.code.split("\n")[where.line]?.slice(where.from, where.to) ?? "";
  const now = editor.blockLines(block.file).get(blockId) ?? block.toLine;
  const first = now - (block.toLine - block.fromLine);
  editor.markProblem(block.file, first + where.line, text, where.from, explained.title);
}

/**
 * Handles one message from R. Messages from an earlier session are ignored
 * by generation, so a restart never mixes old output into new cards.
 */
function handleEvent(generation: number, event: REvent) {
  if (generation !== getState().r.generation) return;
  const blockId = "run" in event ? runToBlock.get(event.run) : undefined;
  switch (event.kind) {
    case "busy":
      setState((state) => ({ r: { ...state.r, status: event.busy ? "busy" : state.r.status === "busy" ? "ready" : state.r.status } }));
      break;
    // Results of editor runs stay beside their code. The console records
    // only what was typed there, so nothing appears twice.
    case "stream":
      if (blockId) addItem(blockId, { type: "stream", name: event.name, text: event.text });
      if (!blockId || inConsole()) appendConsole({ kind: "stream", text: event.text, name: event.name });
      break;
    case "output":
      if (event.png) {
        const block = blockId ? getState().blocks[blockId] : undefined;
        const label = block ? `${baseName(block.file)}, line ${block.toLine + 1}` : "Console";
        // A plot from the console keeps the code typed there, so either
        // kind can be redrawn when exported.
        const code = block?.code ?? (current && current.run === event.run ? current.job.code : "");
        const png = event.png;
        // A line that adds to a plot on screen, such as abline or lines,
        // redraws that plot in place. Its code joins the plot's code, so an
        // export redraws the whole picture rather than the last line alone.
        const existing = event.update && event.displayId ? getState().plots.findIndex((plot) => plot.displayId === event.displayId) : -1;
        let shown: number;
        if (existing >= 0) {
          shown = existing;
          setState((state) => ({
            plots: state.plots.map((plot, index) => (index === existing ? { ...plot, png, code: plot.code.includes(code) ? plot.code : `${plot.code}\n${code}`.trim() } : plot)),
            plotIndex: existing,
            ui: { ...state.ui, bottomPane: "plots" },
          }));
        } else {
          shown = getState().plots.length;
          setState((state) => ({ plots: [...state.plots, { png, label, code, displayId: event.displayId ?? undefined }], plotIndex: state.plots.length, ui: { ...state.ui, bottomPane: "plots" } }));
        }
        if (blockId) addItem(blockId, { type: "plot", png, plot: shown });
        if (!blockId || inConsole()) appendConsole({ kind: "plot", text: existing >= 0 ? `Plot ${shown + 1} was updated in the Plots pane` : `Plot ${shown + 1} is in the Plots pane` });
      } else if (event.text !== null) {
        if (blockId) addItem(blockId, { type: "value", text: event.text });
        if (!blockId || inConsole()) appendConsole({ kind: "value", text: event.text });
      }
      break;
    case "error":
      if (blockId) {
        addItem(blockId, { type: "error", message: event.message, traceback: event.traceback });
        const block = getState().blocks[blockId];
        // With results in the console, the plain version goes there too.
        const toConsole = (parsed = "") => {
          if (!block || !inConsole()) return;
          appendConsole({ kind: "error", text: describeProblem(explainError(event.message, getState().objects, block.code, event.traceback, parsed), block.code) });
        };
        // A syntax error from the console has no position, so R's parser is
        // asked where it stopped before the spot is marked.
        if (block && SYNTAX.test(event.message)) {
          parseProblem(block.code).then((parsed) => {
            updateBlock(blockId, (current) => ({ items: current.items.map((item) => (item.type === "error" ? { ...item, parsed } : item)) }));
            showProblem(blockId, event.message, event.traceback, parsed);
            toConsole(parsed);
          });
        } else {
          showProblem(blockId, event.message, event.traceback);
          toConsole();
        }
      } else {
        // Console errors have no card, so the plain version is written into
        // the record with the failing spot marked under the code typed.
        const code = current && current.run === event.run ? current.job.code : "";
        const write = (parsed = "") => {
          const explained = explainError(event.message, getState().objects, code, event.traceback, parsed);
          lastConsoleProblem = explained;
          appendConsole({ kind: "error", text: describeProblem(explained, code) });
        };
        if (code && SYNTAX.test(event.message)) parseProblem(code).then(write);
        else write();
      }
      break;
    case "input_request":
      setState({ pendingInput: { prompt: event.prompt, password: event.password } });
      notify("R is waiting for an answer in the console.");
      document.querySelector<HTMLElement>("#console-input")?.focus();
      break;
    case "done":
      finishRun(event.run, event.ok, event.stopped);
      break;
    case "exited":
      onExited(event.code, event.log);
      break;
  }
}

/**
 * Wraps up a run: final status and duration on its card, an announcement,
 * the queue moved along, and the objects list refreshed.
 */
function finishRun(run: string, ok: boolean, stopped: boolean) {
  const blockId = runToBlock.get(run);
  runToBlock.delete(run);
  const job = current?.run === run ? current.job : null;
  if (blockId) {
    const block = getState().blocks[blockId];
    if (block) editor.markLines(block.file, "running", null);
    const duration = Date.now() - (block?.started ?? Date.now());
    const status = stopped ? "stopped" : ok ? "ok" : "error";
    updateBlock(blockId, { status, duration, paused: Boolean(block?.live && duration > LIVE_LIMIT_MS) });
    editor.refreshGutter();
    if (block) {
      const lines = editor.blockLines(block.file);
      const line = (lines.get(blockId) ?? block.toLine) + 1;
      announce(stopped ? `Stopped at line ${line}` : ok ? `Line ${line} finished` : `Line ${line} did not run. ${problemTitles.get(blockId) ?? ""}`.trim());
    }
  }
  setState((state) => ({ pendingInput: null, r: { ...state.r, lastDuration: blockId ? getState().blocks[blockId]?.duration ?? 0 : state.r.lastDuration } }));
  // The last result of a run is brought into view, so output never lands
  // somewhere the person has to go looking for it.
  if (blockId && job && !queue.some((item) => item.batch === job.batch)) {
    setTimeout(() => editor.revealBlock(blockId), 60);
  }
  if (job) {
    current = null;
    // Run File stops at the first error, like sourcing a script.
    if (!ok && !stopped) {
      for (const queued of queue.filter((item) => item.batch === job.batch)) if (queued.blockId) updateBlock(queued.blockId, { status: "skipped" });
      queue = queue.filter((item) => item.batch !== job.batch);
    }
    if (job.console && !ok && !stopped) suggestFromConsoleError();
  }
  refreshObjects();
  recheckAfterInstall();
  pump();
}

/** R ended. Work in flight is marked, and the banner offers a restart. */
function onExited(code: number | null, log: string) {
  if (current?.job.file) editor.markLines(current.job.file, "running", null);
  if (current?.job.blockId) updateBlock(current.job.blockId, { status: "stopped" });
  current = null;
  failQueued("stopped");
  runToBlock.clear();
  setState((state) => ({
    r: { ...state.r, status: "stopped", message: code === 0 ? "R quit." : "R stopped unexpectedly.", log },
    pendingInput: null,
  }));
  appendConsole({ kind: "info", text: code === 0 ? "R quit. Restart R to keep working." : "R stopped unexpectedly. Your files are safe. Restart R to keep working." });
}

/** Console runs have no card for a fix button, so a missing package error
 * there gets a notice pointing to the install command. */
function suggestFromConsoleError() {
  const explained = lastConsoleProblem;
  lastConsoleProblem = null;
  if (explained?.fix?.kind === "install") notify(`${explained.detail} Use Packages, Install Packages to add it.`);
}

// Several runs finishing together refresh the objects list once.
let objectsTimer: ReturnType<typeof setTimeout> | undefined;

/** Reads the objects in R's global environment for the inspector. */
function refreshObjects() {
  clearTimeout(objectsTimer);
  objectsTimer = setTimeout(async () => {
    if (!isRunning()) return;
    const objects = await api.objects().catch(() => null);
    if (objects) setState({ objects });
    // Code can attach or install packages, so an open Packages pane is
    // brought up to date along with the objects.
    const { ui } = getState();
    if (ui.inspector && ui.bottomPane === "packages") refreshPackages();
  }, 150);
}

// Resizing the window sends one size to R when it stops, not one per frame.
let plotTimer: ReturnType<typeof setTimeout> | undefined;

/** The inspector reports its plot area so new plots match it exactly. */
export function setPlotArea(width: number, height: number) {
  if (width < 50 || height < 50) return;
  plotArea = renderSize(width, height);
  clearTimeout(plotTimer);
  plotTimer = setTimeout(() => {
    if (isRunning()) api.setPlotSize(plotArea.width, plotArea.height, window.devicePixelRatio || 1).catch(() => {});
  }, 400);
}

/** Shows an earlier or later plot in the inspector. */
export function showPlot(index: number) {
  setState((state) => ({ plotIndex: Math.max(0, Math.min(state.plots.length - 1, index)) }));
}

/** Opens the export dialog for the plot on show. */
export function openExportPlot() {
  if (!getState().plots.length) return notify("There is no plot to export yet. Run code that draws one first.");
  openDialog("exportPlot");
}

/**
 * Exports the plot on show at a chosen size and format. R draws it again
 * from its code, so a PDF or SVG is sharp at any size. A plot with no code
 * on record, which should not happen, falls back to the screen image.
 */
export async function exportPlot(options: PlotExport) {
  const { plots, plotIndex } = getState();
  const plot = plots[plotIndex];
  if (!plot) return false;
  if (!plot.code.trim()) {
    await savePlot();
    return true;
  }
  if (!requireR()) return false;
  try {
    const path = await api.exportPlot({ ...options, code: plot.code }, `plot-${plotIndex + 1}.${options.format}`);
    if (!path) return false;
    notify(`Exported ${baseName(path)}`);
    return true;
  } catch (error) {
    notify(String(error), "error");
    return false;
  }
}

/** Saves the plot on show as a PNG, exactly as it appears on screen. */
export async function savePlot() {
  const { plots, plotIndex } = getState();
  const plot = plots[plotIndex];
  if (!plot) return;
  try {
    const path = await api.savePlot(plot.png, `plot-${plotIndex + 1}.png`);
    if (path) notify(`Saved ${baseName(path)}`);
  } catch (error) {
    notify(`Could not save the plot. ${String(error)}`, "error");
  }
}

// Running.

/** Creates the card for a statement about to run and anchors it under the
 * statement's last line. */
function newBlock(file: string, code: string, fromLine: number, toLine: number, live = false): Block {
  const id = `block-${crypto.randomUUID()}`;
  // An underline from an earlier error describes code that is about to run
  // again, so it goes.
  if (!live) editor.clearProblems(file);
  // A rerun replaces the output of the same statement rather than piling a
  // second card underneath it.
  const lines = editor.blockLines(file);
  for (const [existing, line] of lines) {
    if (line === toLine) {
      editor.detachBlock(file, existing);
      setState((state) => ({ blockOrder: state.blockOrder.filter((item) => item !== existing) }));
    }
  }
  const block: Block = { id, file, code, fromLine, toLine, status: "queued", items: [], started: 0, duration: 0, live, paused: false };
  setState((state) => ({ blocks: { ...state.blocks, [id]: block }, blockOrder: [...state.blockOrder, id] }));
  editor.attachBlock(file, id, toLine);
  return block;
}

/** Records code typed in the console, and in the history the up arrow
 * walks there. */
function echo(code: string) {
  appendConsole({ kind: "input", text: code });
  setState((state) => ({ history: [...state.history.filter((item) => item !== code), code].slice(-200) }));
}

/** Checks that R can take code, and says why not when it cannot. */
function requireR(): boolean {
  const { status } = getState().r;
  if (status === "ready" || status === "busy") return true;
  if (status === "starting") notify("R is still starting. Try again in a moment.");
  else if (status === "missing") notify("R is not installed on this computer.", "error");
  else notify("R is not running. Use Restart R to start it.", "error");
  return false;
}

/**
 * Runs the selection, or the whole statement under the cursor when nothing
 * is selected, then moves the cursor to the next statement.
 */
export function runLine() {
  const { active } = getState();
  if (!active || active.startsWith("data:") || !requireR()) return;
  const position = editor.cursor(active);
  const text = editor.getText(active);
  const batch = crypto.randomUUID();
  if (position.selection.trim()) {
    const lines = text.split("\n");
    const fromLine = Math.max(0, position.selectionEndLine - position.selection.split("\n").length + 1);
    const block = newBlock(active, position.selection, fromLine, Math.min(position.selectionEndLine, lines.length - 1));
    enqueue([{ code: position.selection, batch, blockId: block.id, file: active }]);
    return;
  }
  const range = statementAt(statementRanges(text), position.line);
  if (!range) return;
  const code = text.split("\n").slice(range.from, range.to + 1).join("\n");
  const block = newBlock(active, code, range.from, range.to);
  enqueue([{ code, batch, blockId: block.id, file: active }]);
  // Like RStudio, the cursor moves on so pressing again runs the next one.
  const next = statementRanges(text).find((candidate) => candidate.from > range.to);
  editor.goToLine(active, next ? next.from : range.to);
}

/** Runs every statement in the file, or those up to the cursor, each with
 * its own card. The batch stops at the first error. */
export function runFile(upToCursor = false) {
  const { active } = getState();
  if (!active || active.startsWith("data:") || !requireR()) return;
  const text = editor.getText(active);
  const lines = text.split("\n");
  const limit = upToCursor ? editor.cursor(active).line : Infinity;
  const batch = crypto.randomUUID();
  const jobs: Job[] = [];
  for (const range of statementRanges(text)) {
    if (range.from > limit) break;
    const code = lines.slice(range.from, range.to + 1).join("\n");
    const block = newBlock(active, code, range.from, range.to);
    jobs.push({ code, batch, blockId: block.id, file: active });
  }
  enqueue(jobs);
}

/** A clean run from scratch, the reliable way to check a script works. */
export async function restartAndRunFile() {
  await restartR();
  runFile();
}

/**
 * Reruns the statement being edited, if it is safe and complete. It waits
 * its turn rather than interrupting anything, and skips paused statements.
 */
function runLive(path: string) {
  const { active, r } = getState();
  if (path !== active || r.status !== "ready" || current || queue.length) return;
  const text = editor.getText(path);
  const range = statementAt(statementRanges(text), editor.cursor(path).line);
  if (!range) return;
  const code = text.split("\n").slice(range.from, range.to + 1).join("\n");
  if (LIVE_UNSAFE.test(code)) return;
  const lines = editor.blockLines(path);
  const existing = Object.values(getState().blocks).find((block) => block.file === path && lines.get(block.id) === range.to);
  if (existing?.paused || existing?.code === code) return;
  // Only complete statements run live. Half typed code would mostly error.
  api.isComplete(code).then((status) => {
    if (status !== "complete" || getState().r.status !== "ready") return;
    const block = newBlock(path, code, range.from, range.to, true);
    enqueue([{ code, batch: crypto.randomUUID(), blockId: block.id, file: path }]);
  }).catch(() => {});
}

/** Runs a result's statement again, as it reads in the editor now. */
/** Hides or shows a card's result, keeping its code and title bar. */
export function toggleResult(blockId: string) {
  updateBlock(blockId, (block) => ({ collapsed: !block.collapsed }));
  setTimeout(editor.requestMeasure, 0);
}

/** Copies a card's printed result as plain text, as it appears. */
export async function copyResult(blockId: string) {
  const block = getState().blocks[blockId];
  if (!block) return;
  const text = block.items
    .map((item) => (item.type === "stream" || item.type === "value" ? item.text.replace(/\n$/, "") : item.type === "error" ? item.message : ""))
    .filter(Boolean)
    .join("\n");
  if (!text) return notify("This result has no text to copy. A plot can be exported from the Plots pane.");
  try {
    await navigator.clipboard.writeText(text);
    notify("Copied the result");
  } catch {
    notify("The result could not be copied.", "error");
  }
}

export function runBlockAgain(blockId: string) {
  const block = getState().blocks[blockId];
  if (!block || !requireR()) return;
  const line = editor.blockLines(block.file).get(blockId) ?? block.toLine;
  const text = editor.getText(block.file);
  const range = statementAt(statementRanges(text), line);
  const code = range ? text.split("\n").slice(range.from, range.to + 1).join("\n") : block.code;
  const next = newBlock(block.file, code, range?.from ?? block.fromLine, range?.to ?? block.toLine);
  enqueue([{ code, batch: crypto.randomUUID(), blockId: next.id, file: block.file }]);
}

/** Applies a suggested fix, such as a corrected column name, within the
 * statement that failed, then runs it again. */
export function applyFix(blockId: string, from: string, to: string) {
  const block = getState().blocks[blockId];
  if (!block) return;
  const line = editor.blockLines(block.file).get(blockId) ?? block.toLine;
  editor.replaceWord(block.file, Math.max(0, line - (block.toLine - block.fromLine)), line, from, to);
  runBlockAgain(blockId);
}

/** Removes every output card. Objects in R are unaffected. */
export function clearOutput() {
  const { blocks } = getState();
  for (const block of Object.values(blocks)) editor.detachBlock(block.file, block.id);
  setState({ blocks: {}, blockOrder: [] });
}

/**
 * Runs what was typed in the console, or answers R when it is waiting for
 * input. Returns "incomplete" so the console can continue the statement on
 * a new line, as R does with its plus prompt.
 */
export async function runConsole(code: string): Promise<"ran" | "incomplete"> {
  const { pendingInput } = getState();
  if (pendingInput) {
    appendConsole({ kind: "answer", text: pendingInput.password ? "••••" : code });
    setState({ pendingInput: null });
    if (getState().notice?.text.startsWith("R is waiting")) setState({ notice: null });
    await api.sendInput(code).catch((error) => notify(String(error), "error"));
    return "ran";
  }
  if (!code.trim() || !requireR()) return "ran";
  // ?topic and help(topic) open the Help pane, as in RStudio, rather than
  // printing a page into the console.
  const asked = /^\s*\?{1,2}\s*([A-Za-z.][\w.]*|`[^`]+`)\s*$/.exec(code) ?? /^\s*help\(\s*["']?([A-Za-z.][\w.]*)["']?\s*\)\s*$/.exec(code);
  if (asked) {
    echo(code);
    openHelp(asked[1]);
    return "ran";
  }
  const status = await api.isComplete(code).catch(() => "complete");
  if (status === "incomplete") return "incomplete";
  // Console results appear in its record, so the record opens to show them.
  if (!getState().ui.consoleOpen) togglePane("consoleOpen");
  echo(code);
  enqueue([{ code, batch: crypto.randomUUID(), console: true }]);
  return "ran";
}

// Packages.

// One package check at a time, since each asks R.
let checking = false;

/**
 * Compares the packages a file uses against what is installed, asking R
 * only about names it has not checked before, and installs them when the
 * person has chosen automatic installs.
 */
async function checkPackages(path: string) {
  if (path !== getState().active) return;
  const references = referencedPackages(editor.getText(path));
  const unknown = references.map((reference) => reference.name).filter((name) => !knownInstalled.has(name) && !knownMissing.has(name));
  if (unknown.length && getState().r.status === "ready" && !checking) {
    checking = true;
    try {
      const missing = new Set(await api.missingPackages(unknown));
      for (const name of unknown) (missing.has(name) ? knownMissing : knownInstalled).add(name);
    } catch {
      // Checked again on the next change or save.
    } finally {
      checking = false;
    }
  }
  const missing = references.filter((reference) => knownMissing.has(reference.name));
  if (getState().active === path) setState({ missing });
  if (getState().settings.missingPackages === "auto") {
    const fresh = missing.map((item) => item.name).filter((name) => !autoAttempted.has(name));
    if (fresh.length) {
      fresh.forEach((name) => autoAttempted.add(name));
      installPackages(fresh);
    }
  }
}

// Names being installed, checked again once the install finishes.
let installing: string[] = [];

/** Installs packages through the console, so progress and any errors are
 * in plain view. Names are checked so nothing else can reach R this way. */
export function installPackages(names: string[]) {
  const clean = names.map((name) => name.trim()).filter((name) => /^[A-Za-z][A-Za-z0-9.]*$/.test(name));
  if (!clean.length || !requireR()) return;
  installing = [...installing, ...clean];
  if (!getState().ui.consoleOpen) togglePane("consoleOpen");
  const code = `install.packages(c(${clean.map((name) => `"${name}"`).join(", ")}))`;
  echo(code);
  notify(`Installing ${clean.join(", ")}. Progress is in the console.`);
  enqueue([{ code, batch: crypto.randomUUID(), console: true }]);
}

/** Forgets cached answers for what was just installed and checks again. */
function recheckAfterInstall() {
  if (!installing.length) return;
  for (const name of installing) {
    knownMissing.delete(name);
    knownInstalled.delete(name);
  }
  installing = [];
  const { active } = getState();
  if (active) setTimeout(() => checkPackages(active), 100);
}

/** Installs everything the visible file uses that is missing. */
export function installMissingForFile() {
  const { missing } = getState();
  if (missing.length) installPackages(missing.map((item) => item.name));
  else notify("Every package this file uses is installed.");
}

/** Hides the banner until the file changes or is saved. */
export function dismissMissing() {
  setState({ missing: [] });
}

// Commands.

/** Steps text size within the range Settings offers. */
export function zoom(step: number) {
  const textSize = Math.min(150, Math.max(90, getState().settings.textSize + step));
  updateSettings({ textSize });
}

/** Moves keyboard focus to the console input. */
function focusConsole() {
  document.querySelector<HTMLElement>("#console-input")?.focus();
}

/** Opens one of the app's fixed links in the default browser. */
export function openUrl(kind: "releases" | "issues" | "cran" | "ollama") {
  const url = kind === "releases" ? RELEASES : kind === "issues" ? ISSUES : kind === "ollama" ? OLLAMA : CRAN;
  api.openUrl(url).catch(() => notify(`The browser did not open. The address is ${url}`, "error"));
}

/** Runs a command by id, from the menu bar, a shortcut, or the palette. */
export function runCommand(id: string) {
  const actions: Record<string, () => unknown> = {
    "app.settings": () => openDialog("settings"),
    "file.new": newFile,
    "project.new": () => openDialog("newProject"),
    "project.open": chooseAndOpenProject,
    "project.close": closeProject,
    "view.sidebar": () => togglePane("sidebar"),
    "file.open": chooseAndOpen,
    "file.save": () => saveFile(),
    "file.saveAs": () => saveFile(getState().active, true),
    "file.saveAll": saveAll,
    "file.close": () => closeTab(),
    "file.exportPlot": openExportPlot,
    "edit.find": editor.openFind,
    "edit.comment": editor.commentLines,
    "view.output.inline": () => setOutputLayout("inline"),
    "view.output.side": () => setOutputLayout("side"),
    "view.output.stacked": () => setOutputLayout("stacked"),
    "view.output.console": () => setOutputLayout("console"),
    "view.style.cards": () => updateSettings({ resultStyle: "cards" }),
    "view.style.plain": () => updateSettings({ resultStyle: "plain" }),
    "view.live": toggleLive,
    "view.inspector": () => togglePane("inspector"),
    "view.console": () => togglePane("consoleOpen"),
    "view.layer.essentials": () => updateSettings({ layer: "essentials" }),
    "view.layer.everything": () => updateSettings({ layer: "everything" }),
    "view.palette": () => togglePalette(),
    "view.zoomIn": () => zoom(10),
    "view.zoomOut": () => zoom(-10),
    "run.line": runLine,
    "run.file": () => runFile(),
    "run.toHere": () => runFile(true),
    "run.stop": stop,
    "run.restart": restartR,
    "run.restartRunAll": restartAndRunFile,
    "run.chooseR": () => openDialog("chooseR"),
    "run.clearOutput": clearOutput,
    "run.clearConsole": clearConsole,
    "packages.install": () => openDialog("install"),
    "packages.installMissing": installMissingForFile,
    "packages.auto": () => updateSettings({ missingPackages: getState().settings.missingPackages === "auto" ? "ask" : "auto" }),
    "focus.editor": editor.focusEditor,
    "focus.console": focusConsole,
    "focus.help": () => focusPane(() => showBottomPane("help"), "help"),
    "focus.history": () => focusPane(() => showTopPane("history"), "history"),
    "focus.plots": () => focusPane(() => showBottomPane("plots"), "plots"),
    "focus.packages": () => focusPane(() => showBottomPane("packages"), "packages"),
    "focus.environment": () => focusPane(() => showTopPane("environment"), "environment"),
    "edit.pipe": () => editor.insertWhereFocused(" |> "),
    "edit.assign": () => editor.insertWhereFocused(" <- "),
    "edit.section": insertSection,
    "help.atCursor": helpAtCursor,
    "data.import": () => openDialog("importData"),
    "help.shortcuts": () => togglePalette(),
    "help.about": () => openDialog("about"),
    "help.license": () => openDialog("about"),
    "help.report": () => openUrl("issues"),
    "assistant.setup": openAssistantSetup,
    "assistant.show": () => focusPane(() => showTopPane("assistant"), "assistant"),
    "assistant.explain": () => assistOnCode("explainCode"),
    "assistant.comment": () => assistOnCode("comment"),
    "assistant.improve": () => assistOnCode("improve"),
    "assistant.write": () => focusPane(() => showTopPane("assistant"), "assistant"),
    "render.report": () => renderReport(),
    "render.html": () => renderReport("html"),
    "render.word": () => renderReport("word"),
    "render.pdf": () => renderReport("pdf"),
    "render.stop": stopRender,
  };
  // File, Open Recent items carry their place in the recent list.
  const recentProject = /^project\.recent\.(\d+)$/.exec(id);
  if (recentProject) {
    const file = getState().settings.recentProjects[Number(recentProject[1])];
    if (file) openRecentProject(file.path);
    return;
  }
  const recent = /^file\.recent\.(\d+)$/.exec(id);
  if (recent) {
    const file = getState().settings.recentFiles[Number(recent[1])];
    if (file) openRecent(file.path);
    return;
  }
  const action = actions[id];
  if (action) Promise.resolve(action()).catch((error) => notify(String(error), "error"));
}
