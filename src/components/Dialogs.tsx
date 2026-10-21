// Dialogs and the command palette. All of them share one modal frame that
// moves focus in when it opens, keeps Tab inside it, closes on Escape, and
// returns focus to where it was.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { chooseDataFile, chooseProjectFolder, chooseR, createProject, exportPlot, hasPackage, previewData, runImport, installPackages, openDialog, openUrl, runCommand, setOutputLayout, shortPath, togglePalette, updateSettings } from "../lib/app";
import { keyLabel, searchCommands, visibleCommands } from "../lib/commands";
import { isSupportedR, OLDEST_R } from "../lib/rversion";
import { getState, useStore } from "../lib/store";
import { FORMAT_NAMES, FORMAT_PACKAGE, firstLinesCode, formatOf, guessLayout, importCode, isValidName, objectName, pathForCode, previewCode, sheetsCode, type ImportOptions } from "../lib/importData";
import type { Appearance, CodeFont, DataPreview, LineSpacing, OutputLayout, PaletteName, PlotFormat, ProjectTemplate } from "../lib/types";
import { CODE_FONTS } from "../theme/theme";
import tokens from "../theme/tokens.json";
import { AssistantSetupDialog } from "./AssistantSetup";
import { AppWindowIcon, ChartIcon, CloseIcon, FolderIcon, ReportIcon, SearchIcon } from "./Icons";

export function Modal({ title, onClose, children, wide = false, labelledBy, className = "" }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; labelledBy?: string; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    // React applies autoFocus itself and leaves no attribute behind, so the
    // field meant to take focus carries data-autofocus instead. Without one,
    // the first field is used, and the close button only as a last resort.
    const target =
      box.current?.querySelector<HTMLElement>("[data-autofocus]") ??
      box.current?.querySelector<HTMLElement>(".dialog-body input, .dialog-body button, .palette input") ??
      box.current?.querySelector<HTMLElement>("button");
    target?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (event.key !== "Tab" || !box.current) return;
      const focusable = [...box.current.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href], [tabindex='0']")].filter((element) => !element.hasAttribute("disabled"));
      if (!focusable.length) return;
      const [head, tail] = [focusable[0], focusable[focusable.length - 1]];
      if (event.shiftKey && document.activeElement === head) {
        event.preventDefault();
        tail.focus();
      } else if (!event.shiftKey && document.activeElement === tail) {
        event.preventDefault();
        head.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby={labelledBy ?? "dialog-title"} className={`dialog ${wide ? "wide" : ""} ${className}`}>
        <div className="dialog-head">
          <h2 id={labelledBy ?? "dialog-title"}>{title}</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <CloseIcon size={14} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const close = () => openDialog(null);

export function Dialogs() {
  const dialog = useStore((state) => state.ui.dialog);
  const palette = useStore((state) => state.ui.palette);
  return (
    <>
      {dialog === "settings" && <SettingsDialog />}
      {dialog === "about" && <AboutDialog />}
      {dialog === "chooseR" && <ChooseRDialog />}
      {dialog === "install" && <InstallDialog />}
      {dialog === "newProject" && <NewProjectDialog />}
      {dialog === "exportPlot" && <ExportPlotDialog />}
      {dialog === "importData" && <ImportDataDialog />}
      {dialog === "assistantSetup" && <AssistantSetupDialog />}
      {palette && <CommandPalette />}
    </>
  );
}

function Radio<T extends string>({ name, value, current, onChange, children }: { name: string; value: T; current: T; onChange: (value: T) => void; children: ReactNode }) {
  return (
    <label className={`choice ${current === value ? "is-on" : ""}`}>
      <input type="radio" name={name} checked={current === value} onChange={() => onChange(value)} />
      {children}
    </label>
  );
}

const PALETTES: { value: PaletteName; label: string; note: string }[] = [
  { value: "standard", label: "Standard", note: "Green, amber, and red" },
  { value: "deuteranopia", label: "Deuteranopia", note: "Green weak, the most common" },
  { value: "protanopia", label: "Protanopia", note: "Red weak, reds look darker" },
  { value: "tritanopia", label: "Tritanopia", note: "Blue and yellow weak" },
  { value: "monochrome", label: "Monochrome", note: "Shapes and lightness only" },
];

type Pane = "appearance" | "code" | "editor" | "results" | "accessibility" | "r" | "menus";

const PANES: { id: Pane; label: string }[] = [
  { id: "appearance", label: "Appearance" },
  { id: "code", label: "Code text" },
  { id: "editor", label: "Editor" },
  { id: "results", label: "Results" },
  { id: "accessibility", label: "Accessibility" },
  { id: "r", label: "R and packages" },
  { id: "menus", label: "Menus" },
];

/**
 * Settings follow the macOS pattern of panes named for a task, with
 * accessibility as a pane of its own rather than a buried checkbox. Every
 * change applies at once, so there is nothing to save.
 */
function SettingsDialog() {
  const [pane, setPane] = useState<Pane>("appearance");
  return (
    <Modal title="Settings" onClose={close} wide>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {PANES.map((item) => (
            <button key={item.id} type="button" aria-current={pane === item.id ? "page" : undefined} className={pane === item.id ? "is-on" : ""} onClick={() => setPane(item.id)}>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="dialog-body settings">
          {pane === "appearance" && <AppearancePane />}
          {pane === "code" && <CodePane />}
          {pane === "editor" && <EditorPrefsPane />}
          {pane === "results" && <ResultsPane />}
          {pane === "accessibility" && <AccessibilityPane />}
          {pane === "r" && <RPane />}
          {pane === "menus" && <MenusPane />}
        </div>
      </div>
    </Modal>
  );
}

function AppearancePane() {
  const settings = useStore((state) => state.settings);
  return (
    <>
      <fieldset>
        <legend>Appearance</legend>
        <div className="choices row">
          {(["system", "light", "dark"] as Appearance[]).map((value) => (
            <Radio key={value} name="appearance" value={value} current={settings.appearance} onChange={(appearance) => updateSettings({ appearance })}>
              {value === "system" ? "Match the system" : value === "light" ? "Light" : "Dark"}
            </Radio>
          ))}
        </div>
        <p className="hint">Light is easier to proofread on, so it is the default. Dark is a full alternative, not an inverted copy.</p>
      </fieldset>
      <fieldset>
        <legend>Interface text size</legend>
        <p className="hint">Menus, panes, the console's notes, and dialogs. Code has a size of its own under Code text.</p>
        <div className="range-row">
          <span aria-hidden="true" className="small-a">A</span>
          <input type="range" min={90} max={150} step={10} value={settings.textSize} aria-label="Interface text size" onChange={(event) => updateSettings({ textSize: Number(event.target.value) })} />
          <span aria-hidden="true" className="large-a">A</span>
          <span className="muted">{settings.textSize} percent</span>
        </div>
      </fieldset>
    </>
  );
}

// A few lines of R that show the things a code typeface has to get right:
// the assignment arrow, the pipe, brackets, a number, text, and a comment.
const CODE_SAMPLE = `# Mean body mass by species
penguins |>
  filter(!is.na(body_mass)) |>
  summarize(mass = mean(body_mass), .by = species)
x <- c(1, 2.5, 10) != 0L`;

/**
 * The code typeface, its size, and its spacing, applied to the script, the
 * console, and every result. A sample shows each change before the person
 * goes back to their own code, so trying a setting costs nothing.
 */
function CodePane() {
  const settings = useStore((state) => state.settings);
  const font = CODE_FONTS[settings.codeFont] ?? CODE_FONTS["dm-mono"];
  return (
    <>
      <pre className="code-sample" aria-label="Sample of code in the chosen typeface">
        {CODE_SAMPLE}
      </pre>
      <fieldset>
        <legend>Typeface</legend>
        <div className="choices fonts">
          {(Object.keys(CODE_FONTS) as CodeFont[]).map((value) => (
            <Radio key={value} name="code-font" value={value} current={settings.codeFont} onChange={(codeFont) => updateSettings({ codeFont })}>
              <span className="font-choice" style={{ fontFamily: CODE_FONTS[value].stack }}>
                {CODE_FONTS[value].label}
              </span>
            </Radio>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Size</legend>
        <div className="range-row">
          <span aria-hidden="true" className="small-a">A</span>
          <input type="range" min={11} max={24} step={1} value={settings.codeSize} aria-label="Code size" onChange={(event) => updateSettings({ codeSize: Number(event.target.value) })} />
          <span aria-hidden="true" className="large-a">A</span>
          <span className="muted">{settings.codeSize} points</span>
        </div>
      </fieldset>
      <fieldset>
        <legend>Line spacing</legend>
        <div className="choices row">
          {(["compact", "normal", "relaxed"] as LineSpacing[]).map((value) => (
            <Radio key={value} name="line-spacing" value={value} current={settings.lineSpacing} onChange={(lineSpacing) => updateSettings({ lineSpacing })}>
              {value === "compact" ? "Compact" : value === "normal" ? "Normal" : "Relaxed"}
            </Radio>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Joined symbols</legend>
        <label className="check">
          <input type="checkbox" checked={settings.ligatures} disabled={!font.ligatures} onChange={(event) => updateSettings({ ligatures: event.target.checked })} />
          {font.ligatures ? "Draw symbols such as <- and != as single shapes" : `${font.label} has no joined symbols. JetBrains Mono and Fira Code do.`}
        </label>
      </fieldset>
    </>
  );
}

/** How the script editor behaves as you type and read. */
function EditorPrefsPane() {
  const settings = useStore((state) => state.settings);
  const toggle = (key: "lineNumbers" | "highlightLine" | "wrapLines" | "closeBrackets" | "rainbowBrackets", label: string, hint: string) => (
    <label className="check">
      <input type="checkbox" checked={settings[key]} onChange={(event) => updateSettings({ [key]: event.target.checked })} />
      <span>
        {label}
        <span className="hint">{hint}</span>
      </span>
    </label>
  );
  return (
    <>
      <fieldset>
        <legend>Showing code</legend>
        <div className="checks">
          {toggle("lineNumbers", "Line numbers", "In the margin to the left of the code")}
          {toggle("highlightLine", "Highlight the line the cursor is on", "A light band across the current line")}
          {toggle("wrapLines", "Wrap long lines", "Long lines continue below instead of running off to the right")}
          {toggle("rainbowBrackets", "Color brackets by depth", "Each pair of brackets shares a color, so a long call is easier to follow")}
        </div>
      </fieldset>
      <fieldset>
        <legend>Typing</legend>
        <div className="checks">{toggle("closeBrackets", "Close brackets and quotes", "Typing ( adds the ) after the cursor")}</div>
      </fieldset>
      <fieldset>
        <legend>Indent width</legend>
        <div className="choices row">
          {[2, 4].map((value) => (
            <Radio key={value} name="tab-width" value={String(value)} current={String(settings.tabWidth)} onChange={(width) => updateSettings({ tabWidth: Number(width) })}>
              {value} spaces
            </Radio>
          ))}
        </div>
        <p className="hint">Two spaces is the common style for R, and the one the tidyverse style guide uses.</p>
      </fieldset>
    </>
  );
}

const RESULT_PLACES: { value: OutputLayout; label: string; note: string }[] = [
  { value: "inline", label: "Under each line", note: "Each result right below the code that made it" },
  { value: "side", label: "Beside the code", note: "Results in a column of their own" },
  { value: "stacked", label: "Below the code", note: "Results in a strip under the script" },
  { value: "console", label: "In the console", note: "The traditional way, as in R itself" },
];

/** Where results appear, how they look, and how copying treats them. */
function ResultsPane() {
  const settings = useStore((state) => state.settings);
  return (
    <>
      <fieldset>
        <legend>Where results appear</legend>
        <div className="choices palettes">
          {RESULT_PLACES.map((item) => (
            <Radio key={item.value} name="result-place" value={item.value} current={settings.outputLayout} onChange={(outputLayout) => setOutputLayout(outputLayout)}>
              <span>
                <strong>{item.label}</strong>
                <span className="hint">{item.note}</span>
              </span>
            </Radio>
          ))}
        </div>
      </fieldset>
      <fieldset disabled={settings.outputLayout === "console"}>
        <legend>How they look</legend>
        <div className="choices row">
          <Radio name="result-style" value="cards" current={settings.resultStyle} onChange={(resultStyle) => updateSettings({ resultStyle })}>
            <span>
              <strong>Cards</strong>
              <span className="hint">Code tinted, each result in its own well</span>
            </span>
          </Radio>
          <Radio name="result-style" value="plain" current={settings.resultStyle} onChange={(resultStyle) => updateSettings({ resultStyle })}>
            <span>
              <strong>Plain text</strong>
              <span className="hint">Printed under the code, with nothing around it</span>
            </span>
          </Radio>
        </div>
        {settings.outputLayout === "console" && <p className="hint">In the console, results are plain text already.</p>}
      </fieldset>
      <fieldset>
        <legend>Copying</legend>
        <label className="check">
          <input type="checkbox" checked={settings.copyResults} onChange={(event) => updateSettings({ copyResults: event.target.checked })} />
          <span>
            Include results when a copied selection crosses them
            <span className="hint">Turn this off to copy only the code</span>
          </span>
        </label>
      </fieldset>
    </>
  );
}

function AccessibilityPane() {
  const settings = useStore((state) => state.settings);
  const mode = useStore(() => (document.documentElement.dataset.mode === "dark" ? "dark" : "light"));
  return (
    <>
      <fieldset>
        <legend>Color vision palette</legend>
        <p className="hint">Changes interface colors, code colors, and the default colors of new plots. Every palette passes WCAG 2.2 AA, and shapes carry meaning alongside color.</p>
        <div className="choices palettes">
          {PALETTES.map((item) => {
            const colors = tokens.palettes[item.value][mode as "light" | "dark"];
            return (
              <Radio key={item.value} name="palette" value={item.value} current={settings.palette} onChange={(palette) => updateSettings({ palette })}>
                <span className="swatches" aria-hidden="true">
                  {[colors.ok, colors.warn, colors.danger].map((color) => (
                    <span key={color} style={{ background: color }} />
                  ))}
                </span>
                <span>
                  <strong>{item.label}</strong>
                  <span className="hint">{item.note}</span>
                </span>
              </Radio>
            );
          })}
        </div>
      </fieldset>
      <fieldset>
        <legend>Motion</legend>
        <label className="check">
          <input type="checkbox" checked={settings.reduceMotion} onChange={(event) => updateSettings({ reduceMotion: event.target.checked })} />
          Reduce motion. The system setting is always followed too.
        </label>
      </fieldset>
    </>
  );
}

function RPane() {
  const settings = useStore((state) => state.settings);
  const version = useStore((state) => state.r.version);
  return (
    <>
      <fieldset>
        <legend>R version</legend>
        <p className="hint">{version ? `R ${version} is running.` : "R is not running yet."} Changing the version restarts R.</p>
        <div>
          <button type="button" className="button" onClick={() => openDialog("chooseR")}>
            Choose R version
          </button>
        </div>
      </fieldset>
      <fieldset>
        <legend>Missing packages</legend>
        <div className="choices row">
          <Radio name="packages" value="ask" current={settings.missingPackages} onChange={(missingPackages) => updateSettings({ missingPackages })}>
            Ask before installing
          </Radio>
          <Radio name="packages" value="auto" current={settings.missingPackages} onChange={(missingPackages) => updateSettings({ missingPackages })}>
            Install automatically
          </Radio>
        </div>
      </fieldset>
    </>
  );
}

function MenusPane() {
  const settings = useStore((state) => state.settings);
  return (
    <fieldset>
      <legend>Menus</legend>
      <p className="hint">Holding advanced tools back at first helps people learn faster. Switch whenever you like.</p>
      <div className="choices row">
        <Radio name="layer" value="essentials" current={settings.layer} onChange={(layer) => updateSettings({ layer })}>
          <span>
            <strong>Essentials</strong>
            <span className="hint">What a new R user needs</span>
          </span>
        </Radio>
        <Radio name="layer" value="everything" current={settings.layer} onChange={(layer) => updateSettings({ layer })}>
          <span>
            <strong>Everything</strong>
            <span className="hint">Adds the advanced tools</span>
          </span>
        </Radio>
      </div>
    </fieldset>
  );
}

const TEMPLATES: { value: ProjectTemplate; label: string; note: string; Icon: typeof ChartIcon }[] = [
  { value: "analysis", label: "Analysis", note: "A script, a data folder, and a figures folder", Icon: ChartIcon },
  { value: "report", label: "Report", note: "A Quarto document that renders to HTML, Word, or PDF", Icon: ReportIcon },
  { value: "shiny", label: "Shiny app", note: "An interactive app with a working example to edit", Icon: AppWindowIcon },
  { value: "existing", label: "Existing folder", note: "Turn a folder you already have into a project", Icon: FolderIcon },
];

/**
 * A project is a folder with a project file, the same .Rproj file RStudio
 * uses. People start working before they read instructions (Carroll and
 * Rosson 1987), so each template gives them something that runs on the
 * first click.
 */
function NewProjectDialog() {
  const git = useStore((state) => state.info?.git ?? false);
  const [template, setTemplate] = useState<ProjectTemplate>("analysis");
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const [history, setHistory] = useState(git);
  const [renv, setRenv] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const existing = template === "existing";
  const folderName = existing ? parent.split(/[\\/]/).filter(Boolean).pop() ?? "" : name.trim();

  async function choose() {
    const folder = await chooseProjectFolder(existing);
    if (folder) {
      setParent(folder);
      setError("");
    }
  }

  async function create() {
    if (!parent) return setError(existing ? "Choose the folder first." : "Choose where the project goes first.");
    if (!existing && !name.trim()) return setError("Give the project a name.");
    setBusy(true);
    try {
      await createProject(parent, name.trim(), template, history, renv);
    } catch (problem) {
      setError(String(problem));
      setBusy(false);
    }
  }

  return (
    <Modal title="New project" onClose={close} wide>
      <div className="dialog-body new-project">
        <p className="hint">A project keeps your code, data, and output together in one folder, and reopens where you left off. Only its scripts are opened by this app.</p>
        <fieldset>
          <legend>Start from</legend>
          <div className="template-grid">
            {TEMPLATES.map(({ value, label, note, Icon }) => (
              <label key={value} className={`template ${template === value ? "is-on" : ""}`}>
                <span className="template-top">
                  <span className="template-icon" aria-hidden="true">
                    <Icon size={20} />
                  </span>
                  <input type="radio" name="template" checked={template === value} onChange={() => (setTemplate(value), setParent(""))} />
                </span>
                <strong>{label}</strong>
                <span className="hint">{note}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="field-row">
          {!existing && (
            <label className="field">
              Project name
              <input type="text" value={name} data-autofocus onChange={(event) => setName(event.target.value)} placeholder="teacher-survey" />
            </label>
          )}
          <div className="field">
            <span id="where-label">{existing ? "Folder" : "Location"}</span>
            <div className="path-row">
              <span className="path-box" aria-labelledby="where-label">
                {parent ? shortPath(parent) : "Not chosen yet"}
              </span>
              <button type="button" className="button" onClick={choose}>
                Choose
              </button>
            </div>
          </div>
        </div>
        <fieldset>
          <legend>Options</legend>
          <label className={`check ${git ? "" : "is-disabled"}`}>
            <input type="checkbox" checked={history} disabled={!git} onChange={(event) => setHistory(event.target.checked)} />
            <span>
              Keep a history of changes with Git
              <span className="hint">{git ? "Lets you see and undo past versions. Nothing is shared unless you connect GitHub later." : "Git is not installed on this computer, so this is not available."}</span>
            </span>
          </label>
          <label className="check">
            <input type="checkbox" checked={renv} onChange={(event) => setRenv(event.target.checked)} />
            <span>
              Record package versions
              <span className="hint">Uses renv, so the project runs the same way next year and on other computers. Installs renv first if needed.</span>
            </span>
          </label>
        </fieldset>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="dialog-foot">
        <span className="hint">{folderName ? `Creates ${folderName}.Rproj, which also opens in RStudio.` : "Creates a project file that also opens in RStudio."}</span>
        <button type="button" className="button" onClick={close}>
          Cancel
        </button>
        <button type="button" className="button primary" disabled={busy} onClick={create}>
          Create project
        </button>
      </div>
    </Modal>
  );
}

/**
 * Sizes people export to most. Journal widths follow the common single and
 * double column widths of 89 and 183 millimeters. Choosing one fills in the
 * size and the format that suits it, and every value can still be changed.
 */
const PLOT_PRESETS: { id: string; label: string; note: string; width: number; height: number; format: PlotFormat; dpi: number }[] = [
  { id: "slide", label: "Slide", note: "16:9, for PowerPoint, Keynote, or Google Slides", width: 10, height: 5.63, format: "png", dpi: 200 },
  { id: "page", label: "Document", note: "Fits a page in Word or Google Docs", width: 6.5, height: 4.5, format: "png", dpi: 300 },
  { id: "single", label: "Journal, one column", note: "89 mm wide, sharp at any zoom", width: 3.5, height: 3, format: "pdf", dpi: 300 },
  { id: "double", label: "Journal, two columns", note: "183 mm wide, sharp at any zoom", width: 7.2, height: 4.5, format: "pdf", dpi: 300 },
];

const FORMATS: { value: PlotFormat; label: string; note: string }[] = [
  { value: "png", label: "PNG", note: "Opens anywhere" },
  { value: "pdf", label: "PDF", note: "Sharp at any size" },
  { value: "svg", label: "SVG", note: "Sharp, and editable" },
];

/** Functions whose results change from run to run unless a seed is set. */
const RANDOM = /\b(rnorm|runif|rbinom|rpois|rexp|sample|jitter|geom_jitter|position_jitter)\s*\(/;

function ExportPlotDialog() {
  const plot = useStore((state) => state.plots[state.plotIndex]);
  const [preset, setPreset] = useState("slide");
  const [format, setFormat] = useState<PlotFormat>("png");
  const [width, setWidth] = useState(10);
  const [height, setHeight] = useState(5.63);
  const [dpi, setDpi] = useState(200);
  const [busy, setBusy] = useState(false);
  if (!plot) return null;

  const valid = width >= 0.5 && width <= 60 && height >= 0.5 && height <= 60;
  const mm = (inches: number) => Math.round(inches * 25.4);
  const random = RANDOM.test(plot.code) && !/set\.seed\s*\(/.test(plot.code);
  const firstLine = plot.code.trim().split("\n")[0] ?? "";

  function pick(id: string) {
    const chosen = PLOT_PRESETS.find((item) => item.id === id);
    setPreset(id);
    if (!chosen) return;
    setWidth(chosen.width);
    setHeight(chosen.height);
    setFormat(chosen.format);
    setDpi(chosen.dpi);
  }

  async function save() {
    setBusy(true);
    const done = await exportPlot({ format, width, height, dpi });
    setBusy(false);
    if (done) close();
  }

  return (
    <Modal title="Export plot" onClose={close} wide>
      <div className="dialog-body export-plot">
        <div className="export-grid">
          <div className="export-preview">
            {/* The frame takes the shape of the file, so a change of size
                shows at once. R lays the plot out again to fill it. */}
            <div className="export-frame" style={{ aspectRatio: `${Math.max(0.5, width)} / ${Math.max(0.5, height)}` }}>
              <img src={`data:image/png;base64,${plot.png}`} alt={`The plot from ${plot.label}`} />
            </div>
            <p className="hint">
              {width} by {height} inches ({mm(width)} by {mm(height)} mm)
              {format === "png" && valid && (
                <>
                  <br />
                  {Math.round(width * dpi).toLocaleString()} by {Math.round(height * dpi).toLocaleString()} pixels
                </>
              )}
            </p>
          </div>
          <div className="export-options">
            <fieldset>
              <legend>Size for</legend>
              <div className="preset-list">
                {PLOT_PRESETS.map((item) => (
                  <label key={item.id} className={`preset ${preset === item.id ? "is-on" : ""}`}>
                    <input type="radio" name="preset" checked={preset === item.id} onChange={() => pick(item.id)} />
                    <span>
                      <strong>{item.label}</strong>
                      <span className="hint">{item.note}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="field-row three">
              <label className="field">
                Width, inches
                <input type="number" min={0.5} max={60} step={0.1} value={width} onChange={(event) => (setWidth(Number(event.target.value)), setPreset("custom"))} />
              </label>
              <label className="field">
                Height, inches
                <input type="number" min={0.5} max={60} step={0.1} value={height} onChange={(event) => (setHeight(Number(event.target.value)), setPreset("custom"))} />
              </label>
              <label className="field">
                Resolution
                <select value={dpi} disabled={format !== "png"} onChange={(event) => setDpi(Number(event.target.value))}>
                  <option value={150}>150 dpi, screen</option>
                  <option value={200}>200 dpi, slides</option>
                  <option value={300}>300 dpi, print</option>
                  <option value={600}>600 dpi, line art</option>
                </select>
              </label>
            </div>
            <fieldset>
              <legend>Format</legend>
              <div className="segmented">
                {FORMATS.map((item) => (
                  <label key={item.value} className={format === item.value ? "is-on" : ""}>
                    <input type="radio" name="format" checked={format === item.value} onChange={() => setFormat(item.value)} />
                    <span>
                      <strong>{item.label}</strong>
                      <span className="hint">{item.note}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        </div>
        <p className="hint export-source">
          R draws the plot again from <code>{firstLine.length > 60 ? `${firstLine.slice(0, 60)}...` : firstLine}</code>, in {plot.label}. Nothing it assigns is kept.
        </p>
        {random && (
          <p className="form-note" role="note">
            This code uses random numbers and does not call set.seed(), so the exported plot shows a new sample rather than the one on screen.
          </p>
        )}
        {!valid && (
          <p className="form-error" role="alert">
            Width and height must each be between 0.5 and 60 inches.
          </p>
        )}
      </div>
      <div className="dialog-foot">
        <span className="hint">{format === "png" ? "PNG suits slides and documents." : "PDF and SVG suit journals and print."}</span>
        <button type="button" className="button" onClick={close}>
          Cancel
        </button>
        <button type="button" className="button primary" disabled={busy || !valid} onClick={save}>
          Export
        </button>
      </div>
    </Modal>
  );
}

type ReadOptions = Omit<ImportOptions, "path" | "format">;

const SEPARATORS: { value: ReadOptions["sep"]; label: string }[] = [
  { value: ",", label: "Comma" },
  { value: ";", label: "Semicolon" },
  { value: "\t", label: "Tab" },
  { value: " ", label: "Spaces" },
];

/** Sensible starting options for a file, from its extension. */
function startingOptions(file: string | null): ReadOptions {
  const format = file ? formatOf(file) : null;
  return {
    name: file ? objectName(file) : "",
    sep: file && /\.tsv$/i.test(file) ? "\t" : ",",
    header: true,
    dec: ".",
    na: format === "excel" ? "" : "NA",
    skip: 0,
    sheet: "",
  };
}

/**
 * Import Data, modeled on RStudio's Import Dataset: choose a file, see its
 * first rows as R reads them, adjust how it is read, and see the exact
 * code before it runs. The code runs in the console and can go into the
 * script, so the import is part of the analysis rather than a hidden
 * click. R reads the file; the app never opens it.
 */
function ImportDataDialog() {
  const initial = useStore((state) => state.importFile);
  const workingDir = useStore((state) => state.r.workingDir);
  const hasScript = useStore((state) => state.tabs.some((tab) => tab.kind !== "data"));
  const [file, setFile] = useState<string | null>(initial);
  const [options, setOptions] = useState<ReadOptions>(() => startingOptions(initial));
  const [preview, setPreview] = useState<DataPreview | null>(null);
  const [sheets, setSheets] = useState<string[]>([]);
  const [needs, setNeeds] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [toScript, setToScript] = useState(hasScript);
  const [view, setView] = useState(true);
  const format = file ? formatOf(file) : null;
  const full: ImportOptions | null = file && format ? { ...options, path: pathForCode(file, workingDir), format } : null;
  const code = full ? importCode(full) : "";
  const previewKey = full && !needs ? previewCode(full) : "";
  const set = (patch: Partial<ReadOptions>) => setOptions((current) => ({ ...current, ...patch }));
  const nameValid = format === "rdata" || isValidName(options.name);

  // Formats outside base R need a package. Its absence is shown before
  // anything is read, with a button to install it.
  useEffect(() => {
    const needed = format ? FORMAT_PACKAGE[format] : undefined;
    if (!needed) return setNeeds(null);
    let current = true;
    hasPackage(needed).then((present) => current && setNeeds(present ? null : needed));
    return () => {
      current = false;
    };
  }, [format]);

  // While a package installs, the dialog checks for it every few seconds
  // and carries on by itself when it arrives.
  useEffect(() => {
    if (!installing || !needs) return;
    const timer = setInterval(() => {
      hasPackage(needs).then((present) => {
        if (!present) return;
        setNeeds(null);
        setInstalling(false);
      });
    }, 2500);
    return () => clearInterval(timer);
  }, [installing, needs]);

  // For a text file, R reads the first few lines so the dialog can guess
  // the separator and decimal mark, as RStudio's importer does. The guess
  // shows in the options and can be changed.
  useEffect(() => {
    if (format !== "text" || !file) return;
    let current = true;
    previewData(firstLinesCode(pathForCode(file, workingDir))).then((result) => {
      const lines = result.rows?.map((row) => row[0]) ?? [];
      if (current && lines.length) set(guessLayout(lines));
    });
    return () => {
      current = false;
    };
  }, [file, format]);

  // A workbook's sheets are listed once per file, not on every option.
  useEffect(() => {
    if (format !== "excel" || needs || !full) return setSheets([]);
    previewData(sheetsCode(full.path)).then((result) => setSheets(result.rows?.map((row) => row[0]) ?? []));
  }, [file, format, needs]);

  // The preview follows each change of option, after a short pause, so
  // typing in a field does not read the file once per keystroke.
  useEffect(() => {
    if (!previewKey) return setPreview(null);
    let current = true;
    setPreview(null);
    const timer = setTimeout(() => previewData(previewKey).then((result) => current && setPreview(result)), 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [previewKey]);

  async function choose() {
    const picked = await chooseDataFile();
    if (!picked) return;
    setFile(picked);
    setOptions(startingOptions(picked));
  }

  async function copy() {
    await navigator.clipboard.writeText(code).catch(() => {});
  }

  return (
    <Modal title="Import data" onClose={close} wide className="import-dialog">
      <div className="dialog-body import-data">
        <div className="field">
          <span id="import-file-label">File</span>
          <div className="path-row">
            <span className="path-box" aria-labelledby="import-file-label">
              {file ? shortPath(file) : "Not chosen yet"}
            </span>
            <button type="button" className="button" data-autofocus={file ? undefined : true} onClick={choose}>
              Choose
            </button>
          </div>
        </div>
        {file && !format && (
          <p className="form-error" role="alert">
            This file type cannot be imported here. Choose a CSV, text, Excel, SPSS, Stata, SAS, R data, Parquet, Feather, or JSON file.
          </p>
        )}
        {format && (
          <div className="import-grid">
            <div className="import-options">
              <p className="hint">Read as: {FORMAT_NAMES[format]}</p>
              {format !== "rdata" && (
                <label className="field">
                  Name in R
                  <input type="text" value={options.name} spellCheck={false} data-autofocus={file ? true : undefined} onChange={(event) => set({ name: event.target.value })} aria-invalid={!nameValid} />
                </label>
              )}
              {!nameValid && (
                <p className="form-error" role="alert">
                  Use letters, numbers, dots, and underscores, starting with a letter.
                </p>
              )}
              {format === "text" && (
                <>
                  <fieldset>
                    <legend>Columns are separated by</legend>
                    <div className="segmented four">
                      {SEPARATORS.map((item) => (
                        <label key={item.label} className={options.sep === item.value ? "is-on" : ""}>
                          <input type="radio" name="sep" checked={options.sep === item.value} onChange={() => set({ sep: item.value })} />
                          <span>{item.label}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <label className="check">
                    <input type="checkbox" checked={options.header} onChange={(event) => set({ header: event.target.checked })} />
                    <span>The first row holds column names</span>
                  </label>
                  <fieldset>
                    <legend>Decimal mark</legend>
                    <div className="segmented two">
                      {(["." , ","] as const).map((mark) => (
                        <label key={mark} className={options.dec === mark ? "is-on" : ""}>
                          <input type="radio" name="dec" checked={options.dec === mark} onChange={() => set({ dec: mark })} />
                          <span>{mark === "." ? "Period, 1.5" : "Comma, 1,5"}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </>
              )}
              {format === "excel" && sheets.length > 0 && (
                <label className="field">
                  Sheet
                  <select value={options.sheet} onChange={(event) => set({ sheet: event.target.value })}>
                    <option value="">The first sheet</option>
                    {sheets.map((sheet) => (
                      <option key={sheet} value={sheet}>
                        {sheet}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {(format === "text" || format === "excel") && (
                <div className="field-row">
                  <label className="field">
                    Missing values are written as
                    <input type="text" value={options.na} spellCheck={false} placeholder="Blank cells" onChange={(event) => set({ na: event.target.value })} />
                  </label>
                  <label className="field narrow">
                    Lines to skip
                    <input type="number" min={0} value={options.skip} onChange={(event) => set({ skip: Math.max(0, Math.floor(Number(event.target.value) || 0)) })} />
                  </label>
                </div>
              )}
            </div>
            <div className="import-preview" aria-live="polite">
              <h3>Preview</h3>
              {needs && (
                <div className="form-note">
                  <p>Reading this file uses the {needs} package, which is not installed yet.</p>
                  <button
                    type="button"
                    className="button primary"
                    disabled={installing}
                    onClick={() => {
                      setInstalling(true);
                      installPackages([needs]);
                    }}
                  >
                    {installing ? `Installing ${needs}` : `Install ${needs}`}
                  </button>
                </div>
              )}
              {!needs && !preview && <p className="muted">R is reading the first rows</p>}
              {preview?.error && (
                <p className="form-error">
                  R could not read the file this way: {preview.error}
                </p>
              )}
              {preview?.columns && preview.rows && (
                <div className="preview-wrap" tabIndex={0} aria-label="Preview of the first rows">
                  <table className="preview-table">
                    <thead>
                      <tr>
                        {preview.columns.map((column, index) => (
                          <th key={`${column.name}-${index}`} scope="col">
                            <code>{column.name}</code> <span className="type-badge">{column.type}</span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((row, index) => (
                        <tr key={index}>
                          {row.map((value, column) => (
                            <td key={column} className={value === "NA" ? "is-na" : ""}>
                              {value}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {preview?.rows && <p className="hint">The first {preview.rows.length} rows, as R reads them with these choices.</p>}
            {code && (
              <div className="import-code">
                <div className="import-code-head">
                  <span id="import-code-label">Code</span>
                  <button type="button" className="button small quiet" onClick={copy}>
                    Copy code
                  </button>
                </div>
                <pre aria-labelledby="import-code-label">{code}</pre>
                <label className="check">
                  <input type="checkbox" checked={toScript} onChange={(event) => setToScript(event.target.checked)} />
                  <span>
                    Add this code to the script
                    <span className="hint">So the import runs again with the rest of the analysis.</span>
                  </span>
                </label>
                {format !== "rdata" && (
                  <label className="check">
                    <input type="checkbox" checked={view} onChange={(event) => setView(event.target.checked)} />
                    <span>Open the data in the data viewer</span>
                  </label>
                )}
              </div>
            )}
            </div>
          </div>
        )}
      </div>
      <div className="dialog-foot">
        <span className="hint">The code runs in the console, where you can see it.</span>
        <button type="button" className="button" onClick={close}>
          Cancel
        </button>
        <button
          type="button"
          className="button primary"
          disabled={!full || !nameValid || Boolean(needs)}
          onClick={() => {
            runImport(code, format === "rdata" ? "" : options.name, toScript, view);
            close();
          }}
        >
          Import
        </button>
      </div>
    </Modal>
  );
}

function ChooseRDialog() {
  const installs = useStore((state) => state.installs);
  const current = useStore((state) => state.settings.rHome);
  const [choice, setChoice] = useState(current || installs[0]?.home || "");
  return (
    <Modal title="Choose which R to use" onClose={close}>
      <div className="dialog-body">
        {installs.length > 1 && (
          <p className="hint">The app found {installs.length} installations by looking in the standard install folders. It did not read anything else on this computer. The newest is listed first.</p>
        )}
        {installs.length === 0 && <p>No R installation was found. R is free from CRAN.</p>}
        <div className="choices">
          {installs.map((install, index) => (
            <Radio key={install.home} name="r-home" value={install.home} current={choice} onChange={setChoice}>
              <span className="r-choice">
                <strong>
                  R {install.version} {index === 0 && <span className="tag">Newest</span>}
                </strong>
                <code className="small-code">{install.home}</code>
                <span className="hint">{isSupportedR(install.version) ? install.source : `${install.source}. Too old for this app, which needs R ${OLDEST_R} or later`}</span>
              </span>
            </Radio>
          ))}
        </div>
        <p className="hint">You can change this later in Settings. Changing it restarts R.</p>
      </div>
      <div className="dialog-foot">
        {installs.length === 0 ? (
          <button type="button" className="button primary" onClick={() => openUrl("cran")}>
            Get R from CRAN
          </button>
        ) : (
          <>
            <button type="button" className="button" onClick={close}>
              Cancel
            </button>
            <button type="button" className="button primary" disabled={!choice} onClick={() => chooseR(choice)}>
              Use this R
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}

function InstallDialog() {
  const [names, setNames] = useState("");
  const list = names.split(/[\s,]+/).filter(Boolean);
  return (
    <Modal title="Install packages" onClose={close}>
      <div className="dialog-body">
        <label className="field">
          Package names
          <input data-autofocus value={names} placeholder="gt dplyr" spellCheck={false} onChange={(event) => setNames(event.target.value)} />
        </label>
        <p className="hint">Separate names with spaces or commas. Progress appears in the console.</p>
      </div>
      <div className="dialog-foot">
        <button type="button" className="button" onClick={close}>
          Cancel
        </button>
        <button
          type="button"
          className="button primary"
          disabled={!list.length}
          onClick={() => {
            installPackages(list);
            close();
          }}
        >
          Install
        </button>
      </div>
    </Modal>
  );
}

function AboutDialog() {
  const info = useStore((state) => state.info);
  return (
    <Modal title="R: What Is It Good For?" onClose={close}>
      <div className="dialog-body about">
        <img src="/icon.svg" alt="" width="72" height="72" />
        <p>
          Version {info?.version}. Runs R through the ark kernel, version {info?.arkVersion}.
        </p>
        <p>
          Released under the PolyForm Noncommercial License 1.0.0. Copyright 2026 Abhik Roy.
        </p>
        <p className="hint">Includes ark by Posit Software, PBC, under the MIT License. Its license and notice are bundled with the app.</p>
        <p className="hint">No telemetry, no accounts. Your code and data stay on this computer.</p>
      </div>
      <div className="dialog-foot">
        <button type="button" className="button" onClick={() => openUrl("issues")}>
          Report a problem
        </button>
        <button type="button" className="button primary" onClick={() => openUrl("releases")}>
          Latest release
        </button>
      </div>
    </Modal>
  );
}

function CommandPalette() {
  const layer = useStore((state) => state.settings.layer);
  const initialQuery = useStore((state) => state.ui.paletteQuery);
  const [query, setQuery] = useState(initialQuery);
  const [selected, setSelected] = useState(0);
  const results = useMemo(() => searchCommands(visibleCommands(layer), query), [layer, query]);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => setSelected(0), [query]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  function run(id: string) {
    togglePalette();
    // The palette closes first so a command that opens a dialog gets focus.
    setTimeout(() => runCommand(id), 0);
  }

  return (
    <Modal title="Commands" onClose={() => togglePalette()} labelledBy="palette-title">
      <div className="palette">
        <label className="palette-search">
          <SearchIcon size={16} />
          <span className="visually-hidden">Search commands</span>
          <input
            data-autofocus
            value={query}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={results[selected] ? `cmd-${results[selected].id}` : undefined}
            placeholder="Type a command"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSelected((index) => Math.min(results.length - 1, index + 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelected((index) => Math.max(0, index - 1));
              } else if (event.key === "Enter" && results[selected]) {
                event.preventDefault();
                run(results[selected].id);
              }
            }}
          />
        </label>
        <ul id="palette-list" role="listbox" aria-label="Matching commands" ref={list}>
          {results.map((command, index) => (
            <li
              key={command.id}
              id={`cmd-${command.id}`}
              role="option"
              aria-selected={index === selected}
              data-index={index}
              className={index === selected ? "is-selected" : ""}
              onMouseEnter={() => setSelected(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                run(command.id);
              }}
            >
              <span>{command.title}</span>
              <span className="hint">{command.section}</span>
              {command.keys && <kbd>{keyLabel(command.keys)}</kbd>}
            </li>
          ))}
          {results.length === 0 && <li className="muted palette-empty">No command matches. Try a shorter word.</li>}
        </ul>
        <p className="hint palette-foot">
          {getState().settings.layer === "essentials" ? "Showing the Essentials commands. Switch to Everything in Settings for more." : "Showing every command."}
        </p>
      </div>
    </Modal>
  );
}
