// Earlier versions of a file: the actions behind the history dialog.
//
// The app keeps a copy each time a script is saved. The dialog compares
// any of those with the file as it is now, and can put back one changed
// part or the whole version. Either is a single edit in the script, so
// Undo takes it back, and nothing is saved until the user saves.

import * as editor from "./editor";
import { baseName, goToLine, loadFileVersions, notify, openDialog } from "./app";
import type { Piece } from "./lineDiff";
import { getState } from "./store";
import type { FileVersion } from "./types";

export type Versions = { path: string; versions: (FileVersion & { text: string })[] };
let target: Versions | null = null;

export function currentVersions() {
  return target;
}

/** Opens the earlier versions of the file in front. */
export async function openFileHistory() {
  const { active } = getState();
  if (!active || active.startsWith("data:")) return notify("Open a script to see its earlier versions.");
  if (active.startsWith("untitled:")) return notify("This script has not been saved yet. Each save keeps a version you can come back to.");
  const versions = await loadFileVersions(active);
  if (!versions.length) return notify(`No earlier versions of ${baseName(active)} yet. Each save from now on keeps one.`);
  target = { path: active, versions };
  openDialog("fileHistory");
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
