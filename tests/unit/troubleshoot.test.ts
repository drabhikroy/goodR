import { describe, expect, it } from "vitest";
import { usedBy } from "../../src/lib/troubleshoot";
import type { RObject } from "../../src/lib/types";

const penguins: RObject = { name: "penguins", kind: "data", class: "data.frame", summary: "344 rows, 8 columns", columns: ["species", "island", "body_mass", "flipper_len"] };
const fit: RObject = { name: "fit", kind: "model", class: "lm", summary: "linear model", columns: [] };
const OBJECTS = [penguins, fit];

describe("what a failing line was using", () => {
  it("names what R holds under each name the line reads", () => {
    const used = usedBy("confint(fit)", OBJECTS);
    expect(used).toEqual([{ kind: "object", name: "fit", object: fit }]);
  });

  it("puts a name R has nothing under first, since it is the likely cause", () => {
    const used = usedBy("summary(penguin_data$body_mass, fit)", OBJECTS);
    expect(used.map((item) => [item.kind, item.name])).toEqual([
      ["missing", "penguin_data"],
      ["object", "fit"],
    ]);
  });

  it("does not call a column missing when a data frame on the line has it", () => {
    const used = usedBy("ggplot(penguins, aes(species, body_mass))", OBJECTS);
    expect(used.map((item) => [item.kind, item.name])).toEqual([
      ["object", "penguins"],
      ["column", "species"],
      ["column", "body_mass"],
    ]);
    expect(used.find((item) => item.name === "species")).toMatchObject({ of: "penguins" });
  });

  it("calls a column the frame lacks missing, as a misspelling would be", () => {
    const used = usedBy("lm(body_mass ~ flipper_length, data = penguins)", OBJECTS);
    expect(used.find((item) => item.name === "flipper_length")).toEqual({ kind: "missing", name: "flipper_length" });
    expect(used.find((item) => item.name === "body_mass")).toMatchObject({ kind: "column", of: "penguins" });
  });

  it("leaves out functions, arguments, and columns after a dollar sign", () => {
    expect(usedBy("round(mean(penguins$body_mass), digits = 2)", OBJECTS).map((item) => item.name)).toEqual(["penguins"]);
  });

  it("lists each name once, and nothing for a line that reads no names", () => {
    expect(usedBy("fit + fit + fit", OBJECTS)).toHaveLength(1);
    expect(usedBy("1 + 1", OBJECTS)).toEqual([]);
  });
});
