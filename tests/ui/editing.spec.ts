import { expect, test } from "@playwright/test";
import { newFileWith, openExample } from "./helpers";

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

test("each save keeps a version, and an earlier one can be compared, taken back in part, or used whole", async ({ page }) => {
  await openExample(page);
  const content = page.locator(".editor-host .cm-content");
  await content.click();
  await page.keyboard.press("Control+Home");
  await page.keyboard.insertText("brightest <- head(mass_by_species, 1)\n");
  await page.keyboard.press("Control+s");
  await expect(page.getByRole("tab", { name: /analysis\.R/ })).not.toContainText("edited");
  await page.getByRole("button", { name: "Earlier versions of this file" }).click();
  const dialog = page.getByRole("dialog", { name: "Earlier versions of analysis.R" });
  const versions = dialog.getByRole("group", { name: "Saved versions" }).getByRole("button");
  await expect(versions).toHaveCount(2);
  await expect(versions.first()).toContainText("Same as now");
  await versions.nth(1).click();
  await expect(versions.nth(1)).toContainText("1 line added");
  await expect(dialog.locator(".change-piece.is-added")).toContainText("brightest <- head(mass_by_species, 1)");
  // Taking the added part out changes the script, not the saved file.
  await dialog.getByRole("button", { name: "Take this out" }).click();
  await expect(dialog).toContainText("The script is the same now as in this version.");
  await expect(content).not.toContainText("brightest");
  await page.keyboard.press("Escape");
  await content.click();
  await page.keyboard.press("Control+z");
  await expect(content).toContainText("brightest <- head(mass_by_species, 1)");
});
