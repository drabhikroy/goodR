import { describe, expect, it } from "vitest";
import { formatOf, guessLayout, importCode, isValidName, objectName, pathForCode, previewCode, type ImportOptions } from "../../src/lib/importData";

const base: ImportOptions = { path: "data/survey.csv", name: "survey", format: "text", sep: ",", header: true, dec: ".", na: "NA", skip: 0, sheet: "" };

describe("import code", () => {
  it("writes the plainest call when every option is the default", () => {
    expect(importCode(base)).toBe('survey <- read.csv("data/survey.csv")');
  });

  it("adds an argument only for an option that differs from the default", () => {
    expect(importCode({ ...base, sep: ";", dec: ",", header: false, na: "NA, -99", skip: 2 })).toBe(
      'survey <- read.csv("data/survey.csv", sep = ";", header = FALSE, dec = ",", na.strings = c("NA", "-99"), skip = 2)',
    );
    expect(importCode({ ...base, sep: "\t" })).toBe('survey <- read.csv("data/survey.csv", sep = "\\t")');
  });

  it("limits the preview to the first rows where the reader allows it", () => {
    expect(previewCode(base)).toBe('read.csv("data/survey.csv", nrows = 50)');
    expect(previewCode({ ...base, path: "a.sav", format: "spss" })).toBe('haven::read_sav("a.sav", n_max = 50)');
    expect(previewCode({ ...base, path: "a.rds", format: "rds" })).toBe('utils::head(as.data.frame(readRDS("a.rds")), 50)');
  });

  it("reads Excel with the chosen sheet, and a saved workspace with load", () => {
    expect(importCode({ ...base, path: "book.xlsx", format: "excel", sheet: "Responses", na: "" })).toBe('survey <- readxl::read_excel("book.xlsx", sheet = "Responses")');
    expect(importCode({ ...base, path: "old.RData", format: "rdata" })).toBe('load("old.RData")');
  });

  it("quotes paths safely", () => {
    expect(importCode({ ...base, path: 'C:\\Users\\me\\a "b".csv' })).toBe('survey <- read.csv("C:\\\\Users\\\\me\\\\a \\"b\\".csv")');
  });
});

describe("names and paths", () => {
  it("knows formats by extension", () => {
    expect(formatOf("a/b/Survey.XLSX")).toBe("excel");
    expect(formatOf("notes.docx")).toBeNull();
  });

  it("suggests a valid R name from the file name", () => {
    expect(objectName("/x/teacher survey 2026.csv")).toBe("teacher_survey_2026");
    expect(objectName("2026-results.csv")).toBe("x2026_results");
    expect(isValidName("teacher_survey")).toBe(true);
    expect(isValidName("2026")).toBe(false);
    expect(isValidName("if")).toBe(false);
  });

  it("names files inside the working folder relative to it", () => {
    expect(pathForCode("/Users/a/proj/data/x.csv", "/Users/a/proj")).toBe("data/x.csv");
    expect(pathForCode("/Users/a/other/x.csv", "/Users/a/proj")).toBe("/Users/a/other/x.csv");
    expect(pathForCode("C:\\Users\\a\\proj\\x.csv", "C:\\Users\\a\\proj")).toBe("x.csv");
  });
});

import { parseHelpLink } from "../../src/lib/helpHtml";

describe("help links", () => {
  it("reads the two forms R writes, and nothing else", () => {
    expect(parseHelpLink("../../stats/html/sd.html")).toEqual({ package: "stats", file: "sd", topic: "" });
    expect(parseHelpLink("../../stats/help/var.html")).toEqual({ package: "stats", file: "", topic: "var" });
    expect(parseHelpLink("https://example.com/stats/html/sd.html")).toBeNull();
    expect(parseHelpLink("javascript:alert(1)")).toBeNull();
  });
});

describe("guessing a text file's layout", () => {
  it("finds the separator that splits every line evenly", () => {
    expect(guessLayout(["id,name,score", "1,Ada,3.5", "2,Bo,4"])).toEqual({ sep: ",", dec: "." });
    expect(guessLayout(["id\tscore", "1\t3.5"])).toEqual({ sep: "\t", dec: "." });
  });

  it("sees a semicolon file with decimal commas, as European spreadsheets save them", () => {
    expect(guessLayout(["id;school;score", "1;North;2,5", "2;South;NA"])).toEqual({ sep: ";", dec: "," });
  });

  it("falls back to commas when nothing fits", () => {
    expect(guessLayout(["just one column", "no separators"])).toEqual({ sep: ",", dec: "." });
  });
});

describe("names that R reserves", () => {
  it("refuses ... and ..1, and backticks a name R cannot take plainly", () => {
    expect(isValidName("...")).toBe(false);
    expect(isValidName("..1")).toBe(false);
    expect(isValidName("NA_real_")).toBe(false);
    const code = importCode({ ...base, path: "a.rds", name: "my data", format: "rds" });
    expect(code).toBe('`my data` <- readRDS("a.rds")');
  });
});
