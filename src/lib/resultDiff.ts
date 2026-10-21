// What changed between two runs of the same line.
//
// After an edit upstream, such as a filter tightened or a typo fixed, the
// same line is run again and its result looks much as before. Spotting
// that a mean moved from 4201 to 4207, or that a table lost a row, means
// holding the old result in memory and comparing by eye. This compares
// for the user: numbers that moved, printed lines that came or went,
// objects that grew or shrank, and whether the plot changed.
//
// It reads only the two results it is given, so it can be tested alone.

import type { OutputItem } from "./store";

/** One number that moved, with the line it is on for context. */
export type NumberChange = { before: string; after: string; line: string };

/** The difference between two results of a line. `same` is true when
 * nothing that can be compared changed. */
export type Difference = {
  same: boolean;
  numbers: NumberChange[];
  added: string[];
  removed: string[];
  objects: { name: string; before: string; after: string }[];
  plot: { before: string; after: string } | null;
};

const NUMBER = /-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi;
// Long output is compared only in part, so a huge print stays quick.
const MAX_LINES = 400;

function textOf(items: OutputItem[]): string[] {
  return items
    .filter((item) => item.type === "stream" || item.type === "value")
    .map((item) => ("text" in item ? item.text : ""))
    .join("")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line, index, all) => line !== "" || index < all.length - 1)
    .slice(0, MAX_LINES);
}

function lastPlot(items: OutputItem[]): string | null {
  for (let k = items.length - 1; k >= 0; k -= 1) {
    const item = items[k];
    if (item.type === "plot") return item.png;
  }
  return null;
}

/** The lines only in `a` and only in `b`, by their longest common run. */
function lineDiff(a: string[], b: string[]): { removed: string[]; added: string[] } {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table = new Uint16Array(rows * cols);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * cols + j] = a[i] === b[j] ? table[(i + 1) * cols + j + 1] + 1 : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
    }
  }
  const removed: string[] = [];
  const added: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
    } else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) removed.push(a[i++]);
    else added.push(b[j++]);
  }
  return { removed: [...removed, ...a.slice(i)], added: [...added, ...b.slice(j)] };
}

/** Numbers that moved, when the two outputs have the same lines with only
 * numbers different, as when a summary is run again on changed data. */
function numberChanges(a: string[], b: string[]): NumberChange[] | null {
  if (a.length !== b.length) return null;
  const changes: NumberChange[] = [];
  for (let k = 0; k < a.length; k += 1) {
    if (a[k] === b[k]) continue;
    if (a[k].replace(NUMBER, "#") !== b[k].replace(NUMBER, "#")) return null;
    const before = a[k].match(NUMBER) ?? [];
    const after = b[k].match(NUMBER) ?? [];
    before.forEach((value, index) => {
      if (value !== after[index]) changes.push({ before: value, after: after[index], line: b[k].trim() });
    });
  }
  return changes;
}

/** Compares a line's last result with its new one, and the objects it
 * made or changed, by their summaries before and after. */
export function compareResults(before: OutputItem[], after: OutputItem[], objectsBefore: Record<string, string>, objectsAfter: Record<string, string>): Difference {
  const a = textOf(before);
  const b = textOf(after);
  const numbers = numberChanges(a, b);
  const { removed, added } = numbers ? { removed: [], added: [] } : lineDiff(a, b);
  const objects = Object.keys(objectsBefore)
    .filter((name) => name in objectsAfter && objectsBefore[name] !== objectsAfter[name])
    .map((name) => ({ name, before: objectsBefore[name], after: objectsAfter[name] }));
  const plotBefore = lastPlot(before);
  const plotAfter = lastPlot(after);
  const plot = plotBefore && plotAfter && plotBefore !== plotAfter ? { before: plotBefore, after: plotAfter } : null;
  const found = numbers ?? [];
  return { same: !found.length && !removed.length && !added.length && !objects.length && !plot, numbers: found.slice(0, 12), removed: removed.slice(0, 20), added: added.slice(0, 20), objects, plot };
}

/** The difference in a few words, for the line that opens it. */
export function differenceSummary(diff: Difference): string {
  if (diff.same) return "Same as last time";
  const parts: string[] = [];
  if (diff.numbers.length) parts.push(diff.numbers.length === 1 ? "1 number moved" : `${diff.numbers.length} numbers moved`);
  const lines = diff.added.length + diff.removed.length;
  if (lines) parts.push(lines === 1 ? "1 line differs" : `${lines} lines differ`);
  for (const item of diff.objects) parts.push(`${item.name} changed`);
  if (diff.plot) parts.push("the plot changed");
  return `Since last time: ${parts.join(", ")}`;
}
