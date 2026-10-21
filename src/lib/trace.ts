// Where did this come from: the actions behind the trace dialog.
//
// The trace of a name is read from the script that makes it: the open
// script in front when it does, or else the first open script that does.
// The reading itself is in lineage.ts. This file picks the script, opens
// the dialog, and runs the lines that depend on a name after a change.

import * as editor from "./editor";
import { goToLine, notify, openDialog, openFile, reprexFor, runRanges } from "./app";
import { planQuestion, type QuestionPlan } from "./question";
import type { Reprex } from "./types";
import { codeOnly, isDocument } from "./chunks";
import { isPlainName } from "./rename";
import { inputsOf, scriptSteps, stepsAfter, stepsBehind, touches, type Step } from "./lineage";
import { getState } from "./store";

export type TraceTarget = { path: string; name: string };
export type Question = { plan: QuestionPlan; error: string; about: Reprex | null };
let question: Question | null = null;
let target: TraceTarget | null = null;

export function currentTrace() {
  return target;
}

export function currentQuestion() {
  return question;
}

function stepsOf(path: string): Step[] {
  const text = editor.getText(path);
  return scriptSteps(isDocument(path) ? codeOnly(text) : text);
}

/** The open script that makes a name: the one in front when it does. */
function scriptFor(name: string): string | null {
  const scripts = getState()
    .tabs.filter((tab) => tab.kind !== "data")
    .map((tab) => tab.path);
  const { active } = getState();
  const ordered = active && scripts.includes(active) ? [active, ...scripts.filter((path) => path !== active)] : scripts;
  return ordered.find((path) => stepsOf(path).some((step) => touches(step, name))) ?? null;
}

/** Opens the trace for a name, or for the name at the cursor. */
export function openTrace(name?: string) {
  const chosen = name ?? editor.wordAtCursor();
  if (!chosen || !isPlainName(chosen)) return notify("Put the cursor on the name of an object, or choose one on the canvas, to see where it came from.");
  const path = scriptFor(chosen);
  if (!path) return notify(`${chosen} is not made in any open script. It may come from the R prompt, another script, or a package.`);
  target = { path, name: chosen };
  openDialog("trace");
}

/** What the dialog shows: the steps behind the name, the names they were
 * made from, and the steps after that depend on it. */
export function traceOf(trace: TraceTarget) {
  const steps = stepsOf(trace.path);
  const behind = stepsBehind(steps, trace.name);
  const last = behind.length ? behind[behind.length - 1].to : -1;
  return { behind, inputs: inputsOf(behind, trace.name).filter((name) => steps.some((step) => touches(step, name))), after: stepsAfter(steps, trace.name, last) };
}

/** Follows the trace on to one of the names a step was made from. */
export function traceInput(name: string) {
  const path = scriptFor(name);
  if (path) target = { path, name };
}

/** Moves to a step's first line, in its script. */
export async function goToStep(path: string, line: number) {
  openDialog(null);
  if (getState().active !== path) await openFile(path);
  goToLine(line);
}

/** Runs again every line after the name that depends on it. */
export function rerunAfter(trace: TraceTarget) {
  const { after } = traceOf(trace);
  openDialog(null);
  runRanges(trace.path, after);
}

/** Ask for help online: writes a forum question from a statement that
 * failed, with the lines behind it and samples of its data from R. */
export async function openAskOnline(blockId: string) {
  const block = getState().blocks[blockId];
  const error = block?.items.find((item) => item.type === "error");
  if (!block || !error || error.type !== "error") return;
  const text = editor.getText(block.file);
  const script = isDocument(block.file) ? codeOnly(text) : text;
  const line = editor.blockLines(block.file).get(blockId) ?? block.toLine;
  const plan = planQuestion(script, block.code, line - (block.toLine - block.fromLine));
  const about = await reprexFor(block.file, Object.keys(plan.roots));
  question = { plan, error: error.message, about };
  openDialog("askOnline");
}
