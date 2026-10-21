import { describe, expect, it } from "vitest";
import { planQuestion, questionText } from "../../src/lib/question";

const script = [
  "library(dplyr)",
  'stars <- read.csv("data/bright_stars.csv")',
  "near <- 100",
  "unused <- 1",
  "close <- filter(stars, distance_ly < near)",
  "plot(close$temp, close$luminosity_sun)",
].join("\n");

describe("planQuestion", () => {
  it("keeps the lines the failing statement needs and the packages", () => {
    const plan = planQuestion(script, "plot(close$temp, close$luminosity_sun)", 5);
    expect(plan.steps.map((step) => step.from)).toEqual([0, 1, 2, 4]);
    expect(Object.keys(plan.roots).sort()).toEqual(["near", "stars"]);
  });
});

describe("questionText", () => {
  const plan = planQuestion(script, "plot(close$temp, close$luminosity_sun)", 5);
  const about = { data: { stars: 'data.frame(name = c("Sirius", "Vega"))' }, r: "R version 4.4.1", platform: "macOS 14", packages: ["dplyr 1.1.4"] };

  it("puts a sample in place of a data file", () => {
    const text = questionText(plan, "Error: object 'temp' not found", about, true);
    expect(text).toContain('stars <- data.frame(name = c("Sirius", "Vega"))');
    expect(text).not.toContain("read.csv");
    expect(text).toContain("near <- 100");
    expect(text).not.toContain("unused");
    expect(text).toContain("dplyr 1.1.4");
  });

  it("keeps the original lines without the sample", () => {
    const text = questionText(plan, "Error", about, false);
    expect(text).toContain("read.csv");
    expect(text).not.toContain("A sample of");
  });
});
