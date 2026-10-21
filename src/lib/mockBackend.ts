// A stand-in backend for running the interface in a plain browser.
//
// It holds a few example scripts in memory and imitates the R behaviors
// the interface depends on: printed values, streamed text, errors, plots,
// slow runs that can be stopped, readline prompts, missing packages, and a
// crash. It is used by the interface tests and for reviewing screens. It is
// never part of the desktop app, which talks to real R.

import type { Backend } from "./backend";
import type { AnswerEvent, AssistantTask, DataMeta, DataRow, MachineSpecs, ModelCatalog, ModelFit, ProjectInfo, REvent, RenderEvent, RenderResult, RenderTarget, RObject, SetupEvent, Settings } from "./types";

// Where the example scripts appear to live.
const ROOT = "/Users/demo/Documents/penguins";

// The example scripts. They mirror the penguins example on the design
// canvas, so screens can be compared with the designs directly.
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
const MOCK_FUNCTIONS = ["mean", "median", "merge", "message", "summary", "subset", "sum", "lm", "library", "length", "read.csv", "plot", "print", "head", "aggregate", "confint"];
const MOCK_ARGS: Record<string, string[]> = { mean: ["x", "trim", "na.rm"], lm: ["formula", "data", "subset", "weights"], "read.csv": ["file", "header", "sep", "na.strings"], head: ["x", "n"] };

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
    consoleHeight: 260,
    consoleInputHeight: 96,
    inspectorWidth: 360,
    paneSplit: 45,
    appearance: "light",
    palette: "standard",
    textSize: 100,
    reduceMotion: false,
    layer: "essentials",
    outputLayout: "inline",
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
  };
    // Listeners for R events and menu clicks, as the real backend has.
  const listeners = new Set<(generation: number, event: REvent) => void>();
  const menuListeners = new Set<(id: string) => void>();
    // gt is deliberately missing, to exercise the package banner.
  const installed = new Set(["ggplot2", "dplyr", "shiny"]);
  let objects: RObject[] = [];
  // The plot on screen, which lines such as abline add to, and how many
  // plots there have been.
  let currentPlot = "";
  let plotCount = 0;
  let generation = 0;
  // Packages on the search path, as .packages() reports them.
  const attached = new Set(["base", "stats", "utils", "graphics"]);
  let running = true;
  let interrupted = false;
  let pendingInput: ((value: string) => void) | null = null;
  // Runs execute one at a time, as in R.
    // Each run waits for the one before it, as R does.
  let chain: Promise<void> = Promise.resolve();

    // Sends an event tagged with the current session.
  const emit = (event: REvent) => listeners.forEach((listener) => listener(generation, event));

    /** Adds or replaces an object, keeping the list sorted by name. */
  function setObject(object: RObject) {
    objects = [...objects.filter((existing) => existing.name !== object.name), object].sort((a, b) => a.name.localeCompare(b.name));
  }

    /**
     * The pretend R. Each pattern below imitates one behavior the interface
     * must handle. Returns false when the run failed.
     */
  async function evaluate(run: string, code: string): Promise<boolean> {
    const trimmed = code.trim();
    // quit ends the session, standing in for a crash.
    if (/quit\(/.test(trimmed)) {
      running = false;
      emit({ kind: "exited", code: 0, log: "R quit when asked to." });
      return false;
    }
        // Sys.sleep stands in for slow work and can be interrupted.
    const sleep = /Sys\.sleep\((\d+(?:\.\d+)?)\)/.exec(trimmed);
    if (sleep) {
      const until = Date.now() + Number(sleep[1]) * 1000;
      while (Date.now() < until && !interrupted) await delay(50);
      if (interrupted) return true;
    }
    const error = (message: string) => {
      emit({ kind: "error", run, message: `Error:\n${message}`, traceback: [] });
      return false;
    };
        // stop() produces an error, as in R.
    const stop = /stop\(["'](.+?)["']\)/.exec(trimmed);
    if (stop) return error(stop[1]);
        // Using a package that is not installed fails the way R does.
    for (const match of trimmed.matchAll(/library\((\w+)\)|(\w+)::/g)) {
      const name = match[1] ?? match[2];
      if (!installed.has(name)) return error(`there is no package called ‘${name}’`);
      if (match[1]) attached.add(name);
    }
    // Detaching takes a package off the search path, as in R.
    const detached = /detach\("package:(\w+)"/.exec(trimmed);
    if (detached) attached.delete(detached[1]);
        // The misspelled column from the design canvas error example.
    if (trimmed.includes("flipper_length_mm")) return error("object 'flipper_length_mm' not found");
        // Installs stream progress to stderr, as install.packages does.
    const install = /install\.packages\((.+)\)/.exec(trimmed);
    if (install) {
      for (const name of install[1].match(/[A-Za-z][A-Za-z0-9.]*/g) ?? []) {
        if (name === "c") continue;
        emit({ kind: "stream", run, name: "stderr", text: `Installing package into the user library\ntrying URL for ${name}\n` });
        await delay(300);
        installed.add(name);
        emit({ kind: "stream", run, name: "stderr", text: `* DONE (${name})\n` });
      }
      return true;
    }
        // readline waits for an answer from the console.
    const prompt = /readline\(["'](.*?)["']\)/.exec(trimmed);
    if (prompt) {
      emit({ kind: "input_request", run, prompt: prompt[1], password: false });
      const answer = await new Promise<string>((resolve) => (pendingInput = resolve));
      if (trimmed.includes("cat(")) emit({ kind: "stream", run, name: "stdout", text: `hi ${answer}\n` });
      return true;
    }
    if (trimmed.includes("data(penguins)")) {
      setObject({ name: "penguins", kind: "data", class: "data.frame", summary: "data frame, 344 rows, 8 columns", columns: ["species", "island", "bill_len", "bill_dep", "flipper_len", "body_mass", "sex", "year"] });
    }
        // Two names side by side do not parse, and ark says so without
        // a position, as it does for real.
    if (/^[A-Za-z.][\w.]*\s+[A-Za-z.][\w.]*$/.test(trimmed) && !/^(if|for|while|function|else|repeat)\b/.test(trimmed)) return error("Syntax error: unexpected symbol");
        // Assignments create objects of a plausible kind and print nothing.
    const assign = /^([A-Za-z.][\w.]*)\s*<-/.exec(trimmed);
    if (assign) {
      const name = assign[1];
      if (/lm\(/.test(trimmed)) setObject({ name, kind: "model", class: "lm", summary: "linear model, R squared 0.76", columns: [] });
      else if (/aggregate|data\.frame|na\.omit/.test(trimmed)) setObject({ name, kind: "data", class: "data.frame", summary: "data frame, 3 rows, 2 columns", columns: ["species", "body_mass"] });
      else setObject({ name, kind: "value", class: "numeric", summary: "numeric, 1 value", columns: [] });
      return true;
    }
        // Plotting functions return a picture.
    if (/\b(ggplot|plot|hist|barplot)\(/.test(trimmed)) {
      currentPlot = `plot-${(plotCount += 1)}`;
      emit({ kind: "output", run, text: null, html: null, png: fakePlot(), svg: null, displayId: currentPlot, update: false });
      return true;
    }
    // Lines that add to the plot on screen arrive as updates to it, as they
    // do from ark. With no plot on screen, R says so, as it does for real.
    if (/^(abline|lines|points|text|legend|title|curve|segments|arrows|rect|polygon|grid|mtext|axis|box)\(/.test(trimmed)) {
      if (!currentPlot) return error("plot.new has not been called yet");
      emit({ kind: "output", run, text: null, html: null, png: fakePlot(true), svg: null, displayId: currentPlot, update: true });
      return true;
    }
    // confint prints the interval table from the design canvas.
    if (/^confint\(/.test(trimmed)) {
      emit({ kind: "output", run, text: TABLES.confint, html: null, png: null, svg: null });
      return true;
    }
    // cat prints text to stdout without a value.
    const cat = /^cat\(["'](.*)["']\)$/.exec(trimmed);
    if (cat) {
      emit({ kind: "stream", run, name: "stdout", text: cat[1].replace(/\\n/g, "\n") });
      return true;
    }
    // Plain arithmetic is computed, so live output can be checked.
    if (/^[\d\s+\-*/().]+$/.test(trimmed)) {
      const value = Function(`"use strict"; return (${trimmed});`)() as number;
      emit({ kind: "output", run, text: `[1] ${value}`, html: null, png: null, svg: null });
      return true;
    }
    // A bare name prints its value, or fails when it does not exist.
    const bare = /^(?:head\()?([A-Za-z.][\w.]*)\)?$/.exec(trimmed);
    if (bare) {
      const name = bare[1];
      if (TABLES[name] && objects.some((object) => object.name === name)) {
        emit({ kind: "output", run, text: TABLES[name], html: null, png: null, svg: null });
        return true;
      }
      if (!objects.some((object) => object.name === name)) return error(`object '${name}' not found`);
      emit({ kind: "output", run, text: "[1] 1", html: null, png: null, svg: null });
    }
    return true;
  }

  // Files the person chose in this session, as the Rust side tracks them.
  const granted = new Set<string>();
  const grant = (path: string) => {
    granted.add(path);
    settings.recentFiles = [{ path, openedAt: Math.floor(Date.now() / 1000) }, ...settings.recentFiles.filter((recent) => recent.path !== path)].slice(0, 12);
    return path;
  };
  const check = (path: string) => {
    const inProject = projectOpen && path.startsWith(`${projectRoot}/`) && /\.(R|r|Rmd|qmd)$/.test(path);
    if (!granted.has(path) && !inProject) throw new Error(`${path} was not opened in this app. Open it with File, Open first.`);
  };
  let workingDir = "/Users/demo";
  // The project the stand-in has open, and the folder last chosen for a
  // new one, mirroring the Rust side's rule that a project can be created
  // only where the person chose.
  let projectOpen = false;
  let projectRoot = ROOT;
  let chosenFolder = "";
  const openProject = () => {
    projectOpen = true;
    projectRoot = ROOT;
    settings.sessionProject = PROJECT_FILE;
    settings.recentProjects = [{ path: PROJECT_FILE, openedAt: Math.floor(Date.now() / 1000) }];
    return project();
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
    refreshProject: async () => (projectOpen ? project() : null),
    closeProject: async () => {
      projectOpen = false;
      settings.sessionProject = "";
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
    createProject: async (parent, name, template) => {
      if (parent !== chosenFolder) throw new Error("Choose where the project goes first.");
      const root = `${parent}/${name}`;
      const main = template === "report" ? "report.qmd" : template === "shiny" ? "app.R" : "analysis.R";
      FILES[`${root}/${main}`] = template === "shiny" ? "library(shiny)\n" : "head(mtcars)\n";
      projectOpen = true;
      projectRoot = root;
      return { name, root, file: `${root}/${name}.Rproj`, scripts: [main], data: [] };
    },
    readText: async (path) => {
      check(path);
      return FILES[path];
    },
    writeText: async (path, contents) => {
      check(path);
      FILES[path] = contents;
    },
    savePlot: async (_data, suggested) => `/Users/demo/Pictures/${suggested}`,
    // The browser preview has no R to draw with, so it reports the file
    // that the desktop app would have written.
    exportPlot: async (options, suggested) => `/Users/demo/Pictures/${suggested.replace(/\.\w+$/, "")}.${options.format}`,
        // A new session is a new generation with no objects.
    startSession: async (_home, file) => {
      generation += 1;
      running = true;
      objects = [];
      workingDir = projectOpen ? projectRoot : file ? file.slice(0, file.lastIndexOf("/")) : "/Users/demo";
      await delay(150);
      return { generation, version: "4.5.1", workingDir, logPath: "" };
    },
    // A page reload makes a new stand-in, so there is never a session to
    // reconnect to in the browser preview.
    currentSession: async () => (generation > 0 && running ? { generation, version: "4.5.1", workingDir, logPath: "" } : null),
    shutdownSession: async () => {
      running = false;
    },
        // Runs are chained so each waits for the previous one, and every run
        // reports busy, its output, and done, in the order real R does.
    execute: async (code, run) => {
      if (!running) throw new Error("R is not running");
      const quick = code.length < 60 && !/Sys\.sleep|readline|install|quit/.test(code);
      const finished = (chain = chain.then(async () => {
        interrupted = false;
        emit({ kind: "busy", busy: true });
        await delay(quick ? 0 : 30);
        const ok = await evaluate(run, code);
        if (!running) return;
        emit({ kind: "busy", busy: false });
        emit({ kind: "done", run, ok: ok && !interrupted, stopped: interrupted });
      }));
      // Real R finishes a short statement before the call that sent it has
      // returned. Imitating that keeps the interface honest about matching
      // output to runs whose send has not returned yet.
      if (quick) await finished;
      return run;
    },
    isComplete: async () => "complete",
        // Stop sets a flag that the running pattern checks.
    interrupt: async () => {
      interrupted = true;
    },
    sendInput: async (value) => {
      pendingInput?.(value);
      pendingInput = null;
    },
    objects: async () => structuredClone(objects),
    // Help pages in the shape R's own HTML help takes, for a few topics,
    // with links between them as R writes them.
    help: async (topic, packageName, file) => {
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
    parseProblem: async (code) => {
      const lines = code.split("\n");
      for (let index = 0; index < lines.length; index += 1) {
        const pair = /^(\s*[A-Za-z.][\w.]*\s+)([A-Za-z.][\w.]*)/.exec(lines[index]);
        if (pair && !/^\s*(if|for|while|function|else|repeat)\b/.test(lines[index])) return `<text>:${index + 1}:${pair[1].length + 1}: unexpected symbol`;
      }
      return "";
    },
    preview: async (code) => {
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
    chooseDataFile: async () => "/Users/demo/Documents/penguins/data/penguins.csv",
    packages: async () =>
      ["base", "dplyr", "ggplot2", "graphics", "shiny", "stats", "utils"].map((name) => ({
        name,
        version: name === "ggplot2" ? "3.5.2" : name === "dplyr" ? "1.1.4" : name === "shiny" ? "1.11.1" : "4.5.1",
        title: MOCK_PACKAGE_TITLES[name],
        loaded: attached.has(name),
        base: ["base", "graphics", "stats", "utils"].includes(name),
      })),
    // A small imitation of R's completion engine: arguments inside a known
    // call first, then columns after a dollar sign, then functions and the
    // objects in the session.
    complete: async (line, cursor) => {
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
    missingPackages: async (names) => names.filter((name) => !installed.has(name)),
    setPlotSize: async () => {},
    setPalette: async () => {},
    // Only the example data frame can be viewed, and only once R has it.
    dataMeta: async (name) => {
      if (name !== "penguins" || !objects.some((object) => object.name === name)) throw new Error(`object '${name}' not found`);
      await delay(60);
      return penguinsMeta();
    },
    dataRows: async (_name, offset, count, sortBy, descending) => {
      await delay(40);
      return penguinsRows(offset, count, sortBy, descending);
    },
    setWorkingDir: async (file) => {
      check(file);
      workingDir = file.slice(0, file.lastIndexOf("/"));
      return workingDir;
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
      return mockRender(id, file, FILES[file] ?? "", target);
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
  };
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
async function mockRender(id: string, file: string, text: string, target: RenderTarget): Promise<RenderResult> {
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
  { id: "gemma3:4b", name: "Gemma 3 4B", kind: "General model", sizeGb: 3.3, memoryFloorGb: 8, pros: ["Explains output and statistics in clear, everyday words", "Fits a Mac with 8 GB of memory"], cons: ["Writes less reliable R than the code models, especially longer code"], thinks: false },
  { id: "qwen3:8b", name: "Qwen3 8B", kind: "General model", sizeGb: 5.2, memoryFloorGb: 16, pros: ["Good at walking through why an error happened", "Balances explanation and code well"], cons: ["Larger download than the code models of similar skill", "Can be wordy, though the app asks for short answers"], thinks: true },
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
