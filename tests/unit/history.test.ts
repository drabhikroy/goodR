import { describe, expect, it } from "vitest";
import { compare, describe as say, firstChoice, lastRan, outcomes, sectionAt } from "../../src/lib/thenNow";
import { likeness, workedBefore } from "../../src/lib/rescue";
import { contrast, parseColor, softGround } from "../../src/lib/historyColors";
import type { Block } from "../../src/lib/store";

// An 84 line script with sections, and the same script with four changes
// spread through it.
const lines = Array.from({ length: 84 }, (_, index) => `x${index} <- ${index}`);
lines[0] = "# Cleaning ----";
lines[30] = "# Summaries ----";
lines[50] = "# Plots ----";
lines[70] = "# Model ----";
const before = lines.join("\n");
const edited = [...lines];
edited[8] = "x8 <- round(8, 2)";
edited[33] = "x33 <- 33 * 2";
edited[55] = "x55 <- 55 + 1";
edited.splice(75, 0, "confint(fit)");
const after = edited.join("\n");
const sections = [
  { label: "Cleaning", line: 0 },
  { label: "Summaries", line: 30 },
  { label: "Plots", line: 50 },
  { label: "Model", line: 70 },
];

describe("then and now", () => {
  it("folds what matches and names each change's section", () => {
    const result = compare(before, after, sections);
    expect(result.changes).toBe(4);
    expect(result.sections).toBe(4);
    const kinds = result.segments.map((segment) => segment.kind);
    // Nothing is folded before the first change's context, so the file
    // starts folded, then context, the change, context, and so on.
    expect(kinds).toEqual(["fold", "same", "change", "same", "fold", "same", "change", "same", "fold", "same", "change", "same", "fold", "same", "change", "same", "fold"]);
    const changes = result.segments.filter((segment) => segment.kind === "change");
    expect(changes.map((segment) => segment.kind === "change" && segment.section)).toEqual(["Cleaning", "Summaries", "Plots", "Model"]);
    // Two lines of context sit each side of a change.
    const firstContext = result.segments[1];
    expect(firstContext.kind === "same" && firstContext.lines.map((line) => line.now)).toEqual([6, 7]);
    expect(say(result)).toBe("4 changes in 4 sections, 85 lines in all");
  });

  it("numbers lines in each version, with added lines only on the right", () => {
    const result = compare(before, after, sections);
    const added = result.segments.find((segment) => segment.kind === "change" && segment.piece.kind === "added");
    expect(added && added.kind === "change" && added.then).toEqual([]);
    expect(added && added.kind === "change" && added.now).toEqual([{ n: 75, text: "confint(fit)" }]);
  });

  it("shows nothing to fold when nothing changed", () => {
    const result = compare(before, before, sections);
    expect(result.changes).toBe(0);
    expect(result.segments).toEqual([]);
    expect(say(result)).toBe("No changes");
  });

  it("finds the section a line falls in", () => {
    expect(sectionAt(sections, 0)).toBe("Cleaning");
    expect(sectionAt(sections, 49)).toBe("Summaries");
    expect(sectionAt([{ label: "Later", line: 10 }], 3)).toBeNull();
  });
});

const block = (fields: Partial<Block>): Block =>
  ({ id: "b", file: "/p/a.R", code: "", fromLine: 0, toLine: 0, status: "ok", items: [], started: 0, duration: 0, live: false, paused: false, ...fields }) as Block;

describe("versions and how they fared", () => {
  const versions = [
    { id: "400", savedAt: 400, text: "now" },
    { id: "300-ran", savedAt: 300, text: "c", ran: true },
    { id: "200", savedAt: 200, text: "b" },
    { id: "100", savedAt: 100, text: "a" },
  ];

  it("marks versions that ran, and those while which a line failed", () => {
    const blocks = [block({ status: "error", started: 250 }), block({ status: "error", started: 120, undone: true }), block({ status: "error", started: 150, file: "/p/other.R" })];
    expect(outcomes("/p/a.R", versions, blocks)).toEqual([null, "ran", "failed", null]);
  });

  it("starts at the newest version that differs, and finds the last that ran", () => {
    expect(firstChoice(versions, "now")).toBe(1);
    expect(firstChoice(versions, "other")).toBe(0);
    expect(lastRan(versions, "now")).toBe(1);
    expect(lastRan(versions, "c")).toBe(-1);
  });
});

describe("error rescue", () => {
  const failed = block({ id: "f", code: 'ggplot(penguins, aes(flipper, mass))', status: "error", started: 500 });

  it("finds the line as it last worked, once it has been edited away", () => {
    const earlier = [
      block({ id: "1", code: "ggplot(penguins, aes(flipper_len, mass))", started: 100 }),
      block({ id: "2", code: "ggplot(penguins, aes(flipper_length, mass))", started: 300 }),
      block({ id: "3", code: "summary(fit)", started: 400 }),
      block({ id: "4", code: "ggplot(penguins, aes(bill, mass))", started: 450, status: "error" }),
    ];
    const script = "library(ggplot2)\nggplot(penguins, aes(flipper, mass))\nsummary(fit)";
    // Both are alike enough, so the one that ran later wins.
    expect(workedBefore(failed, earlier, script)?.id).toBe("2");
  });

  it("offers nothing for a new line, or one still in the script", () => {
    expect(workedBefore(failed, [block({ code: "mean(x)", started: 100 })], "")).toBeNull();
    // A line found only inside a longer line is not still there.
    expect(workedBefore(block({ code: "valeu", status: "error", started: 500 }), [block({ code: "value", started: 100 })], "value <- 5\nvaleu")?.code).toBe("value");
    const still = block({ code: "ggplot(penguins, aes(flipper_len, mass))", started: 100 });
    expect(workedBefore(failed, [still], "ggplot(penguins, aes(flipper_len, mass))")).toBeNull();
    expect(workedBefore(failed, [block({ code: "ggplot(penguins, aes(flipper_len, mass))", started: 600 })], "")).toBeNull();
  });

  it("measures how alike two lines are", () => {
    expect(likeness("mean(x)", "mean(x)")).toBe(1);
    expect(likeness("mean(x)", "")).toBe(0);
    expect(likeness("aes(flipper, mass)", "aes(flipper_len, mass)")).toBeGreaterThan(0.7);
    // A slip in a one word line still looks like the word.
    expect(likeness("value", "valeu")).toBeGreaterThanOrEqual(0.5);
  });
});

describe("history colors", () => {
  it("reads hex and RGB as a person types them", () => {
    expect(parseColor("#feb98b")).toBe("#FEB98B");
    expect(parseColor("FEB98B")).toBe("#FEB98B");
    expect(parseColor("#fb8")).toBe("#FFBB88");
    expect(parseColor("rgb(254, 185, 139)")).toBe("#FEB98B");
    expect(parseColor("254, 185, 139")).toBe("#FEB98B");
    expect(parseColor("254 185 139")).toBe("#FEB98B");
    expect(parseColor("rgba(254, 185, 139, 0.5)")).toBe("#FEB98B");
    expect(parseColor("256, 0, 0")).toBeNull();
    expect(parseColor("orange")).toBeNull();
    expect(parseColor("")).toBeNull();
  });

  it("keeps code readable on the soft ground of any chosen color", () => {
    const readers = ["#E7EDF1", "#A39E95", "#D3AEF0", "#9FD49B", "#8CBCE4", "#F2A673"];
    for (const bar of ["#FF0000", "#FFFF00", "#FFFFFF", "#00FF88"]) {
      const ground = softGround(bar, "#151E25", true, readers);
      for (const color of readers) expect(contrast(color, ground)).toBeGreaterThanOrEqual(4.5);
    }
    const light = softGround("#AE6F42", "#FFFFFF", false, ["#15202A", "#67645E"]);
    expect(light).not.toBe("#FFFFFF");
    expect(contrast("#67645E", light)).toBeGreaterThanOrEqual(4.5);
  });
});
