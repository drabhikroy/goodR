// Running Shiny apps, shown in the App pane beside the code.
//
// An app runs in its own R, started fresh each time, as a report renders.
// The console stays free while the app is open, and the app sees only what
// its own code makes, which is what a person it is shared with will see.
// Its files are saved first, because the app reads them from disk, and
// Shiny reloads the app by itself whenever one of them is saved again.
//
// When an app will not start, the failure is explained with the same plain
// language rules as errors in the console, and the failing line is marked
// in the editor. Errors inside a running app, such as a plot that fails,
// are listed above the app without stopping it, as Shiny does, and placed
// at the line where they really happened, read from the stack trace Shiny
// prints after them, rather than at whatever the message seems to name.
//
// Before an app runs, and as it is written, its code is also read for
// mistakes that Shiny never reports at their cause, such as an output id
// spelled differently in the UI and the server (shinyCheck.ts).

import { explainApp as explainWith, explainProblem, type AppAction, type AppExplained } from "./appErrors";
import type { Backend } from "./backend";
import * as editor from "./editor";
import { announce, baseName, folderOf, installPackages, notify, openDialog, openFile, saveFile, showPanel, togglePane } from "./app";
import { explainError } from "./errors";
import { shinyGraph } from "./shinyGraph";
import { checkShinyApp, closestName, tokenize, type ShinyFinding, type ShinyFix } from "./shinyCheck";
import { describePlace, parseFrame, placeOf } from "./shinyTrace";
import { getState, setState, type AppProblem, type ShinyAppState } from "./store";
import type { AppEvent, AppFailure, ExportEvent } from "./types";

export type { AppAction, AppExplained };
export { explainProblem };

let api: Backend;

// The log keeps the latest lines only, since an app can run for hours.
const LOG_LIMIT = 2000;
// Only the latest errors inside the app are kept. A plot that fails on
// every slider move would otherwise fill the list with one message.
const PROBLEM_LIMIT = 20;

/** Listens for what running apps and exports print. */
export async function initApps(backend: Backend) {
  api = backend;
  await api.onApp(onEvent);
  await api.onExport(onExportLine);
}

// Shiny treats these names as parts of an app folder, so ui.R and server.R
// run together from their folder.
const APP_FILE_NAMES = new Set(["app.R", "ui.R", "server.R"]);

/**
 * Whether a script is a Shiny app: one of Shiny's own file names, or a
 * script that builds an app with shinyApp(), which Shiny runs as a single
 * file app. `text` is the script as the editor holds it.
 */
export function isShinyApp(path: string | null | undefined, text: string): boolean {
  if (!path || path.startsWith("untitled:") || path.startsWith("data:") || !/\.[Rr]$/.test(path)) return false;
  if (APP_FILE_NAMES.has(baseName(path))) return true;
  // A call that is commented out does not make an app.
  return text.split("\n").some((line) => /^[^#]*\bshinyApp\s*\(/.test(line));
}

/** Changes the latest app's state, if it is still the one with `id`. */
function patch(id: string, change: (run: ShinyAppState) => Partial<ShinyAppState>) {
  setState((state) => (state.shinyApp && state.shinyApp.id === id ? { shinyApp: { ...state.shinyApp, ...change(state.shinyApp) } } : {}));
}

function onEvent(event: AppEvent) {
  const run = getState().shinyApp;
  if (!run || run.id !== event.id) return;
  switch (event.kind) {
    case "ready":
      patch(event.id, () => ({ status: "running", url: event.url }));
      announce(`${baseName(run.file)} is running in the App pane.`);
      break;
    case "problem":
      patch(event.id, (current) => ({ problems: [...current.problems, { message: event.message, frames: [], complete: false }].slice(-PROBLEM_LIMIT) }));
      announce(`The app hit an error. ${explainProblem(event.message).title}.`);
      break;
    case "line": {
      // The stack trace follows its error line by line. Each frame joins
      // the latest error until a line that is not a frame ends it, and the
      // spot is marked again as the place becomes clearer.
      const frame = parseFrame(event.text);
      patch(event.id, (current) => {
        const last = current.problems[current.problems.length - 1];
        const log = [...current.log, event.text].slice(-LOG_LIMIT);
        if (!last || last.complete) return { log };
        const updated: AppProblem = frame ? { ...last, frames: [...last.frames, frame] } : { ...last, complete: true };
        return { log, problems: [...current.problems.slice(0, -1), updated] };
      });
      const latest = getState().shinyApp?.problems.at(-1);
      if (frame && latest) markRuntimeProblem(latest);
      break;
    }
    case "ended":
      patch(event.id, () => ({ status: "ended", url: null, failure: event.failure }));
      ended(run.file, event.failure);
      break;
  }
}

/** Marks the failing spot and says what happened when an app ends. */
function ended(file: string, failure: AppFailure | null) {
  if (!failure) {
    announce(`${baseName(file)} closed itself.`);
    return;
  }
  if (failure.kind === "stopped") {
    announce("The app stopped.");
    return;
  }
  const explained = explainApp(failure);
  const where = explained.where;
  if (where) editor.markProblem(where.file, where.line, where.text, where.from, explained.title);
  announce(`${baseName(file)} did not start. ${explained.title}.`);
}

/**
 * Runs a Shiny app, the one in the editor unless another is named. Running
 * an app while another runs replaces it, as only one runs at a time.
 */
export async function runApp(file: string | null = getState().active) {
  if (!file || !isShinyApp(file, editor.getText(file))) {
    notify("Run app only works on Shiny apps: an app.R file, a ui.R and server.R pair, or a script that ends with shinyApp(). Open one, then run it.");
    return;
  }
  // The app reads its files from disk, so unsaved changes to it, and to
  // the scripts beside it such as ui.R and server.R, are saved.
  const folder = folderOf(file);
  const unsaved = getState().tabs.filter((tab) => !tab.untitled && tab.kind !== "data" && folderOf(tab.path) === folder && editor.isDirty(tab.path));
  for (const tab of unsaved) {
    await saveFile(tab.path);
    if (editor.isDirty(tab.path)) return;
  }
  for (const tab of getState().tabs) if (folderOf(tab.path) === folder) editor.clearProblems(tab.path);
  const id = crypto.randomUUID();
  setState({ shinyApp: { id, file, status: "starting", url: null, log: [], problems: [], failure: null, reloads: 0, preview: null } });
  if (!getState().ui.inspector) togglePane("inspector");
  showPanel("app");
  announce(`Starting ${baseName(file)}.`);
  try {
    await api.appStart(id, file);
  } catch (error) {
    const message = String(error).replace(/^Error: /, "");
    patch(id, () => ({ status: "ended", failure: { kind: "ended", message } }));
  }
}

/** Stops the running app, along with its R. */
export function stopApp() {
  api.appStop().catch(() => {});
}

/** Loads the app's page again, as the browser's own Reload would. */
export function reloadApp() {
  const run = getState().shinyApp;
  if (run) patch(run.id, (current) => ({ reloads: current.reloads + 1 }));
}

/** The spot on a line that an error names, as columns, when the error's
 * own words point at something on it, such as a name that was not found.
 * Otherwise the line's code, without its indent. */
function spotOn(message: string, lineText: string): { from: number; to: number } {
  const where = explainError(message, [], lineText).where;
  if (where && where.to > where.from) return { from: where.from, to: where.to };
  const start = lineText.search(/\S/);
  return { from: Math.max(0, start), to: lineText.replace(/\s+$/, "").length };
}

/**
 * Where an error inside the running app happened, in the app's own files:
 * the file, the zero based line, the spot on it, the place in words, and a
 * fix when a name was misspelled and the file has one close to it.
 */
export function locateProblem(problem: AppProblem) {
  const place = placeOf(problem.frames);
  if (!place.at) return null;
  // R may write the path differently from how it was opened, as through a
  // link to the folder, so a file beside the app with the same name is the
  // same file.
  const app = getState().shinyApp?.file;
  const same = `${app ? folderOf(app) : ""}/${baseName(place.at.file)}`;
  const file = getState().tabs.some((tab) => tab.path === place.at!.file) || !app ? place.at.file : same;
  const line = place.at.line - 1;
  const text = editor.getText(file) || "";
  const lineText = text.split("\n")[line] ?? "";
  const spot = spotOn(problem.message, lineText);
  const missing = /object '([^']+)' not found|could not find function "([^"]+)"/.exec(problem.message);
  const wanted = missing?.[1] ?? missing?.[2];
  const names = wanted ? [...new Set(tokenize(text).filter((token) => token.kind === "ident" && token.text !== wanted).map((token) => token.text))] : [];
  const near = wanted ? closestName(wanted, names) : undefined;
  const fix: ShinyFix | undefined = near && lineText.slice(spot.from, spot.to) === wanted ? { label: `Change to ${near}`, file, line, from: spot.from, to: spot.to, text: near } : undefined;
  return { file, line, ...spot, words: describePlace(place), place, fix };
}

/** Underlines where an error inside the running app happened. */
function markRuntimeProblem(problem: AppProblem) {
  const found = locateProblem(problem);
  if (!found || !getState().tabs.some((tab) => tab.path === found.file)) return;
  const lineText = editor.getText(found.file).split("\n")[found.line] ?? "";
  editor.markProblem(found.file, found.line, lineText.slice(found.from, found.to), found.from, explainProblem(problem.message).title);
}

/** Opens a file at a zero based line, with the spot on it selected. */
export async function goToAppLine(file: string, line: number, from = 0, to = 0) {
  await openFile(file);
  const lineText = editor.getText(file).split("\n")[line] ?? "";
  if (to > from) editor.selectSpan(file, line, lineText.slice(from, to), from);
  else editor.goToLine(file, line);
}

/** Makes a fix offered for an app: opens its file, replaces the spot, and
 * reads the app again. The change is one step that Undo takes back. */
export async function applyShinyFix(fix: ShinyFix) {
  await openFile(fix.file);
  editor.replaceRange(fix.file, fix.line, fix.from, fix.to, fix.text);
  await checkShinyFile(fix.file);
}

// The files of an app that has more than one, read together: the UI, the
// server, and global.R, which both can use.
const SPLIT_FILES = ["ui.R", "server.R", "global.R"];

// Counts checks, so a slow read from disk cannot put an earlier file's
// findings over those of the file checked after it.
let checkCount = 0;

/**
 * Reads a Shiny app's code for likely mistakes and underlines them, for
 * the file in front and the files beside it that make up the same app.
 * Files that are not open are read from disk. Anything that is not a
 * Shiny app clears what was found before.
 */
export async function checkShinyFile(path: string | null) {
  if (!path || !isShinyApp(path, editor.getText(path))) {
    if (getState().shinyCheck) setState({ shinyCheck: null });
    return;
  }
  const check = (checkCount += 1);
  const name = baseName(path);
  const folder = folderOf(path);
  const paths = SPLIT_FILES.includes(name) ? SPLIT_FILES.map((file) => `${folder}/${file}`) : [path];
  const files: { file: string; text: string }[] = [];
  for (const file of paths) {
    const open = getState().tabs.some((tab) => tab.path === file);
    const text = open ? editor.getText(file) : await api.readText(file).catch(() => null);
    if (text !== null && text !== undefined) files.push({ file, text });
  }
  if (check !== checkCount) return;
  const findings: ShinyFinding[] = checkShinyApp(files);
  // The map of how the app's parts connect is read from the same files.
  setState({ shinyCheck: { file: path, findings, graph: shinyGraph(files) } });
  for (const { file } of files) {
    editor.setLintMarks(
      file,
      findings.filter((finding) => finding.file === file).map((finding) => ({ line: finding.line, from: finding.from, to: finding.to, note: finding.title })),
    );
  }
}

/** Opens the running app in the system's browser. */
export function openAppInBrowser() {
  api.appOpen().catch((error) => notify(String(error).replace(/^Error: /, ""), "error"));
}

/** Empties the list of errors inside the running app. */
export function clearProblems() {
  const run = getState().shinyApp;
  if (run) patch(run.id, () => ({ problems: [] }));
}

/** Carries out the button offered with a failure. */
export function runAppAction(action: AppAction) {
  if (action.kind === "install") installPackages([action.name]);
  else if (action.kind === "chooseR") openDialog("chooseR");
  else runApp(getState().shinyApp?.file);
}

/** Opens the file that failed and selects the failing spot. */
export async function goToSpot(where: NonNullable<AppExplained["where"]>) {
  await openFile(where.file);
  editor.selectSpan(where.file, where.line, where.text, where.from);
}

/** Explains a failure against the app's files as they are in the editor. */
export function explainApp(failure: AppFailure): AppExplained {
  if (failure.kind !== "parse") return explainWith(failure, (file) => editor.getText(file));
  return explainWith({ ...failure, file: openPathOf(failure.file) }, (file) => editor.getText(file));
}

/**
 * The open tab for a file R named. R spells the path its own way, which
 * can differ from the tab's when a folder on the way is a link, so a tab
 * with the same name in the app's folder counts as the same file.
 */
function openPathOf(file: string): string {
  const tabs = getState().tabs;
  if (tabs.some((tab) => tab.path === file)) return file;
  const folder = folderOf(getState().shinyApp?.file ?? "");
  return tabs.find((tab) => folderOf(tab.path) === folder && baseName(tab.path) === baseName(file))?.path ?? file;
}

// Sharing an app as a web page.

/** Adds a line an export printed to the Share dialog's log. */
function onExportLine(event: ExportEvent) {
  setState((state) => (state.share && state.share.id === event.id ? { share: { ...state.share, log: [...state.share.log, event.text].slice(-LOG_LIMIT) } } : {}));
}

/**
 * Opens the Share dialog for an app, listing the files its web page would
 * hold, so the user sees exactly what will be shared before anything is
 * made.
 */
export async function openShare(file: string | null = getState().shinyApp?.file ?? getState().active) {
  if (!file || !isShinyApp(file, editor.getText(file))) {
    notify("Sharing works on Shiny apps. Open one, then share it.");
    return;
  }
  if (file.startsWith("untitled:")) {
    file = await saveFile(file);
    if (!file || file.startsWith("untitled:")) return;
  }
  const id = crypto.randomUUID();
  setState({ share: { id, file, status: "ready", bundle: null, log: [], folder: null, failure: null } });
  openDialog("shareApp");
  const bundle = await api.appBundleFiles(file).catch(() => null);
  setState((state) => (state.share?.id === id ? { share: { ...state.share, bundle } } : {}));
}

/** Changes the Share dialog's state, if it is still the export with `id`. */
function patchShare(id: string, change: Partial<NonNullable<ReturnType<typeof getState>["share"]>>) {
  setState((state) => (state.share && state.share.id === id ? { share: { ...state.share, ...change } } : {}));
}

/** Makes the web version: the system dialog asks where it goes, then R
 * exports it with shinylive. The app's files are saved first. */
export async function exportApp() {
  const share = getState().share;
  if (!share || share.status === "exporting") return;
  const folder = folderOf(share.file);
  for (const tab of getState().tabs.filter((item) => !item.untitled && folderOf(item.path) === folder && editor.isDirty(item.path))) {
    await saveFile(tab.path);
  }
  const id = crypto.randomUUID();
  setState({ share: { ...share, id, status: "exporting", log: [], folder: null, failure: null } });
  try {
    const result = await api.appExport(id, share.file);
    if (!result) return patchShare(id, { status: "ready" });
    patchShare(id, { status: result.status, folder: result.folder, failure: result.failure });
    announce(result.status === "done" ? `The web version of ${baseName(share.file)} is ready.` : `The web version was not made. ${result.failure ? explainApp(result.failure).title : ""}`);
  } catch (error) {
    patchShare(id, { status: "failed", failure: { kind: "ended", message: String(error).replace(/^Error: /, "") } });
  }
}

/** Stops the export under way. */
export function stopExport() {
  api.appExportStop().catch(() => {});
}

/** Shows the web version in the App pane, as whoever opens it will see it. */
export async function previewExport() {
  const share = getState().share;
  if (!share?.folder) return;
  openDialog(null);
  const id = crypto.randomUUID();
  setState({ shinyApp: { id, file: share.file, status: "starting", url: null, log: [], problems: [], failure: null, reloads: 0, preview: share.folder } });
  showPanel("app");
  try {
    await api.appPreview(id, share.folder);
  } catch (error) {
    patch(id, () => ({ status: "ended", failure: { kind: "ended", message: String(error).replace(/^Error: /, "") } }));
  }
}

/** Shows the web version's folder in Finder, to copy or upload. */
export function revealExport() {
  const folder = getState().share?.folder;
  if (folder) api.appReveal(folder).catch((error) => notify(String(error).replace(/^Error: /, ""), "error"));
}
