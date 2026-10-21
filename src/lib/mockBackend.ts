// A stand-in backend for running the interface in a plain browser.
//
// It holds a few example scripts in memory and imitates the R behaviors
// the interface depends on: printed values, streamed text, errors, plots,
// slow runs that can be stopped, readline prompts, missing packages, and a
// crash. It is used by the interface tests and for reviewing screens. It is
// never part of the desktop app, which talks to real R.

import type { Backend } from "./backend";
import type { AnswerEvent, AppEvent, ExportEvent, AssistantTask, DataMeta, DataRow, MachineSpecs, ModelCatalog, ModelFit, ProjectInfo, REvent, RenderEvent, RenderResult, RenderTarget, RObject, SetupEvent, Settings } from "./types";

// Where the example scripts appear to live.
const ROOT = "/Users/demo/Documents/penguins";

// The example project the app ships, read from the same files the desktop
// app compiles in, and where it appears to be copied.
const EXAMPLES_ROOT = "/Users/demo/Documents/R Examples";
const EXAMPLE_FILES = import.meta.glob("../../examples/**/*", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

// The example scripts: a short penguins analysis that exercises each kind
// of result, so every screen has something real to show.
const FILES: Record<string, string> = {
  [`${ROOT}/analysis.R`]: [
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
  ].join("\n"),
  [`${ROOT}/cleaning.R`]: "# Cleaning steps\npenguins_clean <- na.omit(penguins)\nnrow(penguins_clean)\n",
  // A script in another folder, for checking that R follows the script.
  "/Users/demo/Desktop/quick.R": "1 + 2\n",
  // A Shiny app, for the App pane.
  [`${ROOT}/app.R`]: [
    "library(shiny)",
    "",
    "ui <- fluidPage(",
    "  titlePanel(\"Penguin explorer\"),",
    "  plotOutput(\"mass\")",
    ")",
    "",
    "server <- function(input, output) {",
    "  output$mass <- renderPlot(hist(penguins$body_mass))",
    "}",
    "",
    "shinyApp(ui, server)",
    "",
  ].join("\n"),
  [`${ROOT}/report.qmd`]: "---\ntitle: \"Penguin measurements\"\nformat: html\n---\n\n## Body mass by species\n\n```{r}\naggregate(body_mass ~ species, data = penguins, FUN = mean)\n```\n",
};

// The example project, made of the scripts above and one data file.
const PROJECT_FILE = `${ROOT}/penguins.Rproj`;
const project = (): ProjectInfo => ({
  name: "penguins",
  root: ROOT,
  file: PROJECT_FILE,
  scripts: Object.keys(FILES).filter((path) => path.startsWith(`${ROOT}/`)).map((path) => path.slice(ROOT.length + 1)),
  data: ["data/penguins.csv"],
});

// A small stand-in for the penguins data, enough to page, sort, and show
// missing values in the data viewer. Values come from simple arithmetic on
// the row number, so every test run sees the same table, and two rows are
// missing their measurements, as two are in the real data.
const SPECIES = ["Adelie", "Chinstrap", "Gentoo"];
const PENGUINS = Array.from({ length: 344 }, (_, index) => {
  const species = SPECIES[index % 3];
  const missing = index === 3 || index === 271;
  const mass = missing ? null : 3000 + ((index * 37) % 3300);
  return {
    species,
    island: ["Torgersen", "Biscoe", "Dream"][index % 3],
    bill_len: missing ? null : (32 + ((index * 7) % 27) + 0.1 * (index % 10)).toFixed(1),
    flipper_len: missing ? null : String(172 + ((index * 11) % 59)),
    body_mass: mass === null ? null : String(mass),
    sex: index % 29 === 0 ? null : index % 2 ? "male" : "female",
  };
});

/** Describes the stand-in data the way the R helper describes a real data
 * frame, so the viewer cannot tell the two apart. */
function penguinsMeta(): DataMeta {
  // Numeric columns get twelve histogram bins scaled to the tallest, and
  // their mean, median, and range.
  const numeric = (key: "bill_len" | "flipper_len" | "body_mass") => {
    const values = PENGUINS.map((row) => row[key]).filter((value): value is string => value !== null).map(Number);
    const sorted = [...values].sort((a, b) => a - b);
    const bins = Array.from({ length: 12 }, (_, bin) => values.filter((value) => Math.min(11, Math.floor(((value - sorted[0]) / (sorted[sorted.length - 1] - sorted[0] + 1e-9)) * 12)) === bin).length);
    const top = Math.max(...bins);
    return {
      name: key,
      type: key === "bill_len" ? "num" : "int",
      missing: PENGUINS.length - values.length,
      summary: `${sorted[0]} to ${sorted[sorted.length - 1]}`,
      bars: bins.map((count) => Math.round((100 * count) / top)),
      stats: { mean: values.reduce((a, b) => a + b, 0) / values.length, median: sorted[Math.floor(sorted.length / 2)], sd: 0, min: sorted[0], max: sorted[sorted.length - 1] },
      top: [],
    };
  };
  // Category columns list their values from most to least common.
  const factor = (key: "species" | "island" | "sex") => {
    const counts = new Map<string, number>();
    for (const row of PENGUINS) if (row[key] !== null) counts.set(row[key]!, (counts.get(row[key]!) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
    return { name: key, type: "fct", missing: PENGUINS.filter((row) => row[key] === null).length, summary: `${counts.size} levels`, bars: top.map((item) => Math.round((100 * item.count) / top[0].count)), stats: {}, top };
  };
  return { name: "penguins", rows: PENGUINS.length, columns: [factor("species"), factor("island"), numeric("bill_len"), numeric("flipper_len"), numeric("body_mass"), factor("sex")] };
}

/** One page of the stand-in data, sorted the way R's order() would sort
 * it: numbers by value, text alphabetically, missing values last. */
function penguinsRows(offset: number, count: number, sortBy: string, descending: boolean): DataRow[] {
  const keys = ["species", "island", "bill_len", "flipper_len", "body_mass", "sex"] as const;
  let order = PENGUINS.map((row, index) => ({ row, index }));
  if (sortBy && (keys as readonly string[]).includes(sortBy)) {
    const key = sortBy as (typeof keys)[number];
    const numeric = key === "bill_len" || key === "flipper_len" || key === "body_mass";
    order = [...order].sort((a, b) => {
      const [x, y] = [a.row[key], b.row[key]];
      if (x === null) return 1;
      if (y === null) return -1;
      const result = numeric ? Number(x) - Number(y) : x.localeCompare(y);
      return descending ? -result : result;
    });
  }
  return order.slice(offset, offset + count).map(({ row, index }) => ({ n: index + 1, values: keys.map((key) => row[key] ?? ""), na: keys.map((key) => row[key] === null) }));
}

// The example's three row summary, for the data viewer and the stage.
const MASS_ROWS = [
  ["Adelie", "3700.662"],
  ["Chinstrap", "3733.088"],
  ["Gentoo", "5076.016"],
];
const MASS_META: DataMeta = {
  name: "mass_by_species",
  rows: 3,
  columns: [
    { name: "species", type: "fct", missing: 0, summary: "3 levels", bars: [100, 100, 100], stats: {}, top: MASS_ROWS.map(([value]) => ({ value, count: 1 })) },
    { name: "body_mass", type: "num", missing: 0, summary: "3700.662 to 5076.016", bars: [100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 50], stats: { mean: 4169.92, median: 3733.088, sd: 785, min: 3700.662, max: 5076.016 }, top: [] },
  ],
};

/** The paths the Open dialog returns next. Tests set this to choose files,
 * standing in for a person clicking in the system dialog. */
declare global {
  interface Window {
    goodforPick?: string[];
  }
}

// What the pretend R prints for the example's tables.
const TABLES: Record<string, string> = {
  mass_by_species: "    species body_mass\n1    Adelie  3700.662\n2 Chinstrap  3733.088\n3    Gentoo  5076.016",
  confint: "                  2.5 %     97.5 %\n(Intercept) -6382.36 -5179.302\nflipper_len    46.66    52.716",
  penguins: "  species    island bill_len bill_dep flipper_len body_mass    sex year\n1  Adelie Torgersen     39.1     18.7         181      3750   male 2007",
};

/** Waits, so output arrives over time the way it does from real R. */
function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Draws a small bar chart and returns it as base64 PNG, like ark would. */
function fakePlot(withLine = false): string {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 420;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, 640, 420);
  ctx.fillStyle = "#1F5F8B";
  [0.73, 0.74, 1].forEach((height, index) => ctx.fillRect(80 + index * 180, 380 - height * 320, 120, height * 320));
  ctx.fillStyle = "#1C1B19";
  ctx.font = "16px sans-serif";
  ["Adelie", "Chinstrap", "Gentoo"].forEach((label, index) => ctx.fillText(label, 100 + index * 180, 405));
  // A line added to the plot, as abline would draw one.
  if (withLine) {
    ctx.strokeStyle = "#A84C16";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(60, 360);
    ctx.lineTo(600, 90);
    ctx.stroke();
  }
  return canvas.toDataURL("image/png").split(",")[1];
}

/** Builds a backend whose R recognizes a small set of patterns, enough
 * for every interface path to be exercised. */
/** A few help pages for the stand-in, with the parts R's pages have. */
const MOCK_HELP: Record<string, { package: string; title: string; usage: string; body: string }> = {
  mean: { package: "base", title: "Arithmetic Mean", usage: "mean(x, trim = 0, na.rm = FALSE, ...)", body: 'Generic function for the (trimmed) arithmetic mean. See also <a href="../../stats/help/sd.html">sd</a>.' },
  sd: { package: "stats", title: "Standard Deviation", usage: "sd(x, na.rm = FALSE)", body: 'Computes the standard deviation of the values in x. See also <a href="../../base/html/mean.html">mean</a>.' },
};

const MOCK_PACKAGE_TITLES: Record<string, string> = {
  base: "The R Base Package",
  dplyr: "A Grammar of Data Manipulation",
  ggplot2: "Create Elegant Data Visualisations Using the Grammar of Graphics", // standards: a package's own title
  graphics: "The R Graphics Package",
  shiny: "Web Application Framework for R",
  stats: "The R Stats Package",
  utils: "The R Utils Package",
};

function helpHtml(name: string, page: { package: string; title: string; usage: string; body: string }) {
  // Hostile parts a package's help could carry, which the Help pane must
  // drop: a script, an event handler, an image, and a network link.
  const hostile = `<script>window.helpRan = true</script><p onclick="window.helpRan = true">Details<img src="https://example.com/x.png" onerror="window.helpRan = true"> <a href="https://example.com">site</a></p>`;
  return `<!DOCTYPE html><html><head><title>R: ${page.title}</title><link rel="stylesheet" href="R.css"></head><body><div class="container"><table><tr><td>${name} {${page.package}}</td></tr></table><h2>${page.title}</h2><h3>Usage</h3><pre><code>${page.usage}</code></pre><h3>Description</h3><p>${page.body}</p>${hostile}</div></body></html>`;
}

/** Functions the stand-in completes, and the arguments of a few. */
// Numbers assigned at the prompt or in a script, by name, as R would keep
// them, so a printed name shows its latest value.
const NUMBERS = new Map<string, string>();

const MOCK_DOI ="10.1111/maps.13863";
const MOCK_BIBTEX = "@article{Gattacceca_2022, title={The Meteoritical Bulletin}, journal={Meteoritics & Planetary Science}, DOI={10.1111/maps.13863}, year={2022}}";
// references.bib as the stand-in writes it.
let bibFile = "";

const MOCK_FUNCTIONS = ["mean", "median", "merge", "message", "summary", "subset", "sum", "lm", "library", "length", "read.csv", "plot", "print", "head", "aggregate", "confint"];
const MOCK_ARGS: Record<string, string[]> = { mean: ["x", "trim", "na.rm"], lm: ["formula", "data", "subset", "weights"], "read.csv": ["file", "header", "sep", "na.strings"], head: ["x", "n"] };

// Listeners for the app update's download progress.
const updateListeners = new Set<(progress: { done: number; total: number | null }) => void>();

// Saved versions of each file, newest first, for the history dialog.
const VERSIONS: Record<string, { id: string; savedAt: number; text: string }[]> = {};

export function createMockBackend(): Backend {
  // Settings start with recent files so the opening screen has something
  // to show.
  const now = Math.floor(Date.now() / 1000);
  let settings: Settings = {
    rHome: "",
    recentFiles: [
      { path: `${ROOT}/analysis.R`, openedAt: now - 3600 },
      { path: `${ROOT}/cleaning.R`, openedAt: now - 3 * 86400 },
      { path: `${ROOT}/report.qmd`, openedAt: now - 12 * 86400 },
    ],
    sessionFiles: [],
    sessionActive: "",
    recentProjects: [{ path: PROJECT_FILE, openedAt: now - 1800 }],
    sessionProject: "",
    consoleHeight: 230,
    consoleInputHeight: 96,
    timelineHeight: 184,
    showSidebar: true,
    showCanvas: true,
    showPrompt: true,
    showTimeline: true,
    inspectorWidth: 520,
    paneSplit: 45,
    appearance: "light",
    palette: "standard",
    textSize: 100,
    reduceMotion: false,
    layer: "essentials",
    outputLayout: "canvas",
    layoutChosen: false,
    // The tour opens by itself on a real first run. Tests start it when
    // they mean to, so the stand-in has already seen it.
    tourSeen: true,
    missingPackages: "ask",
    codeFont: "dm-mono",
    codeSize: 15,
    lineSpacing: "normal",
    ligatures: false,
    lineNumbers: true,
    highlightLine: true,
    wrapLines: false,
    tabWidth: 2,
    closeBrackets: true,
    rainbowBrackets: false,
    resultStyle: "cards",
    copyResults: true,
    assistantRoute: "",
    assistantModel: "",
    runDefaults: {},
    undoRuns: true,
    showPackageLog: false,
    updateChecks: "auto",
    // Looked for just now, so the daily check stays quiet during tests.
    lastUpdateCheck: Date.now(),
    autosave: false,
    renderOnSave: true,
    pdfEngine: "auto",
    latexDir: "",
    hints: true,
    formatOnType: true,
    scriptItalics: false,
    keepResults: true,
    plotStyle: false,
    compact: false,
    readingWidth: true,
  };
    // Listeners for R events and menu clicks, as the real backend has.
  const listeners = new Set<(session: string, generation: number, event: REvent) => void>();
  const menuListeners = new Set<(id: string) => void>();
    // gt is deliberately missing, to exercise the package banner. Packages
    // live in one library, so every session sees the same ones.
  const installed = new Set(["ggplot2", "dplyr", "shiny"]);
  let generations = 0;

  // One pretend R per session, each with its own objects, plots, and
  // search path, as separate R processes have.
  type FakeR = {
    key: string;
    generation: number;
    objects: RObject[];
    // The plot on screen, which lines such as abline add to, and how many
    // plots there have been.
    currentPlot: string;
    plotCount: number;
    // Packages on the search path, as .packages() reports them.
    attached: Set<string>;
    running: boolean;
    interrupted: boolean;
    pendingInput: ((value: string) => void) | null;
    // Runs execute one at a time, as in R. Each waits for the one before.
    chain: Promise<void>;
    workingDir: string;
    // The objects as they were before the last run, for undo, and the code
    // being timed, for the summary of a slow run.
    snap: RObject[] | null;
    timing: string | null;
    lastCode: string;
  };
  const fakes = new Map<string, FakeR>();
  (globalThis as unknown as { goodforSessions: typeof fakes }).goodforSessions = fakes;

  /** A session's pretend R. Calls to a session never started fail as the
   * real backend's do. */
  const fake = (key: string): FakeR => {
    const found = fakes.get(key);
    if (!found) throw new Error("R is not running");
    return found;
  };

    // Sends an event tagged with its session.
  const emit = (r: FakeR, event: REvent) => listeners.forEach((listener) => listener(r.key, r.generation, event));

    /** Adds or replaces an object, keeping the list sorted by name. */
  function setObject(r: FakeR, object: RObject) {
    r.objects = [...r.objects.filter((existing) => existing.name !== object.name), object].sort((a, b) => a.name.localeCompare(b.name));
  }

    /**
     * The pretend R. Each pattern below imitates one behavior the interface
     * must handle. Returns false when the run failed.
     */
  async function evaluate(r: FakeR, run: string, code: string): Promise<boolean> {
    const trimmed = code.trim();
    // quit ends the session, standing in for a crash.
    if (/quit\(/.test(trimmed)) {
      r.running = false;
      emit(r, { kind: "exited", code: 0, log: "R quit when asked to." });
      return false;
    }
        // Sys.sleep stands in for slow work and can be r.interrupted.
    const sleep = /Sys\.sleep\((\d+(?:\.\d+)?)\)/.exec(trimmed);
    if (sleep) {
      const until = Date.now() + Number(sleep[1]) * 1000;
      while (Date.now() < until && !r.interrupted) await delay(50);
      if (r.interrupted) return true;
    }
    const error = (message: string) => {
      emit(r, { kind: "error", run, message: `Error:\n${message}`, traceback: [] });
      return false;
    };
        // stop() produces an error, as in R.
    const stop = /stop\(["'](.+?)["']\)/.exec(trimmed);
    if (stop) return error(stop[1]);
        // Using a package that is not installed fails the way R does.
    for (const match of trimmed.matchAll(/library\((\w+)\)|(\w+)::/g)) {
      const name = match[1] ?? match[2];
      if (!installed.has(name)) return error(`there is no package called ‘${name}’`);
      if (match[1]) r.attached.add(name);
    }
    // Detaching takes a package off the search path, as in R.
    const detached = /detach\("package:(\w+)"/.exec(trimmed);
    if (detached) r.attached.delete(detached[1]);
    // A misspelled column, for the error explanation.
    if (trimmed.includes("flipper_length_mm")) return error("object 'flipper_length_mm' not found");
        // Installs stream progress to stderr, as install.packages does.
    const install = /install\.packages\((.+)\)/.exec(trimmed);
    if (install) {
      for (const name of install[1].match(/[A-Za-z][A-Za-z0-9.]*/g) ?? []) {
        if (name === "c") continue;
        // xml2 needs a system library this pretend computer lacks, so its
        // install fails the way a real one does, with a long log first.
        if (name === "xml2") {
          emit(r, { kind: "stream", run, name: "stderr", text: "Installing package into the user library\n* installing *source* package 'xml2' ...\nUsing PKG_CFLAGS=\n------------------------- ANTICONF ERROR ---------------------------\nConfiguration failed because libxml-2.0 was not found. Try installing:\n * deb: libxml2-dev (Debian, Ubuntu, etc)\n * rpm: libxml2-devel (Fedora, CentOS, RHEL)\n * brew: libxml2 (Mac OSX)\n--------------------------------------------------------------------\nERROR: configuration failed for package 'xml2'\n" });
          await delay(100);
          emit(r, { kind: "stream", run, name: "stderr", text: `Warning message:\nIn install.packages("xml2") :\n  installation of package ‘xml2’ had non-zero exit status\n` });
          continue;
        }
        emit(r, { kind: "stream", run, name: "stderr", text: `Installing package into the user library\ntrying URL 'https://cloud.r-project.org/src/contrib/${name}_1.0.0.tar.gz'\n* installing *source* package '${name}' ...\n` });
        await delay(300);
        installed.add(name);
        emit(r, { kind: "stream", run, name: "stderr", text: `* DONE (${name})\n` });
      }
      return true;
    }
        // readline waits for an answer from the console.
    const prompt = /readline\(["'](.*?)["']\)/.exec(trimmed);
    if (prompt) {
      emit(r, { kind: "input_request", run, prompt: prompt[1], password: false });
      const answer = await new Promise<string>((resolve) => (r.pendingInput = resolve));
      if (trimmed.includes("cat(")) emit(r, { kind: "stream", run, name: "stdout", text: `hi ${answer}\n` });
      return true;
    }
    if (trimmed.includes("data(penguins)")) {
      setObject(r, { name: "penguins", kind: "data", class: "data.frame", summary: "data frame, 344 rows, 8 columns", columns: ["species", "island", "bill_len", "bill_dep", "flipper_len", "body_mass", "sex", "year"] });
    }
        // Two names side by side do not parse, and ark says so without
        // a position, as it does for real.
    if (/^[A-Za-z.][\w.]*\s+[A-Za-z.][\w.]*$/.test(trimmed) && !/^(if|for|while|function|else|repeat)\b/.test(trimmed)) return error("Syntax error: unexpected symbol");
        // Assignments create r.objects of a plausible kind and print nothing.
    const assign = /^([A-Za-z.][\w.]*)\s*<-/.exec(trimmed);
    if (assign) {
      const name = assign[1];
      const before = r.objects.find((object) => object.name === name);
      if (/subset\(/.test(trimmed) && before) setObject(r, { ...before, summary: before.summary.replace(/\d+ rows/, "120 rows") });
      else if (/lm\(/.test(trimmed)) setObject(r, { name, kind: "model", class: "lm", summary: "linear model, R squared 0.76", columns: [] });
      else if (/aggregate|data\.frame|na\.omit/.test(trimmed)) setObject(r, { name, kind: "data", class: "data.frame", summary: "data frame, 3 rows, 2 columns", columns: ["species", "body_mass"] });
      else setObject(r, { name, kind: "value", class: "numeric", summary: "numeric, 1 value", columns: [] });
      // A plain number is remembered, so printing the name shows it.
      const literal = /<-\s*(-?\d+(?:\.\d+)?)\s*$/.exec(trimmed);
      if (literal) NUMBERS.set(name, literal[1]);
      return true;
    }
        // Plotting functions return a picture.
    if (/\b(ggplot|plot|hist|barplot)\(/.test(trimmed)) {
      r.currentPlot = `plot-${(r.plotCount += 1)}`;
      emit(r, { kind: "output", run, text: null, html: null, png: fakePlot(), svg: null, displayId: r.currentPlot, update: false });
      return true;
    }
    // Lines that add to the plot on screen arrive as updates to it, as they
    // do from ark. With no plot on screen, R says so, as it does for real.
    if (/^(abline|lines|points|text|legend|title|curve|segments|arrows|rect|polygon|grid|mtext|axis|box)\(/.test(trimmed)) {
      if (!r.currentPlot) return error("plot.new has not been called yet");
      emit(r, { kind: "output", run, text: null, html: null, png: fakePlot(true), svg: null, displayId: r.currentPlot, update: true });
      return true;
    }
    // confint prints a table of intervals, as R does.
    if (/^confint\(/.test(trimmed)) {
      emit(r, { kind: "output", run, text: TABLES.confint, html: null, png: null, svg: null });
      return true;
    }
    // Turning text into numbers prints the result and warns about the
    // values that would not convert, as R does.
    if (/^as\.numeric\(/.test(trimmed)) {
      emit(r, { kind: "output", run, text: "[1]  1 NA  3", html: null, png: null, svg: null });
      emit(r, { kind: "stream", run, name: "stderr", text: "Warning message:\nNAs introduced by coercion \n" });
      return true;
    }
    // cat prints text to stdout without a value.
    const cat = /^cat\(["'](.*)["']\)$/.exec(trimmed);
    if (cat) {
      emit(r, { kind: "stream", run, name: "stdout", text: cat[1].replace(/\\n/g, "\n") });
      return true;
    }
    // A slow model fit, for the summary of where a run spent its time.
    if (/^slow_fit\(/.test(trimmed)) {
      await delay(2100);
      emit(r, { kind: "output", run, text: "[1] 0.76", html: null, png: null, svg: null });
      return true;
    }
    // Plain arithmetic is computed, so live output can be checked.
    if (/^[\d\s+\-*/().]+$/.test(trimmed)) {
      const value = Function(`"use strict"; return (${trimmed});`)() as number;
      emit(r, { kind: "output", run, text: `[1] ${value}`, html: null, png: null, svg: null });
      return true;
    }
    // A bare name prints its value, or fails when it does not exist.
    const bare = /^(?:head\()?([A-Za-z.][\w.]*)\)?$/.exec(trimmed);
    if (bare) {
      const name = bare[1];
      if (TABLES[name] && r.objects.some((object) => object.name === name)) {
        emit(r, { kind: "output", run, text: TABLES[name], html: null, png: null, svg: null });
        return true;
      }
      if (!r.objects.some((object) => object.name === name)) return error(`object '${name}' not found`);
      emit(r, { kind: "output", run, text: `[1] ${NUMBERS.get(name) ?? "1"}`, html: null, png: null, svg: null });
    }
    return true;
  }

  // Files the user chose in this session, as the Rust side tracks them.
  const granted = new Set<string>();
  const grant = (path: string) => {
    granted.add(path);
    settings.recentFiles = [{ path, openedAt: Math.floor(Date.now() / 1000) }, ...settings.recentFiles.filter((recent) => recent.path !== path)].slice(0, 12);
    return path;
  };
  const check = (path: string) => {
    const inProject = [...openProjects.keys()].some((root) => path.startsWith(`${root}/`)) && /\.(R|r|Rmd|qmd)$/.test(path);
    if (!granted.has(path) && !inProject) throw new Error(`${path} was not opened in this app. Open it with File, Open first.`);
  };
  // Every project the stand-in knows, by folder: the example project and
  // any made with New Project. Those open now are in `openProjects`. The
  // folder last chosen for a new one mirrors the Rust side's rule that a
  // project can be created only where the user chose.
  const knownProjects = new Map<string, () => ProjectInfo>([[ROOT, project]]);
  const openProjects = new Map<string, () => ProjectInfo>();
  let chosenFolder = "";
  const openProject = (root = ROOT) => {
    const info = knownProjects.get(root)!;
    openProjects.set(root, info);
    settings.sessionProject = info().file;
    settings.recentProjects = [{ path: info().file, openedAt: Math.floor(Date.now() / 1000) }, ...settings.recentProjects.filter((recent) => recent.path !== info().file)];
    return info();
  };

  return {
    native: false,
    appInfo: async () => ({ name: "R: What Is It Good For?", version: "0.1.0", arkVersion: "0.1.252", platform: "browser", git: true }),
    listRInstalls: async () => [
      { version: "4.5.1", home: "/Library/Frameworks/R.framework/Versions/4.5/Resources", source: "CRAN installer" },
      { version: "4.4.3", home: "/opt/homebrew/Cellar/r/4.4.3/lib/R", source: "Homebrew" },
    ],
    loadSettings: async () => structuredClone(settings),
    saveSettings: async (next) => {
      settings = structuredClone(next);
    },
    updateMenu: async () => {},
    chooseFiles: async () => {
      const picked = window.goodforPick ?? [`${ROOT}/analysis.R`];
      window.goodforPick = undefined;
      return picked.filter((path) => path in FILES).map(grant);
    },
    chooseSavePath: async (suggested) => grant(`${ROOT}/${suggested}`),
    reopen: async (path) => {
      if (!settings.recentFiles.some((recent) => recent.path === path) && !settings.sessionFiles.includes(path)) throw new Error(`${path} is not in the recent list`);
      if (!(path in FILES)) {
        settings.recentFiles = settings.recentFiles.filter((recent) => recent.path !== path);
        throw new Error(`${path} has been moved or deleted`);
      }
      return grant(path);
    },
    forgetRecent: async (path) => {
      settings.recentFiles = settings.recentFiles.filter((recent) => recent.path !== path);
    },
    rememberSession: async (files, active) => {
      settings.sessionFiles = files.filter((file) => granted.has(file));
      settings.sessionActive = active;
    },
    takePending: async () => [],
    // The stand-in's Open Project dialog always picks the example project.
    chooseProject: async () => openProject(),
    reopenProject: async (file) => {
      if (file !== PROJECT_FILE) throw new Error(`${file} has been moved or deleted`);
      return openProject();
    },
    // Listing again returns the same project, since nothing on disk moves.
    refreshProject: async (root) => openProjects.get(root)?.() ?? null,
    closeProject: async (root) => {
      openProjects.delete(root);
      settings.sessionProject = "";
      const r = fakes.get(`project:${root}`);
      if (r) r.running = false;
      fakes.delete(`project:${root}`);
    },
    // A script inside a known project's folder belongs to that project,
    // which opening it opens, as the Rust side finds by the .Rproj file.
    sessionFor: async (file) => {
      check(file);
      const root = [...knownProjects.keys()].find((folder) => file.startsWith(`${folder}/`));
      if (root) return { key: `project:${root}`, project: openProject(root) };
      return { key: `file:${file}`, project: null };
    },
    forgetProject: async (file) => {
      settings.recentProjects = settings.recentProjects.filter((recent) => recent.path !== file);
    },
    chooseProjectFolder: async () => {
      chosenFolder = "/Users/demo/Documents";
      return chosenFolder;
    },
    // A new project gets the template's main file, enough for the
    // workspace to open it.
    // The examples are copied in once, with any deleted file restored and
    // changed files kept, as the Rust side does.
    openExamples: async () => {
      const scripts: string[] = [];
      const data: string[] = [];
      for (const [source, contents] of Object.entries(EXAMPLE_FILES)) {
        const relative = source.replace("../../examples/", "");
        const path = `${EXAMPLES_ROOT}/${relative}`;
        if (FILES[path] === undefined) FILES[path] = contents;
        if (/\.(R|Rmd|qmd)$/.test(relative)) scripts.push(relative);
        else if (/\.csv$/.test(relative)) data.push(relative);
      }
      const order = (a: string, b: string) => a.split("/").length - b.split("/").length || a.localeCompare(b);
      knownProjects.set(EXAMPLES_ROOT, () => ({ name: "R Examples", root: EXAMPLES_ROOT, file: `${EXAMPLES_ROOT}/R Examples.Rproj`, scripts: scripts.sort(order), data: data.sort(order) }));
      return openProject(EXAMPLES_ROOT);
    },
    createProject: async (parent, name, template) => {
      if (parent !== chosenFolder) throw new Error("Choose where the project goes first.");
      const root = `${parent}/${name}`;
      const main = template === "report" ? "report.qmd" : template === "shiny" ? "app.R" : "analysis.R";
      FILES[`${root}/${main}`] = template === "shiny" ? "library(shiny)\n" : "head(quakes)\n";
      knownProjects.set(root, () => ({ name, root, file: `${root}/${name}.Rproj`, scripts: [main], data: [] }));
      return openProject(root);
    },
    readText: async (path) => {
      check(path);
      return FILES[path];
    },
    // Each save keeps the text before it and after it, as the desktop
    // app does, with a pretend time an hour apart so they do not fold.
    writeText: async (path, contents) => {
      check(path);
      const kept = (VERSIONS[path] ??= []);
      if (!kept.length && FILES[path] !== undefined && FILES[path] !== contents) kept.unshift({ id: String(Date.now() - 7_200_000), savedAt: Date.now() - 7_200_000, text: FILES[path] });
      if (kept[0]?.text !== contents) kept.unshift({ id: String(Date.now() - 3_600_000 + kept.length), savedAt: Date.now() - 3_600_000 + kept.length, text: contents });
      FILES[path] = contents;
    },
    // A newer app, R, and Ollama, and two packages behind, so the Updates
    // page has something to show.
    latestVersions: async () => {
      await delay(80);
      return { app: "0.3.0", appInPlace: true, appPage: "https://github.com/drabhikroy/goodR/releases/latest", r: "4.5.2", ollama: "0.41.0" };
    },
    installAppUpdate: async () => {
      for (const done of [2_000_000, 6_000_000, 12_000_000]) {
        await delay(60);
        for (const listener of updateListeners) listener({ done, total: 12_000_000 });
      }
      return "0.3.0";
    },
    onUpdateProgress: async (listener) => {
      updateListeners.add(listener);
      return () => updateListeners.delete(listener);
    },
    restartApp: async () => {},
    outdated: async () => ({ reached: true, packages: [{ name: "dplyr", installed: "1.1.3", available: "1.1.4" }, { name: "ggplot2", installed: "3.5.0", available: "3.5.2" }] }),
    resetApp: async (recent, history) => {
      if (recent) {
        settings.recentFiles = [];
        settings.recentProjects = [];
      }
      if (history) for (const path of Object.keys(VERSIONS)) delete VERSIONS[path];
    },
    fileHistory: async (path) => (VERSIONS[path] ?? []).map(({ id, savedAt }) => ({ id, savedAt })),
    fileVersion: async (path, id) => VERSIONS[path]?.find((version) => version.id === id)?.text ?? "",
    savePlot: async (_data, suggested) => `/Users/demo/Pictures/${suggested}`,
    // The browser preview has no R to draw with, so it reports the file
    // that the desktop app would have written.
    exportPlot: async (_session, options, suggested) => `/Users/demo/Pictures/${suggested.replace(/\.\w+$/, "")}.${options.format}`,
        // A new session is a new generation with no objects, starting in
        // the folder the real backend would choose for its key.
    startSession: async (_home, session) => {
      const old = fakes.get(session);
      if (old) old.running = false;
      let workingDir = "/Users/demo";
      if (session.startsWith("project:")) {
        workingDir = session.slice(8);
        if (!openProjects.has(workingDir)) throw new Error(`${workingDir} is not an open project`);
      } else if (session.startsWith("file:")) {
        check(session.slice(5));
        workingDir = session.slice(5, session.lastIndexOf("/"));
      }
      const r: FakeR = { key: session, generation: (generations += 1), objects: [], currentPlot: "", plotCount: 0, attached: new Set(["base", "stats", "utils", "graphics"]), running: true, interrupted: false, pendingInput: null, chain: Promise.resolve(), workingDir, snap: null, timing: null, lastCode: "" };
      fakes.set(session, r);
      await delay(150);
      return { session, generation: r.generation, version: "4.5.1", workingDir, logPath: "" };
    },
    // A page reload makes a new stand-in, so there is never a session to
    // reconnect to in the browser preview.
    runningSessions: async () => [...fakes.values()].filter((r) => r.running).map((r) => ({ session: r.key, generation: r.generation, version: "4.5.1", workingDir: r.workingDir, logPath: "" })),
    shutdownSession: async (session) => {
      const r = fakes.get(session);
      if (r) r.running = false;
      fakes.delete(session);
    },
        // Runs are chained so each waits for the previous one, and every run
        // reports busy, its output, and done, in the order real R does.
    execute: async (session, code, run) => {
      const r = fake(session);
      if (!r.running) throw new Error("R is not running");
      const quick = code.length < 60 && !/Sys\.sleep|readline|install|quit/.test(code);
      const finished = (r.chain = r.chain.then(async () => {
        r.interrupted = false;
        r.lastCode = code;
        emit(r, { kind: "busy", busy: true });
        await delay(quick ? 0 : 30);
        const ok = await evaluate(r, run, code);
        if (!r.running) return;
        emit(r, { kind: "busy", busy: false });
        emit(r, { kind: "done", run, ok: ok && !r.interrupted, stopped: r.interrupted });
      }));
      // Real R finishes a short statement before the call that sent it has
      // returned. Imitating that keeps the interface honest about matching
      // output to runs whose send has not returned yet.
      if (quick) await finished;
      return run;
    },
    isComplete: async () => "complete",
        // Stop sets a flag that the running pattern checks.
    interrupt: async (session) => {
      fake(session).interrupted = true;
    },
    sendInput: async (session, value) => {
      const r = fake(session);
      r.pendingInput?.(value);
      r.pendingInput = null;
    },
    objects: async (session) => structuredClone(fake(session).objects),
    // Help pages in the shape R's own HTML help takes, for a few topics,
    // with links between them as R writes them.
    help: async (_session, topic, packageName, file) => {
      const name = file || topic;
      if (name === "filter" && !packageName) return { found: true, choices: [{ package: "stats", file: "filter" }, { package: "dplyr", file: "filter" }] };
      const page = MOCK_HELP[name];
      if (!page) return { found: false };
      return { found: true, package: packageName || page.package, file: name, html: helpHtml(name, page) };
    },
    // The preview reads the stand-in penguins for any text file, honoring
    // the header choice, and lists two sheets for a workbook, so the
    // dialog's states can all be seen without R.
    // R's parser, for the one kind of syntax error the stand-in makes: two
    // names side by side on a line.
    parseProblem: async (_session, code) => {
      const lines = code.split("\n");
      for (let index = 0; index < lines.length; index += 1) {
        const pair = /^(\s*[A-Za-z.][\w.]*\s+)([A-Za-z.][\w.]*)/.exec(lines[index]);
        if (pair && !/^\s*(if|for|while|function|else|repeat)\b/.test(lines[index])) return `<text>:${index + 1}:${pair[1].length + 1}: unexpected symbol`;
      }
      return "";
    },
    preview: async (_session, code) => {
      await delay(60);
      if (code.includes("readLines")) {
        const lines = ["species,island,bill_len,flipper_len,body_mass,sex", ...PENGUINS.slice(0, 7).map((row) => Object.values(row).map((value) => value ?? "NA").join(","))];
        return { columns: [{ name: "line", type: "chr" }], rows: lines.map((line) => [line]) };
      }
      if (code.includes("excel_sheets")) return { columns: [{ name: "sheet", type: "chr" }], rows: [["Sheet1"], ["Responses"]] };
      if (!code.includes("penguins")) return { error: "cannot open file: No such file or directory" };
      const keys = ["species", "island", "bill_len", "flipper_len", "body_mass", "sex"] as const;
      const header = !code.includes("header = FALSE");
      const names = header ? [...keys] : keys.map((_, index) => `V${index + 1}`);
      const types = ["chr", "chr", "num", "int", "int", "chr"];
      const rows = PENGUINS.slice(0, 50).map((row) => keys.map((key) => row[key] ?? "NA"));
      return { columns: names.map((name, index) => ({ name, type: types[index] })), rows: header ? rows : [[...keys], ...rows.slice(0, 49)] };
    },
    chooseDataFile: async (_session) => "/Users/demo/Documents/penguins/data/penguins.csv",
    packages: async (session) =>
      ["base", "dplyr", "ggplot2", "graphics", "shiny", "stats", "utils"].map((name) => ({
        name,
        version: name === "ggplot2" ? "3.5.2" : name === "dplyr" ? "1.1.4" : name === "shiny" ? "1.11.1" : "4.5.1",
        title: MOCK_PACKAGE_TITLES[name],
        loaded: fake(session).attached.has(name),
        base: ["base", "graphics", "stats", "utils"].includes(name),
      })),
    // A small imitation of R's completion engine: arguments inside a known
    // call first, then columns after a dollar sign, then functions and the
    // objects in the session.
    complete: async (session, line, cursor) => {
      const objects = fakes.get(session)?.objects ?? [];
      const before = line.slice(0, cursor);
      const word = /[A-Za-z0-9._$@:]*$/.exec(before)?.[0] ?? "";
      const start = cursor - word.length;
      const dollar = /^([A-Za-z.][\w.]*)\$(\w*)$/.exec(word);
      if (dollar) {
        const frame = objects.find((object) => object.name === dollar[1]);
        const columns = (frame?.columns ?? []).filter((column) => column.startsWith(dollar[2]));
        return { start, items: columns.map((column) => ({ name: `${dollar[1]}$${column}`, kind: "variable" })) };
      }
      const call = /([A-Za-z.][\w.]*)\([^()]*$/.exec(before)?.[1];
      const args = (call && MOCK_ARGS[call]) || [];
      const names = [
        ...args.filter((arg) => arg.startsWith(word)).map((arg) => ({ name: `${arg}=`, kind: "argument" })),
        ...MOCK_FUNCTIONS.filter((name) => name.startsWith(word)).map((name) => ({ name, kind: "function" })),
        ...objects.filter((object) => object.name.startsWith(word)).map((object) => ({ name: object.name, kind: object.kind === "data" ? "data" : "variable" })),
      ];
      return { start, items: word || args.length ? names.slice(0, 50) : [] };
    },
    missingPackages: async (_session, names) => names.filter((name) => !installed.has(name)),
    // Undo keeps the objects as they were before each run. Timing a slow
    // run reports the work it did, or that R was mostly waiting.
    step: async (session, summarize, fresh, keep, profile) => {
      const r = fake(session);
      let summary = null;
      if (r.timing !== null) {
        if (summarize) {
          summary = /Sys\.sleep/.test(r.lastCode)
            ? { sampled: 0.02, calls: [] }
            : { sampled: 2.04, calls: [{ name: "slow_fit", seconds: 2.04, share: 1 }, { name: "lm.fit", seconds: 1.62, share: 0.794 }, { name: "model.matrix", seconds: 0.3, share: 0.147 }] };
        }
        r.timing = null;
      }
      if (fresh) r.snap = keep ? structuredClone(r.objects) : null;
      if (profile) r.timing = "on";
      return { profile: summary };
    },
    undo: async (session) => {
      const r = fake(session);
      if (!r.snap) return { ok: false };
      const before = new Map(r.snap.map((object) => [object.name, object]));
      const restored = [...before.values()].filter((object) => JSON.stringify(r.objects.find((now) => now.name === object.name)) !== JSON.stringify(object)).map((object) => object.name);
      const removed = r.objects.filter((object) => !before.has(object.name)).map((object) => object.name);
      r.objects = r.snap;
      r.snap = null;
      return { ok: true, restored, removed };
    },
    // A rough stand-in for styler: spaces around arrows and after commas.
    // A test can say styler is missing with window.goodforNoStyler.
    style: async (_session, code) => {
      if ((window as unknown as { goodforNoStyler?: boolean }).goodforNoStyler && !installed.has("styler")) return { missing: true };
      return { missing: false, text: code.replace(/\s*<-\s*/g, " <- ").replace(/,(?=\S)/g, ", ") };
    },
    // An exercise passes when the student's code matches the answer once
    // spaces are set aside, which is enough to show both outcomes.
    exercise: async (_session, student, answer) => {
      await delay(60);
      const plain = (code: string) => code.replace(/\s+/g, "");
      return plain(student) === plain(answer) ? { ok: true, message: "" } : { ok: false, message: "heavy is not what the exercise asks for yet. It has 344 rows, and the exercise expects 172 rows." };
    },
    // A fixed write-up for any lm() or t.test(), as R's helper gives one.
    // Other statements have none, as in R. The numbers are the penguin
    // model's, so a screen of the example reads true.
    stats: async (_session, code) => {
      await delay(80);
      if (/\blm\(/.test(code)) {
        return {
          found: true,
          title: "Linear model",
          sentence: "F(1, 340) = 1070.74, p < .001, R² = .76, adjusted R² = .76",
          terms: [
            { term: "(Intercept)", sentence: "b = -5780.83, SE = 305.81, t(340) = -18.90, p < .001" },
            { term: "flipper_len", sentence: "b = 49.69, SE = 1.52, t(340) = 32.72, p < .001" },
          ],
          checks: [
            { name: "Normal shape of the residuals", ok: true, detail: "The Shapiro-Wilk test finds no clear departure from a normal shape (p = .126).", advice: "" },
            { name: "Equal spread", ok: false, detail: "The residuals spread more for some fitted values than others (p = .012).", advice: "Standard errors may be off. The sandwich package gives ones that allow for uneven spread." },
          ],
        };
      }
      if (/\bt\.test\(/.test(code)) {
        return { found: true, title: "Welch Two Sample t-test", sentence: "t(55.31) = 1.92, p = .061, 95% CI [-0.17, 7.57], d = 0.49", checks: [{ name: "Extreme values", ok: true, detail: "No value lies far outside the rest.", advice: "" }] };
      }
      return { found: false };
    },
    // A fresh run passes, unless a test names the line that fails with
    // window.goodforFreshFail.
    freshCheck: async (_file, code) => {
      await delay(300);
      const fail = (window as unknown as { goodforFreshFail?: { line: number; message: string } }).goodforFreshFail;
      const statements = code.split("\n").filter((line) => line.trim() && !line.trim().startsWith("#")).length;
      if (fail) return { ok: false, line: fail.line, message: fail.message, ran: Math.max(0, fail.line - 1) };
      return { ok: true, line: null, message: "", ran: statements };
    },
    freshStop: async () => {},
    // One reference to find, by its DOI or by words from its title.
    cite: async (_session, kind, query) => {
      await delay(120);
      if (kind === "doi") {
        return query === MOCK_DOI ? { ok: true, text: MOCK_BIBTEX } : { ok: false, text: "cannot open the connection" };
      }
      const items = /meteor/i.test(query)
        ? [{ DOI: MOCK_DOI, title: ["The Meteoritical Bulletin"], author: [{ family: "Gattacceca" }, { family: "McCubbin" }], issued: { "date-parts": [[2022]] }, "container-title": ["Meteoritics & Planetary Science"] }]
        : [];
      return { ok: true, text: JSON.stringify({ message: { items } }) };
    },
    bibAdd: async (_document, entry) => {
      bibFile = bibFile.includes(entry) ? bibFile : `${bibFile}${entry}\n`;
      return /\{([^,]+),/.exec(entry)?.[1] ?? "ref";
    },
    brief: async (_session, name) => {
      const page = MOCK_HELP[name];
      if (page) return { found: true, package: page.package, title: page.title, usage: page.usage };
      if (MOCK_FUNCTIONS.includes(name)) return { found: true, package: "base", title: "", usage: `${name}(...)` };
      return { found: false };
    },
    // A sample written the way dput() writes it, for the objects the mock
    // knows, so the question dialog can be tested without R.
    reprex: async (session, names) => {
      const known = fake(session).objects.map((object) => object.name);
      const data = Object.fromEntries(names.filter((name) => known.includes(name)).map((name) => [name, `structure(list(species = c("Adelie", "Gentoo"), body_mass_g = c(3750L, 5000L)), row.names = 1:2, class = "data.frame")`]));
      return { data, r: "R version 4.4.1 (2024-06-14)", platform: "macOS Sonoma 14.5", packages: ["dplyr 1.1.4"] };
    },
    setPlotSize: async () => {},
    setPalette: async () => {},
    setPlotStyle: async () => {},
    // Only the example data frame can be viewed, and only once R has it.
    dataMeta: async (session, name) => {
      if (!["penguins", "mass_by_species"].includes(name) || !fake(session).objects.some((object) => object.name === name)) throw new Error(`object '${name}' not found`);
      await delay(60);
      return name === "penguins" ? penguinsMeta() : MASS_META;
    },
    dataRows: async (_session, name, offset, count, sortBy, descending) => {
      await delay(40);
      if (name === "mass_by_species") {
        const rows = MASS_ROWS.map((values, index) => ({ n: index + 1, values, na: [false, false] }));
        if (sortBy === "body_mass") rows.sort((a, b) => (Number(a.values[1]) - Number(b.values[1])) * (descending ? -1 : 1));
        return rows.slice(offset, offset + count);
      }
      return penguinsRows(offset, count, sortBy, descending);
    },
    setWorkingDir: async (session, file) => {
      check(file);
      const r = fake(session);
      r.workingDir = file.slice(0, file.lastIndexOf("/"));
      return r.workingDir;
    },
    confirm: async (message) => window.confirm(message),
    openUrl: async (url) => {
      window.open(url, "_blank", "noopener");
    },
    setTitle: async (title) => {
      document.title = title;
    },
    onREvent: async (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onMenu: async (listener) => {
      menuListeners.add(listener);
      return () => menuListeners.delete(listener);
    },
    // Drops and Finder opens only happen in the desktop app.
    onOpenFiles: async () => () => {},
    onDropHover: async () => () => {},
    onDropSkipped: async () => () => {},
    // The assistant. A test can say an Ollama is already installed with
    // window.goodforOllama = "system" before the page loads its setup.
    assistantStatus: async () => {
      const systemInstalled = (window as unknown as { goodforOllama?: string }).goodforOllama === "system";
      return {
        found: { systemPath: systemInstalled ? "/Applications/Ollama.app/Contents/Resources/ollama" : null, systemRunning: false, systemVersion: "", privateInstalled: ollama.privateInstalled, privateSupported: true, privateVersion: "0.40.3" },
        connected: ollama.connected,
        version: ollama.connected ? "0.40.3" : "",
        installed: ollama.connected ? ollama.models.map((id) => ({ id, sizeGb: MOCK_MODELS.find((model) => model.id === id)?.sizeGb ?? 2, parameters: "" })) : [],
      };
    },
    assistantConnect: async (route) => {
      await delay(120);
      const systemInstalled = (window as unknown as { goodforOllama?: string }).goodforOllama === "system";
      if (route === "system" && !systemInstalled) throw new Error("Ollama is not installed on this computer. Install it from ollama.com, or choose the private copy.");
      if (route === "private" && !ollama.privateInstalled) throw new Error("The private copy of Ollama is not installed yet.");
      ollama.connected = route;
      return "0.40.3";
    },
    // A common Mac, so the suggestion lands on a mid sized model and both a
    // good fit and a model too large for it show up in the list.
    assistantSpecs: async () => ({ memoryGb: 16, freeDiskGb: 120, chip: "Apple M2", appleSilicon: true }),
    assistantCatalog: async (specs) => mockCatalog(specs),
    // The private copy downloads in a few quick steps, with the same progress
    // events and the same refusal of a second download as the real one.
    assistantInstallRuntime: async () => {
      if (ollama.busy) throw new Error("Another download is still running. Wait for it to finish, or cancel it first.");
      ollama.busy = true;
      ollama.cancel = false;
      const total = 167455486;
      for (let step = 1; step <= 5; step += 1) {
        await delay(80);
        if (ollama.cancel) {
          ollama.busy = false;
          setupEmit({ target: "runtime", stage: "Failed", completed: 0, total: 0, done: true, error: "The download was canceled." });
          throw new Error("The download was canceled.");
        }
        setupEmit({ target: "runtime", stage: "Downloading Ollama", completed: (total * step) / 5, total, done: false, error: "" });
      }
      setupEmit({ target: "runtime", stage: "Unpacking", completed: 0, total: 0, done: false, error: "" });
      await delay(80);
      ollama.privateInstalled = true;
      ollama.busy = false;
      setupEmit({ target: "runtime", stage: "Installed", completed: 1, total: 1, done: true, error: "" });
    },
    // A model download, refused until Ollama is connected, as for real.
    assistantPull: async (model) => {
      if (!ollama.connected) throw new Error("The assistant is not connected to Ollama yet.");
      if (ollama.busy) throw new Error("Another download is still running. Wait for it to finish, or cancel it first.");
      ollama.busy = true;
      ollama.cancel = false;
      const total = (MOCK_MODELS.find((item) => item.id === model)?.sizeGb ?? 2) * 1e9;
      for (let step = 1; step <= 6; step += 1) {
        await delay(70);
        if (ollama.cancel) {
          ollama.busy = false;
          setupEmit({ target: model, stage: "Failed", completed: 0, total: 0, done: true, error: "The download was canceled." });
          throw new Error("The download was canceled.");
        }
        setupEmit({ target: model, stage: "Downloading", completed: (total * step) / 6, total, done: false, error: "" });
      }
      if (!ollama.models.includes(model)) ollama.models.push(model);
      ollama.busy = false;
      setupEmit({ target: model, stage: "Installed", completed: 0, total: 0, done: true, error: "" });
    },
    assistantCancelSetup: async () => {
      ollama.cancel = true;
    },
    // Removing a model only forgets it, as Ollama's own delete does.
    assistantDelete: async (model) => {
      ollama.models = ollama.models.filter((id) => id !== model);
    },
    // Removing the private copy takes its models with it.
    assistantRemoveRuntime: async () => {
      ollama.privateInstalled = false;
      if (ollama.connected === "private") {
        ollama.connected = "";
        ollama.models = [];
      }
    },
    assistantAsk: async (id, _model, task) => {
      if (!ollama.connected) throw new Error("The assistant is not connected to Ollama yet.");
      ollama.stop = false;
      const answer = mockAnswer(task);
      // The answer streams a few words at a time, as a real model's does.
      const pieces = answer.match(/\S+\s*|\s+/g) ?? [];
      for (const piece of pieces) {
        if (ollama.stop) break;
        await delay(8);
        answerEmit({ id, text: piece, done: false, error: "" });
      }
      answerEmit({ id, text: "", done: true, error: "" });
    },
    assistantStop: async () => {
      ollama.stop = true;
    },
    onAssistantSetup: async (listener) => {
      setupListeners.add(listener);
      return () => setupListeners.delete(listener);
    },
    onAssistantAnswer: async (listener) => {
      answerListeners.add(listener);
      return () => answerListeners.delete(listener);
    },
    renderStart: async (id, file, target) => {
      check(file);
      return mockRender(id, file, FILES[file] ?? "", target, settings.pdfEngine);
    },
    renderStop: async () => {
      rendering.stop = true;
    },
    renderOpen: async (path) => {
      if (!rendering.made.has(path)) throw new Error("Only a report this app rendered can be opened from here.");
      rendering.opened.push(path);
    },
    previewUrl: (path) => `data:text/html;charset=utf-8,${encodeURIComponent(rendering.made.get(path) ?? "")}`,
    onRender: async (listener) => {
      renderListeners.add(listener);
      return () => renderListeners.delete(listener);
    },
    // LaTeX: none on this pretend computer unless a test sets
    // window.goodforLatex = "system" before the page loads, and the app's
    // own TinyTeX once installed.
    latexStatus: async () => ({ found: mockLatexFound(), installing: tex.busy }),
    latexInstall: async () => {
      if (tex.busy) throw new Error("LaTeX is already being installed.");
      tex.busy = true;
      tex.cancel = false;
      try {
        const steps = ["trying URL 'https://github.com/rstudio/tinytex-releases/releases/download/v2025.10/TinyTeX-1.tar.gz'", "downloaded 112 MB", "Unpacking TinyTeX", "tlmgr: package repository https://mirror.ctan.org/systems/texlive/tlnet", "TinyTeX installed"];
        for (const text of steps) {
          await delay(120);
          if (tex.cancel) throw new Error("The install was canceled.");
          latexListeners.forEach((listener) => listener(text));
        }
        tex.builtin = true;
      } finally {
        tex.busy = false;
      }
    },
    latexCancel: async () => {
      tex.cancel = true;
    },
    latexRemove: async () => {
      tex.builtin = false;
    },
    onLatex: async (listener) => {
      latexListeners.add(listener);
      return () => latexListeners.delete(listener);
    },
    // Starting resolves at once, as the real command does, and the rest
    // arrives as events.
    appStart: async (id, file) => {
      check(file);
      mockApp(id, file, FILES[file] ?? "");
    },
    appStop: async () => {
      if (apps.running) endApp(apps.running, { kind: "stopped" });
    },
    appOpen: async () => {
      if (!apps.running || !apps.url) throw new Error("No app is running.");
      apps.opened.push(apps.url);
    },
    onApp: async (listener) => {
      appListeners.add(listener);
      return () => appListeners.delete(listener);
    },
    // The example app's folder holds the app and the project's data, so the
    // Share dialog has more than one file to list.
    appBundleFiles: async (file) => {
      check(file);
      return file.endsWith("/app.R") ? { files: ["analysis.R", "app.R", "cleaning.R", "data/penguins.csv", "report.qmd"], more: false } : { files: [file.split("/").pop() ?? file], more: false };
    },
    // An export prints a few lines and makes a folder beside the app's. A
    // test can say shinylive is missing with window.goodforNoShinylive.
    appExport: async (id, file) => {
      check(file);
      const send = (text: string) => exportListeners.forEach((listener) => listener({ id, text }));
      if ((window as unknown as { goodforNoShinylive?: boolean }).goodforNoShinylive) {
        send("@@goodr-no-shinylive@@");
        return { status: "failed", folder: null, failure: { kind: "noShinylive" } };
      }
      for (const text of ["Copying base Shiny app files", "Writing app metadata to app.json", "Downloading WebAssembly R package binaries"]) {
        await delay(60);
        send(text);
      }
      const folder = `${file.slice(0, file.lastIndexOf("/"))}-web`;
      apps.exported.add(folder);
      return { status: "done", folder, failure: null };
    },
    appExportStop: async () => {},
    appPreview: async (id, folder) => {
      if (!apps.exported.has(folder)) throw new Error("Only a web version this app made can be previewed here.");
      if (apps.running) endApp(apps.running, { kind: "stopped" });
      apps.running = id;
      apps.url = `data:text/html;charset=utf-8,${encodeURIComponent("<!doctype html><title>Web version</title><h2>Penguin explorer, in the browser</h2>")}`;
      sendApp({ kind: "ready", id, url: apps.url });
    },
    appReveal: async (folder) => {
      apps.revealed.push(folder);
    },
    onExport: async (listener) => {
      exportListeners.add(listener);
      return () => exportListeners.delete(listener);
    },
  };
}

const exportListeners = new Set<(event: ExportEvent) => void>();

// The stand-in Shiny runner's state. `opened` lets tests see what Open in
// browser handed to the system.
const apps = { running: "", url: "", opened: [] as string[], exported: new Set<string>(), revealed: [] as string[] };
const appListeners = new Set<(event: AppEvent) => void>();
(globalThis as unknown as { goodforApps: typeof apps }).goodforApps = apps;

/** Hands an event to every listener, as Tauri's event system would. */
function sendApp(event: AppEvent) {
  appListeners.forEach((listener) => listener(event));
}

/** Ends the app with `id`, forgetting its address if it is the one running. */
function endApp(id: string, failure: Extract<AppEvent, { kind: "ended" }>["failure"]) {
  if (apps.running === id) {
    apps.running = "";
    apps.url = "";
  }
  sendApp({ kind: "ended", id, failure });
}

/**
 * Imitates running a Shiny app. An app whose brackets do not close fails
 * to parse, one with no server fails as R would, and a stop() inside a
 * render function is reported as an error inside the running app, which
 * keeps running. The page shown is a small one made from titlePanel().
 */
function mockApp(id: string, file: string, text: string) {
  if (apps.running) endApp(apps.running, { kind: "stopped" });
  apps.running = id;
  setTimeout(() => {
    if (apps.running !== id) return;
    sendApp({ kind: "line", id, text: "Loading required package: shiny" });
    const lines = text.split("\n");
    const opened = (text.match(/\(/g) ?? []).length;
    const closed = (text.match(/\)/g) ?? []).length;
    if (opened !== closed) {
      endApp(id, { kind: "parse", file, line: lines.length + 1, column: 0, message: "unexpected end of input" });
      return;
    }
    if (!/^server\s*<-/m.test(text)) {
      endApp(id, { kind: "ended", message: "object 'server' not found" });
      return;
    }
    const port = 5123;
    sendApp({ kind: "line", id, text: `Listening on http://127.0.0.1:${port}` });
    const title = /titlePanel\("([^"]*)"\)/.exec(text)?.[1] ?? "Shiny app";
    apps.url = `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html><head><title>${title}</title></head><body style="font:16px system-ui;margin:1rem"><h2>${title}</h2><p>A stand-in for the running app.</p></body></html>`)}`;
    sendApp({ kind: "ready", id, url: apps.url });
    const failing = /stop\("([^"]*)"\)/.exec(text);
    if (failing) {
      // As Shiny does, the error is followed by its stack trace, innermost
      // first, with the app's own calls marked by file and line.
      const lines = text.split("\n");
      const at = lines.findIndex((line) => line.includes(failing[0])) + 1;
      const output = [...lines.slice(0, at)].reverse().map((line) => /output\$(\w+)\s*<-\s*(render\w+)/.exec(line)).find(Boolean);
      const trace = ["  171: stop", `  170: ${output?.[2] ?? "renderPlot"} [${file}#${at}]`, "  128: drawPlot", `   83: output$${output?.[1] ?? "plot"}`, "    1: shiny::runApp"];
      setTimeout(() => {
        if (apps.running !== id) return;
        sendApp({ kind: "problem", id, message: failing[1] });
        for (const line of trace) sendApp({ kind: "line", id, text: line });
      }, 150);
    }
  }, 300);
}

// The stand-in renderer's state. `made` maps each file it pretends to have
// written to the page the preview shows for it. `opened` lets tests see
// what Open handed to the system.
const rendering = { busy: false, stop: false, made: new Map<string, string>(), opened: [] as string[] };
const renderListeners = new Set<(event: RenderEvent) => void>();
(globalThis as unknown as { goodforRendering: typeof rendering }).goodforRendering = rendering;

/**
 * Imitates a render: progress through each chunk, then a page made from
 * the document's title and headings. A chunk using `nosuchthing` fails as
 * knitr would report it, and a chunk with Sys.sleep runs slowly enough to
 * be stopped.
 */
// The stand-in LaTeX: one the user installed, when a test says so, and
// the app's own once installed.
const tex = { builtin: false, busy: false, cancel: false };
const latexListeners = new Set<(text: string) => void>();
const BUILTIN_TEX = "/Users/demo/Library/Application Support/app.goodfor.ide/TinyTeX/bin/universal-darwin";
function mockLatexFound() {
  const found = [];
  if (tex.builtin) found.push({ dir: BUILTIN_TEX, name: "TinyTeX, from TeX Live 2025", builtin: true });
  if ((window as unknown as { goodforLatex?: string }).goodforLatex === "system") found.push({ dir: "/Library/TeX/texbin", name: "TeX Live 2025", builtin: false });
  return found;
}

async function mockRender(id: string, file: string, text: string, target: RenderTarget, pdfEngine = "auto"): Promise<RenderResult> {
  // A PDF made with LaTeX, asked for by the header or by the choice in
  // Settings, fails as the real one does when there is no LaTeX.
  const haveLatex = mockLatexFound().length > 0;
  const wantsLatex = (target === "pdf" && (pdfEngine === "latex" || (pdfEngine === "auto" && haveLatex))) || (target === "asWritten" && /^output:\s*pdf_document/m.test(text));
  if (wantsLatex && !haveLatex) return { status: "failed", outputs: [], failure: { kind: "latex" } };
  if (rendering.busy) throw new Error("A report is already rendering. Stop it first, or wait for it to finish.");
  rendering.busy = true;
  rendering.stop = false;
  const send = (event: RenderEvent) => renderListeners.forEach((listener) => listener(event));
  try {
    const lines = text.split("\n");
    const chunks: { from: number; to: number; label: string; code: string }[] = [];
    lines.forEach((line, index) => {
      const open = /^```\{r\s*([\w-]*)/.exec(line);
      if (!open) return;
      const close = lines.findIndex((other, at) => at > index && other.startsWith("```"));
      const end = close < 0 ? lines.length : close;
      chunks.push({ from: index + 2, to: end + 1, label: open[1] || `unnamed-chunk-${chunks.length + 1}`, code: lines.slice(index + 1, end).join("\n") });
    });
    const total = chunks.length * 2 + 1;
    send({ kind: "line", id, text: `processing file: ${file.split("/").pop()}` });
    for (let step = 1; step <= total; step += 1) {
      const chunk = step % 2 === 0 ? chunks[step / 2 - 1] : undefined;
      send({ kind: "progress", id, done: step, total, label: chunk?.label ?? null });
      const slow = chunk && /Sys\.sleep/.test(chunk.code);
      for (let wait = 0; wait < (slow ? 60 : 1); wait += 1) {
        if (rendering.stop) return { status: "stopped", outputs: [], failure: { kind: "stopped" } };
        await delay(slow ? 100 : 60);
      }
      if (chunk && /nosuchthing/.test(chunk.code)) {
        send({ kind: "line", id, text: `Quitting from lines ${chunk.from}-${chunk.to} [${chunk.label}] (${file.split("/").pop()})` });
        send({ kind: "line", id, text: "Error:\n! object 'nosuchthing' not found" });
        return { status: "failed", outputs: [], failure: { kind: "chunk", from: chunk.from, to: chunk.to, label: chunk.label, message: "object 'nosuchthing' not found" } };
      }
    }
    // The format the header asks for, when rendering as written.
    const header = /^(?:format|output):\s*(\w+)/m.exec(text)?.[1] ?? "html";
    const format = target === "asWritten" ? (/docx|word/.test(header) ? "word" : /pdf/.test(header) ? "pdf" : "html") : target;
    const extension = format === "word" ? "docx" : format === "pdf" ? "pdf" : "html";
    const output = file.replace(/\.\w+$/, `.${extension}`);
    const title = /^title:\s*"?([^"\n]*)"?/m.exec(text)?.[1] ?? "Report";
    // Headings and chunks in document order, each chunk's code shown as
    // Quarto shows it, so the preview reads like a real report.
    const body = lines
      .map((line, index) => {
        if (/^#{1,3} /.test(line)) return `<h2>${line.replace(/^#+ /, "")}</h2>`;
        const chunk = chunks.find((item) => item.from === index + 2);
        return chunk ? `<pre>${chunk.code.replace(/</g, "&lt;")}</pre><pre class="out">  species body_mass\n1  Adelie  3700.662\n2 Chinstrap 3733.088\n3  Gentoo  5076.016</pre>` : "";
      })
      .join("");
    const style = "body{font:16px/1.6 system-ui,sans-serif;color:#212529;margin:1.5rem 1.25rem}h1{font-size:1.9rem;margin:0 0 1rem}h2{font-size:1.3rem;margin:1.4rem 0 .6rem;border-bottom:1px solid #dee2e6;padding-bottom:.3rem}pre{background:#f1f3f5;padding:.6rem .8rem;border-radius:4px;font-size:.8rem;white-space:pre-wrap}pre.out{background:none;padding:0 .8rem}";
    rendering.made.set(output, `<!doctype html><html><head><title>${title}</title><style>${style}</style></head><body><h1>${title}</h1>${body}</body></html>`);
    send({ kind: "line", id, text: `Output created: ${output.split("/").pop()}` });
    return { status: "done", outputs: [output], failure: null };
  } finally {
    rendering.busy = false;
  }
}

// The stand-in assistant's state and event listeners.
const ollama = { privateInstalled: false, connected: "" as "" | "system" | "private", models: [] as string[], busy: false, cancel: false, stop: false };
const setupListeners = new Set<(event: SetupEvent) => void>();
const answerListeners = new Set<(event: AnswerEvent) => void>();
const setupEmit = (event: SetupEvent) => setupListeners.forEach((listener) => listener(event));
const answerEmit = (event: AnswerEvent) => answerListeners.forEach((listener) => listener(event));

// A copy of the catalog in crates/assistant/src/catalog.rs, with the same
// fit rule, so the setup steps can be exercised in a browser.
const MOCK_MODELS = [
  { id: "qwen2.5-coder:3b", name: "Qwen2.5 Coder 3B", kind: "Small code model", sizeGb: 1.9, memoryFloorGb: 8, pros: ["Quick on any Apple silicon Mac", "Trained mostly on code, so it writes R that runs", "Small download"], cons: ["Explanations are brief and can miss the bigger picture", "Less able to reason through why a result looks odd"], thinks: false },
  { id: "qwen2.5-coder:7b", name: "Qwen2.5 Coder 7B", kind: "Code model", sizeGb: 4.7, memoryFloorGb: 16, pros: ["Clearly better code and error fixes than the small model", "Still quick on a Mac with 16 GB of memory"], cons: ["Slow on a Mac with 8 GB of memory", "Explanations lean technical unless asked to keep them plain"], thinks: false },
  { id: "qwen2.5-coder:14b", name: "Qwen2.5 Coder 14B", kind: "Large code model", sizeGb: 9.0, memoryFloorGb: 24, pros: ["The strongest code of the models that fit a 24 to 32 GB Mac", "Handles longer scripts and pipelines"], cons: ["A 9 GB download", "Answers arrive noticeably slower"], thinks: false },
  { id: "qwen3-coder:30b", name: "Qwen3 Coder 30B", kind: "Very large code model", sizeGb: 19.0, memoryFloorGb: 32, pros: ["The best code quality in this list", "Quicker than its size suggests, since only part of it works on each word"], cons: ["A 19 GB download", "Needs 32 GB of memory or more"], thinks: false },
];

// The same thresholds as the Rust fit check, so the browser build marks the
// same models as fitting.
function mockFit(sizeGb: number, specs: MachineSpecs): ModelFit {
  if (specs.freeDiskGb > 0 && specs.freeDiskGb < sizeGb + 2) return "noRoom";
  const need = sizeGb * 1.2 + 1.5;
  const share = specs.memoryGb > 36 ? 0.75 : 0.66;
  if (need <= specs.memoryGb * share) return "good";
  if (need <= specs.memoryGb * 0.85) return "tight";
  return "tooLarge";
}

// The suggestion is the largest code model that fits well, or the small one
// when the Mac was not checked, matching catalog::suggested.
function mockCatalog(specs: MachineSpecs | null): ModelCatalog {
  const models = MOCK_MODELS.map((model) => ({ ...model, fit: specs ? mockFit(model.sizeGb, specs) : null, memoryNeededGb: Math.round((model.sizeGb * 1.2 + 1.5) * 10) / 10 }));
  const fitting = specs ? models.filter((model) => /code/i.test(model.kind) && model.fit === "good").sort((a, b) => b.sizeGb - a.sizeGb) : [];
  return { models, suggested: fitting[0]?.id ?? MOCK_MODELS[0].id };
}

/** A canned answer for each kind of request, shaped like a model's. */
function mockAnswer(task: AssistantTask): string {
  switch (task.kind) {
    case "explainError": {
      const missing = /no package called [‘'"]?([\w.]+)/.exec(task.message);
      if (missing) return `The ${missing[1]} package is not on this computer yet, so R cannot use it. Install it once, then run the line again.\n\n\`\`\`r\ninstall.packages("${missing[1]}")\n\`\`\``;
      return "R looked for a column called flipper_length_mm, but the penguins table names it flipper_len. Using the real name fixes it.\n\n```r\nfit <- lm(body_mass ~ flipper_len, data = penguins)\n```";
    }
    case "writeCode":
      return "This counts how many penguins of each species there are.\n\n```r\n# Count penguins by species\ntable(penguins$species)\n```";
    case "explainCode":
      return "This line fits a straight line through the data. It predicts body mass from flipper length, using the penguins table.";
    case "improve":
      return "Naming the data argument makes the line easier to read.\n\n```r\nfit <- lm(body_mass ~ flipper_len, data = penguins)\n```";
    case "comment":
      return "```r\n# Fit a straight line: body mass by flipper length\nfit <- lm(body_mass ~ flipper_len, data = penguins)\n```";
    default:
      return "Use mean() for the average of a column, such as `mean(penguins$body_mass, na.rm = TRUE)`. The na.rm part skips missing values.";
  }
}
