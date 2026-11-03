import { describe, expect, it } from "vitest";
import { chunkAt, chunksOf, codeOnly, documentFileName, hasSections, headingId, newDocumentText, sectionAt } from "../../src/lib/chunks";
import { statementRanges } from "../../src/lib/statements";

// Line numbers below count from zero, as the editor does.
const RMD = [
  "---", // 0
  'title: "Test"', // 1
  "output: html_document", // 2
  "---", // 3
  "", // 4
  "Some prose with x <- 1 in it.", // 5
  "", // 6
  "```{r setup, include=FALSE}", // 7
  "x <- 1:3", // 8
  "```", // 9
  "", // 10
  "```{python}", // 11
  "print('not R')", // 12
  "```", // 13
  "", // 14
  "```{r}", // 15
  "#| label: totals", // 16
  "mean(x)", // 17
  "sum(x)", // 18
  "```", // 19
].join("\n");

describe("chunksOf", () => {
  it("finds each chunk, its engine, its label, and its code lines", () => {
    const chunks = chunksOf(RMD);
    expect(chunks).toEqual([
      { label: "setup", engine: "r", fence: 7, from: 8, to: 8, close: 9 },
      { label: "", engine: "python", fence: 11, from: 12, to: 12, close: 13 },
      { label: "totals", engine: "r", fence: 15, from: 16, to: 18, close: 19 },
    ]);
    expect(chunkAt(chunks, 17)?.label).toBe("totals");
    expect(chunkAt(chunks, 15)?.label).toBe("totals");
    expect(chunkAt(chunks, 5)).toBeNull();
  });

  it("reads a label given as an option, and an unclosed chunk to the end", () => {
    expect(chunksOf("```{r label='fig', echo=FALSE}\n1\n```")[0].label).toBe("");
    const open = chunksOf("```{r}\n1 + 1\n2 + 2");
    expect(open[0]).toMatchObject({ from: 1, to: 2, close: 2 });
  });

  // The cases below come from comparing these chunks with knitr's own
  // reading of 651 R Markdown and Quarto documents installed with R
  // packages. Each is a header knitr runs that was once missed or misread.
  it("finds a chunk whose options hold a closing brace, as a LaTeX label in a caption does", () => {
    const text = ["```{r disp, echo=FALSE, fig.cap='\\\\label{fig:spam}Sparsity of a matrix.'}", "display(m)", "```"].join("\n");
    expect(chunksOf(text)).toEqual([{ label: "disp", engine: "r", fence: 0, from: 1, to: 1, close: 2 }]);
    expect(codeOnly(text).split("\n")[1]).toBe("display(m)");
    const braces = chunksOf('```{r fig.cap="Mean of {x} by group"}\nplot(x)\n```');
    expect(braces).toHaveLength(1);
    expect(braces[0].label).toBe("");
  });

  it("reads a label in quotes the way knitr does, without the quotes", () => {
    // knitr:::parse_params gives my-label for both, and no label for echo=FALSE.
    expect(chunksOf('```{r "my-label", echo=FALSE}\n1\n```')[0].label).toBe("my-label");
    expect(chunksOf("```{r 'q'}\n1\n```")[0].label).toBe("q");
    expect(chunksOf("```{r my-label}\n1\n```")[0].label).toBe("my-label");
    expect(chunksOf("```{r echo=FALSE}\n1\n```")[0].label).toBe("");
  });

  it("follows an engine named in the options, so C++ written in an r chunk is not run as R", () => {
    const text = '```{r attribs, engine = "cpp11"}\nusing namespace cpp11;\n```\n\n```{r}\nx <- 1\n```';
    expect(chunksOf(text).map((chunk) => chunk.engine)).toEqual(["cpp11", "r"]);
    expect(codeOnly(text).split("\n")).toEqual(["", "", "", "", "", "x <- 1", ""]);
  });

  it("ends a chunk at the next chunk header when its closing fence was left out, as knitr does", () => {
    const text = ["```{r first}", "fit <- lm(dist ~ speed, data = cars)", "```{r second, results='asis'}", "coef(fit)", "```"].join("\n");
    const chunks = chunksOf(text);
    expect(chunks.map((chunk) => [chunk.label, chunk.from, chunk.to])).toEqual([
      ["first", 1, 1],
      ["second", 3, 3],
    ]);
    // The header line itself is never sent to R.
    expect(codeOnly(text).split("\n")[2]).toBe("");
  });

  it("blanks Quarto's #| option lines, so they are never sent along with the first statement", () => {
    const code = codeOnly("```{r}\n#| label: totals\n#| echo: false\nmean(x)\n```").split("\n");
    expect(code).toEqual(["", "", "", "mean(x)", ""]);
  });

  it("keeps a chunk header shown as text inside a longer fence as part of that chunk", () => {
    const text = ["````{r, eval=FALSE}", "```{r}", "1 + 1", "```", "````"].join("\n");
    expect(chunksOf(text)).toEqual([{ label: "", engine: "r", fence: 0, from: 1, to: 3, close: 4 }]);
  });
});

describe("codeOnly", () => {
  it("keeps only R chunk code, so prose and other languages never run", () => {
    const code = codeOnly(RMD);
    expect(code.split("\n")).toHaveLength(RMD.split("\n").length);
    // Each statement stays on its own line, so results land beside it.
    expect(statementRanges(code)).toEqual([
      { from: 8, to: 8 },
      { from: 17, to: 17 },
      { from: 18, to: 18 },
    ]);
  });
});

describe("sectionAt", () => {
  const SCRIPT = ["library(stats)", "", "# Clean ----", "x <- 1", "y <- 2", "", "# Model ----", "fit <- lm(y ~ x)"].join("\n");

  it("spans from the section comment to the line before the next", () => {
    expect(hasSections(SCRIPT)).toBe(true);
    expect(sectionAt(SCRIPT, 4)).toEqual({ from: 2, to: 5 });
    expect(sectionAt(SCRIPT, 7)).toEqual({ from: 6, to: 7 });
    // Lines above the first section form a section of their own.
    expect(sectionAt(SCRIPT, 0)).toEqual({ from: 0, to: 1 });
    expect(hasSections("x <- 1\n# just a comment\n")).toBe(false);
  });
});

describe("new documents", () => {
  it("writes a Quarto header with the chosen format, and chunks that parse as chunks", () => {
    const text = newDocumentText("quarto", 'Penguin "study"', "Ada", "pdf");
    expect(text).toContain('title: "Penguin \\"study\\""');
    expect(text).toContain('author: "Ada"');
    // Typst makes the PDF, so no LaTeX is needed.
    expect(text).toContain("format: typst");
    expect(chunksOf(text).map((chunk) => chunk.label)).toEqual(["setup", "summary", "fig-quakes"]);
  });

  it("writes an R Markdown header, and names files from the title", () => {
    const text = newDocumentText("rmarkdown", "Report", "", "word");
    expect(text).toContain("output: word_document");
    expect(text).not.toContain("author:");
    expect(chunksOf(text).map((chunk) => chunk.label)).toEqual(["setup", "summary", "quake-map"]);
    expect(documentFileName("rmarkdown", "My First Report!")).toBe("my-first-report.Rmd");
    expect(documentFileName("quarto", "  ")).toBe("untitled.qmd");
  });
});

describe("headingId", () => {
  it("gives a heading the id Pandoc gives it, for opening the preview there", () => {
    expect(headingId("Body mass by species")).toBe("body-mass-by-species");
    expect(headingId("1. First steps, again!")).toBe("first-steps-again");
    expect(headingId("Größe & Gewicht")).toBe("größe-gewicht");
    expect(headingId("!!!")).toBe("section");
  });
});
