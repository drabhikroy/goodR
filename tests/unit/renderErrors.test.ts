import { describe, expect, it } from "vitest";
import { explainRender } from "../../src/lib/renderErrors";

// A report whose second chunk fails on its second line, as knitr reports
// it: lines 11 to 13 are the chunk's two lines of code and its fence.
const REPORT = ["---", 'title: "Test"', "format: html", "---", "", "```{r setup}", "x <- 1:3", "```", "", "```{r totals}", "mean(x)", "nosuchthing", "```", ""].join("\n");

describe("explainRender", () => {
  it("marks the exact line inside a failing chunk and says reports start clean", () => {
    const explained = explainRender({ kind: "chunk", from: 11, to: 13, label: "totals", message: "object 'nosuchthing' not found" }, REPORT);
    expect(explained.title).toBe("R could not find “nosuchthing”");
    // Line 12 of the file, counted from zero.
    expect(explained.where).toEqual({ line: 11, text: "nosuchthing", from: 0 });
    expect(explained.chunk).toBe("the chunk named totals");
    expect(explained.detail).toContain("Reports run from a clean start");
    expect(explained.original).toBe("object 'nosuchthing' not found");
  });

  it("offers to install a package a chunk needs", () => {
    const text = REPORT.replace("nosuchthing", "library(gtx)");
    const explained = explainRender({ kind: "chunk", from: 11, to: 13, label: "unnamed-chunk-2", message: "there is no package called 'gtx'" }, text);
    expect(explained.action).toEqual({ label: "Install gtx", kind: "install", name: "gtx" });
    expect(explained.chunk).toBe("a chunk");
    expect(explained.detail).not.toContain("clean start");
  });

  it("points at the chunk's first line when the failing part cannot be found", () => {
    const explained = explainRender({ kind: "chunk", from: 11, to: 13, label: "totals", message: "something unusual happened" }, REPORT);
    expect(explained.where).toEqual({ line: 10, text: "mean(x)", from: 0 });
  });

  it("explains missing tools with a way forward", () => {
    expect(explainRender({ kind: "noQuarto" }, "").action).toEqual({ label: "Get Quarto", kind: "quarto" });
    expect(explainRender({ kind: "noPandoc" }, "").action?.kind).toBe("quarto");
    expect(explainRender({ kind: "noR" }, "").action?.kind).toBe("chooseR");
    const latex = explainRender({ kind: "latex" }, "");
    expect(latex.action).toEqual({ label: "Render as PDF", kind: "pdf" });
    expect(latex.hint).toContain("Typst");
  });

  it("explains a missing rendering package from R's own message", () => {
    const explained = explainRender({ kind: "other", message: "there is no package called 'rmarkdown'" }, "");
    expect(explained.action).toEqual({ label: "Install rmarkdown", kind: "install", name: "rmarkdown" });
  });

  it("says plainly when the person stopped the render", () => {
    const explained = explainRender({ kind: "stopped" }, "");
    expect(explained.title).toBe("Rendering stopped");
    expect(explained.action?.kind).toBe("again");
  });
});
