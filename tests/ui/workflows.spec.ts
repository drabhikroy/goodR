import { expect, test, type Page } from "@playwright/test";
import { appState, expectReady, newFileWith, openExample, runLine } from "./helpers";

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
  // Stands in for the person choosing two files in the system dialog.
  await page.evaluate(() => (window.goodforPick = ["/Users/demo/Documents/penguins/cleaning.R", "/Users/demo/Documents/penguins/analysis.R"]));
  await page.getByRole("button", { name: "Open script" }).click();
  await expect(page.getByRole("tab", { name: /cleaning\.R/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /analysis\.R/ })).toHaveAttribute("aria-selected", "true");
  await expectReady(page);
  await expect.poll(() => appState<string>(page, "state.r.workingDir")).toBe("/Users/demo/Documents/penguins");
});

test("R follows the script being run into its folder, and says so", async ({ page }) => {
  await openExample(page);
  await page.evaluate(() => (window.goodforPick = ["/Users/demo/Desktop/quick.R"]));
  await page.keyboard.press("Control+o");
  await expect(page.getByRole("tab", { name: /quick\.R/ })).toHaveAttribute("aria-selected", "true");
  await runLine(page);
  await expect(page.locator(".cm-output-block").getByText("[1] 3")).toBeVisible();
  expect(await appState<string>(page, "state.r.workingDir")).toBe("/Users/demo/Desktop");
  await expect(page.getByRole("log")).toContainText("Working folder is now ~/Desktop, where quick.R is");
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
  await expect(page.locator(".cm-output-block").getByText("Gentoo")).toBeVisible();
});

test("pointing at a result lights up the lines that made it", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "mass_by_species <- aggregate(body_mass ~ species,\n  data = penguins, FUN = mean)\nmass_by_species\n");
  await runLine(page);
  await runLine(page);
  await page.locator(".cm-output-block .output-card").filter({ hasText: "Gentoo" }).hover();
  await expect(page.locator(".cm-line-linked")).toHaveCount(1);
  await expect(page.locator(".cm-line-linked")).toHaveText("mass_by_species");
});

test("run file stops at the first error and marks the rest as not run", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "x <- 1\nstop('boom')\ny <- 2\n");
  await page.keyboard.press("Shift+Control+Enter");
  await expect(page.locator(".output-card.status-error").getByText("This line did not run")).toBeVisible();
  await expect(page.locator(".output-card").getByText("Did not run, because an earlier line stopped")).toBeVisible();
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

test("missing packages are offered for install before anyone hits the error", async ({ page }) => {
  await openExample(page);
  const banner = page.getByRole("status").filter({ hasText: "Line 19 uses gt, which is not installed yet." });
  await expect(banner).toBeVisible();
  await banner.getByRole("button", { name: "Install gt" }).click();
  await expect(page.getByRole("log")).toContainText('install.packages(c("gt"))');
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
  await expect(page.locator(".cm-output-block").getByText("[1] 2")).toBeVisible();
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
  await expect(page.getByRole("log")).toContainText("hi Ada");
});

test("results from the editor stay beside the code and out of the console", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "1 + 1\n");
  await runLine(page);
  await expect(page.locator(".cm-output-block").getByText("[1] 2")).toBeVisible();
  expect(await appState<string[]>(page, "state.console.map(e => e.text)")).not.toContain("[1] 2");
});

test("results can sit under each line, beside, or below the code", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "1 + 1\n");
  await runLine(page);
  await expect(page.locator(".cm-output-block").getByText("[1] 2")).toBeVisible();
  await showResults(page, /Beside the code/);
  await expect(page.locator(".layout-side .output-column").getByText("[1] 2")).toBeVisible();
  await expect(page.locator(".cm-output-block").getByText("[1] 2")).toHaveCount(0);
  await showResults(page, /Below the code/);
  await expect(page.locator(".layout-stacked .output-column").getByText("[1] 2")).toBeVisible();
  expect(await appState<string>(page, "state.settings.outputLayout")).toBe("stacked");
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
  await search.fill("clear console");
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
  await expect(page.locator(".cm-output-block").getByText("[1] 11")).toBeVisible();
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

test("a statement with output becomes one card, input above output", async ({ page }) => {
  await openExample(page);
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

test("the console can be resized from the keyboard and remembers its height", async ({ page }) => {
  await openExample(page);
  const edge = page.getByRole("separator", { name: "Console height" });
  const before = Number(await edge.getAttribute("aria-valuenow"));
  await edge.focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(edge).toHaveAttribute("aria-valuenow", String(before + 48));
  expect(await appState<number>(page, "state.settings.consoleHeight")).toBe(before + 48);
  // The typing box has its own edge, so a long statement gets room.
  const box = page.getByRole("separator", { name: "Console typing box height" });
  const typing = Number(await box.getAttribute("aria-valuenow"));
  await box.focus();
  await page.keyboard.press("ArrowUp");
  await expect(box).toHaveAttribute("aria-valuenow", String(typing + 20));
  const height = await page.locator(".console-input-row").evaluate((element) => element.getBoundingClientRect().height);
  expect(Math.round(height)).toBe(typing + 20);
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

test("a plot exports at a chosen size and format, redrawn by R", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "plot(1:10, main = 'Mass')\n");
  await page.keyboard.press("Shift+Control+Enter");
  await page.getByRole("button", { name: "Export" }).click();
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
  await expect(page.getByText("Plot 1 of 1")).toBeVisible();
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
  await expect(page.getByRole("tab", { name: "Help" })).toHaveAttribute("aria-selected", "true");
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
  await page.getByRole("tab", { name: "History" }).click();
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
  await page.getByRole("tab", { name: "Packages" }).click();
  const pane = page.getByRole("region", { name: "Packages" });
  await expect(pane.getByRole("checkbox", { name: "Attach dplyr" })).not.toBeChecked();
  await pane.getByRole("searchbox", { name: "Search packages" }).fill("grammar");
  await expect(pane.locator(".package-row")).toHaveCount(2);
  await pane.getByRole("checkbox", { name: "Attach dplyr" }).check();
  await expect(page.getByRole("log")).toContainText("library(dplyr)");
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
  await expect(page.getByRole("log")).toContainText('birds <- read.csv("data/penguins.csv", sep = ";"');
  // The code also went into the script, so the import reruns with it.
  await expect(page.locator(".editor-host .cm-content")).toContainText("birds <- read.csv(");
});

test("a line that adds to a plot, such as abline, updates that plot and shows its own card", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "plot(1:10)\nabline(a = 0, b = 1)\n");
  await runLine(page);
  await expect.poll(() => appState<number>(page, "state.plots.length")).toBe(1);
  await runLine(page);
  // The second line is the last statement. It must still run and show.
  await expect(page.locator(".cm-output-block")).toHaveCount(2);
  // The plot is redrawn in place, not added a second time, and keeps both lines of code.
  expect(await appState<number>(page, "state.plots.length")).toBe(1);
  expect(await appState<string>(page, "state.plots[0].code")).toContain("abline(a = 0, b = 1)");
  expect(await appState<string>(page, "state.plots[0].code")).toContain("plot(1:10)");
});

test("abline before any plot explains that there is no plot to add to", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "abline(a = 0, b = 1)\n");
  await runLine(page);
  await expect(page.locator(".cm-output-block")).toContainText(/plot/i);
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
  const log = page.getByRole("log");
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
