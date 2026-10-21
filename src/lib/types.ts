// Shapes shared between the interface and the Rust side. Field names match
// the JSON the Rust commands send, which uses camelCase.

export type RInstall = { version: string; home: string; source: string };

/** A file opened before. The list is kept by the Rust side, which is the
 * only code allowed to add to it. */
export type RecentFile = { path: string; openedAt: number };

export type Appearance = "system" | "light" | "dark" | "paper";
export type PaletteName = "standard" | "deuteranopia" | "protanopia" | "tritanopia" | "monochrome";
export type Layer = "essentials" | "everything";
/** Where results of script runs appear: in the canvas beside the script,
 * or under each line of the script itself. */
export type OutputLayout = "canvas" | "inline";
/** How results under the code look: as cards, or as plain text. */
export type ResultStyle = "cards" | "plain";
export type CodeFont =
  | "dm-mono"
  | "jetbrains-mono"
  | "ibm-plex-mono"
  | "fira-code"
  | "source-code-pro"
  | "cascadia-code"
  | "victor-mono"
  | "monaspace-neon"
  | "commit-mono"
  | "geist-mono"
  | "iosevka"
  | "atkinson-hyperlegible-mono"
  | "intel-one-mono"
  | "fira-code-iscript"
  | "jetbrains-mono-radon"
  | "system";
export type LineSpacing = "compact" | "normal" | "relaxed";
/** What the Run button runs: the line or selection, the chunk or section
 * the cursor is in, or the whole file. */
export type RunScope = "line" | "chunk" | "file";

export type Settings = {
  rHome: string;
  recentFiles: RecentFile[];
  sessionFiles: string[];
  sessionActive: string;
  recentProjects: RecentFile[];
  sessionProject: string;
  consoleHeight: number;
  consoleInputHeight: number;
  /** Height of the strip of earlier results under the stage, in pixels. */
  timelineHeight: number;
  /** Which parts of the window are on show. Each can be hidden and shown
   * again, and Reset layout shows them all. */
  showSidebar: boolean;
  showCanvas: boolean;
  showPrompt: boolean;
  showTimeline: boolean;
  inspectorWidth: number;
  paneSplit: number;
  appearance: Appearance;
  palette: PaletteName;
  textSize: number;
  reduceMotion: boolean;
  layer: Layer;
  outputLayout: OutputLayout;
  /** Set once the user chooses where results go. Until then they go to
   * the canvas, whatever layout the settings file holds. */
  layoutChosen: boolean;
  /** Set once the tour has been seen, so it opens by itself only once. */
  tourSeen: boolean;
  missingPackages: "ask" | "auto";
  /** The typeface, size in pixels, and spacing of code everywhere it shows. */
  codeFont: CodeFont;
  codeSize: number;
  lineSpacing: LineSpacing;
  ligatures: boolean;
  /** How the script editor behaves. */
  lineNumbers: boolean;
  highlightLine: boolean;
  wrapLines: boolean;
  tabWidth: number;
  closeBrackets: boolean;
  rainbowBrackets: boolean;
  /** How results look, and whether copying across them includes them. */
  resultStyle: ResultStyle;
  copyResults: boolean;
  /** Which Ollama the assistant uses, or empty before it is set up. */
  assistantRoute: "" | "system" | "private";
  assistantModel: string;
  /** What the Run button does for a file, by path, when the user chose
   * a default for it. */
  runDefaults: Record<string, RunScope>;
  /** Whether R keeps the objects as they were before each run, so the
   * last run can be undone. */
  undoRuns: boolean;
  /** Whether package installs and updates show R's own log rather than
   * progress by package. */
  showPackageLog: boolean;
  /** Whether updates are looked for by themselves, once a day at most, or
   * only when asked. */
  updateChecks: "auto" | "manual";
  /** When updates were last looked for, in milliseconds since 1970. */
  lastUpdateCheck: number;
  /** Whether edited files save by themselves after typing stops. */
  autosave: boolean;
  /** Whether a report rendered once renders again each time it is saved. */
  renderOnSave: boolean;
  /** How Render as PDF makes a PDF: with LaTeX when there is one, which
   * is "auto", or always with Typst, or always with LaTeX. */
  pdfEngine: PdfEngine;
  /** The folder of the LaTeX to use, or empty for the first one found. */
  latexDir: string;
  /** Whether the editor points out habits that cause trouble later, such
   * as T for TRUE, with a dotted line and a suggestion. */
  hints: boolean;
  /** Whether Return tidies the line it finishes: spaces around operators
   * and after commas, as the tidyverse style guide lays code out. */
  formatOnType: boolean;
  /** Whether comments are written in a flowing script italic, beside
   * whichever typeface the code uses. */
  scriptItalics: boolean;
  /** Whether results are kept on this computer and shown again, marked
   * as from last time, when the app opens. */
  keepResults: boolean;
  /** Whether new plots take the app's colors and type, so they match the
   * canvas. Plots saved to files are unchanged either way. */
  plotStyle: boolean;
  /** Tighter spacing around panes, for small screens. Targets stay large
   * enough to hit. */
  compact: boolean;
  /** Whether a document's text is kept to a comfortable line length. */
  readingWidth: boolean;
};

export type PdfEngine = "auto" | "typst" | "latex";

/** A LaTeX on this computer: the folder of its programs, its name, such as
 * TeX Live 2025, and whether it is the app's own TinyTeX. */
export type LatexInfo = { dir: string; name: string; builtin: boolean };
export type LatexStatus = { found: LatexInfo[]; installing: boolean };

export type AppInfo = { name: string; version: string; arkVersion: string; platform: string; git: boolean };

/** An open project: its folder, its project file, and what it holds, by
 * path relative to the folder. Data files are listed by name only. */
export type ProjectInfo = { name: string; root: string; file: string; scripts: string[]; data: string[] };

/** The starting points the New Project dialog offers. "existing" adds a
 * project file to a folder the user already has. */
export type ProjectTemplate = "analysis" | "report" | "shiny" | "existing";

/** One column as the data viewer describes it. */
export type DataColumn = {
  name: string;
  type: string;
  missing: number;
  summary: string;
  bars: number[];
  stats: { mean?: number | null; median?: number | null; sd?: number | null; min?: number | null; max?: number | null };
  top: { value: string; count: number }[];
};
/** A data frame's size and columns, read once when the viewer opens and
 * again whenever the object changes in R. */
export type DataMeta = { name: string; rows: number; columns: DataColumn[] };
/** One row as text. `n` is its row number in the data frame as R holds
 * it, which stays the same whatever order the viewer shows. `na` marks
 * missing values, so the viewer can label them rather than print NA. */
export type DataRow = { n: number; values: string[]; na: boolean[] };

/** A help page, or the packages to choose from when a topic is in more
 * than one. */
export type HelpPage = { found: boolean; package?: string; file?: string; html?: string; choices?: { package: string; file: string }[] };

/** An installed package, as the Packages pane lists it. */
export type PackageInfo = { name: string; version: string; title: string; loaded: boolean; base: boolean };

/** The first rows of a data file as R read them, or why it could not. */
export type DataPreview = { columns?: { name: string; type: string }[]; rows?: string[][]; error?: string };

/** How a plot is exported. Sizes are in inches; dpi applies to PNG only.
 * The code is filled in by the controller from the plot on show. */
export type PlotFormat = "png" | "pdf" | "svg";
export type PlotExport = { format: PlotFormat; width: number; height: number; dpi: number; code?: string };

/** A running R. `session` is its key: `project:` and the project folder,
 * `file:` and a script that belongs to no project, or `scratch`. */
export type SessionInfo = { session: string; generation: number; version: string; workingDir: string; logPath: string };

/** Which R a script runs in, and its project when it belongs to one. */
export type SessionContext = { key: string; project: ProjectInfo | null };

export type REvent =
  | { kind: "busy"; busy: boolean }
  | { kind: "stream"; run: string; name: string; text: string }
  | { kind: "output"; run: string; text: string | null; html: string | null; png: string | null; svg: string | null; displayId?: string | null; update?: boolean }
  | { kind: "error"; run: string; message: string; traceback: string[] }
  | { kind: "done"; run: string; ok: boolean; stopped: boolean }
  | { kind: "input_request"; run: string; prompt: string; password: boolean }
  | { kind: "exited"; code: number | null; log: string };

/** Where a slow run spent its time: the seconds R was sampled working, and
 * the functions it was in, most first, with the share of that time. */
export type RunProfile = { sampled: number; calls: { name: string; seconds: number; share: number }[] };

/** What undoing the last run did: the objects put back as they were, and
 * the ones the run had made, now removed. */
export type UndoResult = { ok: boolean; restored?: string[]; removed?: string[] };

/** A function's quick help: its package, the title of its help page, and
 * how it is called. */
/** One assumption of a test or model: whether it holds, or null when there
 * is too little to judge, what was found, and what to do when it fails. */
export type StatsCheck = { name: string; ok: boolean | null; detail: string; advice: string };

/** The write-up of a test or model: an APA sentence, one per term for
 * models with several, and the assumptions checked. */
export type StatsReport = { found: boolean; title?: string; sentence?: string; terms?: { term: string; sentence: string }[]; checks?: StatsCheck[] };

/** Samples of data frames as dput() writes them, by name, with the R
 * version, the system, and the attached packages, for a forum question. */
export type Reprex = { data: Record<string, string>; r: string; platform: string; packages: string[] };

/** The newest versions of what can be updated, each empty when its source
 * could not be reached. */
export type LatestVersions = { app: string; appInPlace: boolean; appPage: string; r: string; ollama: string };

/** Installed packages with a newer version on CRAN. */
export type OutdatedPackages = { reached: boolean; packages: { name: string; installed: string; available: string }[] };

/** One saved version of a file, by the time it was saved. */
export type FileVersion = { id: string; savedAt: number };

export type Brief ={ found: boolean; package?: string; title?: string; usage?: string };

export type RObject = { name: string; kind: "data" | "model" | "function" | "list" | "value"; class: string; summary: string; columns: string[] };

export type MenuState = { layer: Layer; outputLayout: OutputLayout; autoInstall: boolean; liveOutput: boolean };

// The optional assistant. Field names match the Rust commands in
// src-tauri/src/assistant.rs.

export type AssistantFound = {
  systemPath: string | null;
  systemRunning: boolean;
  systemVersion: string;
  privateInstalled: boolean;
  privateSupported: boolean;
  privateVersion: string;
};
export type InstalledModel = { id: string; sizeGb: number; parameters: string };
export type AssistantStatus = { found: AssistantFound; connected: "" | "system" | "private"; version: string; installed: InstalledModel[] };
export type MachineSpecs = { memoryGb: number; freeDiskGb: number; chip: string; appleSilicon: boolean };
export type ModelFit = "good" | "tight" | "tooLarge" | "noRoom";
export type CatalogModel = {
  id: string;
  name: string;
  kind: string;
  sizeGb: number;
  memoryFloorGb: number;
  pros: string[];
  cons: string[];
  thinks: boolean;
  fit: ModelFit | null;
  memoryNeededGb: number;
};
export type ModelCatalog = { models: CatalogModel[]; suggested: string };
export type SetupEvent = { target: string; stage: string; completed: number; total: number; done: boolean; error: string };
export type AnswerEvent = { id: string; text: string; done: boolean; error: string };
export type AssistantTask =
  | { kind: "ask"; question: string }
  | { kind: "explainError"; code: string; message: string; plain: string }
  | { kind: "explainCode"; code: string }
  | { kind: "writeCode"; request: string }
  | { kind: "improve"; code: string }
  | { kind: "comment"; code: string };
export type AssistantContext = { rVersion: string; objects: string[]; packages: string[] };
export type ChatTurn = { role: "user" | "assistant"; content: string };

/** The format a report is rendered to. As written follows the document's
 * own header, which is what the Render button does. */
export type RenderTarget = "asWritten" | "html" | "word" | "pdf";

/** Why a render did not finish, from src-tauri's render module. A chunk
 * failure counts lines from one, from the chunk's first line of code to
 * its closing fence, as knitr reports them. */
export type RenderFailure =
  | { kind: "notReport" }
  | { kind: "noR" }
  | { kind: "noQuarto" }
  | { kind: "noPandoc" }
  | { kind: "latex" }
  | { kind: "chunk"; from: number; to: number; label: string; message: string }
  | { kind: "other"; message: string }
  | { kind: "stopped" };

export type RenderResult = { status: "done" | "failed" | "stopped"; outputs: string[]; failure: RenderFailure | null };

/** Why a Shiny app stopped running, from src-tauri's shiny module. A parse
 * failure counts its line and column from one, as R's parser does, and
 * names the file R read, which may be ui.R beside the app.R that was run. */
export type AppFailure =
  | { kind: "noR" }
  | { kind: "noShiny" }
  | { kind: "noShinylive" }
  | { kind: "parse"; file: string; line: number; column: number; message: string }
  | { kind: "ended"; message: string }
  | { kind: "stopped" };

/** What a running Shiny app is doing. An ending with no failure means the
 * app closed itself, as with stopApp(). */
export type AppEvent =
  | { kind: "ready"; id: string; url: string }
  | { kind: "problem"; id: string; message: string }
  | { kind: "line"; id: string; text: string }
  | { kind: "ended"; id: string; failure: AppFailure | null };

/** The files exporting an app would bundle into its web page, listed
 * before anything is made. `more` says the list stopped at its limit. */
export type BundleList = { files: string[]; more: boolean };

/** How exporting an app as a web page ended: the folder it made, or why
 * it did not. */
export type ExportResult = { status: "done" | "failed" | "stopped"; folder: string | null; failure: AppFailure | null };

/** A line an export printed. */
export type ExportEvent = { id: string; text: string };

/** Progress through a render's chunks, and each line it prints. */
export type RenderEvent = { kind: "progress"; id: string; done: number; total: number; label: string | null } | { kind: "line"; id: string; text: string };
