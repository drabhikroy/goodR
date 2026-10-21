import { describe, expect, it } from "vitest";
import { plotKind, readLabels, writeLabels } from "../../src/lib/plotEdit";

const none = { title: "", x: "", y: "", color: "" };

describe("plotKind", () => {
  it("knows base R plots and ggplot2, and nothing else", () => {
    expect(plotKind("hist(penguins$body_mass)")).toEqual({ kind: "base", call: "hist", colorEditable: true });
    expect(plotKind("ggplot(df, aes(x, y)) + geom_point()")).toEqual({ kind: "ggplot" });
    expect(plotKind("summary(fit)")).toBeNull();
  });

  it("does not offer a color that is mapped from the data", () => {
    expect(plotKind("plot(y ~ x, data = d, col = d$species)")).toMatchObject({ colorEditable: false });
    expect(plotKind('plot(y ~ x, data = d, col = "red")')).toMatchObject({ colorEditable: true });
  });
});

describe("base R plots", () => {
  it("adds labels and a color to a call that has none", () => {
    const code = writeLabels("hist(penguins$body_mass)", { ...none, title: "Body mass", x: "Grams", color: "#1F5F8B" });
    expect(code).toBe('hist(penguins$body_mass, main = "Body mass", xlab = "Grams", col = "#1F5F8B")');
    expect(readLabels(code)).toEqual({ title: "Body mass", x: "Grams", y: "", color: "#1F5F8B" });
  });

  it("changes labels where they are, and removes one that is emptied", () => {
    const code = 'plot(y ~ x, data = d,\n     main = "Old", xlab = "x")';
    expect(writeLabels(code, { ...none, title: "New" })).toBe('plot(y ~ x, data = d,\n     main = "New")');
  });

  it("removes a first argument with the comma after it", () => {
    expect(writeLabels('barplot(main = "A", table(x))', none)).toBe("barplot(table(x))");
  });
});

describe("ggplot2", () => {
  it("adds one labs() at the end when there are no labels", () => {
    const code = "ggplot(df, aes(species, mass)) +\n  geom_col()";
    expect(writeLabels(code, { ...none, title: "Mass", y: "Grams" })).toBe('ggplot(df, aes(species, mass)) +\n  geom_col() +\n  labs(title = "Mass", y = "Grams")');
  });

  it("changes labs(), ggtitle(), and xlab() where they are", () => {
    const code = 'ggplot(df, aes(a, b)) + geom_point() + labs(x = "A") + ggtitle("Old")';
    const changed = writeLabels(code, { ...none, title: "New", x: "Alpha", y: "Beta" });
    expect(changed).toBe('ggplot(df, aes(a, b)) + geom_point() + labs(x = "Alpha", y = "Beta") + ggtitle("New")');
    expect(readLabels(changed)).toEqual({ title: "New", x: "Alpha", y: "Beta", color: "" });
    expect(writeLabels(changed, { ...none, x: "Alpha", y: "Beta" })).toBe('ggplot(df, aes(a, b)) + geom_point() + labs(x = "Alpha", y = "Beta")');
  });
});
