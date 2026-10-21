import { expect, test, type Page } from "@playwright/test";
import { expectReady, openExample } from "./helpers";

/** Opens the penguins project and its Quarto report. */
async function openReport(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Use this R" }).click();
  await page.getByRole("button", { name: /^penguins/ }).first().click();
  await expectReady(page);
  await page.getByRole("navigation", { name: "Project" }).getByRole("button", { name: /report\.qmd/ }).click();
  await expect(page.getByRole("tab", { name: /report\.qmd/ })).toHaveAttribute("aria-selected", "true");
}

/** What Open handed to the system in the stand-in. */
function opened(page: Page) {
  return page.evaluate(() => (globalThis as unknown as { goodforRendering: { opened: string[] } }).goodforRendering.opened);
}

test("Render shows only for reports, and a finished report is previewed beside the code", async ({ page }) => {
  await openExample(page);
  await expect(page.getByRole("button", { name: "Render", exact: true })).toHaveCount(0);
  await page.goto("/");
  await openReport(page);
  // The Report tab appears with the first render, not before.
  await expect(page.getByRole("tab", { name: "Report", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Render", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Report", exact: true })).toHaveAttribute("aria-selected", "true");
  const preview = page.frameLocator('iframe[title="Preview of report.html"]');
  await expect(preview.getByRole("heading", { name: "Penguin measurements" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Report" })).toContainText("report.html, rendered in");
  // Open hands the file to the system's browser.
  await page.getByRole("button", { name: "Open in browser" }).click();
  await expect.poll(() => opened(page)).toEqual(["/Users/demo/Documents/penguins/report.html"]);
  // The log of what the render printed is one press away.
  await page.getByRole("button", { name: "Show the render log" }).click();
  await expect(page.locator('pre[aria-label="Render log"]')).toContainText("Output created: report.html");
});

test("the Render menu makes Word files, which open in their own app", async ({ page }) => {
  await openReport(page);
  await page.getByRole("button", { name: "Render in another format" }).click();
  await page.getByRole("menuitem", { name: /Render as Word/ }).click();
  const pane = page.getByRole("region", { name: "Report" });
  await expect(pane).toContainText("report.docx is ready.");
  await pane.getByRole("button", { name: "Open report.docx" }).click();
  await expect.poll(() => opened(page)).toEqual(["/Users/demo/Documents/penguins/report.docx"]);
});

test("a failing chunk is explained in plain words and its line is marked", async ({ page }) => {
  await openReport(page);
  await page.locator(".editor-host .cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("\n```{r totals}\nmean(1:3)\nnosuchthing\n");
  // The keyboard shortcut is RStudio's Knit. It saves first, and it must
  // never delete the line the cursor is on, which is CodeMirror's default.
  const before = await page.locator(".editor-host .cm-content").innerText();
  await page.keyboard.press("Shift+Control+k");
  const pane = page.getByRole("region", { name: "Report" });
  await expect(pane).toContainText("report.qmd did not render");
  await expect(pane).toContainText("R could not find “nosuchthing”");
  await expect(pane).toContainText("Reports run from a clean start");
  // The caption names the file line that holds the failing name.
  const lines = await page.locator(".editor-host .cm-line").allInnerTexts();
  const line = lines.findIndex((text) => text === "nosuchthing") + 1;
  expect(line).toBeGreaterThan(10);
  await expect(pane.locator("figcaption")).toHaveText(`Where it went wrong: the chunk named totals, line ${line}`);
  expect(await page.locator(".editor-host .cm-content").innerText()).toBe(before);
  await expect(page.getByRole("tab", { name: /report\.qmd/ })).not.toContainText("edited");
  // The failing name is underlined in the script, and Go to the spot
  // selects it.
  await expect(page.locator(".editor-host .cm-problem")).toHaveText("nosuchthing");
  await pane.getByRole("button", { name: "Go to the spot" }).click();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("nosuchthing");
});

test("a long render can be stopped, and says so", async ({ page }) => {
  await openReport(page);
  await page.locator(".editor-host .cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("\n```{r wait}\nSys.sleep(30)\n");
  await page.getByRole("button", { name: "Render", exact: true }).click();
  const pane = page.getByRole("region", { name: "Report" });
  await expect(pane.getByRole("status")).toContainText("the chunk named wait");
  await expect(pane.getByRole("progressbar", { name: "Rendering report.qmd" })).toBeVisible();
  // The toolbar's Render became Stop rendering while it runs.
  await page.getByRole("button", { name: "Stop rendering" }).click();
  await expect(pane).toContainText("Rendering stopped");
  await expect(page.getByRole("button", { name: "Render", exact: true })).toBeVisible();
});
