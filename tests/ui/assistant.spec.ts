import { expect, test, type Page } from "@playwright/test";
import { appState, newFileWith, openExample, runLine } from "./helpers";

/** Walks the setup steps with the private copy, the machine check, and the
 * small code model, as a first time user would. */
async function setUpAssistant(page: Page) {
  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  await page.getByRole("button", { name: "Set up the assistant" }).click();
  const dialog = page.getByRole("dialog", { name: "Set up the assistant" });
  await expect(dialog.locator("[aria-current=step]")).toContainText("Ollama");
  // No Ollama is installed in the stand-in, so only the private copy is offered.
  await expect(dialog.getByRole("radio", { name: /Use the Ollama on this Mac/ })).toBeDisabled();
  await expect(dialog.getByRole("radio", { name: /Install a private copy/ })).toBeChecked();
  await dialog.getByRole("button", { name: "Install and continue" }).click();
  await expect(dialog.locator("[aria-current=step]")).toContainText("This Mac", { timeout: 10_000 });
  await dialog.getByRole("button", { name: "Check this Mac" }).click();
  await expect(dialog.locator(".specs")).toContainText("16 GB");
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(dialog.locator("[aria-current=step]")).toContainText("Models");
  return dialog;
}

test("the assistant is set up in three steps, with an even handed model list", async ({ page }) => {
  await openExample(page);
  const dialog = await setUpAssistant(page);
  // Every model lists what it is good and weaker at.
  const cards = dialog.locator(".model-card");
  await expect(cards).toHaveCount(4);
  for (const card of await cards.all()) {
    await expect(card.getByText("Good at", { exact: true })).toBeVisible();
    await expect(card.getByText("Weaker at", { exact: true })).toBeVisible();
  }
  // On a 16 GB Mac the suggestion is the 7B code model, from fit alone.
  const suggested = dialog.locator(".model-card").filter({ hasText: "Suggested for this Mac" });
  await expect(suggested).toContainText("Qwen2.5 Coder 7B");
  await expect(dialog.locator(".model-card").filter({ hasText: "Qwen3 Coder 30B" })).toContainText("Too large for this Mac's memory");
  // Downloading shows progress, and a second download waits its turn.
  const small = dialog.locator(".model-card").filter({ hasText: "Qwen2.5 Coder 3B" });
  await small.getByRole("button", { name: /^Download/ }).click();
  await expect(dialog.locator(".model-card").filter({ hasText: "Qwen2.5 Coder 7B" }).getByRole("button", { name: /^Download/ })).toBeDisabled();
  await expect(small.getByText("In use")).toBeVisible({ timeout: 10_000 });
  expect(await appState<string>(page, "state.settings.assistantModel")).toBe("qwen2.5-coder:3b");
  expect(await appState<string>(page, "state.settings.assistantRoute")).toBe("private");
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("button", { name: "Explain code" })).toBeVisible();
});

test("the machine check can be skipped, and then models say how much memory they need", async ({ page }) => {
  await openExample(page);
  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  await page.getByRole("button", { name: "Set up the assistant" }).click();
  const dialog = page.getByRole("dialog", { name: "Set up the assistant" });
  await dialog.getByRole("button", { name: "Install and continue" }).click();
  await dialog.getByRole("button", { name: "Skip this step" }).click();
  await expect(dialog.locator(".model-card").filter({ hasText: "Qwen3 Coder 30B" })).toContainText("Best with 32 GB of memory or more");
  await expect(dialog.locator(".model-card").filter({ hasText: "A safe first choice" })).toContainText("Qwen2.5 Coder 3B");
});

test("an error can be handed to the assistant, and its fix replaces the failing line", async ({ page }) => {
  await openExample(page);
  const dialog = await setUpAssistant(page);
  await dialog.locator(".model-card").filter({ hasText: "Qwen2.5 Coder 3B" }).getByRole("button", { name: /^Download/ }).click();
  await expect(dialog.getByText("In use")).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole("button", { name: "Done" }).click();

  await newFileWith(page, "data(penguins)\nfit <- lm(body_mass ~ flipper_length_mm, data = penguins)\n");
  await runLine(page);
  await runLine(page);
  const card = page.locator(".output-card.status-error");
  await card.getByRole("button", { name: "Ask the assistant" }).click();
  const answer = page.locator(".turn-answer").last();
  await expect(answer).toContainText("flipper_len");
  await expect(answer.getByRole("button", { name: "Replace line 2" })).toBeVisible();
  await answer.getByRole("button", { name: "Replace line 2" }).click();
  await expect(page.locator(".editor-host .cm-content")).toContainText("fit <- lm(body_mass ~ flipper_len, data = penguins)");
  // Nothing ran: the replacement waits for the user to run it.
  await page.getByRole("navigation", { name: "Canvas views" }).getByRole("button", { name: "Canvas", exact: true }).click();
  await expect(page.locator(".output-card.status-error")).toHaveCount(1);
});

test("questions stream an answer whose code can be inserted, and code R cannot read is labeled", async ({ page }) => {
  await openExample(page);
  const dialog = await setUpAssistant(page);
  await dialog.locator(".model-card").filter({ hasText: "Qwen2.5 Coder 3B" }).getByRole("button", { name: /^Download/ }).click();
  await expect(dialog.getByText("In use")).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole("button", { name: "Done" }).click();

  await newFileWith(page, "");
  const box = page.getByRole("textbox", { name: "Ask the assistant" });
  await box.fill("Write code that counts penguins by species");
  await box.press("Enter");
  // The stand-in answers ask requests in words only.
  await expect(page.locator(".turn-question")).toHaveText("Write code that counts penguins by species");
  await expect(page.locator(".turn-answer").last()).toContainText("mean(penguins$body_mass, na.rm = TRUE)");
  await expect(page.locator(".turn-answer code").first()).toHaveText("mean(penguins$body_mass, na.rm = TRUE)");

  // Comments on the code at the cursor come back as code to insert.
  await page.locator(".editor-host .cm-content").click();
  await page.keyboard.insertText("fit <- lm(body_mass ~ flipper_len, data = penguins)");
  await page.getByRole("button", { name: "Add comments" }).click();
  const answer = page.locator(".turn-answer").last();
  await expect(answer.locator(".suggestion code")).toContainText("# Fit a straight line");
  await expect(answer.getByText("R can read this code")).toBeVisible();
  await answer.getByRole("button", { name: "Replace line 1" }).click();
  await expect(page.locator(".editor-host .cm-content")).toContainText("# Fit a straight line: body mass by flipper length");
});

test("the assistant pane explains itself before setup and never blocks the rest of the app", async ({ page }) => {
  await openExample(page);
  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  const pane = page.getByRole("region", { name: "Assistant" });
  await expect(pane).toContainText("An assistant that runs on this Mac");
  await expect(pane).toContainText("your work never leaves it");
  // Errors offer the assistant only once a model is ready.
  await newFileWith(page, "nosuchthing\n");
  await runLine(page);
  await expect(page.locator(".output-card.status-error")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ask the assistant" })).toHaveCount(0);
});

test("a fix that is a different step, such as an install, goes to the console and never replaces the line", async ({ page }) => {
  await openExample(page);
  const dialog = await setUpAssistant(page);
  await dialog.locator(".model-card").filter({ hasText: "Qwen2.5 Coder 3B" }).getByRole("button", { name: /^Download/ }).click();
  await expect(dialog.getByText("In use")).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole("button", { name: "Done" }).click();
  // The example script uses gt, which the stand-in has not installed.
  await page.keyboard.press("Shift+Control+Enter");
  const card = page.locator(".output-card.status-error");
  await card.getByRole("button", { name: "Ask the assistant" }).click();
  const answer = page.locator(".turn-answer").last();
  await expect(answer.locator(".suggestion code")).toHaveText('install.packages("gt")');
  await expect(answer.getByRole("button", { name: /^Replace/ })).toHaveCount(0);
  await answer.getByRole("button", { name: "Put in the console" }).click();
  await expect(page.locator("#console-input")).toHaveText('install.packages("gt")');
});

test("a comment becomes code in a draft under it, and goes in only when inserted", async ({ page }) => {
  await openExample(page);
  const dialog = await setUpAssistant(page);
  const small = dialog.locator(".model-card").filter({ hasText: "Qwen2.5 Coder 3B" });
  await small.getByRole("button", { name: /^Download/ }).click();
  await expect(small.getByText("In use")).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "New script" }).click();
  const editor = page.locator(".editor-host .cm-content");
  await editor.click();
  await page.keyboard.insertText("# count penguins by species");
  await page.keyboard.press("Alt+Control+g");
  const draft = page.locator(".code-draft");
  await expect(draft).toContainText("Code for: count penguins by species");
  await expect(draft.locator("pre")).toContainText("table(penguins$species)");
  await expect(draft).toContainText("R can read this.");
  await expect(editor).not.toContainText("table(penguins$species)");
  await draft.getByRole("button", { name: "Insert" }).click();
  await expect(page.locator(".editor-host .cm-line").nth(1)).toContainText("# Count penguins by species");
  await expect(page.locator(".editor-host .cm-line").nth(2)).toHaveText("table(penguins$species)");
});
