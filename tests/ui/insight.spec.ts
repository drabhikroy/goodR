import { expect, test } from "@playwright/test";
import { newFileWith, openExample, runLine } from "./helpers";

// The statistics write-up, and the fixes that came with it: palettes in
// Paper, the R prompt's height, and a tour that keeps its size.

test("a model's result carries an APA sentence and its assumptions, ready to copy", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "fit <- lm(body_mass ~ flipper_len, data = penguins)\n");
  await runLine(page);
  const writeUp = page.getByRole("region", { name: "Write-up of the Linear model" }).first();
  await expect(writeUp).toContainText("F(1, 340) = 1070.74, p < .001");
  await expect(writeUp).toContainText("flipper_len");
  // One assumption fails, so the checks open by themselves and say why.
  await expect(writeUp.getByRole("button", { name: /1 of 2 assumptions needs a look/ })).toHaveAttribute("aria-expanded", "true");
  await expect(writeUp).toContainText("The sandwich package");
  await writeUp.getByRole("button", { name: /1 of 2 assumptions/ }).click();
  await expect(writeUp).not.toContainText("The sandwich package");
});

test("a color vision palette changes the colors in Paper too", async ({ page }) => {
  await openExample(page);
  await page.keyboard.press("Control+,");
  await page.getByRole("radio", { name: "Paper", exact: true }).check();
  await page.getByLabel("Settings sections").getByRole("button", { name: "Accessibility" }).click();
  const ok = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ok").trim());
  const before = await ok();
  await page.getByRole("radio", { name: /Tritanopia/ }).check();
  await expect.poll(ok).not.toBe(before);
});

test("the R prompt is three lines tall and its top edge drags taller", async ({ page }) => {
  await openExample(page);
  const box = page.locator(".composer-box");
  expect((await box.boundingBox())!.height).toBeGreaterThanOrEqual(88);
  const edge = page.getByRole("separator", { name: "R prompt height" });
  await edge.focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(edge).toHaveAttribute("aria-valuenow", "144");
});

test("every step of the tour, and every Settings pane, keeps the same height", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Use this R" }).click();
  await page.keyboard.press("Control+k");
  await page.keyboard.insertText("take the tour");
  await page.keyboard.press("Enter");
  const card = page.locator(".tour");
  const heights = new Set<number>();
  for (let step = 0; step < 4; step += 1) {
    heights.add(Math.round((await card.boundingBox())!.height));
    await page.getByRole("button", { name: "Next" }).click();
  }
  expect(heights.size).toBe(1);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+,");
  const dialog = page.getByRole("dialog", { name: "Settings" });
  const sizes = new Set<number>();
  for (const pane of ["Appearance", "Code text", "Reports", "Menus"]) {
    await page.getByLabel("Settings sections").getByRole("button", { name: pane }).click();
    sizes.add(Math.round((await dialog.boundingBox())!.height));
  }
  expect(sizes.size).toBe(1);
});

test("where did this come from traces an object back and finds the lines that depend on it", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "raw <- penguins\nclean <- subset(raw, !is.na(body_mass))\nclean$kg <- clean$body_mass / 1000\nsummary(clean)\nhist(clean$kg)\n");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Control+k");
  await page.keyboard.insertText("where did this come from");
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Where clean came from" });
  await expect(dialog.getByRole("button", { name: "Line 2" })).toBeVisible();
  await expect(dialog).toContainText("Changes it, column kg");
  await expect(dialog).toContainText("2 lines use clean");
  // Following the trace back to what clean was made from, and returning.
  await dialog.getByRole("button", { name: "Where raw came from" }).click();
  await expect(page.getByRole("dialog", { name: "Where raw came from" })).toContainText("Makes it");
  await page.getByRole("button", { name: "Back to clean" }).click();
  await expect(page.getByRole("dialog", { name: "Where clean came from" })).toBeVisible();
  await page.getByRole("button", { name: "Run those 2 lines again" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("running a line again says what changed since last time", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "x <- 1\nx\n");
  await runLine(page);
  await runLine(page);
  const stage = page.getByRole("region", { name: "Stage" });
  await expect(stage).toContainText("[1] 1");
  // Change the first line, run it, then run the second line again.
  const editor = page.locator(".editor-host .cm-content");
  await editor.focus();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("End");
  await page.keyboard.press("Backspace");
  await page.keyboard.insertText("2");
  await runLine(page);
  await runLine(page);
  await expect(stage).toContainText("[1] 2");
  const changed = stage.getByRole("region", { name: "What changed since last time" });
  await changed.getByRole("button", { name: /Since last time: 1 number moved/ }).click();
  await expect(changed).toContainText("1 to 2");
});

test("a teacher turns a line into an exercise, and a student's attempts are checked", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "data(penguins)\nheavy <- subset(penguins, body_mass > 4000)\n");
  const editor = page.locator(".editor-host .cm-content");
  await page.keyboard.press("ArrowDown");
  const command = async (words: string) => {
    await page.keyboard.press("Control+k");
    await page.keyboard.insertText(words);
    await page.keyboard.press("Enter");
  };
  await command("make this line an exercise");
  // The task's placeholder is selected, so typing replaces it.
  await page.waitForTimeout(150);
  await page.keyboard.insertText("Keep the penguins heavier than 4 kg.");
  await expect(editor).toContainText("# exercise: Keep the penguins heavier than 4 kg.");
  await command("save as exercises");
  await expect(page.getByRole("tab", { name: /exercises\.R/ })).toBeVisible();
  await expect(editor).toContainText("heavy <- ___");
  await expect(editor).not.toContainText("body_mass > 4000");
  const bar = page.locator(".exercises-bar");
  await expect(bar).toContainText("0 of 1 exercises done.");

  // The student runs the data line, then tries the blank as it is.
  await editor.click();
  await page.keyboard.press("Control+Home");
  await runLine(page);
  await bar.getByRole("button", { name: "Go to exercise 1" }).click();
  await runLine(page);
  const stage = page.getByRole("region", { name: "Stage" });
  await expect(stage.getByRole("status", { name: "Exercise 1" })).toContainText("Replace ___ with your code");
  // A wrong attempt says what differs, and after two the answer is offered.
  await bar.getByRole("button", { name: "Go to exercise 1" }).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await page.keyboard.insertText("subset(penguins, body_mass > 3000)");
  await runLine(page);
  const verdict = stage.getByRole("status", { name: "Exercise 1" });
  await expect(verdict).toContainText("not yet");
  await expect(verdict).toContainText("It has 344 rows");
  await verdict.getByRole("button", { name: "Show the answer" }).click();
  await expect(editor).toContainText("heavy <- subset(penguins, body_mass > 4000)");
  await bar.getByRole("button", { name: "Go to exercise 1" }).click();
  await runLine(page);
  await expect(stage.getByRole("status", { name: "Exercise 1" })).toContainText("right");
  await expect(bar).toContainText("1 of 1 exercises done.");
});
