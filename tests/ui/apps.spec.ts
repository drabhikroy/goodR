import { expect, test, type Page } from "@playwright/test";
import { expectReady } from "./helpers";

/** Opens the penguins project and its Shiny app. */
async function openApp(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Use this R" }).click();
  await page.getByRole("button", { name: /^penguins/ }).first().click();
  await expectReady(page);
  await page.getByRole("navigation", { name: "Project" }).getByRole("button", { name: /app\.R/ }).click();
  await expect(page.getByRole("tab", { name: /app\.R/ })).toHaveAttribute("aria-selected", "true");
}

/** Replaces the whole script in the editor with `text`. */
async function replaceScript(page: Page, text: string) {
  await page.locator(".editor-host .cm-content").click();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText(text);
}

/** What Open in browser handed to the system in the stand-in. */
function opened(page: Page) {
  return page.evaluate(() => (globalThis as unknown as { goodforApps: { opened: string[] } }).goodforApps.opened);
}

test("Run app shows only for Shiny apps, and the app runs beside the code", async ({ page }) => {
  await openApp(page);
  // The App sheet is there for any Shiny app in front, with the map of how
  // its parts connect, and running the app brings it forward.
  await expect(page.getByRole("button", { name: "App", exact: true })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Run app" }).click();
  await expect(page.getByRole("button", { name: "App", exact: true })).toHaveAttribute("aria-pressed", "true");
  const app = page.frameLocator('iframe[title="The running app, app.R"]');
  await expect(app.getByRole("heading", { name: "Penguin explorer" })).toBeVisible();
  // While it runs, the title bar offers Stop app, and Run line still works.
  await expect(page.getByRole("button", { name: "Stop app" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run line" })).toBeEnabled();
  const pane = page.getByRole("region", { name: "App" });
  await pane.getByRole("button", { name: "Open in browser" }).click();
  await expect.poll(async () => (await opened(page)).length).toBe(1);
  await pane.getByRole("button", { name: "Show what the app printed" }).click();
  await expect(page.locator('pre[aria-label="What the app printed"]')).toContainText("Listening on http://127.0.0.1:5123");

  await pane.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(pane).toContainText("The app stopped");
  await expect(page.getByRole("button", { name: "Run app" })).toBeVisible();

  // Another script in the project is not an app, so it has no Run app.
  await page.getByRole("navigation", { name: "Project" }).getByRole("button", { name: /cleaning\.R/ }).click();
  await expect(page.getByRole("button", { name: "Run app" })).toHaveCount(0);
});

test("a syntax error is explained and marked in the script", async ({ page }) => {
  await openApp(page);
  await replaceScript(page, 'library(shiny)\nui <- fluidPage(\n  titlePanel("Penguins")\nserver <- function(input, output) {}\nshinyApp(ui, server)\n');
  await page.getByRole("button", { name: "Run app" }).click();
  // The app reads its files from disk, so running saves them first.
  await expect(page.getByRole("tab", { name: /app\.R/ })).not.toContainText("edited");
  const pane = page.getByRole("region", { name: "App" });
  await expect(pane).toContainText("app.R did not start");
  await expect(pane).toContainText("The code stops before it is finished");
  await expect(pane.getByRole("button", { name: "Run again" }).first()).toBeVisible();
  await pane.getByRole("button", { name: "Show the R message" }).click();
  await expect(pane.locator(".error-original")).toContainText("app.R:7:0: unexpected end of input");
});

test("an app missing a part says it starts clean", async ({ page }) => {
  await openApp(page);
  await replaceScript(page, 'library(shiny)\nui <- fluidPage(titlePanel("Penguins"))\nshinyApp(ui, server)\n');
  await page.getByRole("button", { name: "Run app" }).click();
  const pane = page.getByRole("region", { name: "App" });
  await expect(pane).toContainText("R could not find “server”");
  await expect(pane).toContainText("Apps run from a clean start");
});

test("an error inside the running app is shown without stopping it", async ({ page }) => {
  await openApp(page);
  await replaceScript(page, 'library(shiny)\nui <- fluidPage(titlePanel("Penguins"), plotOutput("p"))\nserver <- function(input, output) {\n  output$p <- renderPlot(stop("object \'bins\' not found"))\n}\nshinyApp(ui, server)\n');
  await page.getByRole("button", { name: "Run app" }).click();
  const problems = page.getByRole("group", { name: "Errors inside the app" });
  await expect(problems).toContainText("R could not find “bins”");
  await expect(problems).toContainText("The app is still running");
  // Shiny's stack trace places the error at the line that failed and the
  // output it was drawing, and the button goes straight there.
  await expect(problems).toContainText("Where: line 4 of app.R, in renderPlot, while drawing output$p");
  await problems.getByRole("button", { name: "Go to line 4" }).click();
  await expect(page.locator(".editor-host .cm-activeLine")).toContainText("output$p <- renderPlot");
  await expect(page.frameLocator('iframe[title="The running app, app.R"]').getByRole("heading", { name: "Penguins" })).toBeVisible();
  await problems.getByRole("button", { name: "Dismiss" }).click();
  await expect(problems).toHaveCount(0);
});

test("a script that ends with shinyApp() runs as an app too", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Use this R" }).click();
  await page.getByRole("button", { name: /^penguins/ }).first().click();
  await expectReady(page);
  await page.getByRole("navigation", { name: "Project" }).getByRole("button", { name: /cleaning\.R/ }).click();
  await expect(page.getByRole("button", { name: "Run app" })).toHaveCount(0);
  await replaceScript(page, 'library(shiny)\n# shinyApp( in a comment does not count\nui <- fluidPage(titlePanel("Cleaning"))\nserver <- function(input, output) {}\n');
  await page.waitForTimeout(1500);
  await expect(page.getByRole("button", { name: "Run app" })).toHaveCount(0);
  await page.keyboard.insertText("shinyApp(ui, server)\n");
  // The button appears after a short pause in typing.
  await expect(page.getByRole("button", { name: "Run app" })).toBeVisible();
});

test("an app is shared as a web page, after listing what goes in it, and previews here", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "More for this app" }).click();
  await page.getByRole("menuitem", { name: /Share as a web page/ }).click();
  const dialog = page.getByRole("dialog", { name: "Share as a web page" });
  // Every file in the app's folder is listed, and data is called out.
  await expect(dialog.getByRole("listitem").filter({ hasText: "data/penguins.csv" })).toContainText("data");
  await expect(dialog.getByRole("note")).toContainText("Anyone with the address can download it");
  await dialog.getByRole("button", { name: "Choose a folder and make it" }).click();
  await expect(dialog).toContainText("The web version is ready");
  await expect(dialog).toContainText("~/Documents/penguins-web");
  await dialog.getByRole("button", { name: "Show in folder" }).click();
  await expect
    .poll(() => page.evaluate(() => (globalThis as unknown as { goodforApps: { revealed: string[] } }).goodforApps.revealed))
    .toEqual(["/Users/demo/Documents/penguins-web"]);
  await dialog.getByRole("button", { name: "Preview here" }).click();
  await expect(dialog).toBeHidden();
  const pane = page.getByRole("region", { name: "App" });
  await expect(pane).toContainText("Web version of app.R");
  await expect(page.frameLocator('iframe[title="The web version of app.R"]').getByRole("heading", { name: "Penguin explorer, in the browser" })).toBeVisible();
  await pane.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(pane).toContainText("The app stopped");
});

test("sharing without shinylive explains it and offers to install it", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => ((window as unknown as { goodforNoShinylive: boolean }).goodforNoShinylive = true));
  await page.keyboard.press("Control+k");
  await page.keyboard.insertText("Share Shiny app");
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Share as a web page" });
  await dialog.getByRole("button", { name: "Choose a folder and make it" }).click();
  await expect(dialog).toContainText("The shinylive package is not installed yet");
  await dialog.getByRole("button", { name: "Install shinylive" }).click();
  await expect(page.getByRole("region", { name: "Stage" })).toContainText("Installing packages");
  await expect(page.getByRole("region", { name: "Installing packages" })).toContainText("shinylive");
});

test("likely mistakes in an app are found as it is written, at their line, with a fix", async ({ page }) => {
  await openApp(page);
  await replaceScript(page, 'library(shiny)\nui <- fluidPage(\n  sliderInput("bins", "Bins", 5, 50, 20),\n  plotOutput("mass")\n)\nserver <- function(input, output) {\n  output$mas <- renderPlot(hist(penguins$body_mass, breaks = input$bins))\n}\nshinyApp(ui, server)\n');
  const banner = page.getByRole("region", { name: "Likely problems in this app" });
  await expect(banner).toContainText("1 likely problem in this app");
  await expect(banner).toContainText("Line 7 output$mas has no place in the UI");
  await expect(page.locator(".editor-host .cm-lint")).toHaveText("mas");
  await banner.getByRole("button", { name: "Change to mass" }).click();
  await expect(page.locator(".editor-host .cm-content")).toContainText("output$mass <- renderPlot");
  await expect(banner).toHaveCount(0);
});
