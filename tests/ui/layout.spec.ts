import { expect, test, type Page } from "@playwright/test";
import { appState, expectReady, newFileWith, openProjectMenu, showObjects, showTool } from "./helpers";

// The calmer layout: the script and one result, the tools down the right
// edge, and the files, earlier results, and actions one press away.

/** Starts from a settings file written before the calmer layout, with the
 * sidebar and the strip of earlier results both on. */
async function openFromOlderSettings(page: Page) {
  await page.addInitScript(() => {
    window.goodforSettings = { layoutVersion: 0, showSidebar: true, showTimeline: true, consoleInputHeight: 96 };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Use this R" }).click();
  await page.getByRole("button", { name: /^penguins/ }).first().click();
  await expect(page.getByRole("tab", { name: /analysis\.R/ })).toBeVisible();
  await expectReady(page);
}

function stage(page: Page) {
  return page.getByRole("region", { name: "Stage" });
}

test("a settings file from before moves to the calmer layout once, and the files are in the project menu", async ({ page }) => {
  await openFromOlderSettings(page);
  // No sidebar and no strip of earlier results, and a one-line prompt.
  await expect(page.getByRole("navigation", { name: "Project" })).toHaveCount(0);
  expect(await appState<boolean>(page, "state.settings.showTimeline")).toBe(false);
  expect(await appState<number>(page, "state.settings.layoutVersion")).toBe(2);
  expect(await appState<number>(page, "state.settings.consoleInputHeight")).toBe(48);
  // The project menu says where R is, lists the files, and opens one.
  const menu = await openProjectMenu(page);
  await expect(menu).toContainText(/R 4\.5\.1 is ready, in ~\/Documents\/penguins/);
  await menu.getByRole("menuitem", { name: "cleaning.R" }).click();
  await expect(page.getByRole("tab", { name: /cleaning\.R/ })).toHaveAttribute("aria-selected", "true");
  // A data file opens the import dialog, as it does from the sidebar.
  await (await openProjectMenu(page)).getByRole("menuitem", { name: "Import penguins.csv" }).click();
  await expect(page.getByRole("dialog", { name: "Import data" })).toBeVisible();
  await page.getByRole("dialog", { name: "Import data" }).getByRole("button", { name: "Cancel" }).click();
  // The sidebar comes back for those who want it, and stays.
  await (await openProjectMenu(page)).getByRole("menuitemcheckbox", { name: "Keep the files open on the left" }).click();
  await expect(page.getByRole("navigation", { name: "Project" })).toBeVisible();
  expect(await appState<boolean>(page, "state.settings.showSidebar")).toBe(true);
  // Start screen and Close project are in the same menu.
  await expect((await openProjectMenu(page)).getByRole("menuitem", { name: "Close project" })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("earlier results are stepped through on the stage, and laid out together under All results", async ({ page }) => {
  await openFromOlderSettings(page);
  await newFileWith(page, "1 + 1\nplot(1:10)\n2 * 3\n");
  await page.keyboard.press("Shift+Control+Enter");
  await expect(stage(page)).toContainText("[1] 6");
  await expect(stage(page)).toContainText("3 of 3");
  // The arrows move one result at a time.
  await stage(page).getByRole("button", { name: "Earlier result" }).click();
  await expect(stage(page).locator(".plot-figure")).toBeVisible();
  await expect(stage(page)).toContainText("2 of 3");
  await stage(page).getByRole("button", { name: "Later result" }).click();
  await expect(stage(page)).toContainText("[1] 6");
  // All results lays every result out over the stage. Pointing at one
  // lights up its line in the script, and choosing one shows it.
  await stage(page).getByRole("button", { name: /^All results/ }).click();
  const all = page.getByRole("dialog", { name: "All results" });
  await expect(all.getByRole("option")).toHaveCount(3);
  await all.getByRole("option").first().hover();
  await expect(page.locator(".editor-host .cm-line-linked")).toHaveText("1 + 1");
  await all.getByRole("option").first().click();
  await expect(all).toHaveCount(0);
  await expect(stage(page)).toContainText("[1] 2");
  await expect(stage(page)).toContainText("1 of 3");
});

test("everything done with a result is in its menu, and the code above it is shown on request", async ({ page }) => {
  await openFromOlderSettings(page);
  await newFileWith(page, "x <- 1\n2 * 3\n");
  await page.keyboard.press("Shift+Control+Enter");
  await expect(stage(page)).toContainText("[1] 6");
  await expect(stage(page).locator(".cell-code")).toHaveCount(0);
  await stage(page).getByRole("button", { name: "More for this result" }).click();
  const menu = page.getByRole("menu", { name: "More for this result" });
  for (const name of [/^Run again/, /^Copy result/, /^Hide result/, /^Show the code above results/, /^Undo run/, /^Pin/]) {
    await expect(menu.getByRole("menuitem", { name })).toBeVisible();
  }
  await menu.getByRole("menuitem", { name: /^Show the code above results/ }).click();
  await expect(stage(page).locator(".cell-code")).toHaveText("2 * 3");
});

test("the tools name themselves after the pointer rests, or always when Settings says so", async ({ page }) => {
  await openFromOlderSettings(page);
  const tools = page.getByRole("navigation", { name: "Tools" });
  for (const name of ["Results", "Objects", "R help", "Assistant", "Packages", "History", "Settings"]) {
    await expect(tools.getByRole("button", { name, exact: true })).toBeVisible();
  }
  await tools.getByRole("button", { name: "Packages", exact: true }).hover();
  await page.waitForTimeout(1500);
  await expect(page.locator(".tool-tip")).toHaveCount(0);
  await expect(page.locator(".tool-tip")).toHaveText("Packages", { timeout: 6000 });
  await page.mouse.move(0, 0);
  await expect(page.locator(".tool-tip")).toHaveCount(0);
  // With names on, each is written under its icon and none pops up.
  await tools.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("checkbox", { name: /Show names under the tool icons/ }).check();
  await page.keyboard.press("Escape");
  await expect(tools.locator(".tool-name")).toHaveText(["Results", "Objects", "R help", "Assistant", "Packages", "History", "Settings"]);
  // Objects lists what R holds, with what each is.
  await expect((await showObjects(page)).getByRole("button", { name: /^penguins data frame/ })).toHaveCount(0);
  await showTool(page, "Results");
});

test("the opening screen lists recent work in one list, and the ways in for newcomers can be put away", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Use this R" }).click();
  const recent = page.getByRole("region", { name: "Recent" });
  await expect(recent.getByRole("button", { name: /^penguins/ })).toBeVisible();
  await expect(recent.getByRole("button", { name: /^analysis\.R/ })).toBeVisible();
  await page.getByRole("radio", { name: "Projects" }).click();
  await expect(recent.getByRole("button", { name: /^analysis\.R/ })).toHaveCount(0);
  await page.getByRole("radio", { name: "Scripts" }).click();
  await expect(recent.getByRole("button", { name: /^penguins/ })).toHaveCount(0);
  const newHere = page.getByRole("group", { name: "New here?" });
  await expect(newHere.getByRole("button", { name: "Take the tour" })).toBeVisible();
  await newHere.getByRole("button", { name: "Put these away" }).click();
  await expect(newHere).toHaveCount(0);
  expect(await appState<boolean>(page, "state.settings.hideNewHere")).toBe(true);
});
