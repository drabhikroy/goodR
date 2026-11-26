import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { expectReady, openProjectMenu, showObjects } from "../ui/helpers";

// One test per screenshot, each starting from a fresh window, so a change
// to one screen never shifts the others.

async function save(page: Page, info: TestInfo, name: string) {
  // The caret blinks and fonts load late; both would make each run differ.
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: "*, *::before, *::after { caret-color: transparent !important; transition: none !important; animation: none !important; } .notice { display: none !important; }" });
  await page.screenshot({ path: `docs/images/${name}-${info.project.name}.png` });
}

/** Opens the app and picks R, in the appearance this run is for. */
async function start(page: Page, info: TestInfo) {
  // A first run's layout, not the stand-in's, which keeps the sidebar and
  // the strip of earlier results on for the interface tests.
  await page.addInitScript(() => {
    window.goodforSettings = { showSidebar: false, showTimeline: false, consoleInputHeight: 48, layoutVersion: 2 };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Use this R" }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("radio", { name: info.project.name === "dark" ? "Dark" : "Light", exact: true }).check();
  await page.keyboard.press("Escape");
  // Closing Settings puts focus back on its button, which would show a ring.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

/** Opens the penguins project at analysis.R, with R ready. */
async function openProject(page: Page, info: TestInfo) {
  await start(page, info);
  await page.getByRole("button", { name: /^penguins/ }).first().click();
  await expect(page.getByRole("tab", { name: /analysis\.R/ })).toBeVisible();
  await expectReady(page);
}

async function openFile(page: Page, name: RegExp) {
  await (await openProjectMenu(page)).getByRole("menuitem", { name }).click();
  await expect(page.getByRole("tab", { name })).toHaveAttribute("aria-selected", "true");
}

test("opening screen", async ({ page }, info) => {
  await start(page, info);
  await expect(page.getByRole("button", { name: /^penguins/ }).first()).toBeVisible();
  await save(page, info, "opening");
});

test("workspace after running the script", async ({ page }, info) => {
  await openProject(page, info);
  // Each statement in turn, up to the plot, as someone working through the
  // script would. The last line needs a package the example leaves out.
  await page.locator(".editor-host .cm-content").click();
  await page.keyboard.press("Control+Home");
  for (let statement = 0; statement < 7; statement += 1) {
    await page.keyboard.press("Control+Enter");
    await expectReady(page);
  }
  await expect(page.locator(".output-card").first()).toBeVisible();
  await save(page, info, "workspace");
});

test("data viewer", async ({ page }, info) => {
  await openProject(page, info);
  await page.locator(".editor-host .cm-content").click();
  await page.keyboard.press("Control+Home");
  for (let line = 0; line < 3; line += 1) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Control+Enter");
  await (await showObjects(page)).getByRole("button", { name: /^penguins / }).click();
  await expect(page.getByRole("region", { name: "Data viewer, penguins" }).first()).toContainText("Rows 1 to 100");
  await save(page, info, "data-viewer");
});

test("report preview", async ({ page }, info) => {
  await openProject(page, info);
  await openFile(page, /report\.qmd/);
  await page.getByRole("button", { name: "Render", exact: true }).click();
  const preview = page.frameLocator('iframe[title="Preview of report.html"]');
  await expect(preview.getByRole("heading", { name: "Penguin measurements" })).toBeVisible();
  await save(page, info, "report");
});

test("Shiny app and how its parts connect", async ({ page }, info) => {
  await start(page, info);
  await page.getByRole("button", { name: "Open the examples" }).click();
  // The second app.R is the space launches app, whose map has the most to show.
  await (await openProjectMenu(page)).getByRole("menuitem", { name: "shiny-launches/app.R" }).click();
  await page.getByRole("button", { name: "App", exact: true }).click();
  const map = page.getByRole("group", { name: "How the app connects" });
  await map.getByRole("button", { name: "output$failures" }).click();
  await expect(map.getByRole("button", { name: "input$years" })).toHaveClass(/is-linked/);
  await save(page, info, "shiny");
});

test("Help", async ({ page }, info) => {
  await start(page, info);
  await page.getByRole("button", { name: "Help", exact: true }).click();
  await page.getByRole("button", { name: "Start here" }).click();
  await save(page, info, "help");
});

test("Code text settings", async ({ page }, info) => {
  await openProject(page, info);
  await page.keyboard.press("Control+,");
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Code text" }).click();
  await save(page, info, "settings-code");
});

test("the tour", async ({ page }, info) => {
  await openProject(page, info);
  await page.keyboard.press("Control+k");
  await page.keyboard.insertText("take the tour");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await save(page, info, "tour");
});

test("importing data", async ({ page }, info) => {
  await openProject(page, info);
  await (await openProjectMenu(page)).getByRole("menuitem", { name: "Import penguins.csv" }).click();
  const dialog = page.getByRole("dialog", { name: "Import data" });
  await expect(dialog.locator("pre")).toHaveText('penguins <- read.csv("data/penguins.csv")');
  await expect(dialog).not.toContainText("R is reading the first rows");
  await save(page, info, "import-data");
});

test("likely mistakes in a Shiny app", async ({ page }, info) => {
  await openProject(page, info);
  await openFile(page, /app\.R/);
  await page.locator(".editor-host .cm-content").click();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText('library(shiny)\n\nui <- fluidPage(\n  sliderInput("bins", "Bins", 5, 50, 20),\n  plotOutput("mass")\n)\n\nserver <- function(input, output) {\n  output$mas <- renderPlot(hist(penguins$body_mass, breaks = input$bins))\n}\n\nshinyApp(ui, server)\n');
  // The list starts folded to one line. It is shown open here, since what it says is the point.
  const list = page.getByRole("region", { name: "Likely mistakes in this app" });
  await expect(list).toContainText("1 likely mistake in this app");
  await list.getByRole("button", { name: "Show" }).click();
  await expect(list).toContainText("output$mas has no place in the UI");
  await save(page, info, "shiny-check");
});

test("History, the earlier versions as cards with the script now beside them", async ({ page }, info) => {
  // The page's clock starts at a fixed morning and the file starts with five
  // saved versions of its own, so the times under the slider and the marks on
  // the cards are the same each time the screenshots are taken.
  const base = [
    "# Penguin measurements, first look",
    "library(ggplot2)",
    "",
    "data(penguins)",
    "",
    "# Body mass by species ----",
    "mass_by_species <- aggregate(body_mass ~ species,",
    "                             data = penguins, FUN = mean)",
    "mass_by_species",
    "",
    "# Flipper length model ----",
    "fit <- lm(body_mass ~ flipper_len, data = penguins)",
    "confint(fit)",
    "",
    "ggplot(mass_by_species, aes(species, body_mass)) +",
    "  geom_col(fill = \"#1F5F8B\")",
    "",
    "# Publication table",
    "gt::gt(mass_by_species)",
    "",
  ].join("\n");
  // How the script began the morning, before its heading and model changed.
  const early = base.replace("# Penguin measurements, first look", "# Penguin measurements").replace("lm(body_mass ~ flipper_len,", "lm(body_mass ~ flipper_len + species,");
  const summary = "summary(penguins$body_mass)\n";
  const spread = "sd(penguins$body_mass)\n";
  const slip = "lm(flipper_length_mm ~ species)\n";
  const compare = "t.test(body_mass ~ sex, data = penguins)\n";
  const counts = "table(penguins$species)\n";
  await page.addInitScript(
    ({ base, early, summary, spread, slip, compare }) => {
      const Real = Date;
      const start = new Real(2026, 10, 24, 9, 4).getTime();
      const began = Real.now();
      const w = window as unknown as { goodforLater: number; goodforVersions: Record<string, unknown[]> };
      w.goodforLater = 0;
      class Morning extends Real {
        constructor(...args: unknown[]) {
          if (args.length) super(...(args as [number]));
          else super(Morning.now());
        }
        static now() {
          return start + (Real.now() - began) + w.goodforLater * 60_000;
        }
      }
      window.Date = Morning as unknown as DateConstructor;
      const at = (hour: number, minute: number) => new Real(2026, 10, 24, hour, minute).getTime();
      // Newest first. The slip at 10:29 stopped the script when it ran at 10:30.
      w.goodforVersions = {
        "/Users/demo/Documents/penguins/analysis.R": [
          { savedAt: at(11, 11), text: base + summary + spread + compare, ran: true },
          { savedAt: at(10, 34), text: early + summary + spread + compare, ran: true },
          { savedAt: at(10, 29), text: early + summary + spread + slip, ran: false },
          { savedAt: at(9, 43), text: early + summary + spread, ran: true },
          { savedAt: at(9, 12), text: early + summary, ran: true },
        ],
      };
    },
    { base, early, summary, spread, slip, compare },
  );
  await openProject(page, info);
  const content = page.locator(".editor-host .cm-content");
  const later = (minutes: number) => page.evaluate((add) => ((window as unknown as { goodforLater: number }).goodforLater += add), minutes);
  // The run that failed, half past ten.
  await later(86);
  await content.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText(base + summary + spread + slip);
  await expect(content).toContainText("flipper_length_mm ~ species");
  await expectReady(page);
  await expect(page.getByRole("tab", { name: /analysis\.R/ })).toContainText("edited");
  // The run starts from the keyboard; a press that lands before the editor
  // has taken the new text is tried again.
  await expect(async () => {
    await page.keyboard.press("Control+Shift+Enter");
    await expect(page.locator(".output-card.status-error").first()).toBeVisible({ timeout: 4_000 });
  }).toPass({ timeout: 30_000 });
  // Then the script as it stands now, a little after eleven.
  await later(44);
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText(base + summary + spread + compare + counts);
  await page.getByRole("navigation", { name: "Tools" }).getByRole("button", { name: "History", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "History of analysis.R" });
  const slider = dialog.getByRole("slider", { name: "Compare now with" });
  await expect(slider).toBeVisible();
  await slider.focus();
  // The slider runs oldest to newest: three steps along from the oldest is
  // the half past ten save, with the slip and two earlier saves behind it.
  await page.keyboard.press("Home");
  for (let step = 0; step < 3; step++) await page.keyboard.press("ArrowRight");
  await expect(dialog.locator(".tn-card-behind")).toHaveCount(3);
  // The card that was in front lifts away for a moment; the picture is taken after.
  await expect(dialog.locator(".tn-card-leaving")).toHaveCount(0);
  await expect(dialog.locator(".tn-card .tn-card-when")).toHaveText(/10:34 AM/);
  await slider.blur();
  await save(page, info, "history");
});

/** Sets up the assistant with the private Ollama, up to its list of models. */
async function setUpAssistant(page: Page) {
  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  await page.getByRole("button", { name: "Set up the assistant" }).click();
  const dialog = page.getByRole("dialog", { name: "Set up the assistant" });
  await dialog.getByRole("button", { name: "Install and continue" }).click();
  await expect(dialog.locator("[aria-current=step]")).toContainText("This computer", { timeout: 10_000 });
  await dialog.getByRole("button", { name: "Check this computer" }).click();
  await expect(dialog.locator(".specs")).toContainText("16 GB");
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(dialog.locator(".model-card")).toHaveCount(4);
  return dialog;
}

test("assistant setup", async ({ page }, info) => {
  await openProject(page, info);
  await setUpAssistant(page);
  await save(page, info, "assistant-setup");
});

test("the assistant fixing an error", async ({ page }, info) => {
  await openProject(page, info);
  const dialog = await setUpAssistant(page);
  await dialog.locator(".model-card").filter({ hasText: "Qwen2.5 Coder 3B" }).getByRole("button", { name: /^Download/ }).click();
  await expect(dialog.getByText("In use")).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "New script" }).click();
  await page.locator(".editor-host .cm-content").click();
  await page.keyboard.insertText("data(penguins)\nfit <- lm(body_mass ~ flipper_length_mm, data = penguins)\n");
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("Control+Enter");
  await expectReady(page);
  await page.keyboard.press("Control+Enter");
  await page.locator(".output-card.status-error").getByRole("button", { name: "Ask the assistant" }).click();
  await expect(page.locator(".turn-answer").last().getByRole("button", { name: "Replace line 2" })).toBeVisible();
  await save(page, info, "assistant");
});
