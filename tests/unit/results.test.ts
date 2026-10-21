import { describe, expect, it } from "vitest";
import { bibliographyEdit, doiIn, worksFrom } from "../../src/lib/cite";
import { reportFromResults } from "../../src/lib/resultsReport";
import type { Block } from "../../src/lib/store";

const block = (code: string, toLine: number, items: Block["items"], status: Block["status"] = "ok"): Block => ({
  id: code,
  file: "/work/analysis.R",
  code,
  fromLine: toLine,
  toLine,
  status,
  items,
  started: 0,
  duration: 10,
  live: false,
  paused: false,
});

describe("results as a report", () => {
  it("joins quiet lines to the next result and keeps the order", () => {
    const text = reportFromResults(
      [block("x <- 1:3", 0, []), block("mean(x)", 1, [{ type: "value", text: "[1] 2" }]), block("plot(x)", 2, [{ type: "plot", png: "", plot: 1 }])],
      "Results",
      "2026-10-20",
    );
    expect(text).toContain('title: "Results"');
    expect(text).toContain("## From analysis.R");
    expect(text).toContain("```{r}\nx <- 1:3\nmean(x)\n```");
    expect(text).toContain("```{r}\nplot(x)\n```");
  });

  it("marks failed results so the report still renders, and drops replaced runs", () => {
    const text = reportFromResults(
      [block("mean(y)", 4, [{ type: "error", message: "not found", traceback: [] }], "error"), block("mean(x)", 1, [{ type: "value", text: "1" }]), block("mean(x)", 1, [{ type: "value", text: "2" }])],
      "Results",
      "2026-10-20",
    );
    expect(text).toContain("#| error: true\nmean(y)");
    expect(text.match(/mean\(x\)/g)?.length).toBe(1);
  });
});

describe("citations", () => {
  it("finds a DOI in its usual forms", () => {
    expect(doiIn("10.1038/nature14539")).toBe("10.1038/nature14539");
    expect(doiIn("https://doi.org/10.1038/nature14539.")).toBe("10.1038/nature14539");
    expect(doiIn("doi: 10.1000/xyz")).toBe("10.1000/xyz");
    expect(doiIn("deep learning")).toBeNull();
  });

  it("reads works from a Crossref reply", () => {
    const reply = JSON.stringify({ message: { items: [{ DOI: "10.1/a", title: ["Deep <i>learning</i>"], author: [{ family: "LeCun" }, { family: "Bengio" }, { family: "Hinton" }], issued: { "date-parts": [[2015]] }, "container-title": ["Nature"] }] } });
    expect(worksFrom(reply)).toEqual([{ doi: "10.1/a", title: "Deep learning", authors: "LeCun and others", year: "2015", journal: "Nature" }]);
    expect(worksFrom("not json")).toEqual([]);
  });

  it("names the references file in the header, once", () => {
    const doc = "---\ntitle: Rivers\n---\n\nText";
    const edit = bibliographyEdit(doc)!;
    const after = doc.slice(0, edit.at) + edit.insert + doc.slice(edit.at);
    expect(after).toBe("---\ntitle: Rivers\nbibliography: references.bib\n---\n\nText");
    expect(bibliographyEdit(after)).toBeNull();
    expect(bibliographyEdit("Text")).toEqual({ at: 0, insert: "---\nbibliography: references.bib\n---\n\n" });
  });
});
