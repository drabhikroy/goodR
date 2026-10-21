// The right column, laid out as RStudio lays it out, because people moving
// from RStudio find things where they expect them, and a familiar layout is
// learned faster (Tuch et al. 2012). The top pane holds Environment and
// History, the bottom pane Plots, Help, and Packages. The column's width
// and the split between its panes can each be dragged, or moved with the
// arrow keys, and both are remembered.

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  clearWorkspace,
  helpBack,
  helpForward,
  historyToConsole,
  historyToScript,
  openDialog,
  openExportPlot,
  openHelp,
  refreshPackages,
  setPackageAttached,
  setPlotArea,
  showBottomPane,
  showPlot,
  showTopPane,
  updateSettings,
  viewData,
} from "../lib/app";
import { cleanHelp } from "../lib/helpHtml";
import { useStore, type BottomPane, type TopPane } from "../lib/store";
import type { RObject } from "../lib/types";
import { ArrowIcon, BroomIcon, FunctionIcon, ImportIcon, ModelIcon, PlusIcon, SaveIcon, SearchIcon, TableIcon, ValueIcon } from "./Icons";
import { AssistantPane } from "./AssistantPane";
import { ReportPane } from "./ReportPane";
import { Splitter } from "./Splitter";

export function Inspector() {
  const width = useStore((state) => state.settings.inspectorWidth);
  const split = useStore((state) => state.settings.paneSplit);
  const column = useRef<HTMLElement>(null);
  const [height, setHeight] = useState(800);

  // The split is kept as a share of the column, so it holds when the
  // window changes size.
  useLayoutEffect(() => {
    if (!column.current) return;
    const observer = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height));
    observer.observe(column.current);
    return () => observer.disconnect();
  }, []);

  // A conversation needs room to read, so the Assistant tab takes at least
  // three fifths of the column while it is open. The person's own split
  // comes back with the other tabs.
  // A report preview needs room too, so the Report tab gets at least three
  // fifths from the other side.
  const topPane = useStore((state) => state.ui.topPane);
  const bottomPane = useStore((state) => state.ui.bottomPane);
  const share = topPane === "assistant" ? Math.max(split, 62) : bottomPane === "report" ? Math.min(split, 38) : split;
  const top = Math.round((height * share) / 100);
  const maxWidth = Math.max(300, Math.min(760, Math.round(window.innerWidth * 0.5)));

  return (
    <aside className="inspector" id="inspector" tabIndex={-1} aria-label="Environment, history, plots, help, and packages" ref={column} style={{ width }}>
      <Splitter
        className="column-edge"
        label="Right column width"
        axis="column"
        value={width}
        min={280}
        max={maxWidth}
        onChange={(value) => updateSettings({ inspectorWidth: value })}
      />
      <div className="pane pane-top" style={{ height: top }}>
        <TopPanes />
      </div>
      <Splitter
        className="pane-edge"
        label="Top pane height"
        axis="row"
        grows={false}
        value={top}
        min={120}
        max={Math.max(140, height - 160)}
        onChange={(value) => updateSettings({ paneSplit: Math.round((value / Math.max(1, height)) * 100) })}
      />
      <div className="pane pane-bottom">
        <BottomPanes />
      </div>
    </aside>
  );
}

/** A row of tabs with arrow key movement between them, as the WAI-ARIA
 * tabs pattern describes. */
function PaneTabs<T extends string>({ label, tabs, current, onPick, children }: { label: string; tabs: { id: T; name: string }[]; current: T; onPick: (id: T) => void; children: ReactNode }) {
  const list = useRef<HTMLDivElement>(null);
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = tabs.findIndex((tab) => tab.id === current);
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    onPick(tabs[next].id);
    setTimeout(() => list.current?.querySelector<HTMLButtonElement>(`[data-tab="${tabs[next].id}"]`)?.focus(), 0);
  }
  return (
    <>
      <div className="pane-tabs" role="tablist" aria-label={label} ref={list} onKeyDown={onKeyDown}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            data-tab={tab.id}
            id={`pane-tab-${tab.id}`}
            aria-selected={tab.id === current}
            aria-controls={`pane-panel-${tab.id}`}
            tabIndex={tab.id === current ? 0 : -1}
            className={`pane-tab ${tab.id === current ? "is-active" : ""}`}
            onClick={() => onPick(tab.id)}
          >
            {tab.name}
          </button>
        ))}
      </div>
      <div className="pane-body" role="tabpanel" id={`pane-panel-${current}`} aria-labelledby={`pane-tab-${current}`}>
        {children}
      </div>
    </>
  );
}

const TOP_TABS: { id: TopPane; name: string }[] = [
  { id: "environment", name: "Environment" },
  { id: "history", name: "History" },
  { id: "assistant", name: "Assistant" },
];

const BOTTOM_TABS: { id: BottomPane; name: string }[] = [
  { id: "plots", name: "Plots" },
  { id: "help", name: "Help" },
  { id: "packages", name: "Packages" },
];

function TopPanes() {
  const pane = useStore((state) => state.ui.topPane);
  return (
    <PaneTabs label="Environment, history, and assistant" tabs={TOP_TABS} current={pane} onPick={showTopPane}>
      {pane === "environment" && <EnvironmentPane />}
      {pane === "history" && <HistoryPane />}
      {pane === "assistant" && <AssistantPane />}
    </PaneTabs>
  );
}

function BottomPanes() {
  const pane = useStore((state) => state.ui.bottomPane);
  // The Report tab appears with the first render, so it never sits empty.
  const hasReport = useStore((state) => state.report !== null);
  const tabs = hasReport ? [...BOTTOM_TABS, { id: "report" as const, name: "Report" }] : BOTTOM_TABS;
  const current = pane === "report" && !hasReport ? "plots" : pane;
  return (
    <PaneTabs label={hasReport ? "Plots, help, packages, and report" : "Plots, help, and packages"} tabs={tabs} current={current} onPick={showBottomPane}>
      {current === "plots" && <PlotPanel />}
      {current === "help" && <HelpPane />}
      {current === "packages" && <PackagesPane />}
      {current === "report" && <ReportPane />}
    </PaneTabs>
  );
}

function PlotPanel() {
  const plots = useStore((state) => state.plots);
  const index = useStore((state) => state.plotIndex);
  const box = useRef<HTMLDivElement>(null);

  // New plots are rendered at exactly this box's size, so they arrive sharp
  // and with readable text instead of being shrunk to fit.
  useEffect(() => {
    if (!box.current) return;
    const observer = new ResizeObserver(([entry]) => setPlotArea(entry.contentRect.width, entry.contentRect.height));
    observer.observe(box.current);
    return () => observer.disconnect();
  }, []);

  const plot = plots[index];
  const [large, setLarge] = useState(false);
  return (
    <section className="plot-panel" aria-label="Plots">
      {plot && <p className="pane-note truncate">From {plot.label}</p>}
      <div className={`plot-box ${plot ? "" : "is-empty"}`} ref={box}>
        {plot ? (
          <button type="button" className="plot-open" onClick={() => setLarge(true)} aria-label={`Plot ${index + 1} of ${plots.length}, from ${plot.label}. Open full size`}>
            <img src={`data:image/png;base64,${plot.png}`} alt="" />
          </button>
        ) : (
          <p className="muted">Plots appear here when your code draws one.</p>
        )}
      </div>
      {large && plot && (
        <div className="overlay" onMouseDown={() => setLarge(false)} onKeyDown={(event) => event.key === "Escape" && setLarge(false)}>
          <div role="dialog" aria-modal="true" aria-label={`Plot ${index + 1}, full size`} className="plot-large">
            <img src={`data:image/png;base64,${plot.png}`} alt={`Plot ${index + 1} of ${plots.length}, from ${plot.label}`} />
            <button type="button" className="button" autoFocus onClick={() => setLarge(false)}>
              Close
            </button>
          </div>
        </div>
      )}
      {plots.length > 0 && (
        <div className="plot-controls">
          <button type="button" className="icon-button" aria-label="Earlier plot" disabled={index <= 0} onClick={() => showPlot(index - 1)}>
            <ArrowIcon direction="left" />
          </button>
          <span className="muted">
            Plot {index + 1} of {plots.length}
          </span>
          <button type="button" className="icon-button" aria-label="Later plot" disabled={index >= plots.length - 1} onClick={() => showPlot(index + 1)}>
            <ArrowIcon direction="right" />
          </button>
          <button type="button" className="button small push-end" onClick={openExportPlot}>
            <SaveIcon size={14} /> Export
          </button>
        </div>
      )}
    </section>
  );
}

const KIND_ICON: Record<RObject["kind"], typeof TableIcon> = {
  data: TableIcon,
  model: ModelIcon,
  function: FunctionIcon,
  list: ValueIcon,
  value: ValueIcon,
};

function EnvironmentPane() {
  const objects = useStore((state) => state.objects);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section className="objects" aria-label="Objects in R">
      <div className="pane-toolbar">
        <button type="button" className="button small quiet" onClick={() => openDialog("importData")}>
          <ImportIcon size={14} /> Import data
        </button>
        <button type="button" className="button small quiet push-end" disabled={!objects.length} onClick={clearWorkspace}>
          <BroomIcon size={14} /> Clear
        </button>
      </div>
      {objects.length === 0 && <p className="muted pane-empty">Objects you create appear here. Data frames open in the data viewer.</p>}
      <ul>
        {objects.map((object) => {
          const Icon = KIND_ICON[object.kind];
          // Data frames open in the data viewer. Other objects with parts
          // expand in place to list them.
          const viewable = object.kind === "data" && object.class !== "matrix";
          const expandable = !viewable && object.columns.length > 0;
          return (
            <li key={object.name}>
              <button
                type="button"
                className={`object-row kind-${object.kind}`}
                aria-expanded={expandable ? open === object.name : undefined}
                onClick={() => (viewable ? viewData(object.name) : expandable && setOpen(open === object.name ? null : object.name))}
              >
                <span className="object-icon">
                  <Icon size={16} />
                </span>
                <span className="object-text">
                  <code>{object.name}</code>
                  <span className="muted">{object.summary}</span>
                </span>
                {viewable && <span className="object-action">View</span>}
              </button>
              {open === object.name && (
                <ul className="columns">
                  {object.columns.map((column) => (
                    <li key={column}>
                      <code>{column}</code>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** What was typed in the console, newest first, with a way to send each
 * command back to the console or into the script, as RStudio's History
 * pane does. */
function HistoryPane() {
  const history = useStore((state) => state.history);
  const [query, setQuery] = useState("");
  const shown = [...history].reverse().filter((code) => code.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <section className="history-pane" aria-label="Console history">
      <div className="pane-toolbar">
        <label className="pane-search">
          <SearchIcon size={14} />
          <input type="search" aria-label="Search the history" placeholder="Search the history" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
      </div>
      {history.length === 0 && <p className="muted pane-empty">Commands typed in the console are listed here. Send one back to the console, or into your script.</p>}
      {history.length > 0 && shown.length === 0 && <p className="muted pane-empty">Nothing in the history matches.</p>}
      <ul className="history-list">
        {shown.map((code) => (
          <li key={code} className="history-row">
            <pre className="history-code">{code}</pre>
            <div className="history-actions">
              <button type="button" className="button small quiet" onClick={() => historyToConsole(code)}>
                To console
              </button>
              <button type="button" className="button small quiet" onClick={() => historyToScript(code)}>
                To script
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function HelpPane() {
  const help = useStore((state) => state.help);
  const [query, setQuery] = useState(help.query);
  const article = useRef<HTMLElement>(null);
  useEffect(() => setQuery(help.query), [help.query]);

  const page = help.page;
  // The page is rebuilt from an allowlist and placed with DOM calls, never
  // as raw HTML, so nothing in a help file can run.
  useLayoutEffect(() => {
    const target = article.current;
    if (!target || !page?.html) return;
    target.replaceChildren(cleanHelp(page.html));
    target.scrollTop = 0;
  }, [page?.html]);

  // Links between pages carry their package and file or topic, and open
  // here rather than in a browser.
  function onClick(event: React.MouseEvent<HTMLElement>) {
    const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[data-package]");
    if (!anchor) return;
    event.preventDefault();
    openHelp(anchor.dataset.topic ?? "", anchor.dataset.package ?? "", anchor.dataset.file ?? "");
  }

  return (
    <section className="help-pane" aria-label="Help">
      <div className="pane-toolbar">
        <button type="button" className="icon-button" aria-label="Previous help page" disabled={!help.back.length} onClick={helpBack}>
          <ArrowIcon direction="left" />
        </button>
        <button type="button" className="icon-button" aria-label="Next help page" disabled={!help.forward.length} onClick={helpForward}>
          <ArrowIcon direction="right" />
        </button>
        <form
          className="pane-search"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            openHelp(query);
          }}
        >
          <SearchIcon size={14} />
          <input type="search" aria-label="Help topic" placeholder="Function or topic, such as mean" value={query} spellCheck={false} onChange={(event) => setQuery(event.target.value)} />
        </form>
      </div>
      {help.loading && <p className="muted pane-empty">Looking up {help.query} in R</p>}
      {!help.loading && help.missing && <p className="pane-empty">R has no help page for {help.missing}. Check the spelling, or load the package it comes from first.</p>}
      {!help.loading && !help.missing && !page && (
        <p className="muted pane-empty">Type a function's name above, type ?name in the console, or put the cursor on a name in your script and press F1.</p>
      )}
      {!help.loading && !help.missing && page && page.choices.length > 0 && (
        <div className="help-choices">
          <p>{page.topic} is in more than one package. Which one did you mean?</p>
          <ul>
            {page.choices.map((choice) => (
              <li key={`${choice.package}/${choice.file}`}>
                <button type="button" className="button" onClick={() => openHelp("", choice.package, choice.file)}>
                  {choice.package}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <article
        ref={article}
        className="help-doc"
        hidden={help.loading || Boolean(help.missing) || !page?.html}
        aria-label={page ? `Help for ${page.topic}, from ${page.package}` : "Help page"}
        tabIndex={0}
        onClick={onClick}
      />
    </section>
  );
}

function PackagesPane() {
  const packages = useStore((state) => state.packages);
  const [query, setQuery] = useState("");
  useEffect(() => {
    refreshPackages();
  }, []);
  const words = query.trim().toLowerCase();
  const shown = (packages ?? []).filter((item) => !words || item.name.toLowerCase().includes(words) || item.title.toLowerCase().includes(words));
  return (
    <section className="packages-pane" aria-label="Packages">
      <div className="pane-toolbar">
        <label className="pane-search">
          <SearchIcon size={14} />
          <input type="search" aria-label="Search packages" placeholder="Search packages" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <button type="button" className="button small" onClick={() => openDialog("install")}>
          <PlusIcon size={14} /> Install
        </button>
      </div>
      {packages === null && <p className="muted pane-empty">Reading the installed packages from R</p>}
      <ul className="package-list">
        {shown.map((item) => (
          <li key={item.name} className="package-row">
            <label className="package-attach">
              <input type="checkbox" checked={item.loaded} disabled={item.name === "base"} onChange={(event) => setPackageAttached(item.name, event.target.checked)} />
              <span className="visually-hidden">Attach {item.name}</span>
            </label>
            <button type="button" className="package-name" onClick={() => openHelp(`${item.name}-package`, item.name)} title={`Help for ${item.name}`}>
              <code>{item.name}</code>
              <span className="muted truncate">{item.title}</span>
            </button>
            <span className="package-version muted">{item.version}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
