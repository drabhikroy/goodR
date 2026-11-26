import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { expectReady, openProjectMenu, showObjects } from "../ui/helpers";

// One test per screenshot, each starting from a fresh window, so a change
// to one screen never shifts the others.

async function save(page: Page, info: TestInfo, name: string) {
  // The caret blinks and fonts load late; both would make each run differ.
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: "*, *::before, *::after { caret-color: transparent !important; transition: none !important; animation: none !important; } .notice { display: none !important; }" });
  await page.screenshot({ path: `docs/images/${name}-${info.project.name}.png` });
}

/** Opens the app and picks R, in the appearance this run is for. */
async function start(page: Page, info: TestInfo) {
  // A first run's layout, not the stand-in's, which keeps the sidebar and
  // the strip of earlier results on for the interface tests.
  await page.addInitScript(() => {
    window.goodforSettings = { showSidebar: false, showTimeline: false, consoleInputHeight: 48, layoutVersion: 2 };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Use this R" }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("radio", { name: info.project.name === "dark" ? "Dark" : "Light", exact: true }).check();
  await page.keyboard.press("Escape");
  // Closing Settings puts focus back on its button, which would show a ring.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

/** Opens the penguins project at analysis.R, with R ready. */
async function openProject(page: Page, info: TestInfo) {
  await start(page, info);
  await page.getByRole("button", { name: /^penguins/ }).first().click();
  await expect(page.getByRole("tab", { name: /analysis\.R/ })).toBeVisible();
  await expectReady(page);
}

async function openFile(page: Page, name: RegExp) {
  await (await openProjectMenu(page)).getByRole("menuitem", { name }).click();
  await expect(page.getByRole("tab", { name })).toHaveAttribute("aria-selected", "true");
}

test("opening screen", async ({ page }, info) => {
  await start(page, info);
  await expect(page.getByRole("button", { name: /^penguins/ }).first()).toBeVisible();
  await save(page, info, "opening");
});

test("workspace after running the script", async ({ page }, info) => {
  await openProject(page, info);
  // Each statement in turn, up to the plot, as someone working through the
  // script would. The last line needs a package the example leaves out.
  await page.locator(".editor-host .cm-content").click();
  await page.keyboard.press("Control+Home");
  for (let statement = 0; statement < 7; statement += 1) {
    await page.keyboard.press("Control+Enter");
    await expectReady(page);
  }
  await expect(page.locator(".output-card").first()).toBeVisible();
  await save(page, info, "workspace");
});

test("data viewer", async ({ page }, info) => {
  await openProject(page, info);
  await page.locator(".editor-host .cm-content").click();
  await page.keyboard.press("Control+Home");
  for (let line = 0; line < 3; line += 1) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Control+Enter");
  await (await showObjects(page)).getByRole("button", { name: /^penguins / }).click();
  await expect(page.getByRole("region", { name: "Data viewer, penguins" }).first()).toContainText("Rows 1 to 100");
  await save(page, info, "data-viewer");
});

test("report preview", async ({ page }, info) => {
  await openProject(page, info);
  await openFile(page, /report\.qmd/);
  await page.getByRole("button", { name: "Render", exact: true }).click();
  const preview = page.frameLocator('iframe[title="Preview of report.html"]');
  await expect(preview.getByRole("heading", { name: "Penguin measurements" })).toBeVisible();
  await save(page, info, "report");
});

test("Shiny app and how its parts connect", async ({ page }, info) => {
  await start(page, info);
  await page.getByRole("button", { name: "Open the examples" }).click();
  // The second app.R is the space launches app, whose map has the most to show.
  await (await openProjectMenu(page)).getByRole("menuitem", { name: "shiny-launches/app.R" }).click();
  await page.getByRole("button", { name: "App", exact: true }).click();
  const map = page.getByRole("group", { name: "How the app connects" });
  await map.getByRole("button", { name: "output$failures" }).click();
  await expect(map.getByRole("button", { name: "input$years" })).toHaveClass(/is-linked/);
  await save(page, info, "shiny");
});

test("Help", async ({ page }, info) => {
  await start(page, info);
  await page.getByRole("button", { name: "Help", exact: true }).click();
  await page.getByRole("button", { name: "Start here" }).click();
  await save(page, info, "help");
});

test("Code text settings", async ({ page }, info) => {
  await openProject(page, info);
  await page.keyboard.press("Control+,");
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Code text" }).click();
  await save(page, info, "settings-code");
});

test("the tour", async ({ page }, info) => {
  await openProject(page, info);
  await page.keyboard.press("Control+k");
  await page.keyboard.insertText("take the tour");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await save(page, info, "tour");
});

test("importing data", async ({ page }, info) => {
  await openProject(page, info);
  await (await openProjectMenu(page)).getByRole("menuitem", { name: "Import penguins.csv" }).click();
  const dialog = page.getByRole("dialog", { name: "Import data" });
  await expect(dialog.locator("pre")).toHaveText('penguins <- read.csv("data/penguins.csv")');
  await expect(dialog).not.toContainText("R is reading the first rows");
  await save(page, info, "import-data");
});

test("likely mistakes in a Shiny app", async ({ page }, info) => {
  await openProject(page, info);
  await openFile(page, /app\.R/);
  await page.locator(".editor-host .cm-content").click();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText('library(shiny)\n\nui <- fluidPage(\n  sliderInput("bins", "Bins", 5, 50, 20),\n  plotOutput("mass")\n)\n\nserver <- function(input, output) {\n  output$mas <- renderPlot(hist(penguins$body_mass, breaks = input$bins))\n}\n\nshinyApp(ui, server)\n');
  // The list starts folded to one line. It is shown open here, since what it says is the point.
  const list = page.getByRole("region", { name: "Likely mistakes in this app" });
  await expect(list).toContainText("1 likely mistake in this app");
  await list.getByRole("button", { name: "Show" }).click();
  await expect(list).toContainText("output$mas has no place in the UI");
  await save(page, info, "shiny-check");
});

/** Sets up the assistant with the private Ollama, up to its list of models. */
async function setUpAssistant(page: Page) {
  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  await page.getByRole("button", { name: "Set up the assistant" }).click();
  const dialog = page.getByRole("dialog", { name: "Set up the assistant" });
  await dialog.getByRole("button", { name: "Install and continue" }).click();
  await expect(dialog.locator("[aria-current=step]")).toContainText("This computer", { timeout: 10_000 });
  await dialog.getByRole("button", { name: "Check this computer" }).click();
  await expect(dialog.locator(".specs")).toContainText("16 GB");
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(dialog.locator(".model-card")).toHaveCount(4);
  return dialog;
}

test("assistant setup", async ({ page }, info) => {
  await openProject(page, info);
  await setUpAssistant(page);
  await save(page, info, "assistant-setup");
});

test("the assistant fixing an error", async ({ page }, info) => {
  await openProject(page, info);
  const dialog = await setUpAssistant(page);
  await dialog.locator(".model-card").filter({ hasText: "Qwen2.5 Coder 3B" }).getByRole("button", { name: /^Download/ }).click();
  await expect(dialog.getByText("In use")).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "New script" }).click();
  await page.locator(".editor-host .cm-content").click();
  await page.keyboard.insertText("data(penguins)\nfit <- lm(body_mass ~ flipper_length_mm, data = penguins)\n");
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("Control+Enter");
  await expectReady(page);
  await page.keyboard.press("Control+Enter");
  await page.locator(".output-card.status-error").getByRole("button", { name: "Ask the assistant" }).click();
  await expect(page.locator(".turn-answer").last().getByRole("button", { name: "Replace line 2" })).toBeVisible();
  await save(page, info, "assistant");
});
