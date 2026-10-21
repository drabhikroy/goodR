// Turning the results on the canvas into a Quarto report.
//
// After exploring, the results worth keeping are already on the canvas,
// in the order they were made. This writes them out as a Quarto document:
// each result's code in a chunk, in the same order, with the lines that
// printed nothing joined to the next chunk so every chunk ends at
// something to see. The document runs the code again when it renders, so
// the report is made fresh from the data rather than pasted from the
// screen, and it reproduces on any computer.
//
// It reads only the blocks it is given, so it can be tested alone.

import type { Block } from "./store";
import { isQuiet } from "./store";

/** A Quarto document from results, in the order given. Results that did
 * not run, were undone, or were replaced by a later run of the same lines
 * are left out. */
export function reportFromResults(blocks: Block[], title: string, today: string): string {
  const usable = blocks.filter((block) => !block.undone && !block.live && (block.status === "ok" || block.status === "error"));
  // A later run of the same lines in the same file replaces the earlier.
  const latest = usable.filter((block, index) => !usable.slice(index + 1).some((later) => later.file === block.file && later.toLine === block.toLine && later.code === block.code));
  const chunks: { code: string[]; error: boolean; file: string }[] = [];
  let pending: string[] = [];
  let pendingFile = "";
  for (const block of latest) {
    // A change of file starts a new chunk, so its heading can say where
    // the code came from.
    if (pending.length && pendingFile !== block.file) {
      chunks.push({ code: pending, error: false, file: pendingFile });
      pending = [];
    }
    pendingFile = block.file;
    pending.push(block.code);
    if (!isQuiet(block) || block.status === "error") {
      chunks.push({ code: pending, error: block.status === "error", file: block.file });
      pending = [];
    }
  }
  if (pending.length) chunks.push({ code: pending, error: false, file: pendingFile });

  const out = [
    "---",
    `title: "${title.replace(/\\/g, "\\\\").replace(/"/g, "'")}"`,
    `date: ${today}`,
    "format: html",
    "---",
    "",
    "Written from the results on the canvas, in the order they were made. Each chunk runs again when this renders, so what it shows comes fresh from the data.",
    "",
    "Replace this paragraph with what the results mean.",
  ];
  let lastFile = "";
  for (const chunk of chunks) {
    const name = chunk.file.split(/[\\/]/).pop() ?? chunk.file;
    if (chunk.file !== lastFile && !chunk.file.startsWith("untitled:")) out.push("", `## From ${name}`);
    lastFile = chunk.file;
    out.push("", "```{r}");
    // A result that failed still shows its error, rather than stopping
    // the whole report at it.
    if (chunk.error) out.push("#| error: true");
    out.push(...chunk.code, "```");
  }
  return `${out.join("\n")}\n`;
}
