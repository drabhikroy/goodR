import { describe, expect, it } from "vitest";
import { changeSummary, lineDiff } from "../../src/lib/lineDiff";

describe("lineDiff", () => {
  it("finds added, removed, and changed lines in order", () => {
    const before = "a\nb\nc\nd\ne";
    const after = "a\nB\nc\ne\nf";
    const pieces = lineDiff(before, after);
    expect(pieces.map((piece) => piece.kind)).toEqual(["same", "changed", "same", "removed", "same", "added"]);
    expect(changeSummary(pieces)).toBe("1 line added, 1 taken out and 1 changed");
  });

  it("says when nothing changed", () => {
    expect(changeSummary(lineDiff("x <- 1", "x <- 1"))).toBe("No changes");
  });

  it("keeps line numbers for both versions", () => {
    const pieces = lineDiff("one\ntwo", "zero\none\ntwo");
    expect(pieces[0]).toMatchObject({ kind: "added", after: ["zero"], oldFrom: 0, newFrom: 0 });
    expect(pieces[1]).toMatchObject({ kind: "same", oldFrom: 0, newFrom: 1 });
  });
});
