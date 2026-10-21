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
