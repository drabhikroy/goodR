import { describe, expect, it } from "vitest";
import { codeBlocks, isOneOffStep, likeness } from "../../src/lib/suggestions";

describe("reading an assistant's answer", () => {
  it("finds every R code block, even one cut off by Stop", () => {
    const answer = "First this.\n\n```r\nx <- 1\n```\n\nThen:\n\n```\ny <- 2\n```\n\n```r\nz <- unfinished";
    expect(codeBlocks(answer)).toEqual(["x <- 1", "y <- 2", "z <- unfinished"]);
  });

  it("offers Replace for a corrected version, not for a different step", () => {
    const original = "fit <- lm(body_mass ~ flipper_length_mm, data = penguins)";
    expect(likeness(original, "fit <- lm(body_mass ~ flipper_len, data = penguins)")).toBeGreaterThan(0.6);
    expect(likeness("gt::gt(mass_by_species)", 'install.packages("gt")')).toBeLessThan(0.3);
    // Comments added to the same code leave it just as alike.
    expect(likeness(original, `# Fit a line\n${original}`)).toBe(1);
  });

  it("sends installs to the console and keeps library() for the script", () => {
    expect(isOneOffStep('install.packages("gt")')).toBe(true);
    expect(isOneOffStep('# once\ninstall.packages(c("gt", "dplyr"))')).toBe(true);
    expect(isOneOffStep("library(dplyr)")).toBe(false);
    expect(isOneOffStep('install.packages("gt")\ngt::gt(x)')).toBe(false);
  });
});
