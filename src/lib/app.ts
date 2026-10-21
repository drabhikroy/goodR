// Every action the app can take, in one module, so menus, shortcuts, the
// command palette, and buttons all run the same code.
//
// Runs go through a queue and execute one at a time. That keeps output in
// the order code was sent, lets Run File stop at the first error the way
// sourcing a script does, and lets Stop cancel everything still waiting.

import { assistOnCode, initAssistant, openAssistantSetup } from "./assistant";
import { initLatex } from "./latex";
import { forgetResults, initKeepResults, restoreKeptFor } from "./keepResults";
import { checkFromScratch, initResultsTools, saveResultsAsReport } from "./resultsTools";
import { initCite, openCitation } from "./cite";
import { startGuide } from "./firstProject";
import { openTrace } from "./trace";
import { openFixProblems } from "./fixProblems";
import { openFileHistory } from "./fileHistory";
import { checkForUpdates, checkForUpdatesNow, openUpdates } from "./updates";
import { writeCodeHere } from "./draftCode";
import { scriptSteps } from "./lineage";
import { compareResults } from "./resultDiff";
import { checkExercise, initTeaching, makeExercise, saveExercises } from "./teaching";
import { explainAtCursor, initEditing, openRename, refreshAllHints, tidyCode, updateHints } from "./editing";
import { initReports, renderReport, stopRender } from "./report";
import { checkShinyFile, initApps, openAppInBrowser, openShare, runApp, stopApp } from "./shiny";
import { backend, type Backend } from "./backend";
import * as editor from "./editor";
import { describeProblem, explainError, type Explained } from "./errors";
import { findTarget, pointAt, TARGETS, type GuideTarget } from "./guide";
import { referencedPackages } from "./packages";
import { isSupportedR, OLDEST_R } from "./rversion";
import { chunkAt, chunksOf, codeOnly, documentFileName, hasSections, isDocument, newDocumentText, sectionAt, type DocumentFormat, type DocumentKind } from "./chunks";
import { writeLabels, type PlotLabels } from "./plotEdit";
import { keyLabel } from "./commands";
import { SNIPPETS } from "./snippets";
import { statementAt, statementRanges } from "./statements";
import { defaultSettings, dropSession, getState, isQuiet, patchSession, SCRATCH, sessionOf, setState, showSession, updateBlock, type Block, type Panel, type ConsoleEntry, type OutputItem, type Tab } from "./store";
import { setCompleter } from "./completion";
import type { Brief, DataPreview, OutputLayout, PlotExport, ProjectInfo, ProjectTemplate, REvent, RunProfile, RunScope, Settings } from "./types";
import { applyTheme, plotColors, watchSystemAppearance } from "../theme/theme";

// The backend is set once in init and used by every action below.
let api: Backend;

/** The backend, once the app has started, for modules that talk to it
 * directly rather than through a wrapper here. */
export function backendNow(): Backend {
  return api;
}

// One piece of code waiting to run. `batch` groups the statements of one
// Run File, so an error can cancel the rest of that batch and nothing else.
// `session` names the R it runs in.
type Job = { code: string; batch: string; blockId?: string; console?: boolean; file?: string; session: string };

// Each session keeps its own line of work: the statements waiting their
// turn, the one its R is running now, and which card each run's output
// belongs to, since R tags output with a run id. Sessions run side by
// side, so a long model fit in one project never holds up another.
//
// Between statements the line also tells R where one ends and the next
// begins: `lastBatch` is the run the last statement belonged to, so a new
// run can keep the objects as they were for Undo, `timed` is the statement
// just finished, whose time R sampled, and `totals` counts each run's
// statements, so progress can say "3 of 40".
type Line = {
  queue: Job[];
  current: { job: Job; run: string | null } | null;
  runToBlock: Map<string, string>;
  lastBatch: string | null;
  timed: { blockId?: string; duration: number } | null;
  totals: Map<string, number>;
};

/** A line of work with nothing in it yet. */
function emptyLine(): Line {
  return { queue: [], current: null, runToBlock: new Map(), lastBatch: null, timed: null, totals: new Map() };
}
const sessionLines = new Map<string, Line>();

/** A session's line of work, made the first time it is needed. */
function lineOf(session: string): Line {
  let line = sessionLines.get(session);
  if (!line) {
    line = emptyLine();
    sessionLines.set(session, line);
  }
  return line;
}

let consoleId = 0;

/** The session the panes show, which commands from the menu act on. */
function activeKey() {
  return getState().activeSession;
}

/** Samples of the named objects and the versions, from the session a
 * file runs in, for a forum question. Null when R cannot answer. */
export function reprexFor(path: string, names: string[]) {
  return api.reprex(sessionOfFile(path), names).catch(() => null);
}

/** A file's saved versions, newest first, each with its text. */
export async function loadFileVersions(path: string) {
  const list = await api.fileHistory(path).catch(() => []);
  return Promise.all(list.map(async (version) => ({ ...version, text: await api.fileVersion(path, version.id).catch(() => "") })));
}

/** The session a tab's code runs in. */
export function sessionOfFile(path: string | null | undefined): string {
  return getState().tabs.find((tab) => tab.path === path)?.session ?? activeKey();
}

/** The kind of session a key names. */
function kindOf(session: string): "project" | "file" | "scratch" {
  return session.startsWith("project:") ? "project" : session.startsWith("file:") ? "file" : "scratch";
}

// Package names already asked about, so R is queried once per name.
const knownInstalled = new Set<string>();
const knownMissing = new Set<string>();
const autoAttempted = new Set<string>();

const RELEASES = "https://github.com/drabhikroy/goodR/releases/latest";
const ISSUES = "https://github.com/drabhikroy/goodR/issues";
const CRAN = "https://cran.r-project.org/";
const OLLAMA = "https://ollama.com/download";
const POSIT_COMMUNITY = "https://forum.posit.co/new-topic";
const STACK_OVERFLOW = "https://stackoverflow.com/questions/ask?tags=r";

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
  // Results go to the canvas, where plots have room to be seen, unless the
  // person has chosen to show them under each line. Any other saved layout
  // value is read as the canvas.
  if (settings.outputLayout !== "inline" || !settings.layoutChosen) settings.outputLayout = "canvas";
  setState((state) => ({ info, settings, installs, loaded: true, ui: { ...state.ui, sidebar: settings.showSidebar, inspector: settings.showCanvas } }));
  applyTheme(settings);
  watchSystemAppearance(() => {
    applyTheme(getState().settings);
    if (getState().settings.plotStyle) for (const session of runningKeys()) applyPlotStyle(session);
  });
  editor.setInlineVisible(settings.outputLayout === "inline");
  editor.setPreferences(editorPrefs(settings));
  // A code typeface loads only when first chosen, and its letters are a
  // different width, so the editor measures again once it arrives. Without
  // this the line number margin can overlap the start of each line.
  document.fonts?.addEventListener?.("loadingdone", () => editor.requestMeasure());
  // Copying across results takes their text, as it would read in a console.
  editor.setResultText((id) => {
    const block = getState().blocks[id];
    return block && getState().settings.outputLayout === "inline" ? resultAsText(block) : null;
  });
  editor.setQuietCheck((id) => {
    const block = getState().blocks[id];
    return Boolean(block && isQuiet(block) && !block.undone);
  });
  // A statement becomes a cell, input above output in one card, when it
  // has something to show. Quiet statements keep their gutter check only.
  editor.setCellInfo((id) => {
    const { blocks, settings } = getState();
    const block = blocks[id];
    if (!block || settings.outputLayout !== "inline") return null;
    if (isQuiet(block)) return null;
    return { status: block.status, span: block.toLine - block.fromLine };
  });
  // Completion asks R only when it is free. While code runs, R cannot
  // answer, and a late list would appear after the moment has passed.
  setCompleter((line, cursor) => (getState().r.status === "ready" ? api.complete(activeKey(), line, cursor) : Promise.resolve(null)));
  editor.setQuickHelp(quickHelpFor);
  editor.setEditorHooks({ onChange: onDocumentChanged, onCursor: trackCursor, runLine, runFile, runChunkAt, bindRunKeys: !api.native });
  await api.onREvent(handleEvent);
  await api.onMenu(runCommand);
  await api.onOpenFiles((paths) => openPaths(paths));
  await api.onDropHover((scripts) => setState({ dropHover: scripts }));
  await api.onDropSkipped((count) => notify(count === 1 ? "One file was skipped. Only R scripts, R Markdown, and Quarto files open here." : `${count} files were skipped. Only R scripts, R Markdown, and Quarto files open here.`));
  await syncMenu();
  await initAssistant(api);
  await initReports(api);
  await initApps(api);
  await initLatex(api);
  initEditing(api);
  initResultsTools(api);
  initCite(api);
  initTeaching(api);
  // When only the window reloaded, each R is still running with the
  // person's objects in it, so the interface reconnects rather than
  // restarting them. This comes first, before reopening files can start
  // an R of its own.
  const reconnected = await reconnectR();
  if (!reconnected) chooseRIfNeeded(settings);
  await restoreSession(settings);
  restoreDrafts();
  await initKeepResults();
  // An R for untitled work starts as the app opens, so R is ready before
  // the first line runs even when nothing has been opened yet.
  if (sessionOf(SCRATCH).r.status === "none") startR(SCRATCH);
  // Updates are looked for a little after opening, once R has had time to
  // start, since R is what knows which packages are behind.
  setTimeout(checkForUpdatesNow, 15_000);
  setInterval(checkForUpdatesNow, 60 * 60 * 1000);
}

// Quick help for functions from packages, kept once read, since a
// package's help does not change while the app runs.
const briefs = new Map<string, Brief>();

/**
 * What quick help says about a name in the script. An object says what it
 * holds, from the objects list, with no call to R. A function says what it
 * is for and how it is called, read from R's help, but only while R is
 * free, since a note that arrives after a long run would be out of place.
 */
async function quickHelpFor(name: string, call: boolean): Promise<editor.QuickHelp | null> {
  const session = activeKey();
  const object = sessionOf(session).objects.find((item) => item.name === name);
  if (object && !(call && object.kind === "function")) {
    return { heading: object.name, lines: [{ text: object.summary.charAt(0).toUpperCase() + object.summary.slice(1) }] };
  }
  if (!call || sessionOf(session).r.status !== "ready") return null;
  const key = `${session}\u0000${name}`;
  const brief = briefs.get(key) ?? (await api.brief(session, name).catch(() => null));
  if (!brief?.found) return null;
  const yours = !brief.package || brief.package === "R_GlobalEnv";
  if (!yours) briefs.set(key, brief);
  const lines: editor.QuickHelp["lines"] = [];
  if (brief.title) lines.push({ text: brief.title });
  if (brief.usage) lines.push({ text: brief.usage, code: true });
  lines.push({ text: yours ? "A function made in this session." : "F1 opens its full help page." });
  return { heading: yours ? name : `${name}, from ${brief.package}`, lines };
}

/** Reconnects to every R that kept running while the window reloaded. */
async function reconnectR() {
  const running = await api.runningSessions().catch(() => []);
  for (const info of running) {
    patchSession(info.session, (session) => ({ r: { ...session.r, status: "ready", version: info.version, generation: info.generation, workingDir: info.workingDir } }));
    appendConsole(info.session, { kind: "info", text: `The window reloaded. R ${info.version} kept running in ${shortPath(info.workingDir)}, so your objects are still there.` });
    await prepareSession(info.session);
  }
  return running.length > 0;
}

/** Sends the app's plot style to one R: the colors of the page the plots
 * sit on, read from the theme in use, so dark mode gets dark plots. */
function applyPlotStyle(session: string) {
  const style = getComputedStyle(document.documentElement);
  const colors = ["--code-bg", "--text", "--text-muted", "--border"].map((name) => style.getPropertyValue(name).trim().toUpperCase());
  return api.setPlotStyle(session, getState().settings.plotStyle, colors).catch(() => {});
}

/** Sends a fresh or reconnected R the plot colors and size, and reads its
 * objects. */
async function prepareSession(session: string) {
  await api.setPalette(session, plotColors(getState().settings.palette)).catch(() => {});
  if (getState().settings.plotStyle) await applyPlotStyle(session);
  await api.setPlotSize(session, plotArea.width, plotArea.height, window.devicePixelRatio || 1).catch(() => {});
  refreshObjects(session);
}

// Drafts of unsaved edits, kept in local storage until the file is saved
// or closed, so a reload, crash, or quit does not lose them.
const DRAFTS_KEY = "goodfor.drafts";
// Set for as long as the window is open, to tell a reload, which brings
// drafts back quietly, from a new launch, which says so.
const OPEN_KEY = "goodfor.open";

function readDrafts(): Record<string, { name: string; text: string }> {
  try {
    return JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? sessionStorage.getItem(DRAFTS_KEY) ?? "{}");
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
      if (Object.keys(drafts).length) localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
      else localStorage.removeItem(DRAFTS_KEY);
    } catch {
      // Storage can be unavailable. Drafts are a safety net, not a store.
    }
  }, 300);
}

/** Puts unsaved work back after a reload: edits into files that reopened,
 * and untitled scripts as new tabs. */
function restoreDrafts() {
  const drafts = readDrafts();
  let launched = false;
  try {
    launched = !sessionStorage.getItem(OPEN_KEY);
    sessionStorage.setItem(OPEN_KEY, "1");
  } catch {
    // Without storage there are no drafts either.
  }
  const names: string[] = [];
  for (const [path, draft] of Object.entries(drafts)) {
    if (path.startsWith("untitled:")) {
      newFile();
      const active = getState().active;
      if (active) editor.replaceText(active, draft.text);
      names.push(draft.name);
    } else if (getState().tabs.some((tab) => tab.path === path) && editor.getText(path) !== draft.text) {
      editor.replaceText(path, draft.text);
      names.push(draft.name);
    }
  }
  // After a crash or a quit, the user is told their work came back, and
  // that it is not saved yet, so nothing seems to change by itself.
  if (launched && names.length) {
    notify(`Brought back unsaved changes to ${nameList(names)} from last time. Save to keep them.`);
  }
  saveDrafts();
}

/**
 * Reopens the project and files that were open at the last quit, as Mac
 * document apps do, then any files handed over at launch from Finder or the
 * command line.
 */
async function restoreSession(settings: Settings) {
  if (settings.sessionProject) {
    const info = await api.reopenProject(settings.sessionProject).catch(() => null);
    if (info) patchSession(projectKey(info.root), { project: info });
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
    patchSession(activeKey(), (session) => ({ r: { ...session.r, status: "missing" } }));
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
  api
    .listRInstalls()
    .then((installs) => {
      setState({ installs });
      if (installs.length) patchSession(activeKey(), (session) => ({ r: { ...session.r, status: "none" } }));
      chooseRIfNeeded(getState().settings);
    })
    .catch((error) => notify(String(error), "error"));
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
  setState((state) => ({
    settings,
    // The sidebar and the canvas are shown from the interface's own state,
    // which follows these two settings wherever they change.
    ui: { ...state.ui, sidebar: patch.showSidebar ?? state.ui.sidebar, inspector: patch.showCanvas ?? state.ui.inspector },
  }));
  applyTheme(settings);
  if (patch.outputLayout) editor.setInlineVisible(patch.outputLayout === "inline");
  if (EDITOR_KEYS.some((key) => key in patch)) editor.setPreferences(editorPrefs(settings));
  // A new code size, face, or spacing changes every line's height.
  if (patch.codeSize !== undefined || patch.codeFont || patch.lineSpacing || patch.textSize !== undefined) setTimeout(editor.requestMeasure, 60);
  if (patch.palette) for (const session of runningKeys()) api.setPalette(session, plotColors(settings.palette)).catch(() => {});
  // The plot style follows the appearance, so it is sent again when either
  // changes. Turning it off is sent too, to put R's own look back.
  if (patch.plotStyle !== undefined || (settings.plotStyle && patch.appearance)) for (const session of runningKeys()) applyPlotStyle(session);
  if (patch.layer || patch.outputLayout || patch.missingPackages) syncMenu();
  if (patch.hints !== undefined) refreshAllHints();
  if (patch.keepResults === false) forgetResults();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => api.saveSettings(getState().settings).catch((error) => notify(String(error), "error")), 250);
}

/** The settings each section of Settings shows, so a section can be put
 * back to its defaults on its own. */
export const SETTINGS_SECTIONS: Record<string, (keyof Settings)[]> = {
  appearance: ["appearance", "textSize", "compact", "readingWidth"],
  code: ["codeFont", "codeSize", "lineSpacing", "ligatures", "scriptItalics"],
  editor: ["lineNumbers", "highlightLine", "wrapLines", "closeBrackets", "rainbowBrackets", "autosave", "hints", "formatOnType", "tabWidth"],
  results: ["outputLayout", "resultStyle", "copyResults", "keepResults", "plotStyle"],
  reports: ["pdfEngine", "latexDir", "renderOnSave"],
  accessibility: ["palette", "reduceMotion"],
  r: ["missingPackages", "undoRuns", "showPackageLog"],
  updates: ["updateChecks"],
  menus: ["layer"],
  // The parts of the window and their sizes.
  layout: ["showSidebar", "showCanvas", "showPrompt", "showTimeline", "consoleInputHeight", "inspectorWidth", "paneSplit", "timelineHeight"],
};

/** What Reset the app puts back, beyond every setting and the layout. */
export type ResetChoices = { recent: boolean; history: boolean; results: boolean; r: boolean };

/** Puts the whole app back as it was new: every setting and the layout,
 * the tour shown again, and, as chosen, the recent lists, earlier versions
 * of files, kept results, and the R in use. Files and installed packages
 * are never touched. Open tabs stay open, so nothing in progress is lost. */
export async function resetApp(choices: ResetChoices) {
  const keep = getState().settings;
  await api.resetApp(choices.recent, choices.history).catch((error) => notify(String(error), "error"));
  updateSettings({
    ...defaultSettings,
    rHome: choices.r ? "" : keep.rHome,
    sessionFiles: keep.sessionFiles,
    sessionActive: keep.sessionActive,
    sessionProject: keep.sessionProject,
    recentFiles: choices.recent ? [] : keep.recentFiles,
    recentProjects: choices.recent ? [] : keep.recentProjects,
  });
  if (choices.results) forgetResults();
  setState((state) => ({ ui: { ...state.ui, focus: false, dialog: null } }));
  setTimeout(editor.requestMeasure, 50);
  notify(choices.r ? "The app is back as it was new. Choose an R the next time it opens." : "The app is back as it was new.");
}

/** Puts one section's settings back to their defaults, or every setting
 * when no section is named, after asking. Recent files, the R chosen, and
 * the assistant are kept, since they are the user's work and setup
 * rather than preferences. */
export async function resetSettings(section: string | null) {
  const keys = section ? SETTINGS_SECTIONS[section] : Object.values(SETTINGS_SECTIONS).flat();
  const sure = await api.confirm(
    section ? "Put the settings in this section back to how they were when the app was new?" : "Put every setting back to how it was when the app was new? Your files, recent lists, the R you chose, and the assistant stay as they are.",
    section ? "Reset section" : "Reset all settings",
  );
  if (!sure) return;
  const patch = Object.fromEntries(keys.map((key) => [key, defaultSettings[key as keyof Settings]])) as Partial<Settings>;
  updateSettings(patch);
  notify(section ? "The section is back to its defaults." : "Every setting is back to its default.");
}

// Settings that change how the script editor behaves.
const EDITOR_KEYS = ["lineNumbers", "highlightLine", "wrapLines", "tabWidth", "closeBrackets", "rainbowBrackets", "copyResults", "formatOnType"] as const;

function editorPrefs(settings: Settings): editor.EditorPrefs {
  return {
    lineNumbers: settings.lineNumbers,
    highlightLine: settings.highlightLine,
    wrapLines: settings.wrapLines,
    tabWidth: settings.tabWidth === 4 ? 4 : 2,
    closeBrackets: settings.closeBrackets,
    rainbowBrackets: settings.rainbowBrackets,
    copyResults: settings.copyResults,
    formatOnType: settings.formatOnType,
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
  updateSettings({ outputLayout, layoutChosen: true });
  editor.refreshGutter();
  setTimeout(editor.requestMeasure, 50);
}

/** Live output is a session choice rather than a saved setting, so it is
 * always off when the app opens and nothing runs by surprise. */
export function toggleLive() {
  setState((state) => ({ live: !state.live }));
  syncMenu();
  notify(getState().live ? "Live output is on. The code you are editing runs again each time you stop typing." : "Live output is off.");
}

// Notices.

// Notices fade on their own. Errors stay longer because they need reading.
let noticeTimer: ReturnType<typeof setTimeout> | undefined;

/** Shows a short message at the bottom of the window. */
export function notify(text: string, tone: "info" | "error" = "info", action?: { label: string; run: () => void }) {
  setState({ notice: { text, tone, action } });
  clearTimeout(noticeTimer);
  // A notice with a button stays longer, so there is time to reach it.
  noticeTimer = setTimeout(() => setState({ notice: null }), tone === "error" || action ? 9000 : 4500);
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
export function togglePane(pane: "inspector" | "sidebar") {
  const shown = !getState().ui[pane];
  // Remembered, so the window opens next time as it was left.
  updateSettings(pane === "inspector" ? { showCanvas: shown } : { showSidebar: shown });
  setTimeout(editor.requestMeasure, 50);
}

/** Shows or hides the R prompt under the script, or the strip of earlier
 * results under the stage. */
export function togglePart(part: "showPrompt" | "showTimeline") {
  updateSettings({ [part]: !getState().settings[part] });
  setTimeout(editor.requestMeasure, 50);
}

/** Whether the window is laid out as it is on a first run. */
export function isDefaultLayout(settings = getState().settings) {
  return SETTINGS_SECTIONS.layout.every((key) => settings[key] === defaultSettings[key]);
}

/** Puts every part of the window back, at its first size. It asks no
 * question, since nothing is lost and the old layout is one drag away. */
export function resetLayout() {
  const patch = Object.fromEntries(SETTINGS_SECTIONS.layout.map((key) => [key, defaultSettings[key]])) as Partial<Settings>;
  updateSettings(patch);
  setState((state) => ({ ui: { ...state.ui, focus: false } }));
  setTimeout(editor.requestMeasure, 50);
  announce("The layout is back to how it started.");
}

/**
 * Shows the opening screen over the workspace, as a browser's home button
 * would. Nothing closes: R keeps running, every tab stays open, and
 * opening or starting anything from the opening screen returns to them.
 */
export function showStartScreen() {
  setState((state) => ({ ui: { ...state.ui, showStart: true } }));
}

/**
 * Focus mode: the script and the result on the stage, and nothing else.
 * The sidebar, the objects, the timeline, and the prompt step aside, and
 * come back exactly as they were. The canvas shows, since the result is
 * half of what there is to focus on.
 */
export function toggleFocus() {
  const focus = !getState().ui.focus;
  // Focus mode shows the canvas for the result; leaving it puts the canvas
  // back to what the layout says.
  setState((state) => ({ ui: { ...state.ui, focus, inspector: focus ? true : state.settings.showCanvas, panel: focus ? "canvas" : state.ui.panel } }));
  setTimeout(editor.requestMeasure, 50);
  announce(focus ? "Focus mode is on. Only the script and the result show." : "Focus mode is off.");
}

/** Returns from the opening screen to the workspace, exactly as it was. */
export function hideStartScreen() {
  setState((state) => (state.ui.showStart ? { ui: { ...state.ui, showStart: false } } : {}));
}

/** Shows the app's own help over whatever is open, as Home does. */
export function showHelpScreen() {
  setState((state) => ({ ui: { ...state.ui, showHelp: true, palette: false, dialog: null } }));
}

/** Returns from the help to where the user was. */
export function hideHelpScreen() {
  setState((state) => (state.ui.showHelp ? { ui: { ...state.ui, showHelp: false } } : {}));
}

/** Opens the New Project dialog on a template, such as a Shiny app. */
export function openNewProject(template: ProjectTemplate) {
  setState((state) => ({ ui: { ...state.ui, newProjectTemplate: template } }));
  openDialog("newProject");
}

/** Copies the example project into the Documents folder, keeping any
 * changes made to it before, and opens it. */
export async function openExamples() {
  try {
    const info = await api.openExamples();
    setState((state) => ({ ui: { ...state.ui, showHelp: false, showStart: false } }));
    await enterProject(info);
  } catch (error) {
    notify(`The examples could not be opened. ${String(error)}`, "error");
  }
}

/**
 * Points at a part of the app from Help: Help steps aside, the workspace
 * comes forward with the canvas showing, opening the examples first when
 * nothing is open, and the part is marked with rings. A part that only
 * exists later, such as the timeline before anything has run, is
 * explained instead.
 */
export async function showMe(target: GuideTarget) {
  hideHelpScreen();
  hideStartScreen();
  const { tabs, project } = getState();
  if (!tabs.length && !project) await openExamples();
  setState((state) => ({ ui: { ...state.ui, inspector: true, panel: "canvas", tour: null } }));
  setTimeout(() => {
    if (findTarget(target)) pointAt(target);
    else if (target === "timeline") notify("Earlier results appear under the stage once something has run. Run a line to see them.");
    else if (target === "sidebar") notify("The project sidebar appears when a project is open.");
    else notify(`${TARGETS[target].label} is not on screen right now.`);
  }, 350);
}

/** Starts the tour on the example project, so every step has something
 * real on screen to point at. */
export async function startTour() {
  await openExamples();
  setTour(0);
}

/** Moves the tour to a step, or ends it with null. */
export function setTour(step: number | null) {
  setState((state) => ({ ui: { ...state.ui, tour: step } }));
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

/**
 * Opens a file in a tab, or switches to it when it is already open. A
 * script inside a project runs in that project's R, wherever it was
 * opened from, and any other script runs in an R of its own, so no one
 * has to keep track of which session a file landed in.
 */
export async function openFile(path: string, activate = true) {
  if (!getState().tabs.some((tab) => tab.path === path)) {
    let text: string;
    try {
      text = await api.readText(path);
    } catch (error) {
      notify(String(error), "error");
      return;
    }
    const context = await api.sessionFor(path).catch(() => ({ key: `file:${path}`, project: null }));
    if (context.project) patchSession(context.key, { project: context.project });
    // A second open of the same file while the first was reading wins
    // nothing, so the tab is added once.
    if (getState().tabs.some((tab) => tab.path === path)) return activate ? activateTab(path) : undefined;
    editor.openDocument(path, text);
    setState((state) => ({ tabs: [...state.tabs, { path, name: baseName(path), dirty: false, untitled: false, session: context.key }] }));
    restoreKeptFor(path);
  }
  if (activate) activateTab(path);
  else ensureR(sessionOfFile(path));
  rememberTabs();
}

// Projects.

/** The session key of a project, by its folder. */
function projectKey(root: string) {
  return `project:${root}`;
}

/**
 * Opens a project beside whatever else is open. Each project has its own
 * R, which starts in the project folder, so relative paths mean the
 * project's own files and nothing carries over from other work. Other
 * projects and scripts stay open in their own sessions.
 */
async function enterProject(info: ProjectInfo) {
  const key = projectKey(info.root);
  patchSession(key, { project: info });
  refreshRecents();
  // The project's main script opens, so there is something to work on.
  const open = getState().tabs.find((tab) => tab.session === key);
  const main = info.scripts.find((script) => !script.includes("/")) ?? info.scripts[0];
  if (open) activateTab(open.path);
  else if (main) await openFile(joinPath(info.root, main));
  else {
    showSession(key);
    ensureR(key);
    hideStartScreen();
  }
  setState((state) => ({ ui: { ...state.ui, sidebar: state.settings.showSidebar } }));
  setTimeout(editor.requestMeasure, 50);
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

/** Closes the project on show, its scripts, and its R. Other projects and
 * scripts are untouched. */
export async function closeProject() {
  const { project, activeSession } = getState();
  if (!project) return;
  for (const tab of getState().tabs) if (tab.session === activeSession) await closeTab(tab.path);
  // A tab with unsaved changes the user chose to keep holds the project
  // open, so nothing is lost.
  if (getState().tabs.some((tab) => tab.session === activeSession)) return;
  await api.closeProject(project.root).catch(() => {});
  forgetSession(activeSession);
}

/** Lists the project on show again, after a save may have added a script. */
async function refreshProject(session = activeKey()) {
  const project = sessionOf(session).project;
  if (!project) return;
  const info = await api.refreshProject(project.root).catch(() => null);
  if (info) patchSession(session, { project: info });
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
  if (!getState().settings.showCanvas) updateSettings({ showCanvas: true });
  // The assistant's sheet has its own box in the prompt's place, so the
  // prompt comes back to take the code.
  setState((state) => ({ consoleDraft: { id: draftId, text }, ui: { ...state.ui, inspector: true, panel: state.ui.panel === "assistant" ? "canvas" : state.ui.panel } }));
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
  return api.chooseDataFile(activeKey()).catch((error) => {
    notify(String(error), "error");
    return null;
  });
}

/** The first rows R reads with the given code, for the preview. */
export function previewData(code: string): Promise<DataPreview> {
  if (getState().r.status !== "ready") return Promise.resolve({ error: "R is busy. The preview appears when it finishes." });
  return api.preview(activeKey(), code).catch((error): DataPreview => ({ error: String(error) }));
}

/** True when a package is installed. */
export async function hasPackage(name: string) {
  const missing = await api.missingPackages(activeKey(), [name]).catch(() => [name]);
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

/** Opens the past commands over the canvas, with the search ready to type in. */
export function showConsoleHistory() {
  showPanel("history");
  setTimeout(() => document.querySelector<HTMLElement>("#history-search")?.focus(), 30);
}

/** Puts an output on the stage by its key, or null to follow the latest. */
export function showOnStage(key: string | null) {
  setState((state) => (state.ui.stage === key ? {} : { ui: { ...state.ui, stage: key } }));
}

/** Keeps an output on the stage above the current one, or lets it go. */
export function pinOnStage(key: string | null) {
  setState((state) => ({ ui: { ...state.ui, stagePin: key } }));
}

/** Shows a plot full size over the window, or closes it with null. */
export function viewPlot(index: number | null) {
  if (index !== null) showPlot(index);
  setState((state) => ({ ui: { ...state.ui, plotView: index } }));
}

/** Shows a sheet over the canvas, or the canvas itself, opening the canvas
 * when it is hidden. */
export function showPanel(panel: Panel) {
  // Opening a sheet shows the canvas it sits on, and the layout keeps it.
  if (!getState().settings.showCanvas) updateSettings({ showCanvas: true });
  setState((state) => ({ ui: { ...state.ui, inspector: true, panel } }));
  if (panel === "packages") refreshPackages();
}

// Help, from R's own documentation, shown in the Help pane.

/** Opens a help page by topic, as ?topic does, or by package and file, as
 * links between pages name them. */
export async function openHelp(topic: string, packageName = "", file = "", keepForward = false) {
  const name = topic.trim().replace(/^`|`$/g, "");
  if (!name && !file) return;
  showPanel("help");
  if (!requireR()) return;
  setState((state) => ({ help: { ...state.help, loading: true, missing: "" } }));
  try {
    const page = await api.help(activeKey(), name, packageName, file);
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
    const field =
      tab === "help" ? document.querySelector<HTMLElement>("#sheet-help input")
      : tab === "assistant" ? document.querySelector<HTMLElement>("#assistant-input")
      : tab === "feed" ? document.querySelector<HTMLElement>("#canvas-feed")
      : tab === "objects" ? document.querySelector<HTMLElement>("#object-cards button")
      : null;
    (field ?? document.querySelector<HTMLElement>(`[data-sheet="${tab}"]`))?.focus();
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
  const session = activeKey();
  if (getState().r.status !== "ready") return;
  const packages = await api.packages(session).catch(() => null);
  if (packages) patchSession(session, { packages });
}

/** Attaches or detaches a package, through the console so the code shows. */
export function setPackageAttached(name: string, attach: boolean) {
  // The name goes into R code, so only a valid package name is accepted.
  if (!PACKAGE_NAME.test(name)) return;
  // The box changes at once. The list is read again from R after the code
  // runs, which corrects it if attaching failed.
  patchSession(activeKey(), (session) => ({ packages: session.packages?.map((item) => (item.name === name ? { ...item, loaded: attach } : item)) ?? null }));
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
  const sure = await api.confirm("Remove every object from R? Your scripts and files stay as they are, and running the scripts again brings the objects back.", "Remove objects");
  if (sure) runInConsole("rm(list = ls())");
}

/** Runs code as if typed in the console, with the record open to show it. */
export function runInConsole(code: string, task?: ConsoleEntry["task"]): string | null {
  const session = activeKey();
  if (!requireR(session)) return null;
  const batch = crypto.randomUUID();
  echo(session, code, batch, task);
  enqueue([{ code, batch, console: true, session }]);
  return batch;
}

/** Whether a run is still waiting or running in a session. */
export function isBatchPending(session: string, batch: string | undefined) {
  if (!batch) return false;
  const line = lineOf(session);
  return line.current?.job.batch === batch || line.queue.some((job) => job.batch === batch);
}

// Data viewer.

/** Opens a data frame in the data viewer, in a tab of its own. */
export function viewData(name: string) {
  const path = `data:${name}`;
  if (!getState().tabs.some((tab) => tab.path === path)) {
    setState((state) => ({ tabs: [...state.tabs, { path, name, dirty: false, untitled: false, kind: "data", session: activeKey() }] }));
  }
  activateTab(path);
}

/** The data viewer's queries, passed through for its component. */
export function dataMeta(name: string) {
  return api.dataMeta(sessionOfFile(`data:${name}`), name);
}

export function dataRows(name: string, offset: number, count: number, sortBy: string, descending: boolean) {
  return api.dataRows(sessionOfFile(`data:${name}`), name, offset, count, sortBy, descending);
}

let untitledCount = 0;

/**
 * Starts an untitled script. It gets a real name the first time it is
 * saved. It runs in the session on show, so a scratch script started
 * while working on a project sees that project's objects. With nothing
 * open it runs in the R for untitled work.
 */
export function newFile() {
  newDocument();
}

/** Starts an untitled document holding `text`, named `name` until saved. */
export function newDocument(text = "", name = "") {
  untitledCount += 1;
  // The path carries a document's extension even before it is saved, so
  // the editor highlights it as a document and Run knows its chunks.
  const extension = /\.(qmd|Rmd)$/.exec(name)?.[0] ?? "";
  const path = `untitled:${untitledCount}${extension}`;
  editor.openDocument(path, text);
  const session = getState().tabs.length ? activeKey() : SCRATCH;
  setState((state) => ({ tabs: [...state.tabs, { path, name: name || `Untitled ${untitledCount}`, dirty: false, untitled: true, session }] }));
  activateTab(path);
}

/** Shows a tab in the editor and refreshes what depends on the visible
 * file: the window title, the sections, the package check, and the list of
 * files to reopen next time. */
export function activateTab(path: string) {
  setState({ active: path, cursorLine: 0 });
  // Showing a tab always returns from the opening screen, whether it was
  // reached from Home or simply never left.
  hideStartScreen();
  // The panes follow the tab: its session's console, objects, plots, and
  // project come forward, and its R starts if it has not yet.
  const session = sessionOfFile(path);
  showSession(session);
  ensureR(session);
  if (path.startsWith("data:")) {
    setState({ outline: [], missing: [] });
    api.setTitle(`${path.slice(5)}, R: What Is It Good For?`).catch(() => {});
    return;
  }
  editor.showDocument(path);
  lastScript = path;
  const tab = getState().tabs.find((item) => item.path === path);
  api.setTitle(tab ? `${tab.name}, R: What Is It Good For?` : "R: What Is It Good For?").catch(() => {});
  updateOutline(path);
  updateHints(path);
  checkPackages(path);
  checkShinyFile(path);
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
    // The neighbor in the same session takes over first, so closing a
    // script does not jump to another project's panes when it need not.
    const same = tabs.filter((item) => item.session === tab.session);
    const next = (same.length ? same[Math.min(position, same.length - 1)] : tabs[Math.min(position, tabs.length - 1)])?.path ?? null;
    setState({ active: next, missing: [], outline: [] });
    editor.showDocument(next);
    if (next) activateTab(next);
    else {
      api.setTitle("R: What Is It Good For?").catch(() => {});
      showSession(SCRATCH);
    }
  }
  // A script's own R ends with its last tab. A project's R stays until the
  // project is closed, and the R for untitled work stays for the next one.
  if (kindOf(tab.session) === "file" && !tabs.some((item) => item.session === tab.session)) forgetSession(tab.session);
  rememberTabs();
  saveDrafts();
}

/** Ends a session's R and forgets its record. */
function forgetSession(session: string) {
  const line = sessionLines.get(session);
  if (line) for (const job of line.queue) if (job.blockId) updateBlock(job.blockId, { status: "skipped" });
  sessionLines.delete(session);
  api.shutdownSession(session).catch(() => {});
  if (getState().activeSession === session) showSession(SCRATCH);
  dropSession(session);
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
export async function saveFile(path: string | null = getState().active, saveAs = false, automatic = false): Promise<string | null> {
  if (!path || path.startsWith("data:")) return null;
  let target = path;
  if (path.startsWith("untitled:") || saveAs) {
    const tab = getState().tabs.find((item) => item.path === path);
    const suggested = tab ? (tab.untitled && !/\.\w+$/.test(tab.name) ? `${tab.name}.R` : tab.name) : "script.R";
    const chosen = await api.chooseSavePath(suggested).catch((error) => {
      notify(String(error), "error");
      return null;
    });
    if (!chosen) return null;
    // The tab may have closed while the Save dialog was open. Its text is
    // gone then, and writing would leave an empty file.
    if (!getState().tabs.some((item) => item.path === path)) return null;
    // Two tabs on one file would overwrite each other's saves.
    if (chosen !== path && getState().tabs.some((item) => item.path === chosen)) {
      notify(`${baseName(chosen)} is already open in another tab. Close it first, or save under another name.`, "error");
      return null;
    }
    target = chosen;
  }
  try {
    await api.writeText(target, editor.getText(path));
  } catch (error) {
    notify(`Could not save. ${String(error)}`, "error");
    return null;
  }
  if (target !== path) {
    editor.renameDocument(path, target);
    setState((state) => ({
      tabs: state.tabs.map((tab): Tab => (tab.path === path ? { ...tab, path: target, name: baseName(target), dirty: false, untitled: false } : tab)),
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
  // Saving by itself is quiet. A save the user asked for is confirmed,
  // and renders an open report again when that is on.
  if (!automatic) {
    announce(`Saved ${baseName(target)}`);
    onSaved(target);
  }
  return target;
}

/**
 * After a save the user asked for: a report rendered before renders
 * again, when that is on, so its preview keeps up with the code. Word and
 * PDF renders are slow and open in other apps, so only HTML follows.
 */
function onSaved(path: string) {
  const { report, settings } = getState();
  if (!settings.renderOnSave || !report || report.file !== path || report.status === "running") return;
  if (report.target === "word" || report.target === "pdf" || report.outputs.some((output) => /\.(docx|pdf)$/i.test(output))) return;
  renderReport(report.target, path, true);
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
// Each file waits for its own pause, so typing in a second file does not
// cancel the save of the first.
const autosaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
let changeTimer: ReturnType<typeof setTimeout> | undefined;
let liveTimer: ReturnType<typeof setTimeout> | undefined;

/** Called on every edit. Cheap work happens now, the rest after a pause. */
function onDocumentChanged(path: string) {
  setTabDirty(path, editor.isDirty(path));
  saveDrafts();
  // With saving automatically on, a file with a name saves a moment after
  // typing stops. A new file still asks for its name with Save.
  if (getState().settings.autosave && !path.startsWith("untitled:")) {
    clearTimeout(autosaveTimers.get(path));
    autosaveTimers.set(
      path,
      setTimeout(() => {
        autosaveTimers.delete(path);
        if (editor.isDirty(path)) saveFile(path, false, true);
      }, 1500),
    );
  }
  clearTimeout(changeTimer);
  changeTimer = setTimeout(() => {
    updateOutline(path);
    updateHints(path);
    checkPackages(path);
    checkShinyFile(path);
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

/** True when a session's R can take code now or after the current run. */
function isRunning(session = activeKey()) {
  const status = sessionOf(session).r.status;
  return status === "ready" || status === "busy";
}

/** The keys of every session whose R is running. */
function runningKeys() {
  return Object.keys(getState().sessions).filter((session) => isRunning(session));
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

/** Starts a session's R the first time something in it is shown. */
function ensureR(session: string) {
  if (sessionOf(session).r.status === "none") startR(session);
}

/**
 * Starts a session's R with the chosen version: in the project folder for
 * a project, in the script's folder for a script on its own, and in the
 * home folder for untitled work. Work queued for an earlier R in this
 * session is dropped, since that R no longer exists. Other sessions are
 * left alone.
 */
export async function startR(session: string = activeKey()) {
  const { settings, installs } = getState();
  if (!installs.length) {
    patchSession(session, (current) => ({ r: { ...current.r, status: "missing" } }));
    return;
  }
  if (!settings.rHome) {
    openDialog("chooseR");
    return;
  }
  const chosen = installs.find((install) => install.home === settings.rHome);
  if (chosen && !isSupportedR(chosen.version)) {
    const message = `R ${chosen.version} is older than ${OLDEST_R}, the oldest R this app runs. Install a newer R from CRAN, then choose it.`;
    patchSession(session, (current) => ({ r: { ...current.r, status: "failed", message } }));
    return;
  }
  sessionLines.set(session, emptyLine());
  forgetUndo(session);
  patchSession(session, (current) => ({ r: { ...current.r, status: "starting", message: "", log: "", runStarted: 0 }, pendingInput: null }));
  try {
    const info = await api.startSession(settings.rHome, session);
    patchSession(session, (current) => ({ r: { ...current.r, status: "ready", version: info.version, generation: info.generation, workingDir: info.workingDir } }));
    appendConsole(session, { kind: "info", text: `R ${info.version} started in ${shortPath(info.workingDir)}${describeSession(session)}` });
    await prepareSession(session);
    if (getState().active && sessionOfFile(getState().active) === session) checkPackages(getState().active!);
    // Anything run while R was starting goes now.
    pump(session);
  } catch (error) {
    patchSession(session, (current) => ({ r: { ...current.r, status: "failed", message: String(error) } }));
  }
}

/** Says whose R a session is, for the line that opens its console. */
function describeSession(session: string) {
  const project = sessionOf(session).project;
  if (project) return `, for the ${project.name} project`;
  if (kindOf(session) === "file") return `, for ${baseName(session.slice(5))} on its own`;
  return "";
}

/**
 * Shortens a path for display. The home folder becomes ~, as Finder and
 * Terminal show it, and a folder in iCloud is named as Finder names it:
 * iCloud Drive for the drive itself, and iCloud Drive/Pages for the folder
 * an app such as Pages keeps there, rather than the hidden folder inside
 * the Library that holds them.
 */
export function shortPath(path: string) {
  const home = path.replace(/^\/Users\/[^/]+|^\/home\/[^/]+|^[A-Z]:\\Users\\[^\\]+/, "~");
  const cloud = /^~\/Library\/Mobile Documents\/([^/]+)(\/.*)?$/.exec(home);
  if (!cloud) return home;
  const [, container, rest = ""] = cloud;
  if (container === "com~apple~CloudDocs") return `iCloud Drive${rest}`;
  // Another app's container, such as iCloud~com~apple~Pages, shows its
  // Documents folder in Finder under the app's name.
  const documents = /^\/Documents(\/.*)?$/.exec(rest);
  return documents ? `iCloud Drive/${container.split("~").pop()}${documents[1] ?? ""}` : home;
}

/** Starts a fresh R for the session on show. Objects are gone afterward,
 * as in any R restart. Other sessions keep theirs. */
export async function restartR() {
  const session = activeKey();
  appendConsole(session, { kind: "info", text: "Restarting R" });
  failQueued(session, "skipped");
  await startR(session);
}

/** The last line of the file that ran without an error, counting from
 * one, or zero when none has. After R stops, running again up to here
 * brings the objects back. */
export function lastRanLine(path: string | null): number {
  if (!path) return 0;
  const lines = editor.blockLines(path);
  let last = -1;
  for (const block of Object.values(getState().blocks)) {
    if (block.file !== path || block.status !== "ok" || block.undone) continue;
    last = Math.max(last, lines.get(block.id) ?? block.toLine);
  }
  return last + 1;
}

/** Starts a fresh R and runs the file in front up to a line, as after R
 * stopped, to bring back the objects the work had made. */
export async function restartAndRunTo(line: number) {
  const { active } = getState();
  await restartR();
  if (active && line > 0) runSpan(active, 0, line - 1);
}

/** Stops the running statement in the session on show and cancels
 * everything queued behind it. */
export async function stop() {
  const session = activeKey();
  if (getState().r.status !== "busy" && !lineOf(session).queue.length) return;
  failQueued(session, "skipped");
  await api.interrupt(session).catch(() => {});
}

/** Switches R version. Every R that has started restarts with it, so no
 * two sessions quietly run different versions. */
export async function chooseR(home: string) {
  updateSettings({ rHome: home });
  openDialog(null);
  const started = Object.keys(getState().sessions).filter((session) => sessionOf(session).r.status !== "none");
  await Promise.all((started.length ? started : [activeKey()]).map((session) => startR(session)));
}

/** Marks everything waiting in a session's queue as not run and empties it. */
function failQueued(session: string, status: "skipped" | "stopped") {
  const line = lineOf(session);
  for (const job of line.queue) if (job.blockId) updateBlock(job.blockId, { status });
  line.queue = [];
  editor.refreshGutter();
}

/** Adds work to its session's queue and starts it when that R is free. */
function enqueue(jobs: Job[]) {
  if (!jobs.length) return;
  const session = jobs[0].session;
  const line = lineOf(session);
  for (const job of jobs) {
    if (job.blockId) updateBlock(job.blockId, { batch: job.batch });
    line.totals.set(job.batch, (line.totals.get(job.batch) ?? 0) + 1);
  }
  line.queue.push(...jobs);
  pump(session);
}

/**
 * Moves R to the folder of the script about to run, when it is somewhere
 * else, so a path such as "data.csv" means the file beside the script. The
 * console says so each time, so the change is never silent. Only the R for
 * untitled work moves: a project's R stays in the project folder, the
 * convention the here package and RStudio projects rely on, and a
 * script's own R already starts beside it.
 */
async function followScript(session: string, file: string | undefined) {
  if (!file || file.startsWith("untitled:") || kindOf(session) !== "scratch") return;
  const folder = folderOf(file);
  if (folder === sessionOf(session).r.workingDir) return;
  const now = await api.setWorkingDir(session, file).catch(() => null);
  if (!now) return;
  patchSession(session, (current) => ({ r: { ...current.r, workingDir: now } }));
  appendConsole(session, { kind: "info", text: `Working folder is now ${shortPath(now)}, where ${baseName(file)} is` });
}

/** Puts the running bar beside the statement R is working on, wherever
 * edits since it was queued have moved it. */
function markRunning(blockId: string) {
  const block = getState().blocks[blockId];
  if (!block) return;
  const to = editor.blockLines(block.file).get(blockId) ?? block.toLine;
  editor.markLines(block.file, "running", [to - (block.toLine - block.fromLine), to]);
}

/** Sends a session's next queued statement to its R when nothing is
 * running there. */
async function pump(session: string) {
  const line = lineOf(session);
  if (line.current || !line.queue.length || !isRunning(session)) return;
  const job = line.queue.shift()!;
  // The id is chosen here and registered before the code is sent. Real R
  // can finish a short statement before the send call even returns, so the
  // mapping must already exist when its output arrives.
  const run = crypto.randomUUID();
  line.current = { job, run };
  await followScript(session, job.file);
  await stepR(session, job.batch);
  // A restart or a closed session while waiting replaces or removes this
  // line, and the job belongs to an R that is gone.
  if (sessionLines.get(session) !== line) return;
  // What R is running, for the progress shown once a run takes a while.
  const total = line.totals.get(job.batch) ?? 1;
  const left = line.queue.filter((item) => item.batch === job.batch).length;
  const label = job.blockId ? runLabelOf(job.blockId) : "the command typed at the prompt";
  patchSession(session, (current) => ({ r: { ...current.r, runStarted: Date.now(), runLabel: label, runIndex: total - left, runTotal: total } }));
  if (job.blockId) {
    line.runToBlock.set(run, job.blockId);
    updateBlock(job.blockId, { status: "running", started: Date.now() });
    markRunning(job.blockId);
    editor.refreshGutter();

  }
  try {
    await api.execute(session, job.code, run);
  } catch (error) {
    line.runToBlock.delete(run);
    if (job.blockId) updateBlock(job.blockId, { status: "error", items: [{ type: "error", message: String(error), traceback: [] }] });
    line.current = null;
    patchSession(session, (current) => ({ r: { ...current.r, runStarted: 0 } }));
    pump(session);
  }
}

/** Adds a line to a session's console record. */
export function appendConsole(session: string, entry: Omit<ConsoleEntry, "id">) {
  consoleId += 1;
  patchSession(session, (state) => {
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

/** Empties the console record on show. R itself is unaffected. */
export function clearConsole() {
  const session = activeKey();
  const kept = sessionOf(session).console;
  if (!kept.length) return;
  patchSession(session, { console: [] });
  // Clearing loses nothing for good: the notice can put every result back.
  notify("Cleared the results.", "info", { label: "Undo", run: () => patchSession(session, (state) => ({ console: [...kept, ...state.console] })) });
}

/** Appends output to a card, joining text that streams in pieces. */
function addItem(blockId: string | undefined, item: OutputItem) {
  if (!blockId) return;
  // A result's first output takes the stage, so what was just run is what
  // is on show, in its own session.
  const before = getState().blocks[blockId];
  if (before && before.items.length === 0 && sessionOfFile(before.file) === activeKey()) showOnStage(`b:${blockId}`);
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

// ark's words for code that does not parse.
const SYNTAX = /Syntax error|unexpected|parse incomplete input/;

/** R's parser message for code that does not parse, or empty. A failure to
 * ask is treated as no answer, since the plain explanation still stands. */
function parseProblem(session: string, code: string): Promise<string> {
  return api.parseProblem(session, code).catch(() => "");
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
function showProblem(session: string, blockId: string, message: string, traceback: string[], parsed = "") {
  const block = getState().blocks[blockId];
  if (!block) return;
  const explained = explainError(message, sessionOf(session).objects, block.code, traceback, parsed);
  problemTitles.set(blockId, explained.title);
  const where = explained.where;
  if (!where) return;
  const text = block.code.split("\n")[where.line]?.slice(where.from, where.to) ?? "";
  const now = editor.blockLines(block.file).get(blockId) ?? block.toLine;
  const first = now - (block.toLine - block.fromLine);
  editor.markProblem(block.file, first + where.line, text, where.from, explained.title);
}

/**
 * Handles one message from one session's R. Messages from an earlier R in
 * that session are ignored by generation, so a restart never mixes old
 * output into new cards. A session in the background keeps its own record
 * up to date, ready for when its tab comes forward.
 */
function handleEvent(session: string, generation: number, event: REvent) {
  const record = getState().sessions[session];
  if (!record || generation !== record.r.generation) return;
  const line = lineOf(session);
  const current = line.current;
  const shown = session === activeKey();
  const blockId = "run" in event ? line.runToBlock.get(event.run) : undefined;
  switch (event.kind) {
    case "busy":
      patchSession(session, (state) => ({ r: { ...state.r, status: event.busy ? "busy" : state.r.status === "busy" ? "ready" : state.r.status } }));
      break;
    // Results of editor runs stay beside their code. The console records
    // only what was typed there, so nothing appears twice.
    case "stream":
      if (blockId) addItem(blockId, { type: "stream", name: event.name, text: event.text });
      if (!blockId) appendConsole(session, { kind: "stream", text: event.text, name: event.name });
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
        const plots = sessionOf(session).plots;
        const existing = event.update && event.displayId ? plots.findIndex((plot) => plot.displayId === event.displayId) : -1;
        let index: number;
        if (existing >= 0) {
          index = existing;
          patchSession(session, (state) => ({
            plots: state.plots.map((plot, at) => (at === existing ? { ...plot, png, code: plot.code.includes(code) ? plot.code : `${plot.code}\n${code}`.trim() } : plot)),
            plotIndex: existing,
          }));
        } else {
          index = plots.length;
          patchSession(session, (state) => ({ plots: [...state.plots, { png, label, code, displayId: event.displayId ?? undefined }], plotIndex: state.plots.length }));
        }
        // A new plot brings the canvas back from under a sheet, so it is
        // seen. A sheet the user is reading, such as a help page, a
        // report, or a running app, stays when the plot came from the
        // script, since its result there says so.
        const reading = ["help", "report", "app", "assistant"].includes(getState().ui.panel);
        if (shown && (!reading || !blockId)) setState((state) => ({ ui: { ...state.ui, panel: "canvas" } }));
        if (blockId) addItem(blockId, { type: "plot", png, plot: index });
        if (!blockId && existing < 0) appendConsole(session, { kind: "plot", text: `Plot ${index + 1}`, plot: index });
      } else if (event.text !== null) {
        if (blockId) addItem(blockId, { type: "value", text: event.text });
        if (!blockId) appendConsole(session, { kind: "value", text: event.text });
      }
      break;
    case "error":
      if (blockId) {
        addItem(blockId, { type: "error", message: event.message, traceback: event.traceback });
        const block = getState().blocks[blockId];
        // A syntax error from the console has no position, so R's parser is
        // asked where it stopped before the spot is marked.
        if (block && SYNTAX.test(event.message)) {
          parseProblem(session, block.code).then((parsed) => {
            updateBlock(blockId, (latest) => ({ items: latest.items.map((item) => (item.type === "error" ? { ...item, parsed } : item)) }));
            showProblem(session, blockId, event.message, event.traceback, parsed);
          });
        } else {
          showProblem(session, blockId, event.message, event.traceback);
        }
      } else {
        // Console errors have no card, so the plain version is written into
        // the record with the failing spot marked under the code typed.
        const code = current && current.run === event.run ? current.job.code : "";
        const write = (parsed = "") => {
          const explained = explainError(event.message, sessionOf(session).objects, code, event.traceback, parsed);
          lastConsoleProblem = explained;
          appendConsole(session, { kind: "error", text: describeProblem(explained, code) });
        };
        if (code && SYNTAX.test(event.message)) parseProblem(session, code).then(write);
        else write();
      }
      break;
    case "input_request":
      patchSession(session, { pendingInput: { prompt: event.prompt, password: event.password } });
      if (!shown) {
        notify(`R is waiting for an answer in the console of ${sessionName(session)}. Switch to one of its tabs to answer.`);
        break;
      }
      notify("R is waiting for an answer in the console.");
      document.querySelector<HTMLElement>("#console-input")?.focus();
      break;
    case "done":
      finishRun(session, event.run, event.ok, event.stopped);
      break;
    case "exited":
      onExited(session, event.code, event.log);
      break;
  }
}

/** A session's short name: its project, its script, or Untitled work. */
export function sessionLabel(session: string) {
  const project = sessionOf(session).project;
  if (project) return project.name;
  if (kindOf(session) === "file") return baseName(session.slice(5));
  return "Untitled work";
}

/** Brings a session forward by showing its most recent tab. */
export function showSessionTab(session: string) {
  const tab = getState().tabs.find((item) => item.session === session);
  if (tab) activateTab(tab.path);
}

/** A session's name in words: its project, its script, or untitled work. */
export function sessionName(session: string) {
  const project = sessionOf(session).project;
  if (project) return `the ${project.name} project`;
  if (kindOf(session) === "file") return baseName(session.slice(5));
  return "untitled work";
}

/**
 * Wraps up a run: final status and duration on its card, an announcement,
 * the queue moved along, and the objects list refreshed.
 */
function finishRun(session: string, run: string, ok: boolean, stopped: boolean) {
  const line = lineOf(session);
  const blockId = line.runToBlock.get(run);
  line.runToBlock.delete(run);
  const job = line.current?.run === run ? line.current.job : null;
  if (blockId) {
    const block = getState().blocks[blockId];
    if (block) editor.markLines(block.file, "running", null);
    const duration = Date.now() - (block?.started ?? Date.now());
    const status = stopped ? "stopped" : ok ? "ok" : "error";
    updateBlock(blockId, { status, duration, paused: Boolean(block?.live && duration > LIVE_LIMIT_MS) });
    // A slow statement that printed nothing still gets a result, saying how
    // long it took, and it takes the stage like any other.
    const finished = getState().blocks[blockId];
    if (finished && finished.items.length === 0 && !isQuiet(finished) && sessionOfFile(finished.file) === activeKey()) showOnStage(`b:${blockId}`);
    editor.refreshGutter();
    if (block) {
      const lines = editor.blockLines(block.file);
      const at = (lines.get(blockId) ?? block.toLine) + 1;
      announce(stopped ? `Stopped at line ${at}` : ok ? `Line ${at} finished` : `Line ${at} did not run. ${problemTitles.get(blockId) ?? ""}`.trim());
    }
    problemTitles.delete(blockId);
  }
  patchSession(session, (state) => ({ pendingInput: null, r: { ...state.r, lastDuration: blockId ? getState().blocks[blockId]?.duration ?? 0 : state.r.lastDuration } }));
  // The last result of a run is brought into view, so output never lands
  // somewhere the user has to go looking for it.
  if (blockId && job && !line.queue.some((item) => item.batch === job.batch)) {
    setTimeout(() => editor.revealBlock(blockId), 60);
  }
  if (job) {
    line.current = null;
    // Run File stops at the first error, like sourcing a script.
    if (!ok && !stopped) {
      for (const queued of line.queue.filter((item) => item.batch === job.batch)) if (queued.blockId) updateBlock(queued.blockId, { status: "skipped" });
      line.queue = line.queue.filter((item) => item.batch !== job.batch);
    }
    if (job.console && !ok && !stopped) suggestFromConsoleError();
    // A run's count is needed only while its statements are waiting.
    if (!line.queue.some((item) => item.batch === job.batch)) line.totals.delete(job.batch);
  }
  // The statement just finished was timed by R. Its time is summarized
  // before the next statement starts, or now, when nothing else waits.
  const started = sessionOf(session).r.runStarted;
  line.timed = { blockId, duration: blockId ? (getState().blocks[blockId]?.duration ?? 0) : started ? Date.now() - started : 0 };
  if (!line.queue.length) {
    patchSession(session, (state) => ({ r: { ...state.r, runStarted: 0 } }));
    settleTiming(session);
  }
  if (blockId && ok && !stopped && getState().blocks[blockId]?.before) waitingToCompare.add(blockId);
  refreshObjects(session);
  if (blockId && ok && !stopped) readStats(session, blockId);
  const finishedBlock = blockId ? getState().blocks[blockId] : undefined;
  if (finishedBlock && !stopped) {
    checkExercise(session, finishedBlock);
    // A checked exercise prints nothing when it assigns, so its verdict is
    // what there is to see, on the stage.
    if (sessionOfFile(finishedBlock.file) === activeKey()) setTimeout(() => getState().blocks[finishedBlock.id]?.exercise && showOnStage(`b:${finishedBlock.id}`), 400);
  }
  recheckAfterInstall();
  pump(session);
}

// Results that finished a rerun and wait for the objects list, which comes
// a moment later, to say what changed since the run before.
const waitingToCompare = new Set<string>();

/** Compares each finished rerun in a session with the result it replaced,
 * now that the objects list is up to date. */
function settleComparisons(session: string) {
  const objects = Object.fromEntries(sessionOf(session).objects.map((item) => [item.name, item.summary]));
  for (const blockId of [...waitingToCompare]) {
    const block = getState().blocks[blockId];
    if (!block) {
      waitingToCompare.delete(blockId);
      continue;
    }
    if (sessionOfFile(block.file) !== session || !block.before) continue;
    waitingToCompare.delete(blockId);
    updateBlock(blockId, { compared: compareResults(block.before.items, block.items, block.before.objects, objects) });
  }
}

// Statements that run a test or a model R can write up, as a quick first
// look before asking R, which reads the code properly.
const STATS_CALL = /\b(t\.test|wilcox\.test|chisq\.test|cor\.test|aov|lm)\s*\(/;

/** Asks R for the write-up of a test or model the statement ran, and puts
 * it on the statement's result. Live runs are left alone, since they rerun
 * on every pause in typing. */
function readStats(session: string, blockId: string) {
  const block = getState().blocks[blockId];
  if (!block || block.live || !STATS_CALL.test(block.code)) return;
  api
    .stats(session, block.code)
    .then((report) => {
      const current = getState().blocks[blockId];
      if (!report.found || !current) return;
      updateBlock(blockId, { stats: report });
      // A fitted model prints nothing, so its write-up is what there is to
      // see, and it takes the stage as a printed result would.
      editor.refreshGutter();
      if (sessionOfFile(current.file) === activeKey()) showOnStage(`b:${blockId}`);
    })
    .catch(() => {});
}

// A statement that takes this long gets a summary of where its time went.
// Shorter ones are quick enough that nobody wonders.
const PROFILE_MS = 2000;

/**
 * Tells R a new statement is about to run. The statement before stops
 * being timed, and gets its summary when it was slow. At the start of a
 * new run, R keeps the objects as they are, so Undo can put them back.
 */
async function stepR(session: string, batch: string) {
  const line = lineOf(session);
  const fresh = batch !== line.lastBatch;
  line.lastBatch = batch;
  const keep = getState().settings.undoRuns;
  const timed = takeTimed(line);
  const result = await api.step(session, timed.summarize, fresh, keep, true).catch(() => null);
  attachProfile(timed.blockId, result?.profile ?? null);
  if (fresh) {
    if (keep && result) setState((state) => ({ undo: { ...state.undo, [session]: batch } }));
    else forgetUndo(session);
  }
}

/** Stops timing once a session has nothing more to run. */
async function settleTiming(session: string) {
  const timed = takeTimed(lineOf(session));
  // Timing stops either way. Only a slow statement asks for its summary.
  const result = await api.step(session, timed.summarize, false, false, false).catch(() => null);
  attachProfile(timed.blockId, result?.profile ?? null);
}

/** The statement waiting for its summary, taken off the line. */
function takeTimed(line: Line) {
  const timed = line.timed;
  line.timed = null;
  return { blockId: timed?.blockId, summarize: Boolean(timed?.blockId && timed.duration >= PROFILE_MS) };
}

function attachProfile(blockId: string | undefined, profile: RunProfile | null) {
  if (blockId && profile) updateBlock(blockId, { profile });
}

/** The line a script result came from, in words, for progress. */
function runLabelOf(blockId: string) {
  const block = getState().blocks[blockId];
  if (!block) return "the script";
  const to = editor.blockLines(block.file).get(blockId) ?? block.toLine;
  const span = block.toLine - block.fromLine;
  return span ? `lines ${to - span + 1} to ${to + 1}` : `line ${to + 1}`;
}

/** Forgets the run Undo could put back, as when R restarts. */
function forgetUndo(session: string) {
  if (getState().undo[session]) {
    setState((state) => {
      const undo = { ...state.undo };
      delete undo[session];
      return { undo };
    });
  }
}

/** A list of names in words: "x", "x and y", or "x, y, and 3 more". */
function nameList(names: string[]) {
  if (names.length <= 2) return names.join(" and ");
  if (names.length <= 4) return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
  return `${names.slice(0, 3).join(", ")}, and ${names.length - 3} more`;
}

/**
 * Puts the objects in the session on show back as they were before its
 * last run. One press of Run is one run, so this undoes a whole Run file
 * at once. Files the run wrote and packages it loaded stay as they are,
 * and the notice says exactly what changed.
 */
export async function undoLastRun() {
  const session = activeKey();
  const batch = getState().undo[session];
  if (!batch) {
    notify(getState().settings.undoRuns ? "There is no run to undo yet. Undo puts back the objects the last run changed." : "Undo for runs is off. Turn it on in Settings, under R and packages.");
    return;
  }
  const line = lineOf(session);
  if (line.current || line.queue.length || sessionOf(session).r.status === "busy") {
    notify("R is still running. Stop it first, then undo.");
    return;
  }
  const result = await api.undo(session).catch(() => null);
  forgetUndo(session);
  if (!result?.ok) {
    notify("That run can no longer be undone.", "error");
    return;
  }
  // The run's results stay in view, marked as undone, so it is clear what
  // was taken back.
  setState((state) => ({
    blocks: Object.fromEntries(Object.entries(state.blocks).map(([id, block]) => [id, block.batch === batch ? { ...block, undone: true } : block])),
  }));
  patchSession(session, (state) => ({ console: state.console.map((entry) => (entry.batch === batch ? { ...entry, undone: true } : entry)) }));
  editor.refreshGutter();
  refreshObjects(session);
  const restored = result.restored ?? [];
  const removed = result.removed ?? [];
  const parts = [restored.length ? `Put back ${nameList(restored)} as ${restored.length === 1 ? "it was" : "they were"}.` : "", removed.length ? `Removed ${nameList(removed)}, which the run made.` : ""].filter(Boolean);
  const words = parts.length ? parts.join(" ") : "It had not changed any objects.";
  notify(`Undid the last run. ${words}`);
  announce(`Undid the last run. ${words}`);
}

/** A session's R ended. Work in flight is marked, and the banner offers a
 * restart. */
function onExited(session: string, code: number | null, log: string) {
  const line = lineOf(session);
  if (line.current?.job.file) editor.markLines(line.current.job.file, "running", null);
  if (line.current?.job.blockId) updateBlock(line.current.job.blockId, { status: "stopped" });
  line.current = null;
  line.timed = null;
  failQueued(session, "stopped");
  line.runToBlock.clear();
  forgetUndo(session);
  patchSession(session, (state) => ({
    r: { ...state.r, status: "stopped", message: code === 0 ? "R quit." : "R stopped unexpectedly.", log, runStarted: 0 },
    pendingInput: null,
  }));
  appendConsole(session, { kind: "info", text: code === 0 ? "R quit. Restart R to keep working." : "R stopped unexpectedly. Your files are safe. Restart R to keep working." });
}

/** Console runs have no card for a fix button, so a missing package error
 * there gets a notice pointing to the install command. */
function suggestFromConsoleError() {
  const explained = lastConsoleProblem;
  lastConsoleProblem = null;
  if (explained?.fix?.kind === "install") notify(`${explained.detail} To add it, choose Install Packages from the Packages menu.`);
}

// Several runs finishing together refresh a session's objects list once.
const objectsTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Reads the objects in a session's global environment for the inspector. */
function refreshObjects(session: string) {
  clearTimeout(objectsTimers.get(session));
  objectsTimers.set(
    session,
    setTimeout(async () => {
      if (!isRunning(session)) return;
      const objects = await api.objects(session).catch(() => null);
      if (objects) patchSession(session, { objects });
      settleComparisons(session);
      // Code can attach or install packages, so an open Packages pane is
      // brought up to date along with the objects.
      const { ui } = getState();
      if (session === activeKey() && ui.inspector && ui.panel === "packages") refreshPackages();
    }, 150),
  );
}

// Resizing the window sends one size to R when it stops, not one per frame.
let plotTimer: ReturnType<typeof setTimeout> | undefined;

/** The inspector reports its plot area so new plots match it exactly. */
export function setPlotArea(width: number, height: number) {
  if (width < 50 || height < 50) return;
  plotArea = renderSize(width, height);
  clearTimeout(plotTimer);
  plotTimer = setTimeout(() => {
    for (const session of runningKeys()) api.setPlotSize(session, plotArea.width, plotArea.height, window.devicePixelRatio || 1).catch(() => {});
  }, 400);
}

/** Shows an earlier or later plot in the inspector. */
export function showPlot(index: number) {
  patchSession(activeKey(), (state) => ({ plotIndex: Math.max(0, Math.min(state.plots.length - 1, index)) }));
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
    const path = await api.exportPlot(activeKey(), { ...options, code: plot.code }, `plot-${plotIndex + 1}.${options.format}`);
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
  // The result it replaces is kept on the new card, to show what changed.
  const lines = editor.blockLines(file);
  let previous: Block | undefined;
  for (const [existing, line] of lines) {
    if (line === toLine) {
      previous = getState().blocks[existing];
      editor.detachBlock(file, existing);
      setState((state) => ({ blockOrder: state.blockOrder.filter((item) => item !== existing) }));
    }
  }
  const block: Block = { id, file, code, fromLine, toLine, status: "queued", items: [], started: 0, duration: 0, live, paused: false };
  if (!live && previous && previous.status === "ok" && !previous.live && !previous.undone) {
    const touched = scriptSteps(code).flatMap((step) => [...step.makes, ...step.changes]);
    const objects = Object.fromEntries(sessionOf(sessionOfFile(file)).objects.filter((item) => touched.includes(item.name)).map((item) => [item.name, item.summary]));
    block.before = { items: previous.items, objects };
  }
  setState((state) => ({ blocks: { ...state.blocks, [id]: block }, blockOrder: [...state.blockOrder, id] }));
  editor.attachBlock(file, id, toLine);
  // The run takes its place at the bottom of the canvas's feed as it is
  // queued, so a long run shows what is waiting and what was skipped.
  const session = sessionOfFile(file);
  const order = new Set(getState().blockOrder);
  patchSession(session, (state) => ({ console: state.console.filter((entry) => !entry.blockId || order.has(entry.blockId)) }));
  appendConsole(session, { kind: "block", text: "", blockId: id });
  if (!live && session === activeKey()) revealFeed();
  return block;
}

/** Brings the canvas's feed back from under a sheet when code runs, so
 * its results are seen. A report or a running app is left on show, since
 * they are what the user is looking at while they work. */
function revealFeed() {
  const { ui } = getState();
  if (["help", "packages", "history", "assistant"].includes(ui.panel)) setState({ ui: { ...ui, panel: "canvas" } });
}

/** Records code typed in the console, and in the history the up arrow
 * walks there. */
function echo(session: string, code: string, batch?: string, task?: ConsoleEntry["task"]) {
  appendConsole(session, { kind: "input", text: code, batch, task });
  // What was typed is followed on the stage as its output arrives.
  if (session === activeKey()) showOnStage(null);
  patchSession(session, (state) => ({ history: [...state.history.filter((item) => item !== code), code].slice(-200) }));
}

/** Checks that a session's R can take code, and says why not when it
 * cannot. Code sent while R is still starting waits in the queue and runs
 * as soon as R is ready, since every new script starts an R of its own
 * and making people press Run twice would be a needless chore. */
export function requireR(session = activeKey()): boolean {
  const { status } = sessionOf(session).r;
  if (status === "ready" || status === "busy" || status === "starting") return true;
  if (status === "none") {
    startR(session);
    return true;
  }
  if (status === "missing") notify("R is not installed on this computer.", "error");
  else notify("R is not running. Use Restart R to start it.", "error");
  return false;
}

/** The text of a file as R should see it: a document's prose blanked out,
 * so only its R chunks run, with every line keeping its number. */
function runnableText(path: string) {
  const text = editor.getText(path);
  return isDocument(path) ? codeOnly(text) : text;
}

/**
 * Runs the selection, or the whole statement under the cursor when nothing
 * is selected, then moves the cursor to the next statement. In a document,
 * a cursor on a chunk's header runs the chunk, and a cursor in prose says
 * where code can run.
 */
export function runLine() {
  const { active } = getState();
  const session = sessionOfFile(active);
  if (!active || active.startsWith("data:") || !requireR(session)) return;
  const position = editor.cursor(active);
  const text = runnableText(active);
  const batch = crypto.randomUUID();
  if (position.selection.trim()) {
    const lines = text.split("\n");
    const fromLine = Math.max(0, position.selectionEndLine - position.selection.split("\n").length + 1);
    const toLine = Math.min(position.selectionEndLine, lines.length - 1);
    // A selection across prose and chunks runs the code in it, not the prose.
    const code = isDocument(active) ? lines.slice(fromLine, toLine + 1).join("\n").trim() : position.selection;
    if (!code) return notify("The selection is text, not code. Select lines inside a chunk to run them.");
    const block = newBlock(active, code, fromLine, toLine);
    enqueue([{ code, batch, blockId: block.id, file: active, session }]);
    return;
  }
  // In a document, the cursor must be in a chunk's code. On a chunk's
  // header it runs the chunk, and in prose it says where code can run,
  // rather than reaching ahead to the next chunk as a blank line in a
  // script does.
  if (isDocument(active)) {
    const chunk = chunkAt(chunksOf(editor.getText(active)), position.line);
    if (chunk && (position.line === chunk.fence || position.line === chunk.close)) return runChunkAt(active, position.line);
    if (!chunk) return notify("This line is text, not code. Put the cursor in a chunk, or choose Run chunk.");
  }
  const range = statementAt(statementRanges(text), position.line);
  if (!range) return;
  const code = text.split("\n").slice(range.from, range.to + 1).join("\n");
  const block = newBlock(active, code, range.from, range.to);
  enqueue([{ code, batch, blockId: block.id, file: active, session }]);
  // Like RStudio, the cursor moves on so pressing again runs the next one.
  const next = statementRanges(text).find((candidate) => candidate.from > range.to);
  editor.goToLine(active, next ? next.from : range.to);
}

/** Queues every statement between two lines, each with its own result,
 * as one batch that stops at the first error. */
function runSpan(path: string, from: number, to: number) {
  const session = sessionOfFile(path);
  if (!requireR(session)) return 0;
  const text = runnableText(path);
  const lines = text.split("\n");
  const batch = crypto.randomUUID();
  const jobs: Job[] = [];
  for (const range of statementRanges(text)) {
    if (range.to < from || range.from > to) continue;
    const code = lines.slice(range.from, range.to + 1).join("\n");
    const block = newBlock(path, code, range.from, range.to);
    jobs.push({ code, batch, blockId: block.id, file: path, session });
  }
  enqueue(jobs);
  return jobs.length;
}

/** Runs chosen statements of a file, in order, as one run that stops at
 * the first error. Each range is a whole statement, counted from zero. */
export function runRanges(path: string, ranges: { from: number; to: number }[]) {
  const session = sessionOfFile(path);
  if (!ranges.length || !requireR(session)) return;
  const lines = runnableText(path).split("\n");
  const batch = crypto.randomUUID();
  enqueue(
    ranges.map((range) => {
      const code = lines.slice(range.from, range.to + 1).join("\n");
      const block = newBlock(path, code, range.from, range.to);
      return { code, batch, blockId: block.id, file: path, session };
    }),
  );
}

/** Runs every statement in the file, or those up to the cursor, each with
 * its own card. The batch stops at the first error. In a document, only
 * the R chunks run. */
export function runFile(upToCursor = false) {
  const { active } = getState();
  if (!active || active.startsWith("data:")) return;
  if (!runSpan(active, 0, upToCursor ? editor.cursor(active).line : Infinity) || upToCursor) return;
  // The cursor follows the run to the end, where the next line would go.
  editor.goToLine(active, editor.getText(active).split("\n").length - 1, true, true);
}

/**
 * Runs the chunk the cursor is in, in a document, or the section the
 * cursor is in, in a script: the lines from its section comment, such as
 * "# Clean ----", to the next one. A script with no sections runs whole.
 */
export function runChunk() {
  const { active } = getState();
  if (!active || active.startsWith("data:")) return;
  runChunkAt(active, editor.cursor(active).line);
}

/** Runs the chunk or section holding a line, as the buttons on each
 * chunk's header do. */
export function runChunkAt(path: string, line: number) {
  if (isDocument(path)) {
    const chunk = chunkAt(chunksOf(editor.getText(path)), line);
    if (!chunk) return notify("The cursor is in text, not a chunk. Put it inside a chunk to run that chunk.");
    if (chunk.engine !== "r") return notify(`This chunk is ${chunk.engine}, not R, so it runs only when the document renders.`);
    if (!runSpan(path, chunk.from, chunk.to)) return notify("This chunk is empty.");
    // The cursor moves to the end of the chunk's code, past what just ran.
    if (path === getState().active) editor.goToLine(path, chunk.to, true, true);
    return;
  }
  const span = sectionAt(editor.getText(path), line);
  if (runSpan(path, span.from, span.to) && path === getState().active) editor.goToLine(path, span.to, true, true);
}

/** What the Run button runs for a file: the user's choice for it, or a
 * line in a script and a chunk in a document. */
export function runScopeFor(path: string | null): RunScope {
  if (!path) return "line";
  return getState().settings.runDefaults[path] ?? (isDocument(path) ? "chunk" : "line");
}

/** Remembers what the Run button runs for one file. Choosing the usual
 * default for its kind removes the entry, keeping the list short. */
export function setRunScope(path: string, scope: RunScope) {
  const runDefaults = { ...getState().settings.runDefaults };
  if (scope === (isDocument(path) ? "chunk" : "line")) delete runDefaults[path];
  else runDefaults[path] = scope;
  updateSettings({ runDefaults });
  announce(`The Run button now runs the ${scope === "line" ? "line" : scope === "file" ? "whole file" : isDocument(path) ? "chunk" : "section"} for ${baseName(path)}.`);
}

/** Does what the Run button says for the file in front. */
export function runDefault() {
  const scope = runScopeFor(getState().active);
  if (scope === "file") runFile();
  else if (scope === "chunk") runChunk();
  else runLine();
}

/** Whether Run chunk means a section in this file, and whether it has any. */
export function chunkWord(path: string | null): "chunk" | "section" {
  return isDocument(path) ? "chunk" : "section";
}

/** Whether a script has sections for Run section to use. */
export function fileHasSections(path: string) {
  return hasSections(editor.getText(path));
}

/**
 * Changes a plot's title, axis labels, or color by changing the line that
 * drew it, then runs that line again, so the change is in the code and
 * stays when the script runs from the top. The new plot replaces the old
 * one, and Undo in the editor takes the change back.
 */
export function editPlotCode(blockId: string, labels: PlotLabels) {
  const block = getState().blocks[blockId];
  if (!block) return;
  const to = editor.blockLines(block.file).get(blockId) ?? block.toLine;
  const from = to - (block.toLine - block.fromLine);
  const current = editor.getText(block.file).split("\n").slice(from, to + 1).join("\n");
  const next = writeLabels(current, labels);
  if (next === current) return;
  if (getState().active !== block.file) activateTab(block.file);
  editor.replaceLines(block.file, from, to, next);
  editor.detachBlock(block.file, blockId);
  setState((state) => ({ blockOrder: state.blockOrder.filter((id) => id !== blockId) }));
  runSpan(block.file, from, from + next.split("\n").length - 1);
  announce("Changed the plot in the code and drew it again.");
}

// The script the user last had in front, where changes made in the data
// viewer go as lines of R.
let lastScript: string | null = null;

/**
 * Changes a data frame from the data viewer by writing the line of R that
 * does it into the script and running it, so the change is part of the
 * analysis and runs again with it. The line goes after the statement the
 * cursor is on, in the script last in front, and the notice says where.
 */
export function changeData(code: string, words: string) {
  const session = activeKey();
  const scripts = getState().tabs.filter((tab) => tab.kind !== "data" && tab.session === session);
  let path = scripts.find((tab) => tab.path === lastScript)?.path ?? scripts[scripts.length - 1]?.path;
  if (!path) {
    newFile();
    path = getState().active ?? "";
    if (!path) return;
  }
  const lines = editor.getText(path).split("\n");
  const cursorLine = editor.cursor(path).line;
  let after: number;
  if (isDocument(path)) {
    // In a report, the line goes into the chunk the cursor is in, or the
    // last chunk, never into the writing between chunks.
    const chunks = chunksOf(editor.getText(path)).filter((chunk) => chunk.engine === "r");
    const chunk = chunkAt(chunks, cursorLine) ?? chunks[chunks.length - 1];
    if (!chunk) {
      editor.insertText(path, `\n\`\`\`{r}\n${code}\n\`\`\`\n`);
      const total = editor.getText(path).split("\n").length;
      runSpan(path, total - 3, total - 3);
      notify(`Added a chunk to the end of ${baseName(path)} and ran it: ${words}.`);
      return;
    }
    after = Math.min(chunk.close - 1, Math.max(chunk.fence, statementAt(statementRanges(runnableText(path)), cursorLine)?.to ?? chunk.close - 1));
  } else {
    const range = statementAt(statementRanges(runnableText(path)), cursorLine);
    after = range ? range.to : Math.max(0, lines.length - 1);
    // Trailing blank lines are skipped, so the line joins the code.
    while (!range && after > 0 && !lines[after].trim()) after -= 1;
  }
  editor.replaceLines(path, after, after, `${lines[after]}\n${code}`);
  runSpan(path, after + 1, after + 1);
  notify(`Added line ${after + 2} to ${baseName(path)} and ran it: ${words}. ${keyLabel("⌥⌘Z")} undoes the change to the data.`);
}

/** Puts a snippet's code at the cursor in the script in front, or in a
 * new script when none is open, ready to fill in with Tab. */
export function insertSnippetById(id: string) {
  const found = SNIPPETS.find((item) => item.id === id);
  if (!found) return;
  const { active } = getState();
  if (!active || active.startsWith("data:")) newFile();
  setTimeout(() => editor.insertSnippet(found.code), 0);
}

/** Inserts an empty R chunk at the cursor, with the cursor inside it. In
 * a script, which has no chunks, it inserts a section comment instead. */
export function insertChunk() {
  const { active } = getState();
  if (!active || active.startsWith("data:")) return;
  if (!isDocument(active)) return insertSection();
  const prefix = editor.cursorLineIsBlank() ? "" : "\n";
  const text = `${prefix}\`\`\`{r}\n\n\`\`\`\n`;
  const inside = prefix.length + 7;
  editor.insertAtCursor(text, [inside, inside]);
}

/** Starts a new Quarto or R Markdown document from the New document
 * dialog, holding a header and first chunks, ready to render. */
export function createDocument(kind: DocumentKind, title: string, author: string, format: DocumentFormat) {
  openDialog(null);
  newDocument(newDocumentText(kind, title, author, format), documentFileName(kind, title));
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
  const { active } = getState();
  const session = sessionOfFile(path);
  const line = lineOf(session);
  if (path !== active || sessionOf(session).r.status !== "ready" || line.current || line.queue.length) return;
  const text = editor.getText(path);
  const range = statementAt(statementRanges(text), editor.cursor(path).line);
  if (!range) return;
  const code = text.split("\n").slice(range.from, range.to + 1).join("\n");
  if (LIVE_UNSAFE.test(code)) return;
  const lines = editor.blockLines(path);
  const existing = Object.values(getState().blocks).find((block) => block.file === path && lines.get(block.id) === range.to);
  if (existing?.paused || existing?.code === code) return;
  // Only complete statements run live. Half typed code would mostly error.
  api.isComplete(session, code).then((status) => {
    // The file may have closed, or another taken its place, while R read it.
    if (status !== "complete" || sessionOf(session).r.status !== "ready" || getState().active !== path) return;
    const block = newBlock(path, code, range.from, range.to, true);
    enqueue([{ code, batch: crypto.randomUUID(), blockId: block.id, file: path, session }]);
  }).catch(() => {});
}

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

/** Runs a result's statement again, as it reads in the editor. */
export function runBlockAgain(blockId: string) {
  const block = getState().blocks[blockId];
  const session = sessionOfFile(block?.file);
  if (!block || !requireR(session)) return;
  const line = editor.blockLines(block.file).get(blockId) ?? block.toLine;
  const text = editor.getText(block.file);
  const range = statementAt(statementRanges(text), line);
  const code = range ? text.split("\n").slice(range.from, range.to + 1).join("\n") : block.code;
  const next = newBlock(block.file, code, range?.from ?? block.fromLine, range?.to ?? block.toLine);
  enqueue([{ code, batch: crypto.randomUUID(), blockId: next.id, file: block.file, session }]);
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
  const session = activeKey();
  if (pendingInput) {
    appendConsole(session, { kind: "answer", text: pendingInput.password ? "••••" : code });
    patchSession(session, { pendingInput: null });
    if (getState().notice?.text.startsWith("R is waiting")) setState({ notice: null });
    await api.sendInput(session, code).catch((error) => notify(String(error), "error"));
    return "ran";
  }
  if (!code.trim() || !requireR(session)) return "ran";
  // ?topic and help(topic) open the Help pane, as in RStudio, rather than
  // printing a page into the console.
  const asked = /^\s*\?{1,2}\s*([A-Za-z.][\w.]*|`[^`]+`)\s*$/.exec(code) ?? /^\s*help\(\s*["']?([A-Za-z.][\w.]*)["']?\s*\)\s*$/.exec(code);
  if (asked) {
    echo(session, code);
    openHelp(asked[1]);
    return "ran";
  }
  const status = await api.isComplete(session, code).catch(() => "complete");
  if (status === "incomplete") return "incomplete";
  revealFeed();
  const batch = crypto.randomUUID();
  echo(session, code, batch);
  enqueue([{ code, batch, console: true, session }]);
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
  const session = sessionOfFile(path);
  if (unknown.length && sessionOf(session).r.status === "ready" && !checking) {
    checking = true;
    try {
      const missing = new Set(await api.missingPackages(session, unknown));
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

// A package name as CRAN allows it. Names are checked against this before
// they are written into R code, so nothing else can reach R that way.
const PACKAGE_NAME = /^[A-Za-z][A-Za-z0-9.]*$/;

// Names being installed, checked again once the install finishes.
let installing: string[] = [];

/** Installs packages through the console. Names are checked against
 * PACKAGE_NAME before they go into R code. */
export function installPackages(names: string[]) {
  const clean = names.map((name) => name.trim()).filter((name) => PACKAGE_NAME.test(name));
  const session = activeKey();
  if (!clean.length || !requireR(session)) return;
  installing = [...installing, ...clean];
  const code = `install.packages(c(${clean.map((name) => `"${name}"`).join(", ")}))`;
  const batch = crypto.randomUUID();
  echo(session, code, batch, "install");
  showPanel("canvas");
  notify(`Installing ${clean.join(", ")}. Progress is on the stage.`);
  enqueue([{ code, batch, console: true, session }]);
}

// When R has no package source chosen yet, the update functions would stop
// to ask for a mirror, so the cloud mirror RStudio also uses is set first.
// A source the user chose themselves is left alone.
const CRAN_SETUP = `if (identical(unname(getOption("repos")["CRAN"]), "@CRAN@")) options(repos = c(CRAN = "https://cloud.r-project.org"))`;

/** Shows which packages have newer versions on the Updates page, where
 * everything that can be updated is listed together. */
export function checkPackageUpdates() {
  openUpdates();
  void checkForUpdates();
}

/** Updates every installed package with a newer version, after asking,
 * with the progress at the prompt. */
export async function updateAllPackages(): Promise<string | null> {
  // Names the packages when the Updates page has found them, so it is
  // clear what will change before anything does.
  const known = getState().updates.packages?.packages.map((item) => item.name) ?? [];
  const which = known.length ? `${known.length === 1 ? "this package" : `these ${known.length} packages`}: ${known.slice(0, 12).join(", ")}${known.length > 12 ? ", and more" : ""}` : "every installed package that has a newer version";
  const sure = await api.confirm(`Update ${which}? This can take a few minutes. Restart R afterward to start using the new versions.`, "Update all");
  if (!sure) return null;
  showPanel("canvas");
  notify("Updating packages. Progress is on the stage.");
  return runInConsole(
    `${CRAN_SETUP}\nlocal({\n  old <- old.packages()\n  if (is.null(old)) cat("Every installed package is up to date.\\n") else update.packages(oldPkgs = rownames(old), ask = FALSE, checkBuilt = TRUE)\n})`,
    "update",
  );
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
export function openUrl(kind: "releases" | "issues" | "cran" | "ollama" | "posit" | "stackoverflow") {
  const urls = { releases: RELEASES, issues: ISSUES, cran: CRAN, ollama: OLLAMA, posit: POSIT_COMMUNITY, stackoverflow: STACK_OVERFLOW };
  const url = urls[kind];
  api.openUrl(url).catch(() => notify(`The browser did not open. The address is ${url}`, "error"));
}

/** Runs a command by id, from the menu bar, a shortcut, or the palette. */
export function runCommand(id: string) {
  const actions: Record<string, () => unknown> = {
    "app.settings": () => openDialog("settings"),
    "app.updates": () => (openUpdates(), checkForUpdates()),
    "app.reset": () => openDialog("resetApp"),
    "file.new": newFile,
    "project.new": () => openNewProject("analysis"),
    "file.newShinyApp": () => openNewProject("shiny"),
    "project.open": chooseAndOpenProject,
    "project.close": closeProject,
    "view.sidebar": () => togglePane("sidebar"),
    "file.open": chooseAndOpen,
    "file.save": () => saveFile(),
    "file.saveAs": () => saveFile(getState().active, true),
    "file.history": openFileHistory,
    "file.saveAll": saveAll,
    "file.close": () => closeTab(),
    "file.exportPlot": openExportPlot,
    "edit.find": editor.openFind,
    "edit.comment": editor.commentLines,
    "view.output.canvas": () => setOutputLayout("canvas"),
    "view.output.inline": () => setOutputLayout("inline"),
    "view.style.cards": () => updateSettings({ resultStyle: "cards" }),
    "view.style.plain": () => updateSettings({ resultStyle: "plain" }),
    "view.live": toggleLive,
    "view.inspector": () => togglePane("inspector"),
    "view.prompt": () => togglePart("showPrompt"),
    "view.timeline": () => togglePart("showTimeline"),
    "view.resetLayout": resetLayout,
    "view.startScreen": showStartScreen,
    "view.focus": toggleFocus,
    "view.history": showConsoleHistory,
    "view.layer.essentials": () => updateSettings({ layer: "essentials" }),
    "view.layer.everything": () => updateSettings({ layer: "everything" }),
    "view.palette": () => togglePalette(),
    "view.zoomIn": () => zoom(10),
    "view.zoomOut": () => zoom(-10),
    "run.line": runLine,
    "run.file": () => runFile(),
    "run.toHere": () => runFile(true),
    "run.chunk": runChunk,
    "file.newDocument": () => openDialog("newDocument"),
    "edit.chunk": insertChunk,
    "run.stop": stop,
    "run.restart": restartR,
    "run.undo": undoLastRun,
    "run.restartRunAll": restartAndRunFile,
    "run.chooseR": () => openDialog("chooseR"),
    "run.clearOutput": clearOutput,
    "run.clearConsole": clearConsole,
    "packages.install": () => openDialog("install"),
    "packages.checkUpdates": checkPackageUpdates,
    "packages.updateAll": updateAllPackages,
    "packages.installMissing": installMissingForFile,
    "packages.auto": () => updateSettings({ missingPackages: getState().settings.missingPackages === "auto" ? "ask" : "auto" }),
    "focus.editor": editor.focusEditor,
    "focus.console": focusConsole,
    "focus.help": () => focusPane(() => showPanel("help"), "help"),
    "focus.history": showConsoleHistory,
    "focus.plots": () => focusPane(() => showPanel("canvas"), "feed"),
    "focus.packages": () => focusPane(() => showPanel("packages"), "packages"),
    "focus.environment": () => focusPane(() => showPanel("canvas"), "objects"),
    "edit.pipe": () => editor.insertWhereFocused(" |> "),
    "edit.assign": () => editor.insertWhereFocused(" <- "),
    "edit.section": insertSection,
    "help.atCursor": helpAtCursor,
    "data.import": () => openDialog("importData"),
    "help.shortcuts": () => togglePalette(),
    "help.about": () => openDialog("about"),
    "help.guide": showHelpScreen,
    "help.examples": openExamples,
    "help.tour": startTour,
    "help.firstProject": startGuide,
    "help.license": () => openDialog("about"),
    "help.report": () => openUrl("issues"),
    "assistant.setup": openAssistantSetup,
    "assistant.show": () => focusPane(() => showPanel("assistant"), "assistant"),
    "assistant.explain": () => assistOnCode("explainCode"),
    "edit.explain": explainAtCursor,
    "edit.trace": () => openTrace(),
    "edit.makeExercise": makeExercise,
    "file.saveExercises": saveExercises,
    "run.fresh": checkFromScratch,
    "edit.cite": openCitation,
    "results.report": saveResultsAsReport,
    "edit.tidy": tidyCode,
    "edit.fixProblems": openFixProblems,
    "edit.rename": openRename,
    "edit.findInFiles": () => openDialog("findInFiles"),
    "assistant.comment": () => assistOnCode("comment"),
    "assistant.improve": () => assistOnCode("improve"),
    "assistant.write": () => focusPane(() => showPanel("assistant"), "assistant"),
    "assistant.writeHere": writeCodeHere,
    "render.report": () => renderReport(),
    "render.html": () => renderReport("html"),
    "render.word": () => renderReport("word"),
    "render.pdf": () => renderReport("pdf"),
    "render.stop": stopRender,
    "app.run": () => runApp(),
    "app.stop": stopApp,
    "app.open": openAppInBrowser,
    "app.share": () => openShare(),
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
