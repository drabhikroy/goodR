// Rendering reports: Quarto (.qmd) and R Markdown (.Rmd) files turned into
// HTML, Word, or PDF, with a preview in the Report pane.
//
// A render runs in its own R, started fresh for each render, as RStudio
// does when it knits. The report then shows what its own code makes from
// a clean start, which is what a reader of the report will get, and the
// console's objects are left alone. The file is saved first, because the
// render reads it from disk.
//
// When a render fails, the failure is explained with the same plain
// language rules as errors in the console, and the failing line is marked
// in the editor, so a report error reads like any other error in the app.

import type { Backend } from "./backend";
import * as editor from "./editor";
import { explainRender as explainWith, type RenderAction, type RenderExplained } from "./renderErrors";
import { announce, baseName, installPackages, notify, openDialog, saveFile, showBottomPane, togglePane } from "./app";
import { getState, setState, type ReportState } from "./store";
import type { RenderEvent, RenderFailure, RenderTarget } from "./types";

export type { RenderAction, RenderExplained };

let api: Backend;

// The log keeps the latest lines only, so a very chatty render cannot
// slow the interface down.
const LOG_LIMIT = 2000;

const QUARTO_URL = "https://quarto.org/docs/get-started/";

/** Listens for progress from renders. */
export async function initReports(backend: Backend) {
  api = backend;
  await api.onRender(onEvent);
}

/** Whether a file is a report the editor can render. */
export function isReport(path: string | null | undefined): boolean {
  return Boolean(path && !path.startsWith("untitled:") && !path.startsWith("data:") && /\.(qmd|Rmd|rmd)$/.test(path));
}

/** Changes the latest render's state, if it is still the one with `id`. */
function patch(id: string, change: (report: ReportState) => Partial<ReportState>) {
  setState((state) => (state.report && state.report.id === id ? { report: { ...state.report, ...change(state.report) } } : {}));
}

function onEvent(event: RenderEvent) {
  if (event.kind === "progress") {
    patch(event.id, () => ({ progress: { done: event.done, total: event.total, label: event.label } }));
  } else {
    patch(event.id, (report) => ({ log: [...report.log, event.text].slice(-LOG_LIMIT) }));
  }
}

/** What each format is called in messages. */
const TARGET_WORDS: Record<RenderTarget, string> = { asWritten: "", html: " as HTML", word: " as a Word document", pdf: " as a PDF" };

/**
 * Renders a report, the one in the editor unless another is named. The
 * Render button renders it as its header says. The Render menu can ask for
 * HTML, Word, or PDF instead.
 */
export async function renderReport(target: RenderTarget = "asWritten", active: string | null = getState().active) {
  const { report } = getState();
  if (!active || !isReport(active)) {
    notify("Rendering works on Quarto (.qmd) and R Markdown (.Rmd) files. Open one, then render it.");
    return;
  }
  if (report?.status === "running") {
    notify("A report is already rendering. Stop it first, or wait for it to finish.");
    return;
  }
  // The render reads the file from disk, so unsaved changes are saved.
  if (editor.isDirty(active)) {
    await saveFile(active);
    if (editor.isDirty(active)) return;
  }
  editor.clearProblems(active);
  const id = crypto.randomUUID();
  setState({ report: { id, file: active, target, status: "running", progress: null, log: [], outputs: [], failure: null, started: Date.now(), finished: 0 } });
  if (!getState().ui.inspector) togglePane("inspector");
  showBottomPane("report");
  announce(`Rendering ${baseName(active)}${TARGET_WORDS[target]}.`);
  try {
    const result = await api.renderStart(id, active, target);
    patch(id, () => ({ status: result.status, outputs: result.outputs, failure: result.failure, finished: Date.now() }));
  } catch (error) {
    const message = String(error).replace(/^Error: /, "");
    patch(id, () => ({ status: "failed", failure: { kind: "other", message }, finished: Date.now() }));
  }
  const done = getState().report;
  if (!done || done.id !== id) return;
  if (done.status === "done") {
    announce(`${baseName(active)} rendered. ${done.outputs.map(baseName).join(", ")} is ready.`);
  } else if (done.status === "failed" && done.failure) {
    const explained = explainRender(done.failure, active);
    if (explained.where) editor.markProblem(active, explained.where.line, explained.where.text, explained.where.from, explained.title);
    announce(`${baseName(active)} did not render. ${explained.title}.`);
  } else {
    announce("Rendering stopped.");
  }
}

/** Stops the render under way, along with the R it started. */
export function stopRender() {
  api.renderStop().catch(() => {});
}

/** Opens a rendered file in its usual app, or shows it in Finder. */
export function openOutput(path: string, reveal = false) {
  api.renderOpen(path, reveal).catch((error) => notify(String(error).replace(/^Error: /, ""), "error"));
}

/** The address the preview loads a rendered file from. */
export function previewUrl(path: string) {
  return api.previewUrl(path);
}

/** Opens Quarto's getting started page in the browser. */
export function getQuarto() {
  api.openUrl(QUARTO_URL).catch(() => notify(`The browser did not open. The address is ${QUARTO_URL}`, "error"));
}

/** Carries out the button offered with a failure. */
export function runRenderAction(action: RenderAction) {
  if (action.kind === "install") installPackages([action.name]);
  else if (action.kind === "quarto") getQuarto();
  else if (action.kind === "chooseR") openDialog("chooseR");
  else if (action.kind === "pdf") renderReport("pdf", getState().report?.file);
  else renderReport(getState().report?.target ?? "asWritten", getState().report?.file);
}

/** Explains a failure against the report as it is in the editor. */
export function explainRender(failure: RenderFailure, file: string): RenderExplained {
  return explainWith(failure, editor.getText(file));
}
