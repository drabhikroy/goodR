import { expect, test, type Page } from "@playwright/test";
import { expectReady } from "./helpers";

/** Where the bar's last button ends, against the script's column and the
 * canvas beside it, and the document's own width against the window's. */
function measure(page: Page) {
  return page.evaluate(() => {
    const right = (selector: string) => document.querySelector(selector)!.getBoundingClientRect().right;
    return {
      end: right(".title-bar-end"),
      column: right(".center"),
      canvas: document.querySelector(".canvas")!.getBoundingClientRect().left,
      page: document.documentElement.scrollWidth,
      tab: (document.querySelector(".tab.is-active .tab-name") as HTMLElement).getBoundingClientRect(),
      strip: document.querySelector(".tabs")!.getBoundingClientRect(),
    };
  });
}

/** Opens the penguins app, so the bar holds Run app and Run as well. */
async function openApp(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Use this R" }).click();
  await page.getByRole("button", { name: /^penguins/ }).first().click();
  await expectReady(page);
  await page.getByRole("navigation", { name: "Project" }).getByRole("button", { name: /app\.R/ }).click();
}

for (const layout of ["with the sidebar", "with the Mac window buttons"]) {
  test(`the bar above the script never runs under the canvas, ${layout}`, async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 });
    await openApp(page);
    // The Mac's window buttons sit over the bar when the sidebar is closed,
    // and take its first hundred or so pixels.
    if (layout !== "with the sidebar") await page.addStyleTag({ content: ".title-bar { padding-left: 6.4rem !important; } .sidebar { display: none !important; }" });
    for (const width of [1500, 1300, 1150, 1050, 960]) {
      await page.setViewportSize({ width, height: 900 });
      await expect
        .poll(async () => {
          const spot = await measure(page);
          return spot.end <= spot.column && spot.column <= spot.canvas && spot.page <= width;
        }, { message: `at ${width} pixels` })
        .toBe(true);
      // The open script's tab stays in view as the strip narrows.
      await expect
        .poll(async () => {
          const spot = await measure(page);
          return spot.tab.left >= spot.strip.left - 1 && spot.tab.left < spot.strip.right;
        }, { message: `the open tab at ${width} pixels` })
        .toBe(true);
    }
    // The buttons keep their names for screen readers when their words go.
    await expect(page.getByRole("button", { name: "Run app" })).toBeVisible();
  });
}
