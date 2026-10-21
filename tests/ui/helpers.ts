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
  await expect(page.locator(".r-status")).toHaveText("R 4.5.1");
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
