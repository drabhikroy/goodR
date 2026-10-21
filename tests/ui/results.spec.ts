import { expect, test, type Page } from "@playwright/test";
import { appState, newFileWith, openExample, runLine } from "./helpers";

// Taking results further: keeping them for next time, writing them out as
// a report, checking a script from scratch, and plots that match the app.

function stage(page: Page) {
  return page.getByRole("region", { name: "Stage" });
}

test("results come back after the app opens again, marked as from last time", async ({ page }) => {
  await openExample(page);
  // Run file, in the example script, which is saved, so its results keep.
  await page.locator(".editor-host .cm-content").click();
  await page.keyboard.press("Control+Shift+Enter");
  await expect
    .poll(() => appState<boolean>(page, "Object.values(state.blocks).some((b) => b.items.length) && !Object.values(state.blocks).some((b) => b.status === 'running' || b.status === 'queued')"))
    .toBe(true);
  // Saving waits for a pause, so the reload waits too.
  await page.waitForTimeout(2200);
  await page.reload();
  await page.getByRole("button", { name: "Use this R" }).click();
  // The file opens from the recent list, and its results come with it.
  await page.getByRole("button", { name: /^analysis\.R/ }).click();
  await expect(page.getByRole("tab", { name: /analysis\.R/ })).toBeVisible();
  await expect(page.getByText("From last time. Run it again to work with what it made.").first()).toBeVisible();
});

test("the results on the canvas become a Quarto report, one chunk per result", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "mass_by_species <- aggregate(body_mass ~ species,\n  data = penguins, FUN = mean)\nmass_by_species\n");
  await runLine(page);
  await runLine(page);
  await expect(stage(page).getByRole("cell", { name: "Gentoo" })).toBeVisible();
  await page.getByRole("button", { name: "More for earlier results" }).click();
  await page.getByRole("menuitem", { name: "Save as a report" }).click();
  await expect(page.getByRole("tab", { name: /results\.qmd/ })).toBeVisible();
  const doc = page.locator(".editor-host .cm-content");
  await expect(doc).toContainText('title: "Results from penguins"');
  await expect(doc).toContainText("```{r}");
  await expect(doc).toContainText("mass_by_species <- aggregate(body_mass ~ species,");
  await expect(doc).toContainText("data = penguins, FUN = mean)");
});

test("Check it runs from scratch says when a line needs something done by hand", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "total <- made_at_the_prompt + 1\ntotal\n");
  await page.evaluate(() => ((window as unknown as { goodforFreshFail: unknown }).goodforFreshFail = { line: 0, message: "object 'made_at_the_prompt' not found" }));
  await page.keyboard.press("Control+k");
  await page.keyboard.insertText("check it runs");
  await page.keyboard.press("Enter");
  const banner = page.getByRole("alert").filter({ hasText: "In a new R, line 1 fails." });
  await expect(banner).toContainText("made_at_the_prompt");
  await expect(banner).toContainText("Write that step into the script.");
  await expect(banner.getByRole("button", { name: "Go to line 1" })).toBeVisible();
  // Once it passes, the banner says so.
  await page.evaluate(() => ((window as unknown as { goodforFreshFail: unknown }).goodforFreshFail = undefined));
  await banner.getByRole("button", { name: "Check again" }).click();
  await expect(page.getByRole("status").filter({ hasText: "It runs from scratch." })).toBeVisible();
});

test("plots matching the app is a choice under Results", async ({ page }) => {
  await openExample(page);
  await page.keyboard.press("Control+,");
  await page.getByLabel("Settings sections").getByRole("button", { name: "Results" }).click();
  const box = page.getByRole("checkbox", { name: /Plots match the app/ });
  await expect(box).not.toBeChecked();
  await box.check();
  await expect(box).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /Keep results for next time/ })).toBeChecked();
});

test("a citation found by title goes into references.bib, the header, and the text", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Use this R" }).click();
  await page.getByRole("button", { name: /^penguins/ }).first().click();
  await expect(page.getByRole("status").filter({ hasText: /^R is ready$/ })).toHaveCount(1);
  await page.getByRole("navigation", { name: "Project" }).getByRole("button", { name: /report\.qmd/ }).click();
  const doc = page.locator(".editor-host .cm-content");
  await doc.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("Falls are recorded every year ");
  await page.keyboard.press("Control+k");
  await page.keyboard.insertText("insert citation");
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Insert citation" });
  await dialog.getByRole("searchbox").fill("meteoritical bulletin");
  await dialog.getByRole("button", { name: "Search" }).click();
  await expect(dialog.getByRole("status")).toContainText("1 work found");
  await dialog.getByRole("button", { name: /The Meteoritical Bulletin/ }).click();
  await expect(dialog).toHaveCount(0);
  await expect(doc).toContainText("bibliography: references.bib");
  await expect(doc).toContainText("Falls are recorded every year [@Gattacceca_2022]");
});

test("the first project ticks off each step as it is done, however it was done", async ({ page }) => {
  await openExample(page);
  await page.keyboard.press("Control+k");
  await page.keyboard.insertText("first project");
  await page.keyboard.press("Enter");
  const card = page.getByRole("region", { name: "Your first project" });
  await expect(card).toContainText("0 of 5 done");
  await expect(card.getByRole("button", { name: "Import a file" })).toBeVisible();
  await newFileWith(page, "data(penguins)\nhead(penguins)\n");
  await runLine(page);
  await runLine(page);
  await expect(card).toContainText("2 of 5 done");
  await expect(card.getByRole("button", { name: "Insert the code" })).toBeVisible();
  await card.getByRole("button", { name: "Close the guide" }).click();
  await expect(card).toHaveCount(0);
});
