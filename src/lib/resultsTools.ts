// Two ways to take results further: writing the canvas out as a Quarto
// report, and checking that the script in front works from a clean start.
//
// Both act on what is already there, the results on the canvas and the
// script in the editor, so neither needs a screen of its own. The report
// opens as a new document to read through and save. The check reports in a
// banner above the script, with the line that failed one press away.

import type { Backend } from "./backend";
import * as editor from "./editor";
import { goToLine, newDocument, notify, openFile } from "./app";
import { codeOnly, isDocument } from "./chunks";
import { reportFromResults } from "./resultsReport";
import { getState, sessionOf, setState, type Block } from "./store";

let api: Backend;

export function initResultsTools(backend: Backend) {
  api = backend;
}

/** Opens the results on the canvas as a new Quarto document. */
export function saveResultsAsReport() {
  const { activeSession, blocks } = getState();
  const session = sessionOf(activeSession);
  const ordered = session.console.map((entry) => (entry.blockId ? blocks[entry.blockId] : undefined)).filter((block): block is Block => Boolean(block));
  if (!ordered.some((block) => block.status === "ok" && block.items.length > 0)) {
    return notify("There are no results on the canvas yet. Run some code first, and its results become the report.");
  }
  const title = session.project ? `Results from ${session.project.name}` : "Results";
  const today = new Date().toISOString().slice(0, 10);
  newDocument(reportFromResults(ordered, title, today), "results.qmd");
  notify("The results are a new Quarto document. Add what they mean in your own words, then save it and choose Render report.");
}

/**
 * Runs the script in front in a new R, from its first line to its last,
 * and says whether it got to the end. A script that works only because of
 * something done by hand earlier fails here, at the line that needs it.
 */
export async function checkFromScratch() {
  const { active, tabs } = getState();
  const tab = tabs.find((item) => item.path === active);
  if (!active || !tab || tab.kind === "data") return;
  if (getState().freshCheck?.status === "running") return notify("A check is already running.");
  const text = editor.getText(active);
  const code = isDocument(active) ? codeOnly(text) : text;
  if (!code.trim()) return notify("There is no code here to check.");
  setState({ freshCheck: { file: active, status: "running", line: null, message: "", ran: 0 } });
  try {
    const result = await api.freshCheck(tab.untitled ? null : active, code);
    // Stop, or a closed banner, ends the check, and its late answer is
    // left unshown.
    const check = getState().freshCheck;
    if (!check || check.file !== active || check.status !== "running") return;
    setState({ freshCheck: { file: active, status: result.ok ? "ok" : "failed", line: result.line, message: result.message, ran: result.ran } });
    // The line that failed is underlined, as an error from a run is.
    const failed = result.line !== null ? text.split("\n")[result.line]?.trim() : "";
    if (!result.ok && result.line !== null && failed && getState().tabs.some((item) => item.path === active)) editor.markProblem(active, result.line, failed, 0, "Fails in a new R");
  } catch (error) {
    if (getState().freshCheck?.status !== "running") return;
    setState({ freshCheck: null });
    notify(String(error), "error");
  }
}

/** Stops the check under way. */
export function stopCheck() {
  api.freshStop().catch(() => {});
  setState({ freshCheck: null });
}

/** Closes the check's banner. */
export function dismissCheck() {
  setState({ freshCheck: null });
}

/** Moves to the line the check stopped at, in its file. */
export async function goToCheckLine() {
  const check = getState().freshCheck;
  if (!check || check.line === null) return;
  if (getState().active !== check.file) await openFile(check.file);
  goToLine(check.line);
}
