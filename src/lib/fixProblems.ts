// Fix problems: everything in a script that can be put right, in one list.
//
// Three kinds of problem are gathered. Retired code, found by reading the
// script and by reading the deprecation warnings R printed when it ran.
// Habits that cause trouble later, the same ones the editor underlines.
// And lines that failed, with the fix the error explanation found, such as
// a misspelled name. Each comes with what it changes, so the user can
// untick any of them before one press fixes the rest. The fixes go in as
// one edit, so one Undo takes them all back.

import * as editor from "./editor";
import { notify, openDialog, sessionOfFile } from "./app";
import { codeOnly, isDocument } from "./chunks";
import { explainError } from "./errors";
import { findHints, type Hint } from "./hints";
import { findOutdated, fixesFromWarnings } from "./outdated";
import { getState } from "./store";

export type Problem = Hint & { kind: "outdated" | "habit" | "failed"; id: string };

let target: { path: string; problems: Problem[] } | null = null;

export function currentProblems() {
  return target;
}

/** Every problem in a file, in line order, one per spot. */
export function problemsIn(path: string): Problem[] {
  const text = editor.getText(path);
  const code = isDocument(path) ? codeOnly(text) : text;
  const lines = code.split("\n");
  const found: Problem[] = [];
  const seen = new Set<string>();
  const add = (kind: Problem["kind"], hint: Hint) => {
    const id = `${hint.line}:${hint.from}`;
    if (seen.has(id)) return;
    seen.add(id);
    found.push({ ...hint, kind, id });
  };
  for (const hint of findOutdated(code)) add("outdated", hint);
  // Results from the last run, while their code still reads the same in
  // the file, since a fix made from older code could land in the wrong place.
  for (const block of Object.values(getState().blocks)) {
    if (block.file !== path) continue;
    const end = editor.blockLines(path).get(block.id) ?? block.toLine;
    const start = end - (block.toLine - block.fromLine);
    if (lines.slice(start, end + 1).join("\n") !== block.code) continue;
    const warnings = block.items.map((item) => (item.type === "stream" && item.name === "stderr" ? item.text : "")).join("\n");
    for (const hint of fixesFromWarnings(block.code, warnings)) add("outdated", { ...hint, line: hint.line + start });
    const error = block.items.find((item) => item.type === "error");
    if (block.status !== "error" || !error || error.type !== "error") continue;
    const plain = explainError(error.message, getState().objects, block.code, error.traceback, error.parsed ?? "");
    const fix = plain.fix?.kind === "replace" ? plain.fix : null;
    const spot = fix ? lines.slice(start, end + 1).map((row, at) => ({ at, col: row.search(new RegExp(`(?<![\\w.])${fix.from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w.])`)) })).find((item) => item.col >= 0) : null;
    if (fix && spot) add("failed", { line: start + spot.at, from: spot.col, to: spot.col + fix.from.length, title: plain.title, detail: plain.detail, fix: fix.to });
    else add("failed", { line: start, from: 0, to: 0, title: plain.title, detail: `${plain.detail}${plain.hint ? ` ${plain.hint}` : ""}` });
  }
  if (getState().settings.hints) for (const hint of findHints(code, sessionOfFile(path).startsWith("project:"))) add("habit", hint);
  return found.sort((a, b) => a.line - b.line || a.from - b.from);
}

/** Opens the list of problems for the file in front. */
export function openFixProblems() {
  const { active } = getState();
  if (!active || active.startsWith("data:")) return notify("Open a script to look for problems in it.");
  const problems = problemsIn(active);
  if (!problems.length) return notify("No problems found in this script. Run it to catch anything that only shows when it runs.");
  target = { path: active, problems };
  openDialog("fixProblems");
}

/** Applies the chosen fixes as one edit, and says how many went in. */
export function applyProblemFixes(path: string, chosen: Problem[]) {
  const spans = chosen.filter((problem) => problem.fix !== undefined).map((problem) => ({ line: problem.line, from: problem.from, to: problem.to, text: problem.fix! }));
  editor.replaceSpans(path, spans);
  openDialog(null);
  notify(`Fixed ${spans.length === 1 ? "one problem" : `${spans.length} problems`}. Undo takes ${spans.length === 1 ? "it" : "them all"} back. Run the script again to check.`);
}
