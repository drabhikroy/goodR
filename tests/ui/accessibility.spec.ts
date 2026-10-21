import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { expectReady, newFileWith, openExample, runLine } from "./helpers";

// Automated checks against WCAG 2.2 A and AA. They catch missing names,
// broken roles, and contrast in the rendered page. They do not replace
// testing with a screen reader, which these checks cannot do.
async function audit(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const summary = results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`);
  expect(summary).toEqual([]);
}

for (const appearance of ["Light", "Dark", "Paper"]) {
  test(`opening screen and workspace pass in ${appearance.toLowerCase()} appearance`, async ({ page }) => {
    await page.goto("/");
    await audit(page);
    await page.getByRole("button", { name: "Use this R" }).click();
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("radio", { name: appearance, exact: true }).check();
    await audit(page);
    await page.keyboard.press("Escape");
    await audit(page);
    await page.getByRole("button", { name: /^penguins/ }).first().click();
    await expect(page.getByRole("tab", { name: /analysis\.R/ })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: /^R is ready$/ })).toHaveCount(1);
    // Home, reached with work open, offers Continue working back to it.
    await page.getByRole("button", { name: "Show the start screen" }).click();
    await audit(page);
    await page.getByRole("button", { name: "Continue working" }).click();
    await expect(page.getByRole("tab", { name: /analysis\.R/ })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Shift+Control+Enter");
    await expect(page.locator(".output-card.status-error")).toBeVisible();
    await audit(page);
    // The menus that open from the title bar pass too.
    await page.getByRole("button", { name: /^Results/ }).click();
    await audit(page);
    await page.keyboard.press("Escape");
    await page.locator(".project-switch").click();
    await audit(page);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "More for earlier results" }).click();
    await audit(page);
    await page.keyboard.press("Escape");
    // The Layout and Updates pages of Settings pass too.
    await page.keyboard.press("Control+,");
    const sections = page.getByRole("navigation", { name: "Settings sections" });
    await sections.getByRole("button", { name: "Layout", exact: true }).click();
    await audit(page);
    await sections.getByRole("button", { name: "Updates", exact: true }).click();
    await page.getByRole("button", { name: "Check now" }).click();
    await expect(page.locator(".update-list")).toContainText("2 with newer versions");
    await audit(page);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /^penguins data frame/ }).click();
    await expect(page.getByRole("region", { name: "Data viewer, penguins" })).toContainText("Rows 1 to 100");
    await audit(page);
    await page.keyboard.press("Control+Shift+n");
    await audit(page);
    await page.keyboard.press("Escape");
    await newFileWith(page, "plot(1:10)\n");
    await page.keyboard.press("Shift+Control+Enter");
    // A plot shows at full width in its card in the canvas.
    await expect(page.locator(".stage .plot-figure").last().getByRole("button", { name: "Export" })).toBeVisible();
    await page.locator(".stage .plot-figure").last().getByRole("button", { name: "Full size", exact: true }).click();
    await audit(page);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+Shift+e");
    await expect(page.getByRole("dialog", { name: "Export plot" })).toBeVisible();
    await audit(page);
    await page.keyboard.press("Escape");
    // The sheets over the canvas, with a help page showing.
    await page.getByRole("button", { name: "R help" }).click();
    await page.getByRole("searchbox", { name: "Help topic" }).fill("mean");
    await page.getByRole("searchbox", { name: "Help topic" }).press("Enter");
    await expect(page.getByRole("article").getByRole("heading", { name: "Arithmetic Mean" })).toBeVisible();
    await audit(page);
    await page.getByRole("button", { name: "Packages", exact: true }).click();
    await expect(page.locator(".package-row").first()).toBeVisible();
    await page.getByRole("button", { name: "History", exact: true }).click();
    await audit(page);
    await page.getByRole("navigation", { name: "Canvas views" }).getByRole("button", { name: "Canvas", exact: true }).click();
    await page.getByRole("button", { name: "Import data" }).click();
    await page.getByRole("dialog", { name: "Import data" }).getByRole("button", { name: "Choose" }).click();
    await expect(page.getByRole("columnheader", { name: /species/ })).toBeVisible();
    await audit(page);
    await page.keyboard.press("Escape");
  });
}

test("dialogs trap focus and give it back when they close", async ({ page }) => {
  await openExample(page);
  const trigger = page.getByRole("button", { name: /^Results/ });
  await trigger.focus();
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("combobox")).toBeFocused();
  // Tabbing many times never leaves the dialog.
  for (let step = 0; step < 6; step += 1) await page.keyboard.press("Tab");
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest("[role=dialog]")))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});

test("run results are announced to screen readers", async ({ page }) => {
  await openExample(page);
  await runLine(page);
  await expect(page.locator("[aria-live=polite].visually-hidden")).toHaveText(/Line \d+ (finished|did not run)/);
});

// The house minimum for anything a pointer can hit is 44 pixels tall, above
// the 24 pixels WCAG 2.2 AA asks for. A native radio or checkbox counts by
// its label, since clicking anywhere on the label sets it.
async function smallTargets(page: Page) {
  return page.evaluate(() => {
    const selector = "button, a, input, select, textarea, [role=tab], [role=option], [role=switch], [role^=menuitem]";
    return [...document.querySelectorAll<HTMLElement>(selector)]
      // Code text is not a target, but the results placed between its lines are.
      .filter((element) => element.offsetParent && (!element.closest(".cm-content") || element.closest(".cm-output-block")) && element.getAttribute("aria-hidden") !== "true")
      .map((element) => element.closest("label") ?? element)
      .map((element) => ({ name: (element.getAttribute("aria-label") ?? element.textContent ?? "").trim().slice(0, 40), height: element.getBoundingClientRect().height }))
      .filter((target) => target.height < 43.5);
  });
}

test("every pointer target is at least 44 pixels tall", async ({ page }) => {
  await page.goto("/");
  expect(await smallTargets(page)).toEqual([]);
  await openExample(page);
  await page.keyboard.press("Shift+Control+Enter");
  await expect(page.locator(".output-card.status-error")).toBeVisible();
  expect(await smallTargets(page)).toEqual([]);
  // Home, and the opening screen it shows over the still open workspace.
  await page.getByRole("button", { name: "Show the start screen" }).click();
  expect(await smallTargets(page)).toEqual([]);
  await page.getByRole("button", { name: "Continue working" }).click();
  await expect(page.getByRole("tab", { name: /analysis\.R/ })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Control+,");
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  expect(await smallTargets(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+k");
  expect(await smallTargets(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Results/ }).click();
  expect(await smallTargets(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^penguins data frame/ }).click();
  await expect(page.getByRole("region", { name: "Data viewer, penguins" })).toContainText("Rows 1 to 100");
  expect(await smallTargets(page)).toEqual([]);
  await page.keyboard.press("Control+Shift+n");
  expect(await smallTargets(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await newFileWith(page, "plot(1:10)\n");
  await page.keyboard.press("Shift+Control+Enter");
  await expect(page.locator(".stage .plot-figure").last().getByRole("button", { name: "Export" })).toBeVisible();
  await page.keyboard.press("Control+Shift+e");
  await expect(page.getByRole("dialog", { name: "Export plot" })).toBeVisible();
  expect(await smallTargets(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await page.locator(".stage .plot-figure").last().getByRole("button", { name: "Full size", exact: true }).click();
  expect(await smallTargets(page)).toEqual([]);
  await page.keyboard.press("Escape");
  for (const sheet of ["R help", "Packages", "History", "Assistant"]) {
    await page.getByRole("navigation", { name: "Canvas views" }).getByRole("button", { name: sheet, exact: true }).click();
    expect(await smallTargets(page)).toEqual([]);
  }
  // Back to the canvas from the last sheet.
  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  await page.getByRole("button", { name: "Import data" }).click();
  await page.getByRole("dialog", { name: "Import data" }).getByRole("button", { name: "Choose" }).click();
  await expect(page.getByRole("columnheader", { name: /species/ })).toBeVisible();
  expect(await smallTargets(page)).toEqual([]);
});

test("the assistant's setup steps and conversation pass the same checks", async ({ page }) => {
  test.setTimeout(90_000);
  await openExample(page);
  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  await audit(page);
  expect(await smallTargets(page)).toEqual([]);
  await page.getByRole("button", { name: "Set up the assistant" }).click();
  const dialog = page.getByRole("dialog", { name: "Set up the assistant" });
  await audit(page);
  expect(await smallTargets(page)).toEqual([]);
  await dialog.getByRole("button", { name: "Install and continue" }).click();
  await dialog.getByRole("button", { name: "Check this Mac" }).click();
  await audit(page);
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(dialog.locator(".model-card")).toHaveCount(4);
  await audit(page);
  expect(await smallTargets(page)).toEqual([]);
  await dialog.locator(".model-card").filter({ hasText: "Qwen2.5 Coder 3B" }).getByRole("button", { name: /^Download/ }).click();
  await expect(dialog.getByText("In use")).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole("button", { name: "Done" }).click();
  await page.keyboard.press("Shift+Control+Enter");
  await page.locator(".output-card.status-error").getByRole("button", { name: "Ask the assistant" }).click();
  await expect(page.locator(".suggestion-foot").first()).toBeVisible();
  await audit(page);
  expect(await smallTargets(page)).toEqual([]);
});

for (const appearance of ["Light", "Dark"]) {
  test(`every Settings section passes, with large targets, in ${appearance.toLowerCase()} appearance`, async ({ page }) => {
    await openExample(page);
    await page.keyboard.press("Control+,");
    const dialog = page.getByRole("dialog", { name: "Settings" });
    await dialog.getByRole("radio", { name: appearance, exact: true }).check();
    for (const section of ["Appearance", "Code text", "Editor", "Results", "Reports", "Accessibility", "R and packages", "Menus"]) {
      await dialog.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: section }).click();
      await audit(page);
      expect(await smallTargets(page)).toEqual([]);
    }
  });
}

for (const appearance of ["Light", "Dark"]) {
  test(`the Report pane passes while rendering, when done, and when a chunk fails, in ${appearance.toLowerCase()} appearance`, async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Use this R" }).click();
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("radio", { name: appearance, exact: true }).check();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /^penguins/ }).first().click();
    await expectReady(page);
    await page.getByRole("navigation", { name: "Project" }).getByRole("button", { name: /report\.qmd/ }).click();
    // A slow chunk holds the render open long enough to check the progress.
    await page.locator(".editor-host .cm-content").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText("\n```{r wait}\nSys.sleep(30)\n```\n");
    await page.getByRole("button", { name: "Render", exact: true }).click();
    await expect(page.getByRole("progressbar")).toBeVisible();
    await audit(page);
    expect(await smallTargets(page)).toEqual([]);
    await page.getByRole("button", { name: "Stop rendering" }).click();
    await expect(page.getByRole("region", { name: "Report" })).toContainText("Rendering stopped");
    // Done, with the preview.
    await page.locator(".editor-host .cm-content").click();
    await page.keyboard.press("Control+a");
    await page.keyboard.insertText('---\ntitle: "Penguins"\nformat: html\n---\n\n## Mass\n\n```{r}\n1 + 1\n```\n');
    await page.getByRole("button", { name: "Render", exact: true }).click();
    await expect(page.locator(".report-frame")).toBeVisible();
    await audit(page);
    expect(await smallTargets(page)).toEqual([]);
    // A failing chunk.
    await page.locator(".editor-host .cm-content").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText("```{r totals}\nnosuchthing\n```\n");
    await page.getByRole("button", { name: "Render", exact: true }).click();
    await expect(page.getByRole("region", { name: "Report" })).toContainText("did not render");
    await audit(page);
    expect(await smallTargets(page)).toEqual([]);
  });

  test(`the App pane passes while starting, running, with an error inside, and when it will not start, in ${appearance.toLowerCase()} appearance`, async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Use this R" }).click();
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("radio", { name: appearance, exact: true }).check();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /^penguins/ }).first().click();
    await expectReady(page);
    await page.getByRole("navigation", { name: "Project" }).getByRole("button", { name: /app\.R/ }).click();
    await page.getByRole("button", { name: "Run app" }).click();
    await expect(page.getByRole("progressbar", { name: "Starting app.R" })).toBeVisible();
    await audit(page);
    expect(await smallTargets(page)).toEqual([]);
    // The Share dialog, before and after making the web version.
    await page.getByRole("button", { name: "Stop app" }).click();
    await page.getByRole("button", { name: "More for this app" }).click();
    await page.getByRole("menuitem", { name: /Share as a web page/ }).click();
    const share = page.getByRole("dialog", { name: "Share as a web page" });
    await expect(share.getByRole("note")).toBeVisible();
    await audit(page);
    expect(await smallTargets(page)).toEqual([]);
    await share.getByRole("button", { name: "Choose a folder and make it" }).click();
    await expect(share).toContainText("The web version is ready");
    await audit(page);
    expect(await smallTargets(page)).toEqual([]);
    await share.getByRole("button", { name: "Done" }).click();
    // Running, with an error inside the app listed above it.
    await page.locator(".editor-host .cm-content").click();
    await page.keyboard.press("Control+a");
    await page.keyboard.insertText('library(shiny)\nui <- fluidPage(titlePanel("Penguins"))\nserver <- function(input, output) {\n  output$p <- renderPlot(stop("object \'bins\' not found"))\n}\nshinyApp(ui, server)\n');
    await page.getByRole("button", { name: "Run app" }).click();
    await expect(page.getByRole("group", { name: "Errors inside the app" })).toBeVisible();
    await audit(page);
    expect(await smallTargets(page)).toEqual([]);
    // An app that will not start.
    await page.locator(".editor-host .cm-content").click();
    await page.keyboard.press("Control+a");
    await page.keyboard.insertText("library(shiny)\nui <- fluidPage(\n");
    await page.getByRole("button", { name: "Stop app" }).click();
    await page.getByRole("button", { name: "Run app" }).click();
    await expect(page.getByRole("region", { name: "App" })).toContainText("did not start");
    await audit(page);
    expect(await smallTargets(page)).toEqual([]);
  });
}

for (const appearance of ["Light", "Dark", "Paper"]) {
  test(`Help, the examples, and the tour pass in ${appearance.toLowerCase()} appearance`, async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Use this R" }).click();
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("radio", { name: appearance, exact: true }).check();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Help", exact: true }).click();
    await page.getByRole("button", { name: /^Keyboard shortcuts/ }).click();
    await audit(page);
    expect(await smallTargets(page)).toEqual([]);
    await page.getByRole("button", { name: "Start here" }).click();
    await audit(page);
    expect(await smallTargets(page)).toEqual([]);
    await page.getByRole("button", { name: /^Take the tour/ }).click();
    await expect(page.getByRole("dialog", { name: "Where things go" })).toBeVisible();
    await audit(page);
    expect(await smallTargets(page)).toEqual([]);
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Show me" }).click();
    await expect(page.locator(".beacon")).toBeVisible();
    await audit(page);
  });
}

for (const appearance of ["Light", "Dark", "Paper"]) {
  test(`warnings, undo, progress, data and plot changes, quick help, and the app map pass in ${appearance.toLowerCase()} appearance`, async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Use this R" }).click();
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("radio", { name: appearance, exact: true }).check();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /^penguins/ }).first().click();
    await expectReady(page);
    // A warning, explained, with Undo run above it.
    await newFileWith(page, 'data(penguins)\nas.numeric(c("1", "x"))\nhist(penguins$body_mass)\nslow_fit(penguins)');
    await runLine(page);
    await runLine(page);
    await expect(page.locator(".output-warning")).toBeVisible();
    await page.locator(".output-warning").getByRole("button", { name: "Show the R message" }).click();
    await audit(page);
    expect(await smallTargets(page)).toEqual([]);
    // A plot, with its labels open for changing.
    await runLine(page);
    await page.getByRole("button", { name: "Edit labels" }).click();
    await audit(page);
    expect(await smallTargets(page)).toEqual([]);
    // A slow run in progress, then where its time went.
    await runLine(page);
    await expect(page.locator(".run-progress")).toBeVisible();
    await audit(page);
    await page.getByRole("button", { name: /see where the time went/ }).click({ timeout: 6000 });
    await audit(page);
    expect(await smallTargets(page)).toEqual([]);
    // Quick help over a function.
    await page.locator(".editor-host .cm-line", { hasText: "slow_fit" }).getByText("slow_fit").hover();
    await page.mouse.move(0, 0);
    // Changing the data, with a form open.
    await page.locator("#object-cards").getByRole("button", { name: /^penguins / }).click();
    const viewer = page.getByRole("region", { name: "Data viewer, penguins" }).first();
    await viewer.getByRole("button", { name: /^bill_len/ }).click();
    await viewer.getByRole("button", { name: "Keep only some rows" }).click();
    await audit(page);
    expect(await smallTargets(page)).toEqual([]);
    await viewer.getByRole("button", { name: "Rename" }).click();
    await audit(page);
    // The map of a Shiny app.
    await page.getByRole("navigation", { name: "Project" }).getByRole("button", { name: /^app\.R/ }).click();
    await page.getByRole("button", { name: "App", exact: true }).click();
    await page.getByRole("group", { name: "How the app connects" }).getByRole("button", { name: "output$mass" }).click();
    await audit(page);
    expect(await smallTargets(page)).toEqual([]);
  });
}

test("the editing dialogs, the first project, and the compact layout pass the same checks", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "keep <- c(T, F)\nkeep\n");
  await page.keyboard.press("F2");
  await expect(page.getByRole("dialog", { name: "Rename keep" })).toBeVisible();
  await audit(page);
  expect(await smallTargets(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+Shift+f");
  await page.getByRole("searchbox", { name: "Find" }).fill("penguins");
  await expect(page.getByRole("dialog", { name: "Find in all files" }).getByRole("region").first()).toBeVisible();
  await audit(page);
  expect(await smallTargets(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+k");
  await page.keyboard.insertText("first project");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "Your first project" })).toBeVisible();
  await audit(page);
  expect(await smallTargets(page)).toEqual([]);
  await page.keyboard.press("Control+,");
  await page.getByRole("checkbox", { name: /^Compact/ }).check();
  await page.keyboard.press("Escape");
  await audit(page);
  expect(await smallTargets(page)).toEqual([]);
});

test("a menu gives focus back to the button that opened it", async ({ page }) => {
  await openExample(page);
  const arrow = page.getByRole("button", { name: "More ways to run" });
  await arrow.click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(arrow).toBeFocused();
  // Tab closes the menu too, rather than leaving it open behind focus.
  await arrow.click();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(arrow).toBeFocused();
});
