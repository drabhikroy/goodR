// Then and now: how History lays an earlier version of a script beside the
// script as it is, for any length of script.
//
// A long script with a few changes spread through it would be mostly lines
// that match. So the lines that match fold away, leaving two lines of
// context on either side of each change, and each change is named for the
// section it falls in. Everything here is plain data from two texts, so it
// is quick and can be tested on its own.

import { lineDiff, type Piece } from "./lineDiff";
import type { Block } from "./store";
import type { FileVersion } from "./types";

/** Lines kept in view on each side of a change. */
export const CONTEXT = 2;

export type Change = Exclude<Piece, { kind: "same" }>;
/** A line shown in a column, with its zero based line number in that text. */
export type Line = { n: number; text: string };
/** A matching line, at its place in each text. */
export type Pair = { then: number; now: number; text: string };

export type Segment =
  | { kind: "same"; key: string; lines: Pair[] }
  | { kind: "fold"; key: string; lines: Pair[] }
  | { kind: "change"; key: string; index: number; piece: Change; section: string | null; then: Line[]; now: Line[] };

export type Comparison = { segments: Segment[]; changes: number; sections: number; lines: number };

/** A section, as the outline finds them: its name and its line. */
export type Section = { label: string; line: number };

/** The section a line falls in: the last one that starts on or before it. */
export function sectionAt(sections: Section[], line: number): string | null {
  let found: string | null = null;
  for (const section of sections) {
    if (section.line > line) break;
    found = section.label;
  }
  return found;
}

/**
 * Compares an earlier text with the text now, in segments to show from top
 * to bottom: changes, the matching lines either side of them, and folds of
 * matching lines in between. `sections` are those of the text now.
 */
export function compare(thenText: string, nowText: string, sections: Section[] = []): Comparison {
  const pieces = lineDiff(thenText, nowText);
  const segments: Segment[] = [];
  let index = 0;
  const named = new Set<string | null>();
  pieces.forEach((piece, position) => {
    if (piece.kind === "same") {
      const rows = piece.lines.map((text, step) => ({ then: piece.oldFrom + step, now: piece.newFrom + step, text }));
      // Context goes only where there is a change beside it.
      const head = position > 0 ? CONTEXT : 0;
      const tail = position < pieces.length - 1 ? CONTEXT : 0;
      // Folding one line away would hide nothing worth hiding.
      if (rows.length <= head + tail + 1) {
        segments.push({ kind: "same", key: `s${piece.newFrom}`, lines: rows });
        return;
      }
      if (head) segments.push({ kind: "same", key: `s${piece.newFrom}`, lines: rows.slice(0, head) });
      segments.push({ kind: "fold", key: `f${piece.newFrom + head}`, lines: rows.slice(head, rows.length - tail) });
      if (tail) segments.push({ kind: "same", key: `t${piece.newFrom}`, lines: rows.slice(rows.length - tail) });
      return;
    }
    const section = sectionAt(sections, piece.newFrom);
    named.add(section);
    segments.push({
      kind: "change",
      key: `c${piece.oldFrom}-${piece.newFrom}`,
      index: index++,
      piece,
      section,
      then: piece.before.map((text, step) => ({ n: piece.oldFrom + step, text })),
      now: piece.after.map((text, step) => ({ n: piece.newFrom + step, text })),
    });
  });
  return { segments: index ? segments : [], changes: index, sections: named.size, lines: nowText.split("\n").length };
}

/** "4 changes in 3 sections, 84 lines in all", or less when there is less to say. */
export function describe(comparison: Comparison): string {
  const { changes, sections, lines } = comparison;
  if (!changes) return "No changes";
  const count = `${changes} ${changes === 1 ? "change" : "changes"}`;
  const where = sections > 1 ? ` in ${sections} sections` : "";
  return `${count}${where}, ${lines} ${lines === 1 ? "line" : "lines"} in all`;
}

export type Outcome = "ran" | "failed" | null;

/**
 * How each version fared, newest first like the versions themselves. A
 * version kept because its code ran is "ran". Otherwise a version is
 * "failed" when a line of the file did not run while it was the latest,
 * and has no mark when nothing ran or everything did.
 */
export function outcomes(path: string, versions: FileVersion[], blocks: Block[]): Outcome[] {
  const failures = blocks.filter((block) => block.file === path && block.status === "error" && !block.undone).map((block) => block.started);
  return versions.map((version, index) => {
    if (version.ran) return "ran";
    const until = index === 0 ? Infinity : versions[index - 1].savedAt;
    return failures.some((time) => time >= version.savedAt && time < until) ? "failed" : null;
  });
}

/** The version to compare with first: the newest that differs from now. */
export function firstChoice(versions: { text: string }[], now: string): number {
  const found = versions.findIndex((version) => version.text !== now);
  return found < 0 ? 0 : found;
}

/** The newest version that ran and differs from now, or -1. */
export function lastRan(versions: (FileVersion & { text: string })[], now: string): number {
  return versions.findIndex((version) => version.ran && version.text !== now);
}
