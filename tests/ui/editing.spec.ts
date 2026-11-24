import { expect, test } from "@playwright/test";
import { newFileWith, openExample, openProjectMenu, runLine } from "./helpers";

// The editing tools that reach past one line: hints, explaining a line,
// tidying, renaming everywhere, and finding in every file.

const editor = (page: import("@playwright/test").Page) => page.locator(".editor-host .cm-content");

test("a habit that causes trouble later gets a dotted line, a reason, and a one click fix", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "keep <- c(T, F)\nfor (i in 1:length(keep)) print(i)\n");
  const hint = page.locator(".cm-hint").first();
  await expect(hint).toHaveText("T");
  await expect(page.locator(".cm-hint")).toHaveCount(3);
  await hint.hover();
  const help = page.locator(".quick-help.is-hint");
  await expect(help).toContainText("Write TRUE in full");
  await help.getByRole("button", { name: "Change to TRUE" }).click();
  await expect(editor(page)).toContainText("keep <- c(TRUE, F)");
  // Turning hints off in Settings takes the lines away.
  await page.keyboard.press("Control+,");
  await page.getByRole("button", { name: "Editor" }).click();
  await page.getByRole("checkbox", { name: /Point out habits/ }).uncheck();
  await page.keyboard.press("Escape");
  await expect(page.locator(".cm-hint")).toHaveCount(0);
});

test("What does this code do explains a line in order, without the assistant", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "average <- mean(c(1, 2, 3))");
  await page.keyboard.press("Alt+Control+e");
  const note = page.locator(".explain-note");
  await expect(note).toContainText("What this code does, in order");
  await expect(note.locator("li").nth(0)).toHaveText("c()");
  await expect(note.locator("li").nth(1)).toHaveText("mean(): Arithmetic Mean");
  await expect(note.locator("li").nth(2)).toContainText("stored as average");
  await page.keyboard.press("Escape");
  await expect(note).toHaveCount(0);
});

test("Tidy code restyles the script as one edit, and asks before installing styler", async ({ page }) => {
  await openExample(page);
  await page.evaluate(() => ((window as unknown as { goodforNoStyler: boolean }).goodforNoStyler = true));
  await newFileWith(page, "x<-c(1,2)");
  let asked = "";
  page.once("dialog", (dialog) => {
    asked = dialog.message();
    dialog.accept();
  });
  await page.keyboard.press("Control+Shift+a");
  await expect(page.locator(".notice")).toContainText("choose Tidy code again");
  expect(asked).toContain("styler, an R package that is not installed");
  await expect(page.getByRole("status").filter({ hasText: /^R is ready$/ })).toHaveCount(1);
  await editor(page).click();
  await page.keyboard.press("Control+Shift+a");
  await expect(editor(page)).toContainText("x <- c(1, 2)");
  await expect(page.locator(".notice")).toContainText("Tidied the script");
  await editor(page).focus();
  await page.keyboard.press("Control+z");
  await expect(editor(page)).toContainText("x<-c(1,2)");
});

test("Rename changes the object everywhere in the file and leaves columns and arguments alone", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, 'data <- penguins\nsummary(data$data)\nlm(y ~ x, data = data)\n# data stays in comments');
  await page.keyboard.press("F2");
  const dialog = page.getByRole("dialog", { name: "Rename data" });
  await expect(dialog).toContainText("Changes 3 places");
  const field = dialog.getByRole("textbox", { name: "New name" });
  await field.fill("2birds");
  await expect(dialog).toContainText("A name starts with a letter");
  await expect(dialog.getByRole("button", { name: "Rename" })).toBeDisabled();
  await field.fill("penguins");
  await expect(dialog).toContainText("penguins is already used in this file");
  await field.fill("birds");
  await dialog.getByRole("button", { name: "Rename" }).click();
  await expect(editor(page)).toContainText("birds <- penguins");
  await expect(editor(page)).toContainText("summary(birds$data)");
  await expect(editor(page)).toContainText("lm(y ~ x, data = birds)");
  await expect(editor(page)).toContainText("# data stays in comments");
});

test("Find in all files lists matches by file and opens the one chosen at its line", async ({ page }) => {
  await openExample(page);
  await page.keyboard.press("Control+Shift+f");
  const dialog = page.getByRole("dialog", { name: "Find in all files" });
  await dialog.getByRole("searchbox", { name: "Find" }).fill("penguins_clean");
  await expect(dialog.getByRole("region", { name: "cleaning.R" })).toBeVisible();
  await expect(dialog.getByRole("status")).toContainText("2 lines in 1 file");
  await dialog.getByRole("region", { name: "cleaning.R" }).getByRole("button").first().click();
  await expect(page.getByRole("tab", { name: /cleaning\.R/ })).toHaveAttribute("aria-selected", "true");
});

test("Fix problems lists retired code and habits, fixes the chosen ones in one step, and Undo takes them back", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "ggplot(df, aes(x, y)) + geom_line(size = 2)\nok <- T\nlong <- gather(df, key, value)\n");
  await page.keyboard.press("Control+k");
  await page.keyboard.insertText("Fix problems");
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Fix problems" });
  await expect(dialog.getByRole("heading", { name: "2 can be fixed for you" })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "One needs a look from you" })).toBeVisible();
  await expect(dialog).toContainText("pivot_longer() replaced gather()");
  await dialog.getByRole("button", { name: "Fix 2 problems" }).click();
  const content = page.locator(".editor-host .cm-content");
  await expect(content).toContainText("geom_line(linewidth = 2)");
  await expect(content).toContainText("ok <- TRUE");
  await content.click();
  await page.keyboard.press("Control+z");
  await expect(content).toContainText("geom_line(size = 2)");
  await expect(content).toContainText("ok <- T");
});

test("History shows a script then and now, folds what matches, and steps through changes spread through it", async ({ page }) => {
  await openExample(page);
  const content = editor(page);
  await content.click();
  await page.keyboard.press("Control+Home");
  await page.keyboard.insertText("brightest <- head(mass_by_species, 1)\n");
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("summary(fit)");
  await page.keyboard.press("Control+s");
  await expect(page.getByRole("tab", { name: /analysis\.R/ })).not.toContainText("edited");
  await page.getByRole("navigation", { name: "Tools" }).getByRole("button", { name: "History", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "History of analysis.R" });
  await expect(dialog.getByRole("tab", { name: "This script" })).toHaveAttribute("aria-selected", "true");
  await expect(dialog).toContainText("2 changes");
  await expect(dialog.getByText("Change 1 of 2", { exact: true })).toBeVisible();
  // The lines between the two changes fold away, and open on request.
  const fold = dialog.getByRole("button", { name: /unchanged lines/ });
  await expect(fold).toHaveCount(1);
  await fold.click();
  await expect(dialog.getByRole("button", { name: /^Fold these/ })).toHaveAttribute("aria-expanded", "true");
  // The arrows, or F7, move to the next change, named for its section.
  await dialog.getByRole("button", { name: "Next change" }).click();
  await expect(dialog.getByText("Change 2 of 2", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("region", { name: "Change 2 of 2, in Flipper length model" })).toBeVisible();
  await page.keyboard.press("Shift+F7");
  await expect(dialog.getByText("Change 1 of 2", { exact: true })).toBeVisible();
  // Taking one change out edits the script, not the saved file.
  await dialog.getByRole("button", { name: "Take out change 1" }).click();
  await expect(dialog.getByText("Change 1 of 1", { exact: true })).toBeVisible();
  await expect(content).not.toContainText("brightest");
  await page.keyboard.press("Escape");
  await content.click();
  await page.keyboard.press("Control+z");
  await expect(content).toContainText("brightest <- head(mass_by_species, 1)");
  // The project menu opens the same History.
  await (await openProjectMenu(page)).getByRole("menuitem", { name: "History of this file" }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("slider", { name: "Compare now with" })).toBeVisible();
});

test("a line that worked before offers itself back when it fails, as one edit Undo takes back", async ({ page }) => {
  await openExample(page);
  await newFileWith(page, "value <- 5\nvalue\n");
  await runLine(page);
  await runLine(page);
  await expect(page.locator(".cm-gutter-check, .output-card").first()).toBeVisible();
  // A slip in the second line, then run it again.
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await page.keyboard.insertText("eu");
  await expect(page.locator(".editor-host .cm-line").nth(1)).toHaveText("valeu");
  await page.keyboard.press("Control+Enter");
  const rescue = page.getByRole("region", { name: "How this line last worked" }).first();
  await expect(rescue).toContainText("This line worked today at");
  await expect(rescue.locator(".tn-code.is-then")).toContainText("value");
  await expect(rescue.locator(".tn-code.is-now")).toContainText("valeu");
  await rescue.getByRole("button", { name: "Put back the version that worked" }).click();
  await expect(page.locator(".editor-host .cm-line").nth(1)).toHaveText("value");
  await editor(page).click();
  await page.keyboard.press("Control+z");
  await expect(page.locator(".editor-host .cm-line").nth(1)).toHaveText("valeu");
});
test("History's earlier versions stack behind the front card and flip one at a time", async ({ page }) => {
  await openExample(page);
  const content = editor(page);
  for (const line of ["one <- 1", "two <- 2", "three <- 3"]) {
    await content.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText(`\n${line}`);
    await page.keyboard.press("Control+s");
    await expect(page.getByRole("tab", { name: /analysis\.R/ })).not.toContainText("edited");
  }
  await page.getByRole("navigation", { name: "Tools" }).getByRole("button", { name: "History", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "History of analysis.R" });
  const slider = dialog.getByRole("slider", { name: "Compare now with" });
  const front = dialog.locator(".tn-card:not(.tn-card-leaving)");
  // The newest earlier version is in front, with older ones behind it.
  const start = Number(await slider.inputValue());
  await expect(dialog.locator(".tn-card-behind")).not.toHaveCount(0);
  const behind = await dialog.locator(".tn-card-behind").count();
  // Left goes back one card; the stack behind gets shorter.
  await dialog.locator(".tn-pane-scroll").first().focus();
  await page.keyboard.press("ArrowLeft");
  await expect(slider).toHaveValue(String(start - 1));
  await expect(dialog.locator(".tn-card-behind")).toHaveCount(behind - 1);
  await expect(front).toHaveCount(1);
  // The card that lifted away is gone once its motion ends.
  await expect(dialog.locator(".tn-card-leaving")).toHaveCount(0);
  // Right comes forward again, and the script now never moves.
  await page.keyboard.press("ArrowRight");
  await expect(slider).toHaveValue(String(start));
  await expect(dialog.getByRole("region", { name: "The script now" })).toContainText("three <- 3");
  // A card behind is a shortcut back to it.
  await dialog.locator(".tn-card-behind").first().click({ position: { x: 6, y: 120 } });
  await expect(slider).toHaveValue(String(start - 1));
});
