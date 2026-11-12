import { describe, expect, it } from "vitest";
import { describePrompt } from "../../src/lib/prompts";

describe("reading a question R asks at the prompt", () => {
  it("offers the answers R lists, and Cancel only when R does", () => {
    expect(describePrompt("Would you like to use a personal library instead? (yes/No/cancel) ").choices).toEqual(["yes", "no", "cancel"]);
    expect(describePrompt("Save workspace image? [y/n]").choices).toEqual(["yes", "no"]);
    expect(describePrompt("Continue? (Y/n)").choices).toEqual(["yes", "no"]);
  });

  it("offers no buttons for a question that wants a typed answer", () => {
    expect(describePrompt("Your name: ").choices).toEqual([]);
    expect(describePrompt("Selection: ").choices).toEqual([]);
    expect(describePrompt("").choices).toEqual([]);
  });

  it("explains the personal library question in both wordings R uses", () => {
    expect(describePrompt("Would you like to use a personal library instead? (yes/No/cancel) ").explanation).toMatch(/home folder/);
    expect(describePrompt("Would you like to create a personal library\n~/R/library\nto install packages into? (yes/No/cancel) ").explanation).toMatch(/home folder/);
    expect(describePrompt("Your name: ").explanation).toBeNull();
  });
});
