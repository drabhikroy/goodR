import { expect, test, type Page } from "@playwright/test";
import { expectReady, newFileWith, openExample, runLine } from "./helpers";

// The fourteen improvements made together: warnings, undo, progress,
// safety for unsaved work, quick help, snippets, focus mode, Paper, data
// and plot edits that write code, the reactive map, and the live report.

/** The stage, where the output in front is shown. */
function stage(page: Page) {
  return page.getByRole("region", { name: "Stage" });
}

/** Types a command at the R prompt under the script and runs it. */
async function typeAtPrompt(page: Page, code: string) {
  const input = page.getByRole("textbox", { name: "R console input" });
  await input.click();
  await page.keyboard.insertText(code);
  await page.keyboard.press("Enter");
}

test("a warning is explained in plain words, with R's own message one press away", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, 'as.numeric(c("1", "x", "3"))');
  await runLine(page);
  const warning = stage(page).getByRole("group", { name: /^Warning: Some values could not be turned into numbers/ });
  await expect(warning).toBeVisible();
  await expect(stage(page)).toContainText("[1]  1 NA  3");
  await warning.getByRole("button", { name: "Show the R message" }).click();
  await expect(warning).toContainText("NAs introduced by coercion");
});

test("a failed install says which system library is missing, with the command to copy", async ({ page }) => {
  await openExample(page);
  await typeAtPrompt(page, 'install.packages("xml2")');
  const warning = stage(page).getByRole("group", { name: /^Warning: xml2 did not install/ });
  await expect(warning).toBeVisible();
  await expect(warning).toContainText("needs libxml2");
  await expect(warning.locator("code")).toHaveText("brew install libxml2");
  // The long build log is folded away, and one press brings it back.
  await expect(stage(page).getByLabel("Install log")).toHaveCount(0);
  await stage(page).getByRole("button", { name: "Show the install log" }).click();
  await expect(stage(page).getByLabel("Install log")).toContainText("ANTICONF ERROR");
});

test("Undo puts back what the last run changed, from the stage or the Run menu", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "x <- 1\ny <- aggregate(1)\nx");
  // One press of Run file is one run.
  await page.keyboard.press("Control+Shift+Enter");
  await expect(stage(page)).toContainText("[1] 1");
  const objectCards = page.locator("#object-cards");
  await expect(objectCards.getByRole("button", { name: /^y / })).toBeVisible();
  await stage(page).getByRole("button", { name: "Undo run" }).click();
  await expect(page.locator(".notice")).toContainText("Undid the last run. Removed x and y, which the run made.");
  await expect(objectCards.getByRole("button", { name: /^y / })).toHaveCount(0);
  await expect(stage(page)).toContainText("Undone. The objects this run changed are back as they were.");
  // There is nothing more to undo, and the Run menu says so by graying it.
  await expect(stage(page).getByRole("button", { name: "Undo run" })).toHaveCount(0);
  await page.getByRole("button", { name: "More ways to run" }).click();
  await expect(page.getByRole("menuitem", { name: /Undo the last run/ })).toBeDisabled();
  await page.keyboard.press("Escape");
  // The shortcut works for a command typed at the prompt too.
  await typeAtPrompt(page, "z <- 5");
  await expect(objectCards.getByRole("button", { name: /^z / })).toBeVisible();
  await page.keyboard.press("Alt+Control+z");
  await expect(page.locator(".notice")).toContainText("Removed z");
  await expect(objectCards.getByRole("button", { name: /^z / })).toHaveCount(0);
});

test("a slow run shows its progress, then where its time went", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "slow_fit(penguins)");
  await runLine(page);
  const progress = page.locator(".run-progress");
  await expect(progress).toContainText("Running line 1");
  await expect(progress.getByRole("button", { name: "Stop" })).toBeVisible();
  await expect(progress).toHaveCount(0, { timeout: 5000 });
  await stage(page).getByRole("button", { name: /see where the time went/ }).click();
  const spent = stage(page).getByRole("group", { name: "Where the time went" });
  await expect(spent).toContainText("lm.fit");
  await expect(spent).toContainText("79 percent");
});

test("a run that mostly waited says so instead of listing functions", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "Sys.sleep(2.2)");
  await runLine(page);
  await stage(page).getByRole("button", { name: /see where the time went/ }).click({ timeout: 6000 });
  await expect(stage(page).getByRole("group", { name: "Where the time went" })).toContainText("waiting rather than working");
});

test("unsaved work comes back after the app closes unexpectedly, and says so", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "kept <- 42\n");
  await page.waitForTimeout(600);
  // A new launch, as after a crash, rather than a reload of the window.
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  const useR = page.getByRole("button", { name: "Use this R" });
  if (await useR.isVisible().catch(() => false)) await useR.click();
  await expect(page.locator(".notice")).toContainText("Brought back unsaved changes to Untitled");
  await expect(page.locator(".editor-host .cm-content")).toContainText("kept <- 42");
});

test("files can save by themselves after typing stops, when that is chosen", async ({ page }) => {
  await openExample(page);
  await page.keyboard.press("Control+,");
  await page.getByRole("button", { name: "Editor", exact: true }).click();
  await page.getByRole("checkbox", { name: /Save files automatically/ }).check();
  await page.keyboard.press("Escape");
  await page.locator(".editor-host .cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("\n# saved by itself\n");
  await expect(page.getByRole("tab", { name: /analysis\.R/ })).toContainText("edited");
  await expect(page.getByRole("tab", { name: /analysis\.R/ })).not.toContainText("edited", { timeout: 4000 });
});

test("after R stops, one press restarts it and runs the script back to where it was", async ({ page }) => {
  await openExample(page);
  await page.locator(".editor-host .cm-content").click();
  await page.keyboard.press("Control+Home");
  for (let line = 0; line < 3; line += 1) await page.keyboard.press("ArrowDown");
  // Run to the cursor, on line 4, data(penguins).
  await page.keyboard.press("Alt+Control+b");
  await expect(page.locator("#object-cards").getByRole("button", { name: /^penguins / })).toBeVisible();
  await typeAtPrompt(page, "quit()");
  const banner = page.getByRole("alert");
  await expect(banner).toContainText("R quit.");
  await banner.getByRole("button", { name: "Restart and run to line 4" }).click();
  await expectReady(page);
  await expect(page.locator("#object-cards").getByRole("button", { name: /^penguins / })).toBeVisible();
});

test("resting the pointer on a function or an object shows quick help, and Escape closes it", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "data(penguins)\nmean(penguins$body_mass)");
  await runLine(page);
  await expect(page.locator("#object-cards").getByRole("button", { name: /^penguins / })).toBeVisible();
  await page.locator(".editor-host .cm-line", { hasText: "mean(" }).getByText("mean", { exact: true }).hover();
  const tip = page.locator(".quick-help");
  await expect(tip).toContainText("mean, from base");
  await expect(tip).toContainText("Arithmetic Mean");
  await expect(tip.locator("code")).toHaveText("mean(x, trim = 0, na.rm = FALSE, ...)");
  await page.keyboard.press("Escape");
  await expect(tip).toHaveCount(0);
  // An object says what it holds, without asking R.
  await page.mouse.move(0, 0);
  // "penguins" starts five characters in, after "mean(", and every
  // character of code is the same width.
  const box = (await page.locator(".editor-host .cm-line", { hasText: "mean(" }).getByText("mean", { exact: true }).boundingBox())!;
  const width = box.width / 4;
  await page.mouse.move(box.x + width * 7, box.y + box.height / 2);
  await expect(tip).toContainText("Data frame, 344 rows, 8 columns");
});

test("ready made code is in the search under Insert, with its blanks selected in turn", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "");
  await expect(page.locator(".editor-host .cm-placeholder")).toContainText("type insert for ready made code");
  await page.keyboard.press("Control+k");
  await page.keyboard.type("insert csv");
  const option = page.getByRole("option", { name: /Insert: Read a CSV file/ });
  await expect(option).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".editor-host .cm-content")).toContainText('data <- read.csv("data.csv")');
  // The first blank is selected, so typing replaces it.
  await page.keyboard.type("penguins.csv");
  await expect(page.locator(".editor-host .cm-content")).toContainText('read.csv("penguins.csv")');
});

test("focus mode leaves the script and the result, and the way out stays in view", async ({ page }) => {
  await openExample(page);
  await expect(page.locator(".composer")).toBeVisible();
  await page.keyboard.press("Alt+Control+f");
  await expect(page.locator(".composer")).toBeHidden();
  await expect(page.locator(".sidebar")).toHaveCount(0);
  await expect(page.locator(".canvas-bar")).toBeHidden();
  await expect(stage(page)).toBeVisible();
  await page.getByRole("button", { name: "Leave focus" }).click();
  await expect(page.locator(".composer")).toBeVisible();
  await expect(page.locator(".sidebar")).toBeVisible();
});

test("Paper is an appearance of its own", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Use this R" }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("radio", { name: "Paper" }).check();
  await expect(page.locator("html")).toHaveAttribute("data-mode", "paper");
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--surface").trim())).toBe("#FBF8F2");
});

test("keeping some rows from the data viewer writes the line into the script and runs it", async ({ page }) => {
  await openExample(page);
  await page.locator(".editor-host .cm-content").click();
  await page.keyboard.press("Control+Home");
  for (let line = 0; line < 3; line += 1) await page.keyboard.press("ArrowDown");
  await runLine(page);
  await page.locator("#object-cards").getByRole("button", { name: /^penguins / }).click();
  const viewer = page.getByRole("region", { name: "Data viewer, penguins" }).first();
  await viewer.getByRole("button", { name: /^bill_len/ }).click();
  await viewer.getByRole("button", { name: "Keep only some rows" }).click();
  await viewer.getByLabel("Comparison").selectOption({ label: "more than" });
  await viewer.getByLabel("Value").fill("40");
  await viewer.getByRole("button", { name: "Keep these rows" }).click();
  await expect(page.locator(".notice")).toContainText(/Added line \d+ to analysis\.R and ran it: kept the rows where bill_len is more than 40/);
  await page.getByRole("tab", { name: /analysis\.R/ }).click();
  await expect(page.locator(".editor-host .cm-content")).toContainText("penguins <- subset(penguins, bill_len > 40)");
  await expect(page.locator("#object-cards").getByRole("button", { name: /^penguins data frame, 120 rows/ })).toBeVisible();
});

test("a plot's labels can be changed from the stage, in the code that drew it", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "hist(penguins$body_mass)");
  await runLine(page);
  await stage(page).getByRole("button", { name: "Edit labels" }).click();
  const form = stage(page).getByRole("form", { name: "Plot labels" });
  await form.getByLabel("Title").fill("Body mass");
  await form.getByLabel("Horizontal axis").fill("Grams");
  await form.getByRole("radio", { name: /Color 1 of the palette/ }).check();
  await form.getByRole("button", { name: "Apply" }).click();
  await expect(page.locator(".editor-host .cm-content")).toContainText('hist(penguins$body_mass, main = "Body mass", xlab = "Grams", col = "#');
  await expect(stage(page).locator(".plot-figure")).toBeVisible();
  // The old picture is replaced, not kept beside the new one.
  await expect(page.getByRole("listbox", { name: "Earlier results" }).getByRole("option")).toHaveCount(1);
});

test("a Shiny app's App sheet maps how its parts connect, before and while it runs", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Use this R" }).click();
  await page.getByRole("button", { name: "Open the examples" }).click();
  // The second app.R is the space launches app.
  await page.getByRole("navigation", { name: "Project" }).getByRole("button", { name: "app.R" }).nth(1).click();
  await page.getByRole("button", { name: "App", exact: true }).click();
  const map = page.getByRole("group", { name: "How the app connects" });
  await expect(map).toBeVisible();
  await map.getByRole("button", { name: "output$failures" }).click();
  await expect(page.locator(".shiny-map-detail")).toContainText("output$failures reads shown().");
  // The path runs back through the reactive to both inputs.
  await expect(map.getByRole("button", { name: "input$years" })).toHaveClass(/is-linked/);
  await expect(map.getByRole("button", { name: "input$who" })).toHaveClass(/is-linked/);
  // Once the app runs, the map is one switch away from the app itself.
  await page.getByRole("button", { name: "Run app", exact: true }).first().click();
  await page.getByRole("radio", { name: "How it connects" }).click();
  await expect(map).toBeVisible();
});
