// Error rescue: when a line fails that worked before, offer the version of
// it that last worked.
//
// Every run is kept as a result with its code, so the line as it last ran
// without a problem is already known. It is found among the earlier
// results of the same file that ran fine, whose code is no longer in the
// script (it was edited since), and that look like the failing line. Only
// the failing lines are put back, as one edit that Undo takes back.

import type { Block } from "./store";

/** The words, names, numbers, and symbols of some code, for comparing. */
function tokens(code: string): string[] {
  return code.match(/[A-Za-z_.][\w.]*|\d+(?:\.\d+)?|"[^"]*"|'[^']*'|[^\s\w]/g) ?? [];
}

/** Pairs of neighboring characters, spaces aside, so a misspelled name
 * still looks like the name it was. */
function pairs(code: string): string[] {
  const text = code.replace(/\s+/g, "");
  return Array.from({ length: Math.max(0, text.length - 1) }, (_, index) => text.slice(index, index + 2));
}

/** The Dice coefficient of two lists, counting repeats: 1 when they hold
 * the same items, 0 when they share none. */
function dice(x: string[], y: string[]): number {
  if (!x.length || !y.length) return 0;
  const counts = new Map<string, number>();
  for (const token of x) counts.set(token, (counts.get(token) ?? 0) + 1);
  let shared = 0;
  for (const token of y) {
    const left = counts.get(token) ?? 0;
    if (left > 0) {
      shared += 1;
      counts.set(token, left - 1);
    }
  }
  return (2 * shared) / (x.length + y.length);
}

/** How alike two pieces of code are, from 0 to 1: by the names and symbols
 * they share, or by their letters, whichever says more alike. The letters
 * catch a one word line with a slip in it, such as valeu for value. */
export function likeness(a: string, b: string): number {
  return Math.max(dice(tokens(a), tokens(b)), dice(pairs(a), pairs(b)));
}

/** Whether some code is still in the script as whole lines. */
function stillThere(code: string, script: string) {
  const tidy = (text: string) => text.split("\n").map((line) => line.trimEnd()).join("\n");
  return `\n${tidy(script)}\n`.includes(`\n${tidy(code)}\n`);
}

/** Below this, an earlier line is too unlike the failing one to be its
 * earlier version. */
export const ALIKE = 0.5;

/**
 * The earlier result whose code is the failing line as it last worked, or
 * null. `script` is the file's text now.
 */
export function workedBefore(failed: Block, blocks: Block[], script: string): Block | null {
  if (failed.status !== "error" || failed.undone) return null;
  let best: Block | null = null;
  for (const block of blocks) {
    if (block.file !== failed.file || block.status !== "ok" || block.undone || block.started >= failed.started) continue;
    const code = block.code.trim();
    if (!code || code === failed.code.trim() || stillThere(block.code, script)) continue;
    if (likeness(block.code, failed.code) < ALIKE) continue;
    // Of the lines alike enough, the one that ran last is how it last worked.
    if (!best || block.started > best.started) best = block;
  }
  return best;
}
