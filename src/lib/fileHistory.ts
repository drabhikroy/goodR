// History: what a script was like before, beside what it is now, and the
// actions behind the History window and error rescue.
//
// The app keeps a version of a script each time it is saved, and each time
// its code runs without a problem. History compares any of those with the
// script as it is now, and can put back one changed part or the whole
// version. Either is a single edit in the script, so Undo takes it back,
// and nothing is saved until the user saves.

import * as editor from "./editor";
import { announce, goToLine, loadFileVersions, notify, openDialog, outlineOf } from "./app";
import type { Piece } from "./lineDiff";
import { workedBefore } from "./rescue";
import { getState } from "./store";
import type { FileVersion } from "./types";

export type Version = FileVersion & { text: string };
export type Versions = { path: string; versions: Version[] };
export type HistoryTab = "script" | "commands";

let target: Versions | null = null;
let firstTab: HistoryTab = "script";

/** The versions History is showing, newest first, or null for none. */
export function currentVersions() {
  return target;
}

/** The tab History opens on. */
export function openingTab() {
  return firstTab;
}

/** Whether a path is a script History can keep versions of. */
function hasVersions(path: string | null): path is string {
  return Boolean(path && !path.startsWith("data:") && !path.startsWith("untitled:"));
}

/** Opens History on the script in front, or on the commands typed at the
 * console. With no saved script in front, the script tab says why. */
export async function openHistory(tab: HistoryTab = "script", path: string | null = getState().active) {
  firstTab = tab;
  target = hasVersions(path) ? { path, versions: await loadFileVersions(path) } : null;
  openDialog("history");
}

/** Opens History on the script in front. */
export function openFileHistory() {
  return openHistory("script");
}

/** The sections of a script now, to name where each change is. */
export function sectionsOf(path: string, text: string) {
  return outlineOf(text, /\.(qmd|Rmd|rmd|md)$/.test(path));
}

/** When a version was saved, in words: today, yesterday, or the date. */
export function savedWhen(time: number, now = Date.now()) {
  const date = new Date(time);
  const clock = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const day = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((day(new Date(now)) - day(date)) / 86_400_000);
  if (days === 0) return `Today, ${clock}`;
  if (days === 1) return `Yesterday, ${clock}`;
  return `${date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: date.getFullYear() === new Date(now).getFullYear() ? undefined : "numeric" })}, ${clock}`;
}

/** When something happened, to go inside a sentence: "today at 2:40 PM",
 * "yesterday at 9:12 AM", or "on Nov 3 at 4:05 PM". */
export function whenWords(time: number, now = Date.now()) {
  const said = savedWhen(time, now);
  const [day, clock] = said.split(", ").length > 2 ? [said.slice(0, said.lastIndexOf(", ")), said.slice(said.lastIndexOf(", ") + 2)] : said.split(", ");
  if (day === "Today") return `today at ${clock}`;
  if (day === "Yesterday") return `yesterday at ${clock}`;
  return `on ${day} at ${clock}`;
}

/** The time of day alone, for the marks under History's slider. */
export function clockTime(time: number) {
  return new Date(time).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Puts one changed part back as it was in the earlier version. */
export function putBack(path: string, piece: Piece) {
  if (piece.kind === "same") return;
  editor.spliceLines(path, piece.newFrom, piece.after.length, piece.before);
  goToLine(piece.newFrom);
}

/** Replaces the whole script with an earlier version, as one edit. Results
 * under the old lines go with them, since those lines are gone. */
export function restoreVersion(path: string, text: string) {
  const count = editor.getText(path).split("\n").length;
  editor.replaceLines(path, 0, count - 1, text);
  openDialog(null);
  notify("The earlier version is back in the script. Undo returns to what you had, and nothing is saved until you save.");
}

/** Copies lines, as a whole version or one part of it. */
export async function copyLines(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    notify("Copied.");
  } catch {
    notify("Could not copy. Select the lines and copy them instead.", "error");
  }
}

// Error rescue.

/** What a failed line was when it last worked, and where it is now. */
export type Rescue = { then: string; now: string; at: number; fromLine: number; toLine: number };

/**
 * The version of a failed line that last ran without a problem, when there
 * is one and the line is still as it was when it failed. Null otherwise.
 */
export function rescueFor(blockId: string): Rescue | null {
  const { blocks } = getState();
  const failed = blocks[blockId];
  if (!failed || failed.status !== "error" || !failed.file) return null;
  const text = editor.getText(failed.file);
  const anchor = editor.blockLines(failed.file).get(blockId);
  if (anchor === undefined) return null;
  const fromLine = anchor - (failed.toLine - failed.fromLine);
  // Edited since it failed: what is there now is the person's own fix.
  if (fromLine < 0 || text.split("\n").slice(fromLine, anchor + 1).join("\n") !== failed.code) return null;
  const earlier = workedBefore(failed, Object.values(blocks), text);
  return earlier ? { then: earlier.code, now: failed.code, at: earlier.started, fromLine, toLine: anchor } : null;
}

/** Puts a failed line back as it last worked, as one edit Undo reverses. */
export function applyRescue(path: string, rescue: Rescue) {
  editor.replaceLines(path, rescue.fromLine, rescue.toLine, rescue.then);
  announce("Put back as it last worked. Run the line again to check it.");
  notify("Put back as it last worked. Run the line again to check it, or Undo to take it back.");
}
