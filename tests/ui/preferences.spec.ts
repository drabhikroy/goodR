import { expect, test, type Page } from "@playwright/test";
import { newFileWith, openExample } from "./helpers";

/** Opens Settings at one section. */
async function openSettings(page: Page, section: string) {
  await page.keyboard.press("Control+,");
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: section }).click();
  return dialog;
}

/** Copies the editor's selection and returns what went to the clipboard. */
function copySelection(page: Page): Promise<string> {
  return page.locator(".editor-host .cm-content").evaluate((content) => {
    const data = new DataTransfer();
    content.dispatchEvent(new ClipboardEvent("copy", { clipboardData: data, bubbles: true, cancelable: true }));
    return data.getData("text/plain");
  });
}

test("the code typeface, size, and spacing change the script at once", async ({ page }) => {
  await openExample(page);
  const dialog = await openSettings(page, "Code text");
  await dialog.getByRole("radio", { name: "Fira Code" }).check();
  await dialog.getByRole("slider", { name: "Code size" }).fill("20");
  await dialog.getByRole("radio", { name: "Relaxed" }).check();
  // Fira Code joins symbols, so the option to turn that on is offered.
  await expect(dialog.getByRole("checkbox", { name: /single shapes/ })).toBeEnabled();
  const content = page.locator(".editor-host .cm-content");
  const style = await content.evaluate((element) => {
    const computed = getComputedStyle(element);
    return { family: computed.fontFamily, size: computed.fontSize, line: computed.lineHeight };
  });
  expect(style.family).toContain("Fira Code");
  expect(style.size).toBe("20px");
  expect(style.line).toBe("38px");
  // The sample in Settings shows the same choice.
  expect(await dialog.locator(".code-sample").evaluate((element) => getComputedStyle(element).fontSize)).toBe("20px");
  // DM Mono has no joined symbols, and the option says so.
  await dialog.getByRole("radio", { name: "DM Mono" }).check();
  await expect(dialog.getByRole("checkbox", { name: /no joined symbols/ })).toBeDisabled();
});

test("editor options turn line numbers, wrapping, and bracket colors on and off", async ({ page }) => {
  await openExample(page);
  await expect(page.locator(".editor-host .cm-lineNumbers")).toHaveCount(1);
  const dialog = await openSettings(page, "Editor");
  await dialog.getByRole("checkbox", { name: /Line numbers/ }).uncheck();
  await dialog.getByRole("checkbox", { name: /Wrap long lines/ }).check();
  await dialog.getByRole("checkbox", { name: /Color brackets by depth/ }).check();
  await page.keyboard.press("Escape");
  await expect(page.locator(".editor-host .cm-lineNumbers")).toHaveCount(0);
  await expect(page.locator(".editor-host .cm-content")).toHaveClass(/cm-lineWrapping/);
  await newFileWith(page, "f(g(h(1)))\n");
  // Each depth has its own color class, outermost first.
  await expect(page.locator(".editor-host .cm-bracket-0")).toHaveCount(2);
  await expect(page.locator(".editor-host .cm-bracket-2")).toHaveCount(2);
  // A bracket inside a string is text, not a bracket.
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText('x <- "(" ');
  await expect(page.locator(".editor-host .cm-bracket-0")).toHaveCount(2);
});

test("results can be plain text instead of cards", async ({ page }) => {
  await openExample(page);
  const dialog = await openSettings(page, "Results");
  await dialog.getByRole("radio", { name: /Plain text/ }).check();
  await expect(page.locator("html")).toHaveAttribute("data-results", "plain");
  await page.keyboard.press("Escape");
  await newFileWith(page, "1 + 1\n");
  await page.keyboard.press("Control+Enter");
  const card = page.locator(".editor-host .output-card");
  await expect(card).toContainText("[1] 2");
  // No card ground: the result sits on the editor's own background.
  const ground = await card.locator(".cell-out").evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(ground).toBe("rgba(0, 0, 0, 0)");
});

test("results can go to the console, with the code echoed above them", async ({ page }) => {
  await openExample(page);
  const dialog = await openSettings(page, "Results");
  await dialog.getByRole("radio", { name: /In the console/ }).check();
  // The look of cards does not apply in the console, so it is turned off.
  await expect(dialog.getByRole("radio", { name: /Plain text/ })).toBeDisabled();
  await page.keyboard.press("Escape");
  await newFileWith(page, "1 + 1\nnosuchthing\n");
  await page.keyboard.press("Control+Enter");
  await page.keyboard.press("Control+Enter");
  const log = page.getByRole("log").filter({ hasText: "1 + 1" });
  await expect(log).toContainText("[1] 2");
  await expect(log).toContainText("nosuchthing");
  await expect(log).toContainText("R could not find");
  await expect(page.locator(".editor-host .output-card")).toHaveCount(0);
  // The failing line is still marked in the script.
  await expect(page.locator(".editor-host .cm-cell-error, .editor-host .cm-problem")).not.toHaveCount(0);
});

test("copying a selection that crosses several results copies them all", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "1 + 1\n2 * 3\n10 - 4\n");
  for (let line = 0; line < 3; line += 1) await page.keyboard.press("Control+Enter");
  await expect(page.locator(".editor-host .output-card")).toHaveCount(3);
  await page.locator(".editor-host .cm-content").focus();
  await page.keyboard.press("Control+a");
  const copied = await copySelection(page);
  expect(copied).toBe("1 + 1\n[1] 2\n2 * 3\n[1] 6\n10 - 4\n[1] 6\n");
  // Turned off, a copy takes the code alone.
  const dialog = await openSettings(page, "Results");
  await dialog.getByRole("checkbox", { name: /Include results/ }).uncheck();
  await page.keyboard.press("Escape");
  await page.locator(".editor-host .cm-content").focus();
  await page.keyboard.press("Control+a");
  expect(await copySelection(page)).toBe("1 + 1\n2 * 3\n10 - 4\n");
});
