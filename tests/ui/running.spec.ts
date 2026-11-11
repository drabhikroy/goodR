import { expect, test, type Page } from "@playwright/test";
import { appState, expectReady, newFileWith, openExample } from "./helpers";

/** The code of every result card, in order. */
function cardCodes(page: Page) {
  return appState<string[]>(page, "state.blockOrder.map((id) => state.blocks[id].code)");
}

/** Opens the penguins project's Quarto report. */
async function openReport(page: Page) {
  await openExample(page);
  await page.getByRole("navigation", { name: "Project" }).getByRole("button", { name: /report\.qmd/ }).click();
  await expect(page.getByRole("tab", { name: /report\.qmd/ })).toHaveAttribute("aria-selected", "true");
}

/** Puts the cursor at the start of a line, counting from one. */
async function cursorTo(page: Page, line: number) {
  await page.locator(".editor-host .cm-content").click();
  await page.keyboard.press("Control+Home");
  for (let at = 1; at < line; at += 1) await page.keyboard.press("ArrowDown");
}

test("Run is a split button, and the way it runs stays as it was last chosen", async ({ page }) => {
  await openExample(page);
  const run = page.getByRole("button", { name: "Run line", exact: true });
  await expect(run).toBeVisible();
  await page.getByRole("button", { name: "More ways to run" }).click();
  const menu = page.getByRole("menu", { name: "More ways to run" });
  // Every way to run, with its shortcut, and a script's chunk is its
  // section. The browser build shows shortcuts as Windows and Linux do.
  await expect(menu.getByRole("menuitemradio", { name: /Run line/ }).locator("kbd")).toHaveText(/Ctrl.*Enter/);
  await expect(menu.getByRole("menuitemradio", { name: /Run section/ }).locator("kbd")).toHaveText(/Ctrl.*Alt.*C|Alt.*Ctrl.*C/);
  await expect(menu.getByRole("menuitemradio", { name: /Run file/ }).locator("kbd")).toHaveText(/Shift.*Enter/);
  await expect(menu.getByRole("menuitemradio", { name: /Run line/ })).toHaveAttribute("aria-checked", "true");
  // Choosing one runs it now, and the button keeps it.
  await menu.getByRole("menuitemradio", { name: /Run file/ }).click();
  await expect.poll(async () => (await cardCodes(page)).length).toBeGreaterThan(3);
  await expect(page.getByRole("button", { name: "Run file", exact: true })).toBeVisible();
  expect(await appState<{ script: string; document: string }>(page, "state.settings.runMode")).toEqual({ script: "file", document: "chunk" });
  // It stays for the next script too, until it is changed by hand.
  await newFileWith(page, "1 + 1\n");
  await expect(page.getByRole("button", { name: "Run file", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "More ways to run" }).click();
  await expect(page.getByRole("menuitemradio", { name: /Run file/ })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("menuitemradio", { name: /Run line/ }).click();
  await expect(page.getByRole("button", { name: "Run line", exact: true })).toBeVisible();
});

test("a document keeps its own choice, apart from scripts", async ({ page }) => {
  await openReport(page);
  await expect(page.getByRole("button", { name: "Run chunk", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "More ways to run" }).click();
  await page.getByRole("menuitemradio", { name: /Run file/ }).click();
  await expect(page.getByRole("button", { name: "Run file", exact: true })).toBeVisible();
  // Scripts were not changed by it.
  await newFileWith(page, "1 + 1\n");
  await expect(page.getByRole("button", { name: "Run line", exact: true })).toBeVisible();
  // And the shortcut for another way runs it without changing the button.
  await page.keyboard.press("Control+Enter");
  await expect(page.getByRole("button", { name: "Run line", exact: true })).toBeVisible();
});

test("Run section runs the lines under the section comment the cursor is in", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "a <- 1\n\n# Model ----\nb <- 2\nc <- 3\n\n# Plot ----\nd <- 4\n");
  await cursorTo(page, 5);
  await page.keyboard.press("Alt+Control+c");
  await expect.poll(() => cardCodes(page)).toEqual(["b <- 2", "c <- 3"]);
});

test("a document runs only its R chunks, and its Run button runs the chunk", async ({ page }) => {
  await openReport(page);
  // A document's Run button runs the chunk by default.
  await expect(page.getByRole("button", { name: "Run chunk", exact: true })).toBeVisible();
  // Run file sends the R code, never the header or the prose.
  await page.keyboard.press("Shift+Control+Enter");
  await expect.poll(() => cardCodes(page)).toEqual(["aggregate(body_mass ~ species, data = penguins, FUN = mean)"]);
  // A line of prose says where code can run.
  await cursorTo(page, 6);
  await page.keyboard.press("Control+Enter");
  await expect(page.getByText("This line is text, not code.")).toBeVisible();
});

test("each chunk's header has a Run button, and Insert chunk adds one", async ({ page }) => {
  await openReport(page);
  await page.locator(".editor-host .cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Alt+Control+i");
  await page.keyboard.insertText("x <- 42");
  await expect(page.locator(".cm-chunk-run")).toHaveCount(2);
  await page.locator(".cm-chunk-run").nth(1).click();
  await expect.poll(() => cardCodes(page)).toEqual(["x <- 42"]);
  await expect.poll(() => appState<string[]>(page, "state.objects.map((object) => object.name)")).toContain("x");
});

test("New document makes a Quarto or R Markdown file that runs and renders", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Use this R" }).click();
  await page.keyboard.press("Alt+Control+n");
  const dialog = page.getByRole("dialog", { name: "New document" });
  await expect(dialog.getByRole("radio", { name: /Quarto/ })).toBeChecked();
  await dialog.getByRole("textbox", { name: "Title" }).fill("Speed study");
  await dialog.getByRole("radio", { name: /^PDF/ }).check();
  await expect(dialog).toContainText("Saved as speed-study.qmd");
  await dialog.getByRole("button", { name: "Create document" }).click();
  await expect(page.getByRole("tab", { name: /speed-study\.qmd/ })).toHaveAttribute("aria-selected", "true");
  const text = await page.locator(".editor-host .cm-content").innerText();
  expect(text).toContain('title: "Speed study"');
  expect(text).toContain("format: typst");
  // It renders and runs as a document straight away.
  await expect(page.getByRole("button", { name: "Render", exact: true })).toBeVisible();
  await expect(page.locator(".cm-chunk-run")).toHaveCount(3);
  await page.keyboard.press("Shift+Control+Enter");
  await expectReady(page);
  await expect.poll(() => cardCodes(page)).toEqual(["library(stats)", "summary(quakes$mag)", "plot(lat ~ long, data = quakes, cex = quakes$mag - 3)"]);
});

test("a failed line lists the names it was using, and the one R has nothing under comes first", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "x <- 5\nlm(flipper_length_mm ~ x)\n");
  await page.keyboard.press("Shift+Control+Enter");
  const using = page.getByRole("region", { name: "What this line was using" });
  await expect(using).toBeVisible();
  const rows = using.getByRole("listitem");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("flipper_length_mm");
  await expect(rows.first()).toContainText("R has nothing called this right now");
  await expect(rows.nth(1)).toContainText("x");
});

test("after a failed line is fixed, Run from here carries on without running what came before", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "1 + 1\nmissing_thing\n3 + 3\n4 + 4\n");
  await page.keyboard.press("Shift+Control+Enter");
  await expect.poll(() => cardCodes(page)).toContain("missing_thing");
  // The two lines after the failure did not run.
  await expect(page.getByRole("button", { name: "Run from line 2 on" })).toBeVisible();
  // Fix line 2, then continue from it.
  await cursorTo(page, 2);
  await page.keyboard.press("Shift+End");
  await page.keyboard.insertText("5 + 5");
  await page.getByRole("button", { name: "Run from line 2 on" }).click();
  await expect.poll(() => cardCodes(page)).toEqual(["1 + 1", "5 + 5", "3 + 3", "4 + 4"]);
  // The first line stayed first, so it was not run again, and nothing is
  // left failed.
  await expect(page.locator(".problems-button")).toHaveCount(0);
});

test("problems can be stepped through, going round at the ends", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "a <- 1\nmissing_one\nb <- 2\nmissing_two\n");
  await cursorTo(page, 2);
  await page.keyboard.press("Control+Enter");
  await page.keyboard.press("Control+Enter");
  await page.keyboard.press("Control+Enter");
  await expect(page.getByRole("button", { name: "2 problems" })).toBeVisible();
  const active = page.locator(".editor-host .cm-activeLine");
  // From the end of the file, the next problem goes round to the first.
  await page.keyboard.press("F8");
  await expect(active).toHaveText("missing_one");
  await page.keyboard.press("F8");
  await expect(active).toHaveText("missing_two");
  await page.keyboard.press("Shift+F8");
  await expect(active).toHaveText("missing_one");
  // The explanation of the line the cursor is on is the one on the stage.
  await expect(page.getByRole("region", { name: "Stage" })).toContainText("missing_one");
  // The button in the bar goes to the next one too.
  await page.getByRole("button", { name: "2 problems" }).click();
  await expect(active).toHaveText("missing_two");
});
