// Dialogs and the command palette. All of them share one modal frame that
// moves focus in when it opens, keeps Tab inside it, closes on Escape, and
// returns focus to where it was.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isDefaultLayout, resetApp, resetLayout, resetSettings, openHelp, chooseDataFile, chooseProjectFolder, chooseR, createDocument, createProject, exportPlot, hasPackage, previewData, runImport, installPackages, openDialog, openUrl, runCommand, setOutputLayout, shortPath, togglePalette, updateSettings, baseName, insertSnippetById } from "../lib/app";
import { documentFileName, type DocumentFormat, type DocumentKind } from "../lib/chunks";
import { explainApp, exportApp, previewExport, revealExport, stopExport } from "../lib/shiny";
import { COMMANDS, keyLabel, searchCommands, searchSnippets, visibleCommands } from "../lib/commands";
import { SNIPPETS } from "../lib/snippets";
import { isSupportedR, OLDEST_R } from "../lib/rversion";
import { getState, setState, useStore } from "../lib/store";
import { FORMAT_NAMES, FORMAT_PACKAGE, firstLinesCode, formatOf, guessLayout, importCode, isValidName, objectName, pathForCode, previewCode, sheetsCode, type ImportOptions } from "../lib/importData";
import type { Appearance, PdfEngine, CodeFont, DataPreview, LineSpacing, OutputLayout, PaletteName, PlotFormat, ProjectTemplate } from "../lib/types";
import { CODE_FONTS, resolveMode } from "../theme/theme";
import tokens from "../theme/tokens.json";
import { AssistantSetupDialog } from "./AssistantSetup";
import { LatexPanel } from "./LatexPanel";
import { UpdatesPane } from "./UpdatesPane";
import { trapTab } from "./focus";
import { AskOnlineDialog, FileHistoryDialog, FixProblemsDialog, CiteDialog, FindInFilesDialog, RenameDialog, TraceDialog } from "./EditingDialogs";
import { AppWindowIcon, ChartIcon, CheckIcon, CloseIcon, FolderIcon, ReportIcon, SearchIcon, TriangleIcon, WarnIcon } from "./Icons";

export function Modal({ title, onClose, children, wide = false, labelledBy, className = "" }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; labelledBy?: string; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  // The latest close action, read when a key is pressed. Callers often pass
  // a new function on every render, and setting up focus again each time
  // would bounce focus out of the dialog and back with every keystroke.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
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
        closeRef.current();
      }
      if (box.current) trapTab(box.current, event);
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, []);
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
      {dialog === "newDocument" && <NewDocumentDialog />}
      {dialog === "shareApp" && <ShareAppDialog />}
      {dialog === "exportPlot" && <ExportPlotDialog />}
      {dialog === "importData" && <ImportDataDialog />}
      {dialog === "assistantSetup" && <AssistantSetupDialog />}
      {dialog === "rename" && <RenameDialog />}
      {dialog === "findInFiles" && <FindInFilesDialog />}
      {dialog === "cite" && <CiteDialog />}
      {dialog === "trace" && <TraceDialog />}
      {dialog === "askOnline" && <AskOnlineDialog />}
      {dialog === "fixProblems" && <FixProblemsDialog />}
      {dialog === "fileHistory" && <FileHistoryDialog />}
      {dialog === "resetApp" && <ResetAppDialog />}
      {palette && <CommandPalette />}
    </>
  );
}

export function Radio<T extends string>({ name, value, current, onChange, children }: { name: string; value: T; current: T; onChange: (value: T) => void; children: ReactNode }) {
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

type Pane = "appearance" | "layout" | "code" | "editor" | "results" | "reports" | "accessibility" | "r" | "updates" | "menus";

const PANES: { id: Pane; label: string }[] = [
  { id: "appearance", label: "Appearance" },
  { id: "layout", label: "Layout" },
  { id: "code", label: "Code text" },
  { id: "editor", label: "Editor" },
  { id: "results", label: "Results" },
  { id: "reports", label: "Reports" },
  { id: "accessibility", label: "Accessibility" },
  { id: "r", label: "R and packages" },
  { id: "updates", label: "Updates" },
  { id: "menus", label: "Menus" },
];

/**
 * Settings follow the macOS pattern of panes named for a task, with
 * accessibility as a pane of its own rather than a buried checkbox. Every
 * change applies at once, so there is nothing to save.
 */
function SettingsDialog() {
  const [pane, setPane] = useState<Pane>("appearance");
  // Opens on the pane something asked for, such as Check for Updates, even
  // when Settings is already open, and then forgets the request.
  const asked = useStore((state) => state.ui.settingsPane) as Pane | null;
  useEffect(() => {
    if (!asked) return;
    if (PANES.some((item) => item.id === asked)) setPane(asked);
    setState((state) => ({ ui: { ...state.ui, settingsPane: null } }));
  }, [asked]);
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
          {pane === "layout" && <LayoutPane />}
          {pane === "code" && <CodePane />}
          {pane === "editor" && <EditorPrefsPane />}
          {pane === "results" && <ResultsPane />}
          {pane === "reports" && <ReportsPane />}
          {pane === "accessibility" && <AccessibilityPane />}
          {pane === "r" && <RPane />}
          {pane === "updates" && <UpdatesPane />}
          {pane === "menus" && <MenusPane />}
        </div>
      </div>
      {/* Resetting is kept apart from the choices, at the foot, and asks
          first, so it is found when wanted and never pressed by accident. */}
      <div className="dialog-foot settings-foot">
        <button type="button" className="button quiet" onClick={() => openDialog("resetApp")}>
          Reset the app
        </button>
        <button type="button" className="button" onClick={() => resetSettings(pane)}>
          Reset {PANES.find((item) => item.id === pane)?.label.replace(/^[A-Z](?=[a-z])/, (letter) => letter.toLowerCase())}
        </button>
      </div>
    </Modal>
  );
}

type Part = "showSidebar" | "showPrompt" | "showCanvas" | "showTimeline";
const PARTS: { key: Part; label: string; note: string }[] = [
  { key: "showSidebar", label: "Project sidebar", note: "The scripts and data in a project, down the left" },
  { key: "showPrompt", label: "R prompt", note: "The box under the script for quick commands" },
  { key: "showCanvas", label: "Canvas", note: "Results, plots, and your objects, on the right" },
  { key: "showTimeline", label: "Earlier results", note: "The strip of past results under the canvas" },
];

/** A part of the window in the picture, as a switch: pressing it shows or
 * hides that part, and its label says which it is and whether it is on. */
function PartTile({ part, className }: { part: (typeof PARTS)[number]; className: string }) {
  const on = useStore((state) => state.settings[part.key]);
  return (
    <button type="button" role="switch" aria-checked={on} aria-describedby={`note-${part.key}`} className={`layout-tile ${className} ${on ? "is-on" : ""}`} onClick={() => updateSettings({ [part.key]: !on })}>
      <span className="layout-tile-name">{part.label}</span>
      <span className="layout-tile-state" aria-hidden="true">
        {on ? "Shown" : "Hidden"}
      </span>
    </button>
  );
}

/** The window as a picture, each part a switch, with the way back to the
 * standard layout under it. The script is always there, so it is shown
 * but is not a switch. */
function LayoutPane() {
  const settings = useStore((state) => state.settings);
  const standard = isDefaultLayout(settings);
  return (
    <>
      <fieldset>
        <legend>Parts of the window</legend>
        <p className="hint">Press a part to hide it, and again to bring it back. Edges between parts can also be dragged to resize them.</p>
        <div className="layout-map">
          <PartTile part={PARTS[0]} className="layout-sidebar-part" />
          <div className="layout-tile layout-script-part is-fixed" aria-hidden="true">
            <span className="layout-tile-name">Script</span>
          </div>
          <PartTile part={PARTS[1]} className="layout-prompt-part" />
          <PartTile part={PARTS[2]} className="layout-canvas-part" />
          <PartTile part={PARTS[3]} className="layout-timeline-part" />
        </div>
        <ul className="layout-notes">
          {PARTS.map((part) => (
            <li key={part.key} id={`note-${part.key}`}>
              <strong>{part.label}</strong>: {part.note}
            </li>
          ))}
        </ul>
      </fieldset>
      <fieldset>
        <legend>Standard layout</legend>
        <p className="hint">{standard ? "The window is laid out as it was when the app was new." : "Shows every part again, at the size it started at."}</p>
        <div>
          <button type="button" className="button" disabled={standard} onClick={resetLayout}>
            Go back to the standard layout
          </button>
        </div>
      </fieldset>
    </>
  );
}

const APPEARANCE_NAMES: Record<Appearance, string> = { system: "Match the system", light: "Light", dark: "Dark", paper: "Paper" };

function AppearancePane() {
  const settings = useStore((state) => state.settings);
  return (
    <>
      <fieldset>
        <legend>Appearance</legend>
        <div className="choices row">
          {(["system", "light", "dark", "paper"] as Appearance[]).map((value) => (
            <Radio key={value} name="appearance" value={value} current={settings.appearance} onChange={(appearance) => updateSettings({ appearance })}>
              {APPEARANCE_NAMES[value]}
            </Radio>
          ))}
        </div>
        <p className="hint">
          Match the system switches between light and dark with your computer. Dark is a full theme of its own, not just the colors flipped. Paper is a warm, softer page for long
          stretches of reading.
        </p>
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
      <fieldset>
        <legend>Space</legend>
        <div className="checks">
          <label className="check">
            <input type="checkbox" checked={settings.compact} onChange={(event) => updateSettings({ compact: event.target.checked })} />
            <span>
              Compact
              <span className="hint">Less space around panes and lists, for a small screen. Buttons stay just as easy to click.</span>
            </span>
          </label>
          <label className="check">
            <input type="checkbox" checked={settings.readingWidth} onChange={(event) => updateSettings({ readingWidth: event.target.checked })} />
            <span>
              Comfortable line length for documents
              <span className="hint">The text of a Quarto or R Markdown document wraps at about 80 characters, however wide the window is. Scripts are not affected.</span>
            </span>
          </label>
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
 * console, and every result. A sample shows each change before the user
 * goes back to their own code, so trying a setting costs nothing.
 */
function CodePane() {
  const settings = useStore((state) => state.settings);
  const font = CODE_FONTS[settings.codeFont] ?? CODE_FONTS["dm-mono"];
  return (
    <>
      <pre className="code-sample" aria-label="Sample of code in the chosen typeface">
        {/* The comment line is styled as the editor styles comments, so the
            script italic shows here when it is chosen. */}
        <span className="sample-comment">{CODE_SAMPLE.split("\n")[0]}</span>
        {"\n" + CODE_SAMPLE.split("\n").slice(1).join("\n")}
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
        {font.note && <p className="hint">{font.note}</p>}
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
          {font.ligatures ? "Draw symbols such as <- and != as single shapes" : `${font.label} has no joined symbols. Fira Code, JetBrains Mono, Cascadia Code, and Iosevka do.`}
        </label>
      </fieldset>
      <fieldset>
        <legend>Comments</legend>
        <label className="check">
          <input type="checkbox" checked={Boolean(font.comments) || settings.scriptItalics} disabled={Boolean(font.comments)} onChange={(event) => updateSettings({ scriptItalics: event.target.checked })} />
          <span>
            Write comments in a script italic
            <span className="hint">
              {font.comments ? `${font.label} sets its own face for comments.` : "Comments take the flowing italic of Victor Mono, beside whichever typeface the code uses, so notes stand apart from code at a glance."}
            </span>
          </span>
        </label>
      </fieldset>
    </>
  );
}

/** How the script editor behaves as you type and read. */
function EditorPrefsPane() {
  const settings = useStore((state) => state.settings);
  const toggle = (key: "lineNumbers" | "highlightLine" | "wrapLines" | "closeBrackets" | "rainbowBrackets" | "autosave" | "hints" | "formatOnType", label: string, hint: string) => (
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
        <div className="checks">
          {toggle("closeBrackets", "Close brackets and quotes", "Typing ( adds the ) after the cursor")}
          {toggle(
            "formatOnType",
            "Tidy each line as you finish it",
            "Return adds spaces around <- and other operators and after commas, the way the tidyverse lays out code. Text in quotes and comments is never changed, and Undo puts a line back.",
          )}
        </div>
      </fieldset>
      <fieldset>
        <legend>Suggestions</legend>
        <div className="checks">
          {toggle(
            "hints",
            "Point out habits that cause trouble later",
            "A dotted line under code such as T for TRUE or 1:length(x). Rest the pointer on it to see why, and change it with one click. It never stops code from running.",
          )}
        </div>
      </fieldset>
      <fieldset>
        <legend>Saving</legend>
        <div className="checks">
          {toggle(
            "autosave",
            "Save files automatically",
            "A moment after you stop typing. Either way, unsaved changes are kept safe and come back if the app closes unexpectedly.",
          )}
        </div>
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
  { value: "canvas", label: "In the canvas", note: "Beside the script, in one feed with plots at full width" },
  { value: "inline", label: "Under each line", note: "Each result right below the code that made it, plots as small copies" },
];

/** Where results appear, how they look, and how copying treats them. */
function ResultsPane() {
  const settings = useStore((state) => state.settings);
  return (
    <>
      <fieldset>
        <legend>Where results appear</legend>
        <div className="choices stack">
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
      <fieldset>
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
      <fieldset>
        <legend>Keeping and styling</legend>
        <div className="checks">
          <label className="check">
            <input type="checkbox" checked={settings.keepResults} onChange={(event) => updateSettings({ keepResults: event.target.checked })} />
            <span>
              Keep results for next time
              <span className="hint">They come back when the app opens, marked as from last time. The objects behind them do not, so run the script again to work with them.</span>
            </span>
          </label>
          <label className="check">
            <input type="checkbox" checked={settings.plotStyle} onChange={(event) => updateSettings({ plotStyle: event.target.checked })} />
            <span>
              Plots match the app
              <span className="hint">New plots use the page, text, and grid colors of the app, light or dark to match, for base R plots and ggplot2 alike.</span>
            </span>
          </label>
        </div>
      </fieldset>
    </>
  );
}

function AccessibilityPane() {
  const settings = useStore((state) => state.settings);
  // Read from the appearance setting, so the swatches follow it as it changes.
  const appearance = useStore((state) => state.settings.appearance);
  const mode = resolveMode(appearance) === "dark" ? "dark" : "light";
  return (
    <>
      <fieldset>
        <legend>Color vision palette</legend>
        <p className="hint">Changes the colors of the app, your code, and new plots. Every palette meets the WCAG 2.2 AA standard for easy reading, and shapes tell things apart as well as color.</p>
        <div className="choices stack">
          {PALETTES.map((item) => {
            const colors = tokens.palettes[item.value][mode as "light" | "dark"];
            return (
              <Radio key={item.value} name="palette" value={item.value} current={settings.palette} onChange={(palette) => updateSettings({ palette })}>
                <span className="swatches" aria-hidden="true">
                  {[("accent" in colors ? colors.accent : tokens.modes[mode as "light" | "dark"].accent), colors.ok, colors.warn, colors.danger].map((color) => (
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
        {/* The palette changes the app's accent, the colors of status, and
            the colors of code. This shows them as they are now, so a change
            is seen at once. */}
        <div className="palette-preview" role="group" aria-label="How the palette looks now">
          <p className="palette-status">
            <span className="palette-accent">Button</span>
            <span className="palette-link">A link</span>
            <span className="tone-ok">
              <CheckIcon size={15} label="" /> Ran
            </span>
            <span className="tone-warn">
              <WarnIcon size={15} /> Warning
            </span>
            <span className="tone-danger">
              <TriangleIcon size={15} label="" /> Did not run
            </span>
          </p>
          <pre className="palette-code">
            <span className="syn-comment"># Mean brightness</span>
            {"\n"}
            <span className="syn-function">mean</span>(x, na.rm = <span className="syn-number">TRUE</span>) <span className="syn-keyword">|&gt;</span> <span className="syn-function">round</span>(
            <span className="syn-number">1</span>){"\n"}label &lt;- <span className="syn-string">"magnitude"</span>
          </pre>
        </div>
      </fieldset>
      <fieldset>
        <legend>Motion</legend>
        <label className="check">
          <input type="checkbox" checked={settings.reduceMotion} onChange={(event) => updateSettings({ reduceMotion: event.target.checked })} />
          Reduce motion. If your computer is set to reduce motion, the app follows that too.
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
      <fieldset>
        <legend>Installing and updating</legend>
        <label className="check">
          <input type="checkbox" checked={settings.showPackageLog} onChange={(event) => updateSettings({ showPackageLog: event.target.checked })} />
          <span>
            Show what R prints while it installs
            <span className="hint">Instead of a list of packages with a progress bar, show R&#8217;s own messages, line by line. Either way, the other is one click away.</span>
          </span>
        </label>
      </fieldset>
      <fieldset>
        <legend>Undo for runs</legend>
        <label className="check">
          <input type="checkbox" checked={settings.undoRuns} onChange={(event) => updateSettings({ undoRuns: event.target.checked })} />
          <span>
            Let the last run be undone
            <span className="hint">
              R keeps the objects as they were before each run. That costs almost nothing, except while a run changes a very large table, which is then held twice until the next
              run.
            </span>
          </span>
        </label>
      </fieldset>
    </>
  );
}

const PDF_ENGINES: { value: PdfEngine; label: string; hint: string }[] = [
  { value: "auto", label: "Choose for me", hint: "LaTeX when there is one on this computer, and Typst when there is not" },
  { value: "latex", label: "LaTeX", hint: "What journals and many templates expect, and the only one that reads LaTeX commands in a document" },
  { value: "typst", label: "Typst", hint: "Fast, and nothing more to install, since it comes with Quarto" },
];

/** How reports are made: which program makes a PDF, the LaTeX to use,
 * and whether a report renders again when saved. */
function ReportsPane() {
  const settings = useStore((state) => state.settings);
  return (
    <>
      <fieldset>
        <legend>Making a PDF</legend>
        <div className="choices stack">
          {PDF_ENGINES.map((item) => (
            <Radio key={item.value} name="pdf-engine" value={item.value} current={settings.pdfEngine} onChange={(pdfEngine) => updateSettings({ pdfEngine })}>
              <span>
                {item.label}
                <span className="hint">{item.hint}</span>
              </span>
            </Radio>
          ))}
        </div>
        <p className="hint">This is for Render as PDF. A document whose own header asks for a LaTeX PDF always uses LaTeX.</p>
      </fieldset>
      <fieldset>
        <legend>LaTeX</legend>
        <LatexPanel />
      </fieldset>
      <fieldset>
        <legend>After saving</legend>
        <label className="check">
          <input type="checkbox" checked={settings.renderOnSave} onChange={(event) => updateSettings({ renderOnSave: event.target.checked })} />
          <span>
            Render a report again each time it is saved
            <span className="hint">Once it has been rendered, so the preview keeps up with your writing</span>
          </span>
        </label>
      </fieldset>
    </>
  );
}

function MenusPane() {
  const settings = useStore((state) => state.settings);
  return (
    <fieldset>
      <legend>Menus</legend>
      <p className="hint">Hiding the advanced tools at first makes R easier to learn. You can switch any time.</p>
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
      {/* Saying exactly what Everything adds, read from the command list,
          so the choice is not a guess. */}
      <p className="hint">Everything adds these to the menus and the search, and changes nothing else:</p>
      <ul className="menus-extra">
        {COMMANDS.filter((command) => command.advanced).map((command) => (
          <li key={command.id}>{command.title}</li>
        ))}
      </ul>
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
 * A project is a folder with an .Rproj file, the same one RStudio uses.
 * Each template starts with code that runs on the first click.
 */
function NewProjectDialog() {
  const git = useStore((state) => state.info?.git ?? false);
  const [template, setTemplate] = useState<ProjectTemplate>(getState().ui.newProjectTemplate);
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
        <p className="hint">A project keeps your code, data, and output together in one folder, and reopens where you left off. This app opens only the scripts in it.</p>
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

const DOCUMENT_KINDS: { value: DocumentKind; label: string; note: string }[] = [
  { value: "quarto", label: "Quarto", note: "The newer format. It makes PDFs without needing LaTeX, and can make books, slides, and websites too." },
  { value: "rmarkdown", label: "R Markdown", note: "The older format, used by many courses and journals. Saved as a .Rmd file." },
];

const DOCUMENT_FORMATS: { value: DocumentFormat; label: string; note: string }[] = [
  { value: "html", label: "Web page", note: "HTML, previewed beside the code" },
  { value: "word", label: "Word", note: "A .docx file to edit or send" },
  { value: "pdf", label: "PDF", note: "For printing and submitting" },
];

/**
 * A new document starts with a header and two example chunks, so it
 * renders straight away. Only three choices are asked here; the rest can
 * be changed later in the header.
 */
function NewDocumentDialog() {
  const [kind, setKind] = useState<DocumentKind>("quarto");
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [format, setFormat] = useState<DocumentFormat>("html");
  const pdfNote = kind === "rmarkdown" && format === "pdf" ? "R Markdown needs LaTeX, a large extra program, to make a PDF. To skip it, choose Render as PDF from the Render menu, which uses Quarto instead." : "";
  return (
    <Modal title="New document" onClose={close} wide>
      <form
        className="dialog-form"
        aria-label="New document"
        onSubmit={(event) => {
          event.preventDefault();
          createDocument(kind, title, author, format);
        }}
      >
        <div className="dialog-body new-project">
          <p className="hint">A document mixes writing with R code. When it renders, each chunk of code runs and its results appear in the finished report.</p>
          <fieldset>
            <legend>Kind</legend>
            <div className="template-grid two">
              {DOCUMENT_KINDS.map((item) => (
                <label key={item.value} className={`template ${kind === item.value ? "is-on" : ""}`}>
                  <span className="template-top">
                    <span className="template-icon" aria-hidden="true">
                      <ReportIcon size={20} />
                    </span>
                    <input type="radio" name="document-kind" checked={kind === item.value} onChange={() => setKind(item.value)} />
                  </span>
                  <strong>{item.label}</strong>
                  <span className="hint">{item.note}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="field-row">
            <label className="field">
              Title
              <input type="text" value={title} data-autofocus onChange={(event) => setTitle(event.target.value)} placeholder="Penguin measurements" />
            </label>
            <label className="field">
              <span>
                Author <span className="muted field-optional">(optional)</span>
              </span>
              <input type="text" value={author} onChange={(event) => setAuthor(event.target.value)} />
            </label>
          </div>
          <fieldset>
            <legend>Renders to</legend>
            <div className="choices row">
              {DOCUMENT_FORMATS.map((item) => (
                <Radio key={item.value} name="document-format" value={item.value} current={format} onChange={setFormat}>
                  <span>
                    <strong>{item.label}</strong>
                    <span className="hint">{item.note}</span>
                  </span>
                </Radio>
              ))}
            </div>
            {pdfNote && <p className="hint">{pdfNote}</p>}
          </fieldset>
        </div>
        <div className="dialog-foot">
          <span className="hint">Saved as {documentFileName(kind, title)} when you first save or render it.</span>
          <button type="button" className="button" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="button primary">
            Create document
          </button>
        </div>
      </form>
    </Modal>
  );
}

// Files that are code or page parts rather than data. Anything else in an
// app's folder is likely data, which the dialog points out before sharing.
const CODE_FILE = /\.(R|r|js|css|html|md|qmd|Rmd|svg|png|jpg|jpeg|gif|ico|woff2?|ttf)$/;

/**
 * Sharing an app as a web page that runs R in the browser, made with
 * shinylive, so whoever opens it needs nothing installed. Before anything
 * is made, the dialog lists every file the page will hold and points out
 * data among them, since anyone with the page's address can download
 * what is in it. Nothing is uploaded: the user puts the folder on a web
 * host of their choosing.
 */
function ShareAppDialog() {
  const share = useStore((state) => state.share);
  const platform = useStore((state) => state.info?.platform);
  const [showLog, setShowLog] = useState(false);
  if (!share) return null;
  const name = baseName(share.file);
  const files = share.bundle?.files ?? [];
  const data = files.filter((file) => !CODE_FILE.test(file));
  const reveal = platform === "macos" ? "Show in Finder" : "Show in folder";
  const explained = share.failure ? explainApp(share.failure) : null;
  // A missing package is installed in the console, where its progress
  // shows, and the dialog closes to make room for it.
  const install = share.status === "failed" && explained?.action?.kind === "install" ? explained.action : null;
  return (
    <Modal title="Share as a web page" onClose={close} wide>
      <div className="dialog-body share-app">
        {share.status === "ready" && (
          <>
            <p>
              Makes a web page that runs <strong>{name}</strong> entirely in the browser, R included, so whoever opens it needs nothing installed. Put the folder it makes on any web host, such as GitHub Pages, Netlify, or your institution's web space, and share the address.
            </p>
            <section className="share-files" aria-labelledby="share-files-heading">
              <h3 id="share-files-heading">What goes in the page</h3>
              {share.bundle === null ? (
                <p className="muted">Listing the app's files</p>
              ) : (
                <ul className="share-file-list">
                  {files.map((file) => (
                    <li key={file}>
                      <code>{file}</code>
                      {data.includes(file) && <span className="share-data">data</span>}
                    </li>
                  ))}
                  {share.bundle.more && <li className="muted">and more</li>}
                </ul>
              )}
              {data.length > 0 && (
                <p className="share-warning" role="note">
                  <WarnIcon size={15} />
                  <span>
                    Everything in the app's folder goes in, including {data.length === 1 ? "this data file" : `these ${data.length} data files`}. Anyone with the address can download {data.length === 1 ? "it" : "them"}. Move anything private out of the folder first, or keep the app in a folder of its own.
                  </span>
                </p>
              )}
            </section>
            <p className="hint">Most CRAN packages work in the browser. A few that need programs outside R do not, and the page says which ones when it loads. The first time, shinylive downloads some files of its own, so you need to be online once.</p>
          </>
        )}
        {share.status === "exporting" && (
          <div className="report-progress">
            <p role="status">Making the web version of {name}</p>
            <progress aria-label={`Making the web version of ${name}`} />
            {share.log.length > 0 && <p className="muted truncate">{share.log[share.log.length - 1]}</p>}
          </div>
        )}
        {share.status === "done" && share.folder && (
          <>
            <p role="status">
              <strong>The web version is ready</strong> in <code>{shortPath(share.folder)}</code>.
            </p>
            <p>Preview it here to see it as others will. To share it, upload the whole folder to a web host and send the address.</p>
            <p className="hint">Double clicking its index.html does not work, because browsers only run R from a web address. The preview here works the way a web host does.</p>
          </>
        )}
        {(share.status === "failed" || share.status === "stopped") && explained && (
          <div className="output-error report-problem">
            <p className="error-title">{share.status === "stopped" ? "Making the web version stopped" : explained.title}</p>
            <p>{share.status === "stopped" ? "Nothing was shared. Make it again when you are ready." : explained.detail}</p>
            {explained.hint && share.status !== "stopped" && (
              <p className="error-hint">
                <strong>Try this:</strong> {explained.hint}
              </p>
            )}
          </div>
        )}
        {share.log.length > 0 && share.status !== "exporting" && (
          <div className="report-log">
            <button type="button" className="button small quiet" aria-expanded={showLog} onClick={() => setShowLog(!showLog)}>
              {showLog ? "Hide what R printed" : "Show what R printed"}
            </button>
            {showLog && (
              <pre className="output-text" tabIndex={0} aria-label="What the export printed">
                {share.log.join("\n")}
              </pre>
            )}
          </div>
        )}
      </div>
      <div className="dialog-foot">
        {share.status === "ready" && (
          <>
            <span className="hint">You choose where the folder goes. Nothing is uploaded.</span>
            <button type="button" className="button" onClick={close}>
              Cancel
            </button>
            <button type="button" className="button primary" disabled={share.bundle === null} onClick={exportApp}>
              Choose a folder and make it
            </button>
          </>
        )}
        {share.status === "exporting" && (
          <button type="button" className="button" onClick={stopExport}>
            Stop
          </button>
        )}
        {share.status === "done" && (
          <>
            <button type="button" className="button" onClick={revealExport}>
              {reveal}
            </button>
            <button type="button" className="button" onClick={close}>
              Done
            </button>
            <button type="button" className="button primary" onClick={previewExport}>
              Preview here
            </button>
          </>
        )}
        {(share.status === "failed" || share.status === "stopped") && (
          <>
            <button type="button" className="button" onClick={close}>
              Close
            </button>
            {install ? (
              <button type="button" className="button primary" onClick={() => (close(), installPackages([install.name]))}>
                {install.label}
              </button>
            ) : (
              <button type="button" className="button primary" onClick={exportApp}>
                Make it again
              </button>
            )}
          </>
        )}
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
          R draws the plot again from <code>{firstLine.length > 60 ? `${firstLine.slice(0, 60)}...` : firstLine}</code>, in {plot.label}. Any objects it makes are thrown away.
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
          <p className="hint">The app found {installs.length} versions of R in the usual places. It did not look anywhere else on this computer. The newest is first.</p>
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
  // The facts are a list of label and value pairs, so a screen reader
  // reads each as a pair and the eye finds a label down one column.
  const facts: [string, string][] = [
    ["Version", info?.version ?? ""],
    ["Runs R with", `ark ${info?.arkVersion ?? ""}, by Posit Software, PBC, under the MIT License`],
    ["License", "PolyForm Noncommercial 1.0.0"],
    ["Copyright", "2026 Abhik Roy"],
  ];
  return (
    <Modal title="About" onClose={close}>
      <div className="dialog-body about">
        <div className="about-head">
          <img src="/icon.svg" alt="" width="64" height="64" />
          <div>
            <p className="about-name">R: What Is It Good For?</p>
            <p className="muted">A workspace for writing R and seeing what it makes.</p>
          </div>
        </div>
        <dl className="about-facts">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <p className="hint">The licenses of everything included come with the app.</p>
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

/** Matches grouped by their section, each keeping its place in the flat
 * list that the arrow keys move through. */
function groupBySection<T extends { section: string }>(results: T[]) {
  const groups: { section: string; items: { command: T; index: number }[] }[] = [];
  results.forEach((command, index) => {
    const group = groups.find((item) => item.section === command.section);
    if (group) group.items.push({ command, index });
    else groups.push({ section: command.section, items: [{ command, index }] });
  });
  return groups;
}

function CommandPalette() {
  const layer = useStore((state) => state.settings.layer);
  const initialQuery = useStore((state) => state.ui.paletteQuery);
  const [query, setQuery] = useState(initialQuery);
  const [selected, setSelected] = useState(0);
  // A query that could be the name of an R function also offers its help
  // page after any matching commands, so the one search field finds both.
  const resultsFor = (text: string) => {
    const found = [...searchCommands(visibleCommands(layer), text), ...searchSnippets(SNIPPETS, text)];
    const name = text.trim().replace(/^\?+/, "");
    const lookup = /^[A-Za-z.][\w.]*(::[A-Za-z.][\w.]*)?$/.test(name) ? [{ id: `help:${name}`, title: `Look up ${name} in R help`, section: "R help", keys: "" }] : [];
    // Shown grouped by section, so the arrow keys follow the same order the
    // eye does.
    return groupBySection([...found, ...lookup]).flatMap((group) => group.items.map((item) => item.command));
  };
  const results = useMemo(() => resultsFor(query), [layer, query]);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => setSelected(0), [query]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  function run(id: string) {
    togglePalette();
    // The palette closes first so a command that opens a dialog gets focus.
    if (id.startsWith("snippet:")) {
      setTimeout(() => insertSnippetById(id.slice(8)), 0);
      return;
    }
    if (id.startsWith("help:")) {
      const [pkg, topic] = id.slice(5).includes("::") ? id.slice(5).split("::") : ["", id.slice(5)];
      setTimeout(() => openHelp(topic, pkg), 0);
      return;
    }
    setTimeout(() => runCommand(id), 0);
  }

  return (
    <Modal title="Search" onClose={() => togglePalette()} labelledBy="palette-title">
      <div className="palette">
        <label className="palette-search">
          <SearchIcon size={16} />
          <span className="visually-hidden">Search commands and R help</span>
          <input
            data-autofocus
            value={query}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={results[selected] ? `cmd-${results[selected].id}` : undefined}
            placeholder="A command, or a function to look up, such as mean"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSelected((index) => Math.min(results.length - 1, index + 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelected((index) => Math.max(0, index - 1));
              } else if (event.key === "Enter") {
                // What is typed now decides, even when Enter comes before
                // the list has caught up with the last key.
                event.preventDefault();
                const typed = event.currentTarget.value;
                // A highlight left past the end of a list that just got
                // shorter falls back to the first match, so Enter always
                // does something when anything matches.
                const choice = (typed === query ? results[selected] : undefined) ?? resultsFor(typed)[0];
                if (choice) run(choice.id);
              }
            }}
          />
        </label>
        <ul id="palette-list" role="listbox" aria-label="Matching commands" ref={list}>
          {/* Grouped under their menu's name, in the order matches come,
              with shortcuts in one column at the right, so the list can be
              skimmed down either edge. */}
          {groupBySection(results).map(({ section, items }) => (
            <li key={section} role="presentation" className="palette-group">
              <p className="palette-heading" id={`palette-group-${section.replace(/\W+/g, "-")}`}>
                {section}
              </p>
              <ul role="group" aria-labelledby={`palette-group-${section.replace(/\W+/g, "-")}`}>
                {items.map(({ command, index }) => (
                  <li
                    key={command.id}
                    id={`cmd-${command.id}`}
                    role="option"
                    aria-selected={index === selected}
                    data-index={index}
                    className={`palette-item${index === selected ? " is-selected" : ""}`}
                    onMouseEnter={() => setSelected(index)}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      run(command.id);
                    }}
                  >
                    <span className="palette-title">{command.title}</span>
                    <span className="palette-keys">{command.keys && <kbd>{keyLabel(command.keys)}</kbd>}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
          {results.length === 0 && <li className="muted palette-empty">No command matches. Try a shorter word.</li>}
        </ul>
        <p className="hint palette-foot">
          {getState().settings.layer === "essentials" ? "Showing the Essentials commands. Choose Everything in Settings, under Menus, for more." : "Showing every command."}
        </p>
      </div>
    </Modal>
  );
}

/** Reset the app: what it puts back, listed, with the parts beyond the
 * settings left to choose. It says plainly what is never touched. */
function ResetAppDialog() {
  const [choices, setChoices] = useState({ recent: false, history: false, results: false, r: false });
  const toggle = (key: keyof typeof choices) => (event: React.ChangeEvent<HTMLInputElement>) => setChoices({ ...choices, [key]: event.target.checked });
  return (
    <Modal title="Reset the app" onClose={close}>
      <div className="dialog-body">
        <p>This puts every setting and the layout back as they were when the app was new, and shows the tour again.</p>
        <fieldset>
          <legend>Also reset</legend>
          <label className="check">
            <input type="checkbox" checked={choices.recent} onChange={toggle("recent")} />
            <span>The lists of recent scripts and projects</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={choices.history} onChange={toggle("history")} />
            <span>Earlier versions of files</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={choices.results} onChange={toggle("results")} />
            <span>Results kept from last time</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={choices.r} onChange={toggle("r")} />
            <span>The R in use, so it is chosen again next time</span>
          </label>
        </fieldset>
        <p className="hint">Your scripts, data, projects, installed packages, and downloaded models are never touched, and open tabs stay open.</p>
      </div>
      <div className="dialog-foot">
        <button type="button" className="button" onClick={close}>
          Cancel
        </button>
        <button type="button" className="button primary" onClick={() => resetApp(choices)}>
          Reset the app
        </button>
      </div>
    </Modal>
  );
}
