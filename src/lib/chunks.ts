// Chunks in R Markdown and Quarto documents, and sections in R scripts.
//
// A document mixes prose with code chunks. Only the R chunks run, so the
// prose is blanked out before the statement splitter sees the text. Lines
// keep their numbers, so every result still lands under the line that made
// it. An R script has no chunks, but its section comments, such as
// "# Clean ----", divide it the same way, and Run chunk runs the section
// the cursor is in. This file depends on nothing, so it can be tested alone.

/** One fenced chunk. Lines count from zero. `from` and `to` are the first
 * and last lines of code between the fences, and `to` is less than `from`
 * for an empty chunk. `close` is the closing fence, or the last line of a
 * document whose chunk was never closed. */
export type Chunk = { label: string; engine: string; fence: number; from: number; to: number; close: number };

/** A run of lines, inclusive, counting from zero. */
export type Span = { from: number; to: number };

/** Whether a file is an R Markdown or Quarto document, by its name. */
export function isDocument(path: string | null | undefined): boolean {
  return Boolean(path && /\.(qmd|Rmd|rmd)$/.test(path));
}

// An executable chunk's header: three or more backticks, then the engine
// in braces, as in ```{r} or ```{r plot-it, echo=FALSE}.
const HEADER = /^\s*(`{3,})\s*\{\s*([A-Za-z]+)(?:[\s,]+([^,}=\s]+)(?=[,}\s]))?[^}]*\}\s*$/;

/** Every fenced chunk in a document, in order. */
export function chunksOf(text: string): Chunk[] {
  const lines = text.split("\n");
  const chunks: Chunk[] = [];
  for (let line = 0; line < lines.length; line += 1) {
    const header = HEADER.exec(lines[line]);
    if (!header) continue;
    const ticks = header[1].length;
    // A fence closes with at least as many backticks as opened it.
    let close = lines.length - 1;
    for (let next = line + 1; next < lines.length; next += 1) {
      const fence = /^\s*(`{3,})\s*$/.exec(lines[next]);
      if (fence && fence[1].length >= ticks) {
        close = next;
        break;
      }
    }
    const closed = close < lines.length && /^\s*`{3,}\s*$/.test(lines[close]) && close > line;
    // Quarto puts a chunk's label inside it, as "#| label: name".
    const option = lines.slice(line + 1, close).map((text) => /^#\|\s*label:\s*(\S+)/.exec(text)?.[1]).find(Boolean);
    const label = header[3] && !header[3].includes("=") ? header[3] : option ?? "";
    chunks.push({ label, engine: header[2].toLowerCase(), fence: line, from: line + 1, to: closed ? close - 1 : close, close });
    line = close;
  }
  return chunks;
}

/** The document with everything but R chunk code replaced by empty lines,
 * so the statement splitter sees only code and line numbers hold. */
export function codeOnly(text: string): string {
  const lines = text.split("\n");
  const keep = new Array<boolean>(lines.length).fill(false);
  for (const chunk of chunksOf(text)) {
    if (chunk.engine !== "r") continue;
    for (let line = chunk.from; line <= chunk.to; line += 1) keep[line] = true;
  }
  // Quarto's "#|" chunk options are comments to R, but blanking them keeps
  // them from being sent along with the first statement.
  return lines.map((line, index) => (keep[index] && !/^#\|/.test(line) ? line : "")).join("\n");
}

/** The chunk a line belongs to, counting its fences, or null in prose. */
export function chunkAt(chunks: Chunk[], line: number): Chunk | null {
  return chunks.find((chunk) => line >= chunk.fence && line <= chunk.close) ?? null;
}

// A section comment, as RStudio writes them: a comment that ends in four
// or more dashes, equals signs, or hashes.
const SECTION = /^\s*#+\s*.*?(?:-{4,}|={4,}|#{4,})\s*$/;

/** The section of an R script a line is in: from its section comment, or
 * the top of the file, to the line before the next section comment. */
export function sectionAt(text: string, line: number): Span {
  const lines = text.split("\n");
  let from = 0;
  for (let at = Math.min(line, lines.length - 1); at >= 0; at -= 1) {
    if (SECTION.test(lines[at])) {
      from = at;
      break;
    }
  }
  let to = lines.length - 1;
  for (let at = Math.max(line, from) + 1; at < lines.length; at += 1) {
    if (SECTION.test(lines[at])) {
      to = at - 1;
      break;
    }
  }
  return { from, to };
}

/** Whether a script has any section comments at all. */
export function hasSections(text: string): boolean {
  return text.split("\n").some((line) => SECTION.test(line));
}

/** What a new document holds, for the New document dialog. */
export type DocumentKind = "quarto" | "rmarkdown";
export type DocumentFormat = "html" | "word" | "pdf";

/**
 * A new document's text: a header with the title and format, and a first
 * chunk to edit, so the document renders as soon as it is made. Quarto's
 * PDF is made with Typst, which needs no LaTeX. R Markdown's PDF needs
 * LaTeX, so its PDF documents say how to get one without it.
 */
export function newDocumentText(kind: DocumentKind, title: string, author: string, format: DocumentFormat): string {
  const name = title.trim() || "Untitled";
  const quoted = (text: string) => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  const header = [`title: ${quoted(name)}`];
  if (author.trim()) header.push(`author: ${quoted(author.trim())}`);
  if (kind === "quarto") {
    header.push(`format: ${{ html: "html", word: "docx", pdf: "typst" }[format]}`);
  } else {
    header.push(`output: ${{ html: "html_document", word: "word_document", pdf: "pdf_document" }[format]}`);
  }
  const setup = kind === "quarto" ? "```{r}\n#| label: setup\n#| include: false\nlibrary(stats)\n```" : "```{r setup, include=FALSE}\nlibrary(stats)\n```";
  // quakes, 1,000 earthquakes near Fiji, comes with R, so a new document
  // renders at once without a data file.
  const first = kind === "quarto" ? "```{r}\n#| label: summary\nsummary(quakes$mag)\n```" : "```{r summary}\nsummary(quakes$mag)\n```";
  const plot =
    kind === "quarto"
      ? "```{r}\n#| label: fig-quakes\n#| fig-cap: \"Earthquakes near Fiji, larger circles for stronger ones\"\nplot(lat ~ long, data = quakes, cex = quakes$mag - 3)\n```"
      : "```{r quake-map, fig.cap=\"Earthquakes near Fiji, larger circles for stronger ones\"}\nplot(lat ~ long, data = quakes, cex = quakes$mag - 3)\n```";
  return [
    "---",
    ...header,
    "---",
    "",
    setup,
    "",
    "## Overview",
    "",
    "Write here. Text between chunks is the report's prose, and each chunk's",
    "results appear below it when the document renders.",
    "",
    first,
    "",
    "## A figure",
    "",
    plot,
    "",
  ].join("\n");
}

/** A file name for a new document, from its title. */
export function documentFileName(kind: DocumentKind, title: string): string {
  const base = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "untitled";
  return `${base}.${kind === "quarto" ? "qmd" : "Rmd"}`;
}

/** The id Pandoc, and so Quarto and R Markdown, gives a heading: lower
 * case, with spaces as hyphens, punctuation left out, and anything before
 * the first letter dropped. */
export function headingId(text: string) {
  return (
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_.-]/gu, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/^[^\p{L}]+/u, "") || "section"
  );
}
