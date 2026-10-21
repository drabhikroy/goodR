// Shapes shared between the interface and the Rust side. Field names match
// the JSON the Rust commands send, which uses camelCase.

export type RInstall = { version: string; home: string; source: string };

/** A file opened before. The list is kept by the Rust side, which is the
 * only code allowed to add to it. */
export type RecentFile = { path: string; openedAt: number };

export type Appearance = "system" | "light" | "dark";
export type PaletteName = "standard" | "deuteranopia" | "protanopia" | "tritanopia" | "monochrome";
export type Layer = "essentials" | "everything";
export type OutputLayout = "inline" | "side" | "stacked" | "console";
/** How results under the code look: as cards, or as plain text. */
export type ResultStyle = "cards" | "plain";
export type CodeFont = "dm-mono" | "jetbrains-mono" | "ibm-plex-mono" | "fira-code" | "source-code-pro" | "system";
export type LineSpacing = "compact" | "normal" | "relaxed";

export type Settings = {
  rHome: string;
  recentFiles: RecentFile[];
  sessionFiles: string[];
  sessionActive: string;
  recentProjects: RecentFile[];
  sessionProject: string;
  consoleHeight: number;
  consoleInputHeight: number;
  inspectorWidth: number;
  paneSplit: number;
  appearance: Appearance;
  palette: PaletteName;
  textSize: number;
  reduceMotion: boolean;
  layer: Layer;
  outputLayout: OutputLayout;
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
};

export type AppInfo = { name: string; version: string; arkVersion: string; platform: string; git: boolean };

/** An open project: its folder, its project file, and what it holds, by
 * path relative to the folder. Data files are listed by name only. */
export type ProjectInfo = { name: string; root: string; file: string; scripts: string[]; data: string[] };

/** The starting points the New Project dialog offers. "existing" adds a
 * project file to a folder the person already has. */
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

export type SessionInfo = { generation: number; version: string; workingDir: string; logPath: string };

export type REvent =
  | { kind: "busy"; busy: boolean }
  | { kind: "stream"; run: string; name: string; text: string }
  | { kind: "output"; run: string; text: string | null; html: string | null; png: string | null; svg: string | null; displayId?: string | null; update?: boolean }
  | { kind: "error"; run: string; message: string; traceback: string[] }
  | { kind: "done"; run: string; ok: boolean; stopped: boolean }
  | { kind: "input_request"; run: string; prompt: string; password: boolean }
  | { kind: "exited"; code: number | null; log: string };

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

/** Progress through a render's chunks, and each line it prints. */
export type RenderEvent = { kind: "progress"; id: string; done: number; total: number; label: string | null } | { kind: "line"; id: string; text: string };
