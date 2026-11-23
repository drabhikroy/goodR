import { expect, type Page } from "@playwright/test";

/** Opens the app, picks the newest R, and opens the example script from
 * the recent list. */
export async function openExample(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Use this R" }).click();
  await page.getByRole("button", { name: /^analysis\.R/ }).click();
  await expect(page.getByRole("tab", { name: /analysis\.R/ })).toBeVisible();
  await expectReady(page);
}

/** Waits until R has started and is idle. */
export async function expectReady(page: Page) {
  await expect(page.getByRole("status").filter({ hasText: /^R is ready$/ })).toHaveCount(1);
}

/** Opens a fresh untitled file holding `code`, with the cursor at the top. */
export async function newFileWith(page: Page, code: string) {
  await page.getByRole("button", { name: "New script" }).click();
  const editor = page.locator(".editor-host .cm-content");
  await editor.click();
  await page.keyboard.insertText(code);
  await page.keyboard.press("Control+Home");
}

export async function runLine(page: Page) {
  await page.locator(".editor-host .cm-content").focus();
  await page.keyboard.press("Control+Enter");
}

/** Reads app state directly, as exposed by App.tsx for tests. */
export function appState<T>(page: Page, read: string): Promise<T> {
  return page.evaluate((expression) => {
    const state = (window as unknown as { goodfor: { getState: () => unknown } }).goodfor.getState();
    return new Function("state", `return ${expression}`)(state);
  }, read) as Promise<T>;
}

/** Opens the project menu at the left of the title bar, which holds the
 * project's files, the start screen, and closing the project. */
export async function openProjectMenu(page: Page) {
  await page.locator(".project-switch").click();
  return page.getByRole("menu", { name: "Projects" });
}

/** Shows the start screen over open work, from the project menu. */
export async function showStart(page: Page) {
  const menu = await openProjectMenu(page);
  await menu.getByRole("menuitem", { name: /^Start screen/ }).click();
}

/** Shows one of the tools down the right edge, such as Objects or R help,
 * unless it is already on show. */
export async function showTool(page: Page, name: string) {
  const tool = page.getByRole("navigation", { name: "Tools" }).getByRole("button", { name, exact: true });
  if ((await tool.getAttribute("aria-pressed")) !== "true") await tool.click();
}

/** Shows the objects in R and returns their list. */
export async function showObjects(page: Page) {
  await showTool(page, "Objects");
  return page.locator("#object-cards");
}
