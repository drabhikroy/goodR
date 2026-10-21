import { describe, expect, it } from "vitest";
import { lineSteps } from "../../src/lib/explain";
import { findHints } from "../../src/lib/hints";
import { isPlainName, renamePlaces } from "../../src/lib/rename";

describe("findHints", () => {
  const titles = (code: string, inProject = false) => findHints(code, inProject).map((hint) => hint.title);

  it("suggests TRUE and FALSE in full, unless the script defines T itself", () => {
    const [hint] = findHints("mean(x, na.rm = T)", false);
    expect(hint).toMatchObject({ title: "Write TRUE in full", line: 0, from: 16, to: 17, fix: "TRUE" });
    expect(titles("T <- 5\nT + 1")).toEqual([]);
    expect(titles("df$T")).toEqual([]);
  });

  it("offers seq_along for 1:length(x), with the fix in place", () => {
    const [hint] = findHints("for (i in 1:length(x)) print(i)", false);
    expect(hint.fix).toBe("seq_along(x)");
    expect("for (i in 1:length(x)) print(i)".slice(hint.from, hint.to)).toBe("1:length(x)");
    expect(findHints("1:nrow(df)", false)[0].fix).toBe("seq_len(nrow(df))");
  });

  it("turns x == NA into is.na(x)", () => {
    const code = "keep <- data$year != NA";
    const [hint] = findHints(code, false);
    expect(hint.fix).toBe("!is.na(data$year)");
    expect(code.slice(hint.from, hint.to)).toBe("data$year != NA");
  });

  it("notes setwd only in a project, and rm(list = ls()) anywhere", () => {
    expect(titles('setwd("~/data")', true)).toEqual(["setwd() ties this script to one computer"]);
    expect(titles('setwd("~/data")', false)).toEqual([]);
    expect(titles("rm(list = ls())")).toEqual(["This is not a fresh start"]);
  });

  it("stays quiet about ordinary code and text", () => {
    expect(titles('x <- c(TRUE, FALSE)\n# T and F == NA\ny <- "T"')).toEqual([]);
  });
});

describe("lineSteps", () => {
  it("lists calls in the order R finishes them, and what is assigned", () => {
    expect(lineSteps("big <- subset(meteorites, mass_g > median(mass_g))")).toEqual({ calls: ["median", "subset"], assigns: "big", pipes: false });
    expect(lineSteps("round(mean(x), 1)").calls).toEqual(["mean", "round"]);
    expect(lineSteps("x |> sort() |> head()")).toMatchObject({ calls: ["sort", "head"], pipes: true });
    expect(lineSteps("tools::toTitleCase(name) -> title")).toEqual({ calls: ["tools::toTitleCase"], assigns: "title", pipes: false });
  });
});

describe("renamePlaces", () => {
  it("renames the object, and not columns, argument names, text, or longer names", () => {
    const code = 'data <- read.csv("data.csv")\nfit <- lm(y ~ x, data = data)\nother$data\ndata_2 <- data # data';
    const places = renamePlaces(code, "data");
    expect(places).toEqual([
      { line: 0, from: 0, to: 4 },
      { line: 1, from: 24, to: 28 },
      { line: 3, from: 10, to: 14 },
    ]);
  });

  it("knows which names can be written plainly", () => {
    expect(isPlainName("mass_kg")).toBe(true);
    expect(isPlainName(".hidden")).toBe(true);
    expect(isPlainName("2x")).toBe(false);
    expect(isPlainName("if")).toBe(false);
    expect(isPlainName("a b")).toBe(false);
  });
});
