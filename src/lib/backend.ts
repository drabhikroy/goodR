// The only way the interface reaches R, the disk, or the system.
//
// In the desktop app these calls go to the Rust commands in src-tauri. In a
// plain browser, used for interface tests and design review, a stand-in
// with a pretend R and a few example scripts takes their place, so every
// screen can be exercised without a desktop build.

import type { Completions } from "./completion";
import type { AppEvent, AnswerEvent, Brief, FileVersion, LatestVersions, OutdatedPackages, Reprex, StatsReport, LatexStatus, RunProfile, UndoResult, BundleList, ExportEvent, ExportResult, AssistantContext, AssistantStatus, AssistantTask, ChatTurn, MachineSpecs, ModelCatalog, SetupEvent, AppInfo, DataMeta, DataPreview, DataRow, HelpPage, MenuState, PackageInfo, PlotExport, ProjectInfo, ProjectTemplate, REvent, RenderEvent, RenderResult, RenderTarget, RInstall, RObject, SessionContext, SessionInfo, Settings } from "./types";

/** Everything the interface may ask of the system. Each method maps to one
 * Rust command, listed in the same order as in src-tauri/src/lib.rs. */
export interface Backend {
  readonly native: boolean;
  appInfo(): Promise<AppInfo>;
  listRInstalls(): Promise<RInstall[]>;
  loadSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<void>;
  updateMenu(state: MenuState): Promise<void>;
  /** Shows the system Open dialog. Only files chosen there, or reopened
   * from the recent list, can be read or written afterward. */
  chooseFiles(): Promise<string[]>;
  chooseSavePath(suggested: string): Promise<string | null>;
  reopen(path: string): Promise<string>;
  forgetRecent(path: string): Promise<void>;
  rememberSession(files: string[], active: string): Promise<void>;
  /** Files handed to the app at launch, from Finder or the command line. */
  takePending(): Promise<string[]>;
  /** Shows the Open dialog for a project file. Null when canceled. */
  chooseProject(): Promise<ProjectInfo | null>;
  reopenProject(file: string): Promise<ProjectInfo>;
  refreshProject(root: string): Promise<ProjectInfo | null>;
  /** Closes a project and ends its R. */
  closeProject(root: string): Promise<void>;
  /** Which R a script runs in: its project's, when it sits inside a
   * project, which this opens, or one of its own. */
  sessionFor(file: string): Promise<SessionContext>;
  forgetProject(file: string): Promise<void>;
  /** Shows the folder picker for a new project. Only the folder chosen
   * here can be passed to createProject. */
  chooseProjectFolder(existing: boolean): Promise<string | null>;
  createProject(parent: string, name: string, template: ProjectTemplate, git: boolean): Promise<ProjectInfo>;
  /** Copies the example project into the Documents folder, restoring any
   * deleted file and keeping changed ones, and opens it. */
  openExamples(): Promise<ProjectInfo>;
  readText(path: string): Promise<string>;
  writeText(path: string, contents: string): Promise<void>;
  /** The newest versions of the app, R, and Ollama. */
  latestVersions(): Promise<LatestVersions>;
  /** Installs the newest version of the app, returning it, or null when
   * there is nothing newer. Progress arrives through onUpdateProgress. */
  installAppUpdate(): Promise<string | null>;
  onUpdateProgress(listener: (progress: { done: number; total: number | null }) => void): Promise<() => void>;
  restartApp(): Promise<void>;
  /** Installed packages with newer versions on CRAN. */
  outdated(session: string): Promise<OutdatedPackages>;
  /** Forgets the recent lists, and deletes earlier versions of files, as
   * asked, when the app is put back as it was new. */
  resetApp(recent: boolean, history: boolean): Promise<void>;
  /** The saved versions of a file, newest first. */
  fileHistory(path: string): Promise<FileVersion[]>;
  /** The text of one saved version of a file. */
  fileVersion(path: string, id: string): Promise<string>;
  savePlot(data: string, suggested: string): Promise<string | null>;
  // Every call to R below names the session it goes to, by key.
  exportPlot(session: string, options: PlotExport, suggested: string): Promise<string | null>;
  startSession(rHome: string, session: string): Promise<SessionInfo>;
  /** The sessions still running after the window reloaded. */
  runningSessions(): Promise<SessionInfo[]>;
  complete(session: string, line: string, cursor: number): Promise<Completions>;
  help(session: string, topic: string, packageName: string, file: string): Promise<HelpPage>;
  packages(session: string): Promise<PackageInfo[]>;
  preview(session: string, code: string): Promise<DataPreview>;
  /** R's parser message for code that does not parse, with its line and
   * column, or empty when it parses. Nothing runs. */
  parseProblem(session: string, code: string): Promise<string>;
  chooseDataFile(session: string): Promise<string | null>;
  shutdownSession(session: string): Promise<void>;
  /** Runs code under a run id the caller chose, so the caller can match
   * output that arrives before this call returns. */
  execute(session: string, code: string, runId: string): Promise<string>;
  isComplete(session: string, code: string): Promise<string>;
  interrupt(session: string): Promise<void>;
  sendInput(session: string, value: string): Promise<void>;
  objects(session: string): Promise<RObject[]>;
  missingPackages(session: string, names: string[]): Promise<string[]>;
  /** Marks the boundary between runs: stops timing the statement before,
   * summarizing where it spent its time when asked, keeps the objects as
   * they are before a fresh run when `keep` is set, and starts timing the
   * next statement when `profile` is set. */
  step(session: string, summarize: boolean, fresh: boolean, keep: boolean, profile: boolean): Promise<{ profile: RunProfile | null }>;
  /** Puts the objects back as they were before the last run. */
  undo(session: string): Promise<UndoResult>;
  /** A function's title, package, and usage, for quick help. */
  brief(session: string, name: string): Promise<Brief>;
  /** Samples of the named objects and the versions, for a forum question. */
  reprex(session: string, names: string[]): Promise<Reprex>;
  /** Code restyled by styler, or that styler is missing, or why it failed. */
  style(session: string, code: string): Promise<{ missing: boolean; text?: string; error?: string }>;
  /** The APA sentence and assumption checks for a test or model, when the
   * statement runs one. */
  stats(session: string, code: string): Promise<StatsReport>;
  /** Whether a student's statement gives what an exercise's answer gives,
   * with what differs when it does not. `ok` is null when it cannot say. */
  exercise(session: string, student: string, answer: string): Promise<{ ok: boolean | null; message: string }>;
  /** Runs code in a new R, with no saved objects or startup files, in the
   * folder of `file` or its project, and says where it first failed. */
  freshCheck(file: string | null, code: string): Promise<{ ok: boolean; line: number | null; message: string; ran: number }>;
  freshStop(): Promise<void>;
  /** Looks up a citation through R: BibTeX for a DOI, or Crossref's
   * reply to a search, as text, or why it could not. */
  cite(session: string, kind: "doi" | "search", query: string): Promise<{ ok: boolean; text: string }>;
  /** Adds a BibTeX entry to references.bib beside a document, returning
   * the key to cite. */
  bibAdd(document: string, entry: string): Promise<string>;
  setPlotSize(session: string, width: number, height: number, ratio: number): Promise<void>;
  setPalette(session: string, colors: string[]): Promise<void>;
  /** Turns the app's plot style on or off: background, text, quieter
   * text, and grid colors, in that order. */
  setPlotStyle(session: string, on: boolean, colors: string[]): Promise<void>;
  /** Moves R to the folder of a script that was opened, returning it. */
  setWorkingDir(session: string, file: string): Promise<string>;
  dataMeta(session: string, name: string): Promise<DataMeta>;
  dataRows(session: string, name: string, offset: number, count: number, sortBy: string, descending: boolean): Promise<DataRow[]>;
  confirm(message: string, okLabel: string): Promise<boolean>;
  openUrl(url: string): Promise<void>;
  setTitle(title: string): Promise<void>;
  onREvent(listener: (session: string, generation: number, event: REvent) => void): Promise<() => void>;
  onMenu(listener: (id: string) => void): Promise<() => void>;
  /** Scripts dropped on the window or opened from Finder while running. */
  onOpenFiles(listener: (paths: string[]) => void): Promise<() => void>;
  /** A drag over the window: how many of its files are scripts, or minus
   * one when the drag ends. */
  onDropHover(listener: (scripts: number) => void): Promise<() => void>;
  onDropSkipped(listener: (count: number) => void): Promise<() => void>;
  // The optional assistant, in src-tauri/src/assistant.rs.
  assistantStatus(): Promise<AssistantStatus>;
  assistantConnect(route: "system" | "private"): Promise<string>;
  /** Reads this computer's memory and disk. Called only after the user
   * agrees to the check. */
  assistantSpecs(): Promise<MachineSpecs>;
  assistantCatalog(specs: MachineSpecs | null): Promise<ModelCatalog>;
  assistantInstallRuntime(): Promise<void>;
  assistantPull(model: string): Promise<void>;
  assistantCancelSetup(): Promise<void>;
  assistantDelete(model: string): Promise<void>;
  assistantRemoveRuntime(): Promise<void>;
  assistantAsk(id: string, model: string, task: AssistantTask, context: AssistantContext, history: ChatTurn[]): Promise<void>;
  assistantStop(): Promise<void>;
  onAssistantSetup(listener: (event: SetupEvent) => void): Promise<() => void>;
  onAssistantAnswer(listener: (event: AnswerEvent) => void): Promise<() => void>;
  // Reports, in src-tauri/src/render.rs.
  /** Renders a Quarto or R Markdown file the user opened, in a separate
   * R, and resolves when it finishes, fails, or is stopped. */
  renderStart(id: string, file: string, target: RenderTarget): Promise<RenderResult>;
  renderStop(): Promise<void>;
  /** Opens a rendered file in its usual app, or shows it in Finder. Only
   * files a render made can be opened this way. */
  renderOpen(path: string, reveal: boolean): Promise<void>;
  /** The address the preview loads a rendered file from. */
  previewUrl(path: string): string;
  onRender(listener: (event: RenderEvent) => void): Promise<() => void>;
  // LaTeX for PDFs, in src-tauri/src/latex.rs.
  /** Every LaTeX on this computer, named, and whether one is installing. */
  latexStatus(): Promise<LatexStatus>;
  /** Installs TinyTeX into the app's own folder, and resolves when done. */
  latexInstall(): Promise<void>;
  latexCancel(): Promise<void>;
  /** Removes the app's own TinyTeX, never a LaTeX the user installed. */
  latexRemove(): Promise<void>;
  /** Each line the install prints. */
  onLatex(listener: (text: string) => void): Promise<() => void>;
  // Shiny apps, in src-tauri/src/shiny.rs.
  /** Runs a Shiny app the user opened, in a separate R, and resolves as
   * soon as it starts. What follows arrives through onApp. */
  appStart(id: string, file: string): Promise<void>;
  appStop(): Promise<void>;
  /** Opens the running app in the system's browser. */
  appOpen(): Promise<void>;
  onApp(listener: (event: AppEvent) => void): Promise<() => void>;
  /** The files exporting an app would put in its web page. */
  appBundleFiles(file: string): Promise<BundleList>;
  /** Exports an app as a web page into a new folder where the user
   * chooses in the system dialog. Null when the dialog is canceled. */
  appExport(id: string, file: string): Promise<ExportResult | null>;
  appExportStop(): Promise<void>;
  /** Shows an exported web page in the App pane, in place of the app. */
  appPreview(id: string, folder: string): Promise<void>;
  /** Shows an exported folder in Finder. */
  appReveal(folder: string): Promise<void>;
  onExport(listener: (event: ExportEvent) => void): Promise<() => void>;
}

/** The desktop backend. The Tauri modules load only inside the app, so
 * the browser build never pulls them in. */
async function tauriBackend(): Promise<Backend> {
  const { convertFileSrc, invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const dialog = await import("@tauri-apps/plugin-dialog");
  const opener = await import("@tauri-apps/plugin-opener");

  return {
    native: true,
    appInfo: () => invoke("app_info"),
    listRInstalls: () => invoke("list_r_installs"),
    loadSettings: () => invoke("load_settings"),
    saveSettings: (settings) => invoke("save_settings", { settings }),
    updateMenu: (menuState) => invoke("update_menu", { menuState }),
    chooseFiles: () => invoke("choose_files"),
    chooseSavePath: (suggested) => invoke("choose_save_path", { suggested }),
    reopen: (path) => invoke("reopen", { path }),
    forgetRecent: (path) => invoke("forget_recent", { path }),
    rememberSession: (files, active) => invoke("remember_session", { files, active }),
    takePending: () => invoke("take_pending"),
    chooseProject: () => invoke("choose_project"),
    reopenProject: (file) => invoke("reopen_project", { file }),
    refreshProject: (root) => invoke("refresh_project", { root }),
    closeProject: (root) => invoke("close_project", { root }),
    sessionFor: (file) => invoke("session_for", { file }),
    forgetProject: (file) => invoke("forget_project", { file }),
    chooseProjectFolder: (existing) => invoke("choose_project_folder", { existing }),
    createProject: (parent, name, template, git) => invoke("create_project", { parent, name, template, git }),
    openExamples: () => invoke("open_examples"),
    readText: (path) => invoke("read_text", { path }),
    writeText: (path, contents) => invoke("write_text", { path, contents }),
    fileHistory: (path) => invoke("file_history", { path }),
    resetApp: (recent, history) => invoke("reset_app", { recent, history }),
    latestVersions: () => invoke("latest_versions"),
    installAppUpdate: () => invoke("install_app_update"),
    onUpdateProgress: (listener) => listen<{ done: number; total: number | null }>("update-progress", (message) => listener(message.payload)),
    restartApp: () => invoke("restart_app"),
    outdated: (session) => invoke("r_outdated", { session }),
    fileVersion: (path, id) => invoke("file_version", { path, id }),
    savePlot: (data, suggested) => invoke("save_plot", { data, suggested }),
    exportPlot: (session, options, suggested) => invoke("export_plot", { ...options, session, suggested }),
    startSession: (rHome, session) => invoke("start_session", { rHome, session }),
    runningSessions: () => invoke("running_sessions"),
    complete: (session, line, cursor) => invoke("r_complete", { session, line, cursor }),
    help: (session, topic, packageName, file) => invoke("r_help", { session, topic, package: packageName, file }),
    packages: (session) => invoke("r_packages", { session }),
    preview: (session, code) => invoke("r_preview", { session, code }),
    parseProblem: (session, code) => invoke("r_parse_problem", { session, code }),
    chooseDataFile: (session) => invoke("choose_data_file", { session }),
    shutdownSession: (session) => invoke("shutdown_session", { session }),
    execute: (session, code, runId) => invoke("execute", { session, code, runId }),
    isComplete: (session, code) => invoke("is_complete", { session, code }),
    interrupt: (session) => invoke("interrupt", { session }),
    sendInput: (session, value) => invoke("send_input", { session, value }),
    objects: (session) => invoke("r_objects", { session }),
    missingPackages: (session, names) => invoke("r_missing_packages", { session, names }),
    step: (session, summarize, fresh, keep, profile) => invoke("r_step", { session, summarize, fresh, keep, profile }),
    undo: (session) => invoke("r_undo", { session }),
    brief: (session, name) => invoke("r_brief", { session, name }),
    reprex: (session, names) => invoke("r_reprex", { session, names }),
    style: (session, code) => invoke("r_style", { session, code }),
    stats: (session, code) => invoke("r_stats", { session, code }),
    exercise: (session, student, answer) => invoke("r_exercise", { session, student, answer }),
    freshCheck: (file, code) => invoke("fresh_check", { file, code }),
    freshStop: () => invoke("fresh_stop"),
    cite: (session, kind, query) => invoke("r_cite", { session, kind, query }),
    bibAdd: (document, entry) => invoke("bib_add", { document, entry }),
    setPlotSize: (session, width, height, ratio) => invoke("r_set_plot_size", { session, width, height, ratio }),
    setPlotStyle: (session, on, colors) => invoke("r_plot_style", { session, on, colors }),
    setPalette: (session, colors) => invoke("r_set_palette", { session, colors }),
    setWorkingDir: (session, file) => invoke("r_set_working_dir", { session, file }),
    dataMeta: (session, name) => invoke("r_data_meta", { session, name }),
    dataRows: (session, name, offset, count, sortBy, descending) => invoke("r_data_rows", { session, name, offset, count, sortBy, descending }),
    // A native dialog, so the question looks and behaves like the system's.
    confirm: (message, okLabel) => dialog.ask(message, { title: "R: What Is It Good For?", kind: "warning", okLabel, cancelLabel: "Cancel" }),
    openUrl: (url) => opener.openUrl(url),
    setTitle: (title) => getCurrentWindow().setTitle(title),
    // Every R message arrives tagged with the session it came from.
    onREvent: (listener) =>
      listen<{ session: string; generation: number; event: REvent }>("r-event", (message) => listener(message.payload.session, message.payload.generation, message.payload.event)),
    onMenu: (listener) => listen<string>("menu", (message) => listener(message.payload)),
    onOpenFiles: (listener) => listen<string[]>("open-files", (message) => listener(message.payload)),
    onDropHover: (listener) => listen<number>("drop-hover", (message) => listener(message.payload)),
    onDropSkipped: (listener) => listen<number>("drop-skipped", (message) => listener(message.payload)),
    assistantStatus: () => invoke("assistant_status"),
    assistantConnect: (route) => invoke("assistant_connect", { route }),
    assistantSpecs: () => invoke("assistant_specs"),
    assistantCatalog: (specs) => invoke("assistant_catalog", { specs }),
    assistantInstallRuntime: () => invoke("assistant_install_runtime"),
    assistantPull: (model) => invoke("assistant_pull", { model }),
    assistantCancelSetup: () => invoke("assistant_cancel_setup"),
    assistantDelete: (model) => invoke("assistant_delete", { model }),
    assistantRemoveRuntime: () => invoke("assistant_remove_runtime"),
    assistantAsk: (id, model, task, context, history) => invoke("assistant_ask", { id, model, task, context, history }),
    assistantStop: () => invoke("assistant_stop"),
    onAssistantSetup: (listener) => listen<SetupEvent>("assistant-setup", (message) => listener(message.payload)),
    onAssistantAnswer: (listener) => listen<AnswerEvent>("assistant-answer", (message) => listener(message.payload)),
    renderStart: (id, file, target) => invoke("render_start", { id, file, target }),
    renderStop: () => invoke("render_stop"),
    renderOpen: (path, reveal) => invoke("render_open", { path, reveal }),
    // The asset protocol serves only folders a render was granted.
    previewUrl: (path) => convertFileSrc(path),
    onRender: (listener) => listen<RenderEvent>("render-event", (message) => listener(message.payload)),
    latexStatus: () => invoke("latex_status"),
    latexInstall: () => invoke("latex_install"),
    latexCancel: () => invoke("latex_cancel"),
    latexRemove: () => invoke("latex_remove"),
    onLatex: (listener) => listen<{ text: string }>("latex-event", (message) => listener(message.payload.text)),
    appStart: (id, file) => invoke("app_start", { id, file }),
    appStop: () => invoke("app_stop"),
    appOpen: () => invoke("app_open"),
    onApp: (listener) => listen<AppEvent>("app-event", (message) => listener(message.payload)),
    appBundleFiles: (file) => invoke("app_bundle_files", { file }),
    appExport: (id, file) => invoke("app_export", { id, file }),
    appExportStop: () => invoke("app_export_stop"),
    appPreview: (id, folder) => invoke("app_preview", { id, folder }),
    appReveal: (folder) => invoke("app_reveal", { folder }),
    onExport: (listener) => listen<ExportEvent>("export-event", (message) => listener(message.payload)),
  };
}

// One backend for the life of the page.
let instance: Promise<Backend> | null = null;

/** The backend for this environment, created once. */
export function backend(): Promise<Backend> {
  if (!instance) {
    const native = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
    instance = native ? tauriBackend() : import("./mockBackend").then((module) => module.createMockBackend());
  }
  return instance;
}
