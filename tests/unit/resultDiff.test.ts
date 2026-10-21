import { describe, expect, it } from "vitest";
import { compareResults, differenceSummary } from "../../src/lib/resultDiff";
import type { OutputItem } from "../../src/lib/store";

const value = (text: string): OutputItem[] => [{ type: "value", text }];

describe("what changed between two runs", () => {
  it("lists numbers that moved when only numbers differ", () => {
    const diff = compareResults(value("   Min. Median   Mean\n   2700   4050   4202"), value("   Min. Median   Mean\n   2850   4050   4207"), {}, {});
    expect(diff.numbers).toEqual([
      { before: "2700", after: "2850", line: "2850   4050   4207" },
      { before: "4202", after: "4207", line: "2850   4050   4207" },
    ]);
    expect(differenceSummary(diff)).toBe("Since last time: 2 numbers moved");
  });

  it("lists lines that came and went otherwise", () => {
    const diff = compareResults(value("a\nb\nc"), value("a\nc\nd"), {}, {});
    expect(diff.removed).toEqual(["b"]);
    expect(diff.added).toEqual(["d"]);
  });

  it("notices objects that changed and a plot that changed", () => {
    const diff = compareResults([{ type: "plot", png: "one", plot: 0 }], [{ type: "plot", png: "two", plot: 1 }], { clean: "data frame, 344 rows" }, { clean: "data frame, 333 rows" });
    expect(diff.objects).toEqual([{ name: "clean", before: "data frame, 344 rows", after: "data frame, 333 rows" }]);
    expect(diff.plot).toEqual({ before: "one", after: "two" });
    expect(differenceSummary(diff)).toBe("Since last time: clean changed, the plot changed");
  });

  it("says when nothing changed", () => {
    const diff = compareResults(value("[1] 3"), value("[1] 3"), { x: "number" }, { x: "number" });
    expect(diff.same).toBe(true);
    expect(differenceSummary(diff)).toBe("Same as last time");
  });
});
