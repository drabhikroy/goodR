import { describe, expect, it } from "vitest";
import { inputsOf, scriptSteps, stepsAfter, stepsBehind } from "../../src/lib/lineage";

const SCRIPT = [
  "raw <- read.csv(\"data/falls.csv\")",
  "falls <- subset(raw, !is.na(mass))",
  "falls$mass_kg <- falls$mass / 1000",
  "names(falls)[1] <- \"id\"",
  "big <- falls[falls$mass_kg > 10, ]",
  "summary(big)",
  "other <- 3",
  "falls <- falls |> mutate(decade = year %/% 10, heavy = mass_kg > 1)",
].join("\n");

describe("where an object came from", () => {
  const steps = scriptSteps(SCRIPT);

  it("reads what each statement makes, changes, and reads", () => {
    expect(steps[0].makes).toEqual(["raw"]);
    expect(steps[1].reads).toEqual(["raw", "mass"]);
    expect(steps[2].changes).toEqual(["falls"]);
    expect(steps[2].columns).toEqual({ falls: ["mass_kg"] });
    expect(steps[3].changes).toEqual(["falls"]);
    expect(steps[7].columns).toEqual({ falls: ["decade", "heavy"] });
  });

  it("follows a name back to where it was last made, with every change after", () => {
    expect(stepsBehind(steps, "falls", 5).map((step) => step.from)).toEqual([1, 2, 3]);
    expect(stepsBehind(steps, "falls").map((step) => step.from)).toEqual([7]);
    expect(inputsOf(stepsBehind(steps, "falls", 5), "falls")).toEqual(["raw", "mass"]);
  });

  it("finds the lines to run again after a change, through what was made from it", () => {
    expect(stepsAfter(steps, "raw", 0).map((step) => step.from)).toEqual([1, 2, 3, 4, 5, 7]);
    expect(stepsAfter(steps, "other", 6)).toEqual([]);
  });

  it("counts data(name) as making name", () => {
    expect(scriptSteps("data(penguins)\nhead(penguins)")[0].makes).toEqual(["penguins"]);
  });
});
