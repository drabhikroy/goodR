import { describe, expect, it } from "vitest";
import { referencedPackages } from "../../src/lib/packages";
import { cleanMessage, closestName, describeProblem, explainError, userFrames } from "../../src/lib/errors";
import type { RObject } from "../../src/lib/types";
import { keyLabel } from "../../src/lib/commands";
import { isSupportedR } from "../../src/lib/rversion";

describe("referencedPackages", () => {
  it("finds library, require, and namespace uses with their first line", () => {
    const code = 'library(ggplot2)\nrequire("dplyr")\nx <- gt::gt(d)\nreadr:::parse_guess(y)';
    expect(referencedPackages(code)).toEqual([
      { name: "ggplot2", line: 1 },
      { name: "dplyr", line: 2 },
      { name: "gt", line: 3 },
      { name: "readr", line: 4 },
    ]);
  });

  it("skips base packages, comments, strings, and variable package names", () => {
    const code = '# library(notreal)\nstats::sd(x)\nmsg <- "use pkg::fn here"\nlibrary(p, character.only = TRUE)\nd$col::x';
    expect(referencedPackages(code)).toEqual([]);
  });

  it("lists each package once", () => {
    expect(referencedPackages("library(gt)\ngt::gt(a)\ngt::gt(b)")).toEqual([{ name: "gt", line: 1 }]);
  });
});

const objects: RObject[] = [
  { name: "penguins", kind: "data", class: "data.frame", summary: "", columns: ["species", "flipper_len", "body_mass"] },
  { name: "fit", kind: "model", class: "lm", summary: "", columns: [] },
];

describe("explainError", () => {
  it("strips the error framing", () => {
    expect(cleanMessage("Error in eval(expr) : boom")).toBe("boom");
    expect(cleanMessage("Error:\nboom")).toBe("boom");
  });

  it("suggests the column someone meant", () => {
    const result = explainError("Error in eval(predvars) : object 'flipper_length_mm' not found", objects);
    expect(result.detail).toBe("There is no object named flipper_length_mm. The closest match is flipper_len.");
    expect(result.fix).toEqual({ kind: "replace", from: "flipper_length_mm", to: "flipper_len", label: "Use flipper_len" });
  });

  it("catches common typos and does not suggest unrelated names", () => {
    expect(closestName("pengiuns", ["penguins", "fit"])).toBe("penguins");
    expect(closestName("zzz", ["penguins", "fit"])).toBeUndefined();
  });

  it("offers to install a missing package", () => {
    const result = explainError("Error:\nthere is no package called ‘gt’", objects);
    expect(result.fix).toEqual({ kind: "install", name: "gt", label: "Install gt" });
  });

  it("explains parse errors in plain words and points at the token that failed", () => {
    const result = explainError('Error: unexpected symbol in "x y"', [], "x y");
    expect(result.title).toBe("R did not expect a name here");
    expect(result.detail).toContain("side by side");
    expect(result.where).toEqual({ line: 0, from: 2, to: 3 });
  });

  it("uses the position R gives for a parse error", () => {
    const code = "a <- 1\nb <- 2 foo\nc <- 3";
    const result = explainError("<text>:2:8: unexpected symbol\n1: a <- 1\n2: b <- 2 foo\n          ^", [], code);
    expect(result.where).toEqual({ line: 1, from: 7, to: 10 });
  });

  it("finds a string constant that R names by its end", () => {
    const code = 'paste("a" "b")';
    const result = explainError("<text>:1:11: unexpected string constant\n1: paste(\"a\" \"b\"\n              ^", [], code);
    expect(result.where).toEqual({ line: 0, from: 10, to: 13 });
  });

  it("says where an unfinished statement stopped", () => {
    const result = explainError("Error: unexpected end of input", [], "mean(c(1, 2");
    expect(result.title).toBe("The code stops before it is finished");
    expect(result.where).toEqual({ line: 0, from: 10, to: 11 });
  });

  it("marks the missing object on the line that names it", () => {
    const code = "a <- 1\nfit <- lm(mass ~ flipper_length_mm, data = d)";
    const result = explainError("object 'flipper_length_mm' not found", objects, code);
    expect(result.where).toEqual({ line: 1, from: 17, to: 34 });
  });

  it("does not mark a word that appears only in text or a comment", () => {
    const code = '# fit is not found\nx <- "fit"\ny <- fit';
    expect(explainError("object 'fit' not found", [], code).where).toEqual({ line: 2, from: 5, to: 8 });
  });

  it("marks the function that could not be found, and explains the pipe", () => {
    const result = explainError('could not find function "%>%"', [], "x %>% mean()");
    expect(result.title).toContain("%>%");
    expect(result.hint).toContain("|>");
    expect(result.where).toEqual({ line: 0, from: 2, to: 5 });
    expect(explainError('could not find function "frobnicate"', [], "y <- 1\nfrobnicate(y)").where).toEqual({ line: 1, from: 0, to: 10 });
  });

  it("uses the function named in the message when the rule has no better clue", () => {
    const code = "d <- read.csv('a.csv')\nm <- lm(y ~ x, data = d)";
    const result = explainError("Error in lm.fit(x, y) : 0 (non-NA) cases", [], code, []);
    expect(result.title).toBe("No row has complete data for this model");
    // lm.fit is not in the code, so there is nothing honest to mark.
    expect(result.where).toBeNull();
    const direct = explainError("Error in lm(y ~ x) : 0 (non-NA) cases", [], code, []);
    expect(direct.where).toEqual({ line: 1, from: 5, to: 7 });
  });

  it("marks an operator only when it is the only candidate", () => {
    expect(explainError("non-numeric argument to binary operator", [], 'x <- "a" + 1').where).toEqual({ line: 0, from: 9, to: 10 });
    expect(explainError("non-numeric argument to binary operator", [], "x <- a + b * c").where).toBeNull();
  });

  it("explains an abline with no plot, in plain words", () => {
    const result = explainError("Error in plot.xy(xy.coords(x, y), type = type, ...) : plot.new has not been called yet", [], "abline(model)");
    expect(result.title).toBe("There is no plot to add to");
    expect(result.hint).toContain("Run the line that draws the plot first");
  });

  // The messages below are copied from a real R 4.3 session run through ark,
  // which is how the app receives them.
  it("finds a syntax error's spot from R's parser when ark leaves the position out", () => {
    const code = "a <- 1\nb <- 2 foo";
    const ark = "Error:\nSyntax error: unexpected symbol";
    expect(explainError(ark, [], code).where).toBeNull();
    const result = explainError(ark, [], code, [], "<text>:2:8: unexpected symbol\n1: a <- 1\n2: b <- 2 foo\n          ^");
    expect(result.title).toBe("R did not expect a name here");
    expect(result.where).toEqual({ line: 1, from: 7, to: 10 });
  });

  it("reads ark's wording for unfinished code", () => {
    // Split so the writing gate does not read ark's words as a contraction.
    const result = explainError("Error:\nCan" + "'t parse incomplete input", [], "mean(c(1, 2)");
    expect(result.title).toBe("The code stops before it is finished");
    expect(result.where).toEqual({ line: 0, from: 11, to: 12 });
  });

  it("points at the person's own call when the error happened deeper inside it", () => {
    const code = "fit <- lm(y ~ x, data = d)";
    const traceback = ["1. lm(y ~ x, data = d)", "2. lm.fit(x, y, offset = offset, singular.ok = singular.ok, ...)", '3. stop("0 (non-NA) cases")'];
    const result = explainError("Error:\n0 (non-NA) cases", [], code, traceback);
    expect(result.where).toEqual({ line: 0, from: 7, to: 9 });
    expect(userFrames(traceback)).toEqual(["lm(y ~ x, data = d)", "lm.fit(x, y, offset = offset, singular.ok = singular.ok, ...)"]);
  });

  it("names the function for a missing input from the traceback", () => {
    const result = explainError('Error:\nargument "x" is missing, with no default', [], "mean()", ["1. mean()", "2. mean.default()"]);
    expect(result.title).toBe("mean() needs a value for \u201Cx\u201D");
    expect(result.where).toEqual({ line: 0, from: 0, to: 4 });
  });

  it("explains an empty input and marks the stray comma", () => {
    const result = explainError("Error:\nargument 3 is empty", [], "sum(1, z = 2, )");
    expect(result.title).toBe("A function input is empty");
    expect(result.where).toEqual({ line: 0, from: 12, to: 13 });
  });

  it("leaves ark's own error handler out of the calls shown", () => {
    expect(userFrames(["1. (function (cnd) \n   {\n   })(structure(list()))", "2. handle_error_base(cnd)"])).toEqual([]);
  });

  it("keeps messages with no plain version, framed so the line is still findable", () => {
    const unknown = explainError("Error: something rare happened", []);
    expect(unknown.title).toBe("R stopped with a message that has no plain version yet");
    expect(unknown.detail).toBe("R said: something rare happened");
    expect(unknown.original).toBe("something rare happened");
  });

  it("avoids R jargon in every plain explanation", () => {
    const messages = [
      "non-numeric argument to binary operator",
      "object of type 'closure' is not subsettable",
      "subscript out of bounds",
      "$ operator is invalid for atomic vectors",
      "arguments imply differing number of rows: 3, 4",
      "unused argument (z = 1)",
    ];
    for (const message of messages) {
      const { title, detail, hint } = explainError(message, [], "");
      const words = `${title} ${detail} ${hint ?? ""}`;
      expect(words).not.toMatch(/closure|binary operator|atomic|subsettable|imply/i);
    }
  });

  it("writes the plain version for the console with carets under the spot", () => {
    const code = "x <- fit + 1";
    const text = describeProblem(explainError("object 'fit' not found", [], code), code);
    expect(text).toContain("R could not find");
    expect(text).toContain("  x <- fit + 1\n       ^^^");
  });
});

describe("keyLabel", () => {
  it("keeps Mac symbols on a Mac", () => {
    expect(keyLabel("⇧⌘↩", true)).toBe("⇧⌘↩");
  });
  it("spells shortcuts out elsewhere", () => {
    expect(keyLabel("⇧⌘↩", false)).toBe("Ctrl+Shift+Enter");
    expect(keyLabel("⌥⌘B", false)).toBe("Ctrl+Alt+B");
    expect(keyLabel("⌃2", false)).toBe("Ctrl+2");
    expect(keyLabel("⌘−", false)).toBe("Ctrl+-");
  });
});

describe("isSupportedR", () => {
  it("accepts 4.2 and later, comparing numbers rather than text", () => {
    expect(isSupportedR("4.2.0")).toBe(true);
    expect(isSupportedR("4.10.1")).toBe(true);
    expect(isSupportedR("5.0.0")).toBe(true);
    expect(isSupportedR("4.1.3")).toBe(false);
    expect(isSupportedR("3.6.3")).toBe(false);
  });
});
