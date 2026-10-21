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

for (const appearance of ["Light", "Dark"]) {
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
    await expect(page.locator(".r-status")).toHaveText("R 4.5.1");
    await page.keyboard.press("Shift+Control+Enter");
    await expect(page.locator(".output-card.status-error")).toBeVisible();
    await audit(page);
    // The menus that open from the title bar pass too.
    await page.getByRole("button", { name: /^Results/ }).click();
    await audit(page);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "R 4.5.1" }).click();
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
    await expect(page.getByRole("button", { name: "Export" })).toBeVisible();
    await page.keyboard.press("Control+Shift+e");
    await expect(page.getByRole("dialog", { name: "Export plot" })).toBeVisible();
    await audit(page);
    await page.keyboard.press("Escape");
    // The RStudio style panes, with a help page showing.
    await page.getByRole("tab", { name: "Help" }).click();
    await page.getByRole("searchbox", { name: "Help topic" }).fill("mean");
    await page.getByRole("searchbox", { name: "Help topic" }).press("Enter");
    await expect(page.getByRole("article").getByRole("heading", { name: "Arithmetic Mean" })).toBeVisible();
    await audit(page);
    await page.getByRole("tab", { name: "Packages" }).click();
    await expect(page.locator(".package-row").first()).toBeVisible();
    await page.getByRole("tab", { name: "History" }).click();
    await audit(page);
    await page.getByRole("tab", { name: "Environment" }).click();
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
  await expect(page.getByRole("button", { name: "Export" })).toBeVisible();
  await page.keyboard.press("Control+Shift+e");
  await expect(page.getByRole("dialog", { name: "Export plot" })).toBeVisible();
  expect(await smallTargets(page)).toEqual([]);
  await page.keyboard.press("Escape");
  for (const tab of ["Help", "Packages", "History", "Environment"]) {
    await page.getByRole("tab", { name: tab }).click();
    expect(await smallTargets(page)).toEqual([]);
  }
  await page.getByRole("button", { name: "Import data" }).click();
  await page.getByRole("dialog", { name: "Import data" }).getByRole("button", { name: "Choose" }).click();
  await expect(page.getByRole("columnheader", { name: /species/ })).toBeVisible();
  expect(await smallTargets(page)).toEqual([]);
});

test("the assistant's setup steps and conversation pass the same checks", async ({ page }) => {
  test.setTimeout(90_000);
  await openExample(page);
  await page.getByRole("tab", { name: "Assistant" }).click();
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
  await expect(dialog.locator(".model-card")).toHaveCount(6);
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
    for (const section of ["Appearance", "Code text", "Editor", "Results", "Accessibility", "R and packages", "Menus"]) {
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
}
