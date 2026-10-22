import { expect, test, type Page } from "@playwright/test";
import { appState, expectReady, newFileWith, openExample, runLine } from "./helpers";

/** The stage, where the output in front is shown. */
function feed(page: Page) {
  return page.getByRole("region", { name: "Stage" });
}

/** The timeline of every output under the stage. */
function timeline(page: Page) {
  return page.getByRole("listbox", { name: "Earlier results" });
}

/** Chooses where results appear from the Results menu. */
async function showResults(page: Page, where: RegExp) {
  await page.getByRole("button", { name: /^Results/ }).click();
  await page.getByRole("menuitemradio", { name: where }).click();
}

test("first run asks which R to use when there are two, then remembers it", async ({ page }) => {
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "Choose which R to use" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("radio", { name: /R 4\.5\.1/ })).toBeChecked();
  await dialog.getByRole("button", { name: "Use this R" }).click();
  await expect(page.getByText("R 4.5.1 is ready, CRAN installer")).toBeVisible();
  expect(await appState<string>(page, "state.settings.rHome")).toContain("4.5");
});

test("scripts open one at a time from the Open dialog, and R starts beside the first", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Use this R" }).click();
  // Stands in for the user choosing two files in the system dialog.
  await page.evaluate(() => (window.goodforPick = ["/Users/demo/Documents/penguins/cleaning.R", "/Users/demo/Documents/penguins/analysis.R"]));
  await page.getByRole("button", { name: "Open script" }).click();
  await expect(page.getByRole("tab", { name: /cleaning\.R/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /analysis\.R/ })).toHaveAttribute("aria-selected", "true");
  await expectReady(page);
  await expect.poll(() => appState<string>(page, "state.r.workingDir")).toBe("/Users/demo/Documents/penguins");
});

test("a script outside any project gets its own R, in its own folder, and says so", async ({ page }) => {
  await openExample(page);
  await page.evaluate(() => (window.goodforPick = ["/Users/demo/Desktop/quick.R"]));
  await page.keyboard.press("Control+o");
  await expect(page.getByRole("tab", { name: /quick\.R/ })).toHaveAttribute("aria-selected", "true");
  // Run straight away, while its R may still be starting: the line waits
  // and runs once R is ready.
  await runLine(page);
  await expect(feed(page).getByText("[1] 3")).toBeVisible();
  expect(await appState<string>(page, "state.r.workingDir")).toBe("/Users/demo/Desktop");
  expect(await appState<string>(page, "state.activeSession")).toBe("file:/Users/demo/Desktop/quick.R");
  expect(await appState<string[]>(page, "state.console.map(e => e.text)")).toContainEqual(expect.stringContaining("started in ~/Desktop, for quick.R on its own"));
});

test("a recent script can be removed from the list without touching the file", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Use this R" }).click();
  await page.getByRole("button", { name: "Remove cleaning.R from this list" }).click();
  await expect(page.getByRole("button", { name: /^cleaning\.R/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^analysis\.R/ })).toBeVisible();
});

test("closing the last script returns to the opening screen", async ({ page }) => {
  await openExample(page);
  await page.keyboard.press("Control+w");
  await expect(page.getByRole("button", { name: "New script" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Scripts", exact: true })).toBeVisible();
});

test("Home shows the opening screen without closing anything, and Continue working returns to it unchanged", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "mass_by_species <- aggregate(body_mass ~ species,\n  data = penguins, FUN = mean)\nmass_by_species\n");
  await runLine(page);
  await runLine(page);
  await expect(feed(page).getByRole("cell", { name: "Gentoo" })).toBeVisible();
  expect(await appState<number>(page, "state.tabs.length")).toBe(2);
  // The objects list is read from R a short moment after the run finishes.
  await expect.poll(() => appState<number>(page, "state.objects.length")).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Show the start screen" }).click();
  await expect(page.getByRole("button", { name: "New project" })).toBeVisible();
  // Nothing closed: both tabs, the output, and R's objects are still there.
  await expect(page.getByRole("tab", { name: "Untitled 1" })).toHaveCount(0);
  expect(await appState<number>(page, "state.tabs.length")).toBe(2);
  expect(await appState<number>(page, "state.objects.length")).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Continue working" }).click();
  await expect(page.getByRole("tab", { name: "Untitled 1" })).toHaveAttribute("aria-selected", "true");
  await expect(feed(page).getByRole("cell", { name: "Gentoo" })).toBeVisible();

  // The keyboard shortcut does the same, and Escape returns the same way
  // as Continue working.
  await page.keyboard.press("Shift+Control+h");
  await expect(page.getByRole("button", { name: "New project" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tab", { name: "Untitled 1" })).toHaveAttribute("aria-selected", "true");
});

test("a new script is named when it is first saved", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "x <- 1\n");
  await page.keyboard.press("Control+s");
  await expect(page.getByRole("tab", { name: "Untitled 1.R" })).toBeVisible();
  expect(await appState<boolean[]>(page, "state.tabs.map(t => t.untitled)")).toEqual([false, false]);
});

test("run line sends the whole statement under the cursor and moves on", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "mass_by_species <- aggregate(body_mass ~ species,\n  data = penguins, FUN = mean)\nmass_by_species\n");
  await runLine(page);
  await expect.poll(() => appState<string[]>(page, "Object.values(state.blocks).map(b => b.code)")).toContain(
    "mass_by_species <- aggregate(body_mass ~ species,\n  data = penguins, FUN = mean)",
  );
  // The assignment printed nothing, so it shows as a gutter check.
  await expect(page.locator(".cm-ran-marker")).toHaveCount(1);
  // The cursor moved to the next statement, so pressing again prints it.
  await runLine(page);
  await expect(feed(page).getByRole("cell", { name: "Gentoo" })).toBeVisible();
});

test("pointing at a result lights up the lines that made it", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "mass_by_species <- aggregate(body_mass ~ species,\n  data = penguins, FUN = mean)\nmass_by_species\n");
  await runLine(page);
  await runLine(page);
  await feed(page).getByRole("button", { name: "Show as printed" }).click();
  await feed(page).locator(".output-card").filter({ hasText: "Gentoo" }).hover();
  await expect(page.locator(".cm-line-linked")).toHaveCount(1);
  await expect(page.locator(".cm-line-linked")).toHaveText("mass_by_species");
});

test("run file stops at the first error and marks the rest as not run", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "x <- 1\nstop('boom')\ny <- 2\n");
  await page.keyboard.press("Shift+Control+Enter");
  await expect(page.locator(".output-card.status-error").getByText("This line did not run")).toBeVisible();
  const skipped = timeline(page).getByRole("option").filter({ hasText: /^Not run/ });
  await expect(skipped).toHaveCount(1);
  await skipped.click();
  await expect(feed(page).getByText("Did not run, because an earlier line stopped")).toBeVisible();
});

test("a misspelled column gets a plain explanation and a working fix", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "data(penguins)\nlm(body_mass ~ flipper_length_mm, data = penguins)\n");
  await runLine(page);
  await runLine(page);
  const card = page.locator(".output-card.status-error");
  await expect(card).toContainText("There is no object named flipper_length_mm. The closest match is flipper_len.");
  await card.getByRole("button", { name: "Show the R message" }).click();
  await expect(card).toContainText("object 'flipper_length_mm' not found");
  await card.getByRole("button", { name: "Use flipper_len" }).click();
  await expect(page.locator(".editor-host .cm-content")).toContainText("lm(body_mass ~ flipper_len, data = penguins)");
  await expect(page.locator(".output-card.status-error")).toHaveCount(0);
});

test("a failed line becomes a forum question with the lines behind it and a sample of the data", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "data(penguins)\nunused <- 1\nlm(body_mass ~ flipper_length_mm, data = penguins)\n");
  await runLine(page);
  await runLine(page);
  await runLine(page);
  await page.locator(".output-card.status-error").getByRole("button", { name: "Ask for help online" }).click();
  const dialog = page.getByRole("dialog", { name: "Ask for help online" });
  const question = dialog.getByRole("textbox", { name: "The question" });
  await expect(question).toHaveValue(/penguins <- structure\(list\(species/);
  await expect(question).toHaveValue(/lm\(body_mass ~ flipper_length_mm, data = penguins\)/);
  await expect(question).toHaveValue(/object 'flipper_length_mm' not found/);
  await expect(question).toHaveValue(/dplyr 1\.1\.4/);
  await expect(question).not.toHaveValue(/unused/);
  await dialog.getByRole("checkbox", { name: /Include a sample of penguins/ }).uncheck();
  await expect(question).toHaveValue(/data\(penguins\)/);
  await expect(question).not.toHaveValue(/structure/);
});

test("missing packages are offered for install before anyone hits the error", async ({ page }) => {
  await openExample(page);
  const banner = page.getByRole("status").filter({ hasText: "Line 19 uses gt, which is not installed yet." });
  await expect(banner).toBeVisible();
  await banner.getByRole("button", { name: "Install gt" }).click();
  // The install shows as a list of packages with where each stands, and
  // R's own log is one press away.
  const card = page.getByRole("region", { name: "Installing packages" });
  await expect(card).toContainText("Done. One package installed.");
  await expect(card.locator(".package-item.is-done")).toContainText("gt");
  await card.getByRole("button", { name: "Show what R printed" }).click();
  await expect(feed(page)).toContainText('install.packages(c("gt"))');
  await expect(banner).toHaveCount(0);
});

test("run becomes stop while R works, and the session keeps working after", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "Sys.sleep(20)\n1 + 1\n");
  await runLine(page);
  // The statement being run carries the running bar in the margin.
  await expect(page.locator(".cm-line-running")).toHaveText("Sys.sleep(20)");
  await page.getByRole("button", { name: /^Stop/ }).click();
  await expect(page.locator(".output-card.status-stopped")).toBeVisible();
  await expect(page.locator(".cm-line-running")).toHaveCount(0);
  await runLine(page);
  await expect(feed(page).getByText("[1] 2")).toBeVisible();
});

test("a readline prompt is answered from the console", async ({ page }) => {
  await openExample(page);
  const input = page.getByRole("textbox", { name: "R console input" });
  await input.fill("answer <- readline('Your name: '); cat('hi', answer)");
  await input.press("Enter");
  const asking = page.getByRole("textbox", { name: "R is asking: Your name: " });
  await expect(asking).toBeFocused();
  await asking.fill("Ada");
  await asking.press("Enter");
  await expect(feed(page)).toContainText("hi Ada");
});

test("results from the script land in the canvas as a card with a link back to their line", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "x <- 5\n1 + 1\n");
  await page.keyboard.press("Shift+Control+Enter");
  const card = feed(page).locator(".output-card").filter({ hasText: "[1] 2" });
  await expect(card).toBeVisible();
  // The quiet assignment shows by its gutter check alone, not as a card.
  await expect(feed(page).locator(".output-card")).toHaveCount(1);
  await card.getByRole("button", { name: "Go to line 2" }).click();
  await expect(page.locator(".editor-host .cm-activeLine")).toHaveText("1 + 1");
  // Running the line again moves its card to the bottom rather than
  // leaving a second copy.
  await runLine(page);
  await expect(feed(page).locator(".output-card")).toHaveCount(1);
});

test("results can sit in the canvas or under each line", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "1 + 1\n");
  await runLine(page);
  await expect(feed(page).getByText("[1] 2")).toBeVisible();
  await showResults(page, /Under each line/);
  await expect(page.locator(".cm-output-block").getByText("[1] 2")).toBeVisible();
  // The stage keeps showing it too, at its full size.
  await expect(feed(page).getByText("[1] 2")).toBeVisible();
  expect(await appState<string>(page, "state.settings.outputLayout")).toBe("inline");
  await showResults(page, /In the canvas/);
  await expect(feed(page).getByText("[1] 2")).toBeVisible();
});

test("the section menu says where the cursor is and jumps elsewhere", async ({ page }) => {
  await openExample(page);
  const sections = page.getByRole("button", { name: /Top of the script/ });
  await sections.click();
  await page.getByRole("menuitem", { name: /Flipper length model/ }).click();
  await expect(page.getByRole("button", { name: /Flipper length model/ })).toBeVisible();
});

test("the command palette finds and runs commands from the keyboard", async ({ page }) => {
  await openExample(page);
  await page.keyboard.press("Control+k");
  const search = page.getByRole("combobox");
  await expect(search).toBeFocused();
  await search.fill("clear all results");
  await search.press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // The palette runs its command just after closing, so this waits for it.
  await expect.poll(() => appState<number>(page, "state.console.length")).toBe(0);
});

test("when R stops unexpectedly, files stay open and Restart brings it back", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "quit()\n");
  await runLine(page);
  const alert = page.getByRole("alert").filter({ hasText: "Your files are safe" });
  await expect(alert).toBeVisible();
  await expect(page.getByRole("tab", { name: /analysis\.R/ })).toBeVisible();
  await alert.getByRole("button", { name: "Restart R" }).click();
  await expectReady(page);
});

test("settings change the palette, appearance, and text size immediately", async ({ page }) => {
  await openExample(page);
  await page.keyboard.press("Control+,");
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.getByRole("radio", { name: "Dark", exact: true }).check();
  await dialog.getByRole("slider", { name: "Text size" }).fill("120");
  await dialog.getByRole("button", { name: "Accessibility" }).click();
  await dialog.getByRole("radio", { name: /Tritanopia/ }).check();
  const root = page.locator("html");
  await expect(root).toHaveAttribute("data-mode", "dark");
  await expect(root).toHaveAttribute("data-palette", "tritanopia");
  // The interface text starts at 15 pixels, so 120 percent is 18.
  expect(await root.evaluate((element) => getComputedStyle(element).fontSize)).toBe("18px");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("unsaved changes are marked and saving clears the mark", async ({ page }) => {
  await openExample(page);
  await page.locator(".editor-host .cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n# a note");
  const tab = page.getByRole("tab", { name: /analysis\.R/ });
  await expect(tab).toContainText("edited");
  await page.keyboard.press("Control+s");
  await expect(tab).not.toContainText("edited");
});

test("results update as you type when asked, and file changes never run that way", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "1 + 1\n");
  await page.getByRole("button", { name: /^Results/ }).click();
  await page.getByRole("menuitemcheckbox", { name: /Update as you type/ }).click();
  await expect(page.getByRole("button", { name: /^Results/ })).toContainText("Live");
  await page.locator(".editor-host .cm-content").click();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("End");
  await page.keyboard.type("0");
  await expect(feed(page).getByText("[1] 11")).toBeVisible();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("install.packages('x')");
  await page.waitForTimeout(900);
  expect(await appState<number>(page, "Object.values(state.blocks).filter(b => b.code.includes('install')).length")).toBe(0);
});

test("R is ready on the opening screen, before anything is opened", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Use this R" }).click();
  await expect(page.getByText("R 4.5.1 is ready, CRAN installer")).toBeVisible();
});

test("under each line, a statement with output becomes one card, input above output", async ({ page }) => {
  await openExample(page);
  await showResults(page, /Under each line/);
  await newFileWith(page, "x <- 1\n1 + 1\n");
  await page.keyboard.press("Shift+Control+Enter");
  await expect(page.locator(".cm-output-block").getByText("[1] 2")).toBeVisible();
  // The quiet assignment is not a card. The printed sum is, with its own
  // line as the input half and the result as the output half.
  await expect(page.locator(".cm-line.cm-cell")).toHaveCount(1);
  await expect(page.locator(".cm-line.cm-cell")).toHaveText("1 + 1");
  await expect(page.locator(".cm-output-block .cell-out")).toContainText("[1] 2");
});

test("a recent project opens with its scripts and data listed, and its data imports through the dialog", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Use this R" }).click();
  await page.getByRole("button", { name: /^penguins/ }).first().click();
  const sidebar = page.getByRole("navigation", { name: "Project" });
  await expect(sidebar.getByRole("button", { name: "cleaning.R" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /analysis\.R/ })).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => appState<string>(page, "state.r.workingDir")).toBe("/Users/demo/Documents/penguins");
  await sidebar.getByRole("button", { name: "Import penguins.csv" }).click();
  const dialog = page.getByRole("dialog", { name: "Import data" });
  // The path is relative to the project, where R works.
  await expect(dialog.locator("pre")).toHaveText('penguins <- read.csv("data/penguins.csv")');
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await sidebar.getByRole("button", { name: "Close project" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
});

test("a new project is created from a template and opened", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Use this R" }).click();
  await page.getByRole("button", { name: "New project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Choose where the project goes first.");
  await dialog.getByRole("radio", { name: /Report/ }).check();
  await dialog.getByRole("textbox", { name: "Project name" }).fill("teacher-survey");
  await dialog.getByRole("button", { name: "Choose" }).click();
  await expect(dialog).toContainText("~/Documents");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("navigation", { name: "Project" })).toContainText("teacher-survey");
  await expect(page.getByRole("tab", { name: /report\.qmd/ })).toBeVisible();
});

test("the data viewer shows columns, sorts, and pages through rows", async ({ page }) => {
  await openExample(page);
  await page.keyboard.press("Shift+Control+Enter");
  await page.getByRole("button", { name: /^penguins data frame/ }).click();
  const viewer = page.getByRole("region", { name: "Data viewer, penguins" });
  await expect(viewer.getByRole("columnheader", { name: /body_mass/ })).toContainText("2 missing");
  await expect(viewer).toContainText("Rows 1 to 100 of 344");
  await viewer.getByRole("button", { name: /^body_mass/ }).click();
  await viewer.getByRole("button", { name: "Sort largest first" }).click();
  await expect(viewer.getByRole("columnheader", { name: /body_mass/ })).toHaveAttribute("aria-sort", "descending");
  await expect(viewer.locator("tbody tr").first().locator("td").nth(4)).toHaveText("6293");
  await viewer.getByRole("button", { name: /Next 100/ }).click();
  await expect(viewer).toContainText("Rows 101 to 200 of 344");
  // The editor comes back with its tab.
  await page.getByRole("tab", { name: /analysis\.R/ }).click();
  await expect(page.locator(".editor-host .cm-content")).toBeVisible();
});

test("the canvas can be resized from the keyboard and remembers its width", async ({ page }) => {
  await openExample(page);
  const edge = page.getByRole("separator", { name: "Canvas width" });
  const before = Number(await edge.getAttribute("aria-valuenow"));
  await edge.focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  const after = Number(await edge.getAttribute("aria-valuenow"));
  expect(after).not.toBe(before);
  expect(await appState<number>(page, "state.settings.inspectorWidth")).toBe(after);
});

test("names complete from R in the editor and the console", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "");
  // Typing three characters opens suggestions, and Tab takes the first.
  await page.keyboard.type("mea");
  await expect(page.getByRole("option", { name: /^mean/ }).first()).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.locator(".editor-host .cm-content")).toContainText("mean");
  // Inside the parentheses, Tab asks for the function's arguments.
  await page.keyboard.type("(");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("option", { name: /na\.rm =/ })).toBeVisible();
  await page.getByRole("option", { name: /na\.rm =/ }).click();
  await expect(page.locator(".editor-host .cm-content")).toContainText("mean(na.rm = )");
  const input = page.getByRole("textbox", { name: "R console input" });
  await input.click();
  await page.keyboard.type("summ");
  await expect(page.getByRole("option", { name: /^summary/ })).toBeVisible();
});

test("a plot fills the stage and opens full size, with every plot a press away in the timeline", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "x <- 1:10\nplot(x)\nhist(x)\n");
  await page.keyboard.press("Shift+Control+Enter");
  // The latest plot is on the stage, as wide as the canvas allows.
  const figure = feed(page).locator(".plot-figure");
  await expect(figure).toHaveCount(1);
  await expect(feed(page)).toContainText("Line 3");
  const box = await figure.boundingBox();
  const canvas = await page.getByRole("complementary", { name: "Canvas" }).boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan((canvas?.width ?? 0) * 0.8);
  expect(box?.height ?? 0).toBeGreaterThan(300);
  // Both plots are in the timeline, and choosing the first shows it.
  const items = timeline(page).getByRole("option").filter({ has: page.locator("img") });
  await expect(items).toHaveCount(2);
  await items.first().click();
  await expect(feed(page)).toContainText("Line 2");
  await expect(items.first()).toHaveAttribute("aria-selected", "true");
  // The arrow keys move along the timeline.
  await items.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(feed(page)).toContainText("Line 3");
  // The objects sit as cards along the canvas's top.
  await expect(page.getByRole("region", { name: "Objects in R" }).getByRole("button", { name: /^x / })).toBeVisible();
  // Full size, with the arrows moving between plots.
  await figure.getByRole("button", { name: "Full size", exact: true }).click();
  await expect(page.getByRole("dialog", { name: /Plot 2 of 2/ })).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("dialog", { name: /Plot 1 of 2/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // The title bar's toggle hides and brings back the whole canvas.
  const toggle = page.getByRole("button", { name: "Show the canvas" });
  await toggle.click();
  await expect(page.getByRole("complementary", { name: "Canvas" })).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(page.getByRole("complementary", { name: "Canvas" })).toBeVisible();
});

test("the stage follows the cursor, and a pinned output stays for comparing", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "1 + 1\nplot(1:10)\n2 * 3\n");
  await page.keyboard.press("Shift+Control+Enter");
  await expect(feed(page)).toContainText("[1] 6");
  // Moving the cursor onto the plot's line brings the plot back.
  await page.locator(".editor-host .cm-content").click();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("ArrowDown");
  await expect(feed(page).locator(".plot-figure")).toBeVisible();
  // Pinned, it stays above whatever the cursor shows next.
  await feed(page).getByRole("button", { name: "Pin" }).click();
  await page.locator(".editor-host .cm-content").focus();
  await page.keyboard.press("ArrowUp");
  await expect(feed(page).getByRole("group", { name: "Pinned output" }).locator(".plot-figure")).toBeVisible();
  await expect(feed(page).getByRole("group", { name: "Output", exact: true })).toContainText("[1] 2");
  await feed(page).getByRole("button", { name: "Unpin" }).click();
  await expect(feed(page).getByRole("group", { name: "Pinned output" })).toHaveCount(0);
});

test("a data frame shown by its name is a table on the stage", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "mass_by_species <- aggregate(body_mass ~ species,\n  data = penguins, FUN = mean)\nmass_by_species\n");
  await runLine(page);
  await runLine(page);
  await expect(feed(page).getByRole("region", { name: /Data viewer, mass_by_species/ })).toContainText("3 rows");
  await feed(page).getByRole("button", { name: "Show as printed" }).click();
  await expect(feed(page).locator(".output-card")).toContainText("Gentoo");
});

test("under each line, a plot is a small preview that opens full size", async ({ page }) => {
  await openExample(page);
  await showResults(page, /Under each line/);
  await newFileWith(page, "plot(1:10, main = 'Mass')\n");
  await page.keyboard.press("Control+Enter");
  const plot = page.locator(".output-plot");
  await expect(plot).toBeVisible();
  const box = await plot.boundingBox();
  expect(box?.height ?? 0).toBeLessThan(120);
  await plot.click();
  await expect(page.getByRole("dialog", { name: /Plot 1 of 1/ })).toBeVisible();
});

test("the canvas never grows wider than the window allows, even at a size remembered from a wider one", async ({ page }) => {
  await openExample(page);
  const splitter = page.getByRole("separator", { name: "Canvas width" });
  await splitter.focus();
  await page.keyboard.press("End");
  const wide = await page.locator(".canvas").boundingBox();
  expect(wide?.width ?? 0).toBeGreaterThan(700);
  // The window narrows, as it would on a smaller screen or a resize, with
  // no further change to the remembered width.
  await page.setViewportSize({ width: 760, height: 900 });
  await expect.poll(async () => (await page.locator(".canvas").boundingBox())?.width ?? 0).toBeLessThan((wide?.width ?? 0) - 100);
});

test("a plot exports at a chosen size and format, redrawn by R", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "plot(1:10, main = 'Mass')\n");
  await page.keyboard.press("Shift+Control+Enter");
  // Export sits on the plot's own card in the canvas.
  await feed(page).locator(".plot-figure").getByRole("button", { name: "Export" }).click();
  const dialog = page.getByRole("dialog", { name: "Export plot" });
  // A journal preset fills in its size and switches to a format that stays
  // sharp at any zoom.
  await dialog.getByRole("radio", { name: /Journal, two columns/ }).check();
  await expect(dialog.getByRole("radio", { name: /PDF/ })).toBeChecked();
  await expect(dialog.getByRole("spinbutton", { name: "Width, inches" })).toHaveValue("7.2");
  await expect(dialog.getByRole("combobox", { name: "Resolution" })).toBeDisabled();
  await expect(dialog).toContainText("plot(1:10, main = 'Mass')");
  // A size R would refuse is caught before anything is written.
  await dialog.getByRole("spinbutton", { name: "Width, inches" }).fill("0");
  await expect(dialog.getByRole("alert")).toContainText("between 0.5 and 60 inches");
  await expect(dialog.getByRole("button", { name: "Export", exact: true })).toBeDisabled();
  await dialog.getByRole("spinbutton", { name: "Width, inches" }).fill("4");
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Exported plot-1.pdf")).toBeVisible();
});

test("exporting a plot made with random numbers says the sample will differ", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "hist(rnorm(100))\n");
  await page.keyboard.press("Shift+Control+Enter");
  await expect(feed(page).locator(".plot-figure")).toBeVisible();
  await page.keyboard.press("Shift+Control+E");
  const dialog = page.getByRole("dialog", { name: "Export plot" });
  await expect(dialog.getByRole("note")).toContainText("does not call set.seed()");
  await expect(dialog).toContainText("2,000 by 1,126 pixels");
});

test("unsaved work survives the window reloading", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "kept <- 42\n");
  // Drafts are copied shortly after each edit.
  await page.waitForTimeout(600);
  await page.reload();
  const useR = page.getByRole("button", { name: "Use this R" });
  if (await useR.isVisible().catch(() => false)) await useR.click();
  await expect(page.locator(".editor-host .cm-content")).toContainText("kept <- 42");
});

test("?topic and F1 open R help in the Help pane, and links between pages work", async ({ page }) => {
  await openExample(page);
  const input = page.getByRole("textbox", { name: "R console input" });
  await input.click();
  await page.keyboard.type("?mean");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "R help" })).toHaveAttribute("aria-pressed", "true");
  const frame = page.getByRole("article");
  await expect(frame.getByRole("heading", { name: "Arithmetic Mean" })).toBeVisible();
  // Scripts, handlers, images, and outside links in a help file never
  // reach the app.
  await frame.getByText("Details").click();
  expect(await page.evaluate(() => (window as unknown as { helpRan?: boolean }).helpRan)).toBeUndefined();
  await expect(frame.locator("script, img, [onclick], [onerror]")).toHaveCount(0);
  await expect(frame.getByRole("link", { name: "site" })).toHaveCount(0);
  // A link names another page, which opens in the same pane.
  await frame.getByRole("link", { name: "sd" }).click();
  await expect(frame.getByRole("heading", { name: "Standard Deviation" })).toBeVisible();
  await page.getByRole("button", { name: "Previous help page" }).click();
  await expect(frame.getByRole("heading", { name: "Arithmetic Mean" })).toBeVisible();
  // A topic in two packages asks which one.
  await page.getByRole("searchbox", { name: "Help topic" }).fill("filter");
  await page.getByRole("searchbox", { name: "Help topic" }).press("Enter");
  await expect(page.getByText("filter is in more than one package")).toBeVisible();
  // F1 looks up the name at the cursor in the script.
  await newFileWith(page, "sd(x)\n");
  await page.keyboard.press("F1");
  await expect(frame.getByRole("heading", { name: "Standard Deviation" })).toBeVisible();
});

test("history sends commands back to the console or into the script", async ({ page }) => {
  await openExample(page);
  const input = page.getByRole("textbox", { name: "R console input" });
  await input.click();
  await page.keyboard.type("1 + 1");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "History", exact: true }).click();
  const history = page.getByRole("region", { name: "Console history" });
  await expect(history.locator(".history-code")).toHaveText(["1 + 1"]);
  await history.getByRole("button", { name: "To console" }).click();
  await expect(input).toHaveText("1 + 1");
  await newFileWith(page, "");
  await history.getByRole("button", { name: "To script" }).click();
  await expect(page.locator(".editor-host .cm-content")).toContainText("1 + 1");
});

test("the Packages pane lists installed packages and attaches through the console", async ({ page }) => {
  await openExample(page);
  await page.getByRole("button", { name: "Packages", exact: true }).click();
  const pane = page.getByRole("region", { name: "Packages" });
  await expect(pane.getByRole("checkbox", { name: "Attach dplyr" })).not.toBeChecked();
  await pane.getByRole("searchbox", { name: "Search packages" }).fill("grammar");
  await expect(pane.locator(".package-row")).toHaveCount(2);
  await pane.getByRole("checkbox", { name: "Attach dplyr" }).check();
  // The sheet stays open, and the command is in the feed behind it.
  await expect(pane).toBeVisible();
  await page.getByRole("navigation", { name: "Canvas views" }).getByRole("button", { name: "Canvas", exact: true }).click();
  await expect(feed(page)).toContainText("library(dplyr)");
});

test("RStudio's insert shortcuts type a pipe, an assignment, and a section", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "");
  await page.keyboard.type("x");
  await page.keyboard.press("Alt+-");
  await page.keyboard.type("data");
  await page.keyboard.press("Shift+Control+m");
  await page.keyboard.type("head()");
  await expect(page.locator(".editor-host .cm-content")).toContainText("x <- data |> head()");
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+Control+r");
  await page.keyboard.type("Clean up");
  await expect(page.locator(".editor-host .cm-content")).toContainText("# Clean up ----");
});

test("Import data previews a file through R, writes the code, and runs it", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "");
  await page.getByRole("button", { name: "Import data" }).click();
  const dialog = page.getByRole("dialog", { name: "Import data" });
  await dialog.getByRole("button", { name: "Choose" }).click();
  // The preview shows the first rows with each column's type.
  await expect(dialog.getByRole("columnheader", { name: /species/ })).toBeVisible();
  await expect(dialog.locator("pre")).toHaveText('penguins <- read.csv("data/penguins.csv")');
  // Each choice changes the code and the preview together.
  await dialog.getByRole("checkbox", { name: "The first row holds column names" }).uncheck();
  await expect(dialog.locator("pre")).toHaveText('penguins <- read.csv("data/penguins.csv", header = FALSE)');
  await expect(dialog.getByRole("columnheader", { name: /V1/ })).toBeVisible();
  await dialog.getByRole("checkbox", { name: "The first row holds column names" }).check();
  await dialog.getByRole("radio", { name: "Semicolon" }).check();
  await dialog.getByRole("textbox", { name: "Missing values are written as" }).fill("NA, -99");
  await expect(dialog.locator("pre")).toHaveText('penguins <- read.csv("data/penguins.csv", sep = ";", na.strings = c("NA", "-99"))');
  // A name R cannot use is caught.
  await dialog.getByRole("textbox", { name: "Name in R" }).fill("2026 data");
  await expect(dialog.getByRole("alert")).toContainText("starting with a letter");
  await expect(dialog.getByRole("button", { name: "Import", exact: true })).toBeDisabled();
  await dialog.getByRole("textbox", { name: "Name in R" }).fill("birds");
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(feed(page)).toContainText('birds <- read.csv("data/penguins.csv", sep = ";"');
  // The code also went into the script, so the import reruns with it.
  await expect(page.locator(".editor-host .cm-content")).toContainText("birds <- read.csv(");
});

test("a line that adds to a plot, such as abline, updates that plot and shows its own card", async ({ page }) => {
  await openExample(page);
  await showResults(page, /Under each line/);
  await newFileWith(page, "plot(1:10)\nabline(a = 0, b = 1)\n");
  await runLine(page);
  await expect.poll(() => appState<number>(page, "state.plots.length")).toBe(1);
  await runLine(page);
  // The second line is the last statement. It must still run and show.
  await expect(page.locator(".cm-output-block")).toHaveCount(2);
  // The plot is redrawn in place, not added a second time, and keeps both lines of code.
  // A card appears when its line is queued, so the update is waited for.
  await expect.poll(() => appState<string>(page, "state.plots[0].code")).toContain("abline(a = 0, b = 1)");
  expect(await appState<number>(page, "state.plots.length")).toBe(1);
  expect(await appState<string>(page, "state.plots[0].code")).toContain("plot(1:10)");
});

test("abline before any plot explains that there is no plot to add to", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "abline(a = 0, b = 1)\n");
  await runLine(page);
  await expect(feed(page)).toContainText(/plot/i);
});

test("selected lines are visibly highlighted, including the line the cursor is on", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "x <- 1\ny <- 2\nz <- 3\n");
  await page.locator(".editor-host .cm-content").focus();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
  const selected = await page.evaluate(() => {
    const selection = window.getSelection();
    const line = document.querySelector(".editor-host .cm-line");
    const style = line ? getComputedStyle(line, "::selection") : null;
    return { text: selection?.toString() ?? "", background: style?.backgroundColor ?? "" };
  });
  expect(selected.text).toContain("x <- 1");
  expect(selected.text).toContain("y <- 2");
  // The page's selection color, which the contrast audit covers, not the browser default.
  const expected = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.background = getComputedStyle(document.documentElement).getPropertyValue("--selection");
    document.body.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  });
  expect(selected.background).toBe(expected);
});

test("an error says what happened in plain words and marks the exact spot, in the card and in the code", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "data(penguins)\nfit <- lm(body_mass ~ flipper_length_mm, data = penguins)\n");
  await runLine(page);
  await runLine(page);
  const card = page.locator(".output-card.status-error");
  await expect(card.locator(".error-title")).toHaveText("R could not find “flipper_length_mm”");
  // The card shows the line and points at the failing part, not just the line.
  await expect(card.locator(".error-where figcaption")).toHaveText("Where it went wrong, line 2");
  await expect(card.locator(".error-where mark")).toHaveText("flipper_length_mm");
  // The same part is underlined in the editor, with a note for hover.
  const underline = page.locator(".editor-host .cm-problem");
  await expect(underline).toHaveText("flipper_length_mm");
  await expect(underline).toHaveAttribute("title", /could not find/);
  // Go to the spot selects the marked part so it can be retyped at once.
  await card.getByRole("button", { name: "Go to the spot" }).click();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("flipper_length_mm");
  // Editing the marked part removes the underline, since it no longer describes the code.
  await page.keyboard.type("flipper_len");
  await expect(page.locator(".editor-host .cm-problem")).toHaveCount(0);
});

test("a console error is written in plain words with carets under the failing part", async ({ page }) => {
  await openExample(page);
  await page.locator("#console-input").click();
  // The stand-in R fails on a bare unknown name, as real R does.
  await page.keyboard.type("nosuchthing");
  await page.keyboard.press("Enter");
  const log = feed(page);
  await expect(log).toContainText("R could not find “nosuchthing”");
  await expect(log).toContainText("^^^^^^^^^^^");
  await expect(log).toContainText("Try this:");
});

test("a syntax error is placed by asking R's parser, since the console message has no position", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "a <- 1\nmean_x total\n");
  await page.keyboard.press("ArrowDown");
  await runLine(page);
  const card = page.locator(".output-card.status-error");
  await expect(card.locator(".error-title")).toHaveText("R did not expect a name here");
  await expect(card.locator(".error-where mark")).toHaveText("total");
  await expect(page.locator(".editor-host .cm-problem")).toHaveText("total");
});

test("Help opens over the workspace without closing anything, one topic at a time", async ({ page }) => {
  await openExample(page);
  // Help lives in the menu bar and the search, not as a button.
  await page.keyboard.press("Control+k");
  await page.keyboard.insertText("Help for this app");
  await page.keyboard.press("Enter");
  const article = page.getByRole("article");
  await expect(page.getByRole("heading", { name: "Start here" })).toBeVisible();
  const topics = page.getByRole("navigation", { name: "Help topics" });
  const canvas = topics.getByRole("button", { name: "The canvas" });
  await canvas.click();
  await expect(canvas).toHaveAttribute("aria-current", "page");
  await expect(article).toContainText("shows one result at a time");
  // Another topic replaces the first, and Next walks on through them.
  await topics.getByRole("button", { name: "Keyboard shortcuts" }).click();
  await expect(article).toContainText("Run line or selection");
  await article.getByRole("button", { name: /^Next: Settings/ }).click();
  await expect(page.getByRole("heading", { name: "Settings and accessibility" })).toBeVisible();
  // Searching narrows the topics, and Return opens the first match.
  const search = page.getByRole("searchbox", { name: "Search help" });
  await search.fill("reactive");
  await expect(topics.getByRole("button")).toHaveText(["Shiny apps"]);
  await search.press("Enter");
  await expect(page.getByRole("heading", { name: "Shiny apps" })).toBeVisible();
  await search.fill("zzzz");
  await expect(topics).toContainText("Nothing matches that");
  // Escape first clears the search, then returns to the workspace as it was.
  await page.keyboard.press("Escape");
  await expect(search).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tab", { name: /analysis\.R/ })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Shift+Control+/");
  await expect(page.getByRole("heading", { name: "Start here" })).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("tab", { name: /analysis\.R/ })).toBeVisible();
});

test("the example project opens with every example, and its first script runs", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Use this R" }).click();
  await page.getByRole("button", { name: "Open the examples" }).click();
  const sidebar = page.getByRole("navigation", { name: "Project" });
  await expect(sidebar).toContainText("R Examples");
  for (const name of ["01-first-steps.R", "03-plots.R", "05-when-things-go-wrong.R", "06-report.qmd", "07-notebook.Rmd", "08-rmarkdown-basics.Rmd"]) {
    await expect(sidebar.getByRole("button", { name })).toBeVisible();
  }
  // Four Shiny apps, each in a folder of its own.
  await expect(sidebar.getByRole("button", { name: "app.R" })).toHaveCount(4);
  for (const name of ["meteorites.csv", "exoplanets.csv", "launches.csv", "bright_stars.csv"]) {
    await expect(sidebar.getByRole("button", { name: `Import ${name}` })).toBeVisible();
  }
  await expect(page.getByRole("tab", { name: /01-first-steps\.R/ })).toHaveAttribute("aria-selected", "true");
  await expectReady(page);
  // The first statement is 1 + 1, on line 8.
  await page.locator(".editor-host .cm-content").click();
  await page.keyboard.press("Control+Home");
  for (let line = 0; line < 7; line += 1) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Control+Enter");
  await expect(feed(page).getByText("[1] 2")).toBeVisible();
});

test("the tour steps through the workspace, and Show me points at each part in place", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Use this R" }).click();
  await page.getByRole("button", { name: "Take the tour" }).click();
  const tour = page.getByRole("dialog", { name: "Where things go" });
  await expect(tour).toBeVisible();
  await expect(page.getByRole("tab", { name: /01-first-steps\.R/ })).toBeVisible();
  await tour.getByRole("button", { name: "Next" }).click();
  const run = page.getByRole("dialog", { name: "Running a line" });
  await expect(run).toBeVisible();
  // Show me sets the card aside, rings the Run button, then brings it back.
  await run.getByRole("button", { name: "Show me" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".beacon")).toContainText("Run");
  await expect(page.locator(".beacon-ring")).toHaveCount(3);
  await expect(run).toBeVisible({ timeout: 8000 });
  await expect(page.locator(".beacon")).toHaveCount(0);
  // The arrow keys move between steps, and the last one starts work.
  await page.keyboard.press("ArrowLeft");
  await expect(tour).toBeVisible();
  for (let step = 0; step < 10; step += 1) await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("dialog", { name: "When something goes wrong" })).toBeVisible();
  await page.getByRole("button", { name: "Start working" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await appState<boolean>(page, "state.settings.tourSeen")).toBe(true);
});

test("Show me in Help closes Help and rings the part of the app it names", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Use this R" }).click();
  await page.getByRole("button", { name: "Help", exact: true }).click();
  // With nothing open, the examples open first so there is something to show.
  await page.getByRole("group", { name: "Show me in the app" }).first().getByRole("button", { name: "The R prompt" }).click();
  await expect(page.getByRole("heading", { name: "Start here" })).toHaveCount(0);
  await expect(page.locator(".beacon")).toContainText("The R prompt");
  // A click anywhere clears the rings early.
  await page.mouse.click(5, 300);
  await expect(page.locator(".beacon")).toHaveCount(0);
});

test("the opening screen groups starting and opening, and offers a Shiny app", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Use this R" }).click();
  await page.getByRole("button", { name: "New Shiny app" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await expect(dialog.getByRole("radio", { name: /Shiny/ })).toBeChecked();
});

test("results under each line still show large on the stage", async ({ page }) => {
  await openExample(page);
  await showResults(page, /Under each line/);
  await newFileWith(page, "plot(1:10)\n");
  await page.keyboard.press("Control+Enter");
  await expect(page.locator(".cm-output-block .output-plot")).toBeVisible();
  await expect(feed(page).locator(".plot-figure")).toBeVisible();
});

test("the search in the title bar looks names up in R help", async ({ page }) => {
  await openExample(page);
  await page.getByRole("button", { name: "Search help and commands" }).click();
  const search = page.getByRole("combobox");
  await search.fill("sd");
  await page.getByRole("option", { name: /Look up sd in R help/ }).click();
  await expect(page.getByRole("button", { name: "R help" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("article").getByRole("heading", { name: "Standard Deviation" })).toBeVisible();
});

test("pressing an output in the timeline puts the cursor on its line, and the line shows where the stage came from", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "1 + 1\nplot(1:10)\n2 * 3\n");
  await page.keyboard.press("Shift+Control+Enter");
  await expect(feed(page)).toContainText("[1] 6");
  await expect(page.locator(".editor-host .cm-line-staged")).toHaveText("2 * 3");
  await timeline(page).getByRole("option").filter({ hasText: "Line 2" }).click();
  await expect(page.locator(".editor-host .cm-activeLine")).toHaveText("plot(1:10)");
  await expect(page.locator(".editor-host .cm-line-staged")).toHaveText("plot(1:10)");
  // The stage's own line link goes there too.
  await timeline(page).getByRole("option").filter({ hasText: "Line 1" }).click();
  await feed(page).getByRole("button", { name: "Line 1", exact: true }).click();
  await expect(page.locator(".editor-host .cm-activeLine")).toHaveText("1 + 1");
});

test("a long run's outputs can be filtered, and are grouped by section", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "# Numbers ----\n1 + 1\n2 + 2\n3 + 3\n# Pictures ----\nplot(1:3)\nplot(1:4)\nstop('no')\n4 + 4\n");
  await page.keyboard.press("Shift+Control+Enter");
  const filters = page.getByRole("radiogroup", { name: "Show in earlier results" });
  await expect(filters).toBeVisible();
  await expect(filters.getByRole("radio", { name: /Plots 2/ })).toBeVisible();
  await filters.getByRole("radio", { name: /Plots/ }).click();
  await expect(timeline(page).getByRole("option")).toHaveCount(2);
  await filters.getByRole("radio", { name: /Problems/ }).click();
  await expect(timeline(page).getByRole("option")).toHaveCount(2);
  await filters.getByRole("radio", { name: /All/ }).click();
  await expect(page.locator(".timeline-section")).toHaveText(["Numbers", "Pictures"]);
});

test("the R prompt sits under the script", async ({ page }) => {
  await openExample(page);
  const prompt = await page.locator(".composer").boundingBox();
  const script = await page.locator(".sheet").boundingBox();
  const canvas = await page.locator(".canvas").boundingBox();
  expect(prompt!.x).toBeLessThan(canvas!.x);
  expect(prompt!.y).toBeGreaterThan(script!.y + script!.height - 1);
});

test("everything that can be updated is listed on one page, and the app updates in place", async ({ page }) => {
  await openExample(page);
  // The Packages sheet's check opens the same page as Check for updates.
  await page.getByRole("button", { name: "Packages", exact: true }).click();
  await page.getByRole("button", { name: "Check for updates" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Updates", exact: true })).toHaveAttribute("aria-current", "page");
  const list = dialog.locator(".update-list");
  await expect(list).toContainText("2 with newer versions");
  await expect(list).toContainText("ggplot2 3.5.0 to 3.5.2");
  await expect(list.getByRole("button", { name: "Get R 4.5.2" })).toBeVisible();
  await list.getByRole("button", { name: "Update to 1.1.0" }).click();
  await expect(list.getByRole("button", { name: "Restart to finish" })).toBeVisible();
  // Updating packages leaves the page open, and it looks again after.
  page.once("dialog", (question) => question.accept());
  await list.getByRole("button", { name: "Update all" }).click();
  await expect(dialog).toBeVisible();
  await expect(list).toContainText("2 with newer versions");
  // Choosing to look only when asked is remembered.
  await dialog.getByRole("radio", { name: "Only when I ask" }).check();
  expect(await appState<string>(page, "state.settings.updateChecks")).toBe("manual");
});
