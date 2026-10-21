// Why a report did not render, in plain words.
//
// The rules are the console's own, from errors.ts, so an error reads the
// same in a report as anywhere else. What a render adds is the chunk: knitr
// names the lines of the chunk that stopped, and the console's rules then
// find the part of that chunk that failed, so the exact line can be marked.
// This file depends on nothing but errors.ts, so it can be tested alone.

import { explainError, type Explained } from "./errors";
import type { RenderFailure } from "./types";

/** Something to press that resolves the failure, when there is one. */
export type RenderAction = { label: string; kind: "install"; name: string } | { label: string; kind: "quarto" | "chooseR" | "pdf" | "again" };

/** A failure in plain words, with the spot in the file when one is known.
 * `where.line` counts from zero, as the editor does. */
export type RenderExplained = {
  title: string;
  detail: string;
  hint?: string;
  action?: RenderAction;
  where?: { line: number; text: string; from: number };
  /** The program's own message, kept one click away. */
  original?: string;
  /** The chunk that failed, for the heading over the code. */
  chunk?: string;
};

/** Explains why a render did not finish. `text` is the report, as the
 * editor holds it, for finding the failing line. */
export function explainRender(failure: RenderFailure, text: string): RenderExplained {
  switch (failure.kind) {
    case "noQuarto":
      return {
        title: "Quarto is not on this computer yet",
        detail: "Quarto turns .qmd files into finished reports, and makes PDFs without needing LaTeX. It is free, comes from Posit, and installs like any other app.",
        hint: "Install it from quarto.org, then render again.",
        action: { label: "Get Quarto", kind: "quarto" },
      };
    case "noPandoc":
      return {
        title: "R Markdown needs Pandoc, which is not on this computer",
        detail: "Pandoc converts the finished document into HTML, Word, or PDF. Quarto comes with its own copy, and the app uses it whenever Quarto is installed.",
        hint: "Install Quarto from quarto.org, then render again.",
        action: { label: "Get Quarto", kind: "quarto" },
      };
    case "noR":
      return {
        title: "The R chosen for this app could not be found",
        detail: "Reports render with the same R as the console. It may have been moved or removed since it was chosen.",
        action: { label: "Choose R version", kind: "chooseR" },
      };
    case "latex":
      return {
        title: "This PDF needs LaTeX, which is not set up",
        detail: "The document's header asks for a PDF made with LaTeX, a large typesetting system that is installed separately.",
        hint: "Choose Render as PDF instead. It makes the PDF with Typst, which comes with Quarto, so nothing else needs installing.",
        action: { label: "Render as PDF", kind: "pdf" },
      };
    case "stopped":
      return { title: "Rendering stopped", detail: "Nothing in your script changed. Render again when you are ready.", action: { label: "Render again", kind: "again" } };
    case "notReport":
      return { title: "Only Quarto and R Markdown files render", detail: "Rendering works on .qmd and .Rmd files. Scripts run with Run line or Run file instead." };
    case "chunk":
      return explainChunk(failure, text);
    case "other": {
      const explained = explainError(failure.message, [], "");
      return { ...fromExplained(explained), original: failure.message };
    }
  }
}

/** The parts of a console explanation a render can use. */
function fromExplained(explained: Explained): RenderExplained {
  const fix = explained.fix;
  const action: RenderAction | undefined = fix?.kind === "install" ? { label: fix.label, kind: "install", name: fix.name } : undefined;
  return { title: explained.title, detail: explained.detail, hint: explained.hint, action };
}

/**
 * Explains a chunk that stopped. knitr names the chunk's lines, and the
 * same rules as the console find the part of the code that failed, so the
 * exact line inside the chunk can be marked.
 */
function explainChunk(failure: Extract<RenderFailure, { kind: "chunk" }>, text: string): RenderExplained {
  const lines = text.split("\n");
  // knitr's range runs from the first line of code to the closing fence.
  const first = Math.max(0, failure.from - 1);
  const last = Math.max(first, failure.to - 2);
  const code = lines.slice(first, last + 1).join("\n");
  const explained = explainError(failure.message, [], code);
  const base = fromExplained(explained);
  // A report starts from nothing, so a name made only in the console is
  // missing there, which surprises people who just saw it work.
  const clean = /object '.*' not found|could not find function/.test(failure.message)
    ? " Reports run from a clean start in their own R, so objects made in the console are not there. Create it in a chunk above this one."
    : "";
  const spot = explained.where;
  const where = spot
    ? { line: first + spot.line, text: (lines[first + spot.line] ?? "").slice(spot.from, spot.to), from: spot.from }
    : { line: first, text: (lines[first] ?? "").trim(), from: Math.max(0, (lines[first] ?? "").search(/\S/)) };
  const chunk = failure.label && !/^unnamed-chunk/.test(failure.label) ? `the chunk named ${failure.label}` : "a chunk";
  return { ...base, detail: `${base.detail}${clean}`, where: where.text ? where : undefined, original: failure.message, chunk };
}
