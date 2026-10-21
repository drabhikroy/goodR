import { expect, test, type Page } from "@playwright/test";
import { appState, expectReady, openExample, runLine } from "./helpers";

const ROOT = "/Users/demo/Documents/penguins";

/** The names in the objects list. */
function objectNames(page: Page) {
  return appState<string[]>(page, "state.objects.map((object) => object.name)");
}

/** Which sessions the stand-in has an R running for. */
function runningSessions(page: Page) {
  return page.evaluate(() => [...(globalThis as unknown as { goodforSessions: Map<string, { running: boolean }> }).goodforSessions.entries()].filter(([, r]) => r.running).map(([key]) => key).sort());
}

/** Replaces the script in the editor and runs its first line. */
async function runCode(page: Page, code: string) {
  await page.locator(".editor-host .cm-content").click();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText(code);
  await page.keyboard.press("Control+Home");
  await runLine(page);
}

test("a script opened on its own from inside a project runs in that project's R", async ({ page }) => {
  // analysis.R is opened from the recent scripts list, not through the
  // project, and still lands in the penguins project's session.
  await openExample(page);
  expect(await appState<string>(page, "state.activeSession")).toBe(`project:${ROOT}`);
  expect(await appState<string>(page, "state.r.workingDir")).toBe(ROOT);
  await expect(page.getByRole("navigation", { name: "Project" })).toBeVisible();
});

test("a project and a script on its own keep separate objects", async ({ page }) => {
  await openExample(page);
  await runCode(page, "inside <- 1\n");
  await expect.poll(() => objectNames(page)).toEqual(["inside"]);

  // A script outside the project gets a fresh R of its own.
  await page.evaluate(() => (window.goodforPick = ["/Users/demo/Desktop/quick.R"]));
  await page.keyboard.press("Control+o");
  await expect(page.getByRole("tab", { name: /quick\.R/ })).toHaveAttribute("aria-selected", "true");
  await expectReady(page);
  expect(await objectNames(page)).toEqual([]);
  await runCode(page, "outside <- 2\n");
  await expect.poll(() => objectNames(page)).toEqual(["outside"]);
  // The project's sidebar belongs to the project, so it is not shown here.
  await expect(page.getByRole("navigation", { name: "Project" })).toHaveCount(0);

  // Back to the project: its objects, console, and sidebar come back.
  await page.getByRole("tab", { name: /analysis\.R/ }).click();
  await expect.poll(() => objectNames(page)).toEqual(["inside"]);
  await expect(page.getByRole("navigation", { name: "Project" })).toBeVisible();
  expect(await runningSessions(page)).toEqual(["file:/Users/demo/Desktop/quick.R", `project:${ROOT}`, "scratch"]);
});

test("closing a script on its own ends its R, and a project's R stays until the project closes", async ({ page }) => {
  await openExample(page);
  await page.evaluate(() => (window.goodforPick = ["/Users/demo/Desktop/quick.R"]));
  await page.keyboard.press("Control+o");
  await expectReady(page);
  await expect.poll(() => runningSessions(page)).toContain("file:/Users/demo/Desktop/quick.R");
  await page.keyboard.press("Control+w");
  await expect.poll(() => runningSessions(page)).toEqual([`project:${ROOT}`, "scratch"]);
  // The project's tab came forward, with its own panes.
  await expect(page.getByRole("tab", { name: /analysis\.R/ })).toHaveAttribute("aria-selected", "true");
  expect(await appState<string>(page, "state.activeSession")).toBe(`project:${ROOT}`);
});

test("opening a project leaves other work open", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Use this R" }).click();
  await page.evaluate(() => (window.goodforPick = ["/Users/demo/Desktop/quick.R"]));
  await page.getByRole("button", { name: "Open script" }).click();
  await expect(page.getByRole("tab", { name: /quick\.R/ })).toBeVisible();
  await page.keyboard.press("Shift+Control+o");
  await expect(page.getByRole("tab", { name: /analysis\.R/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: /quick\.R/ })).toBeVisible();
});
