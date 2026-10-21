// The middle of the workspace: the editor, the bar that says which section
// the cursor is in, and results when they are shown beside or below the
// code rather than under each line.

import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { dismissMissing, goToLine, installPackages, newFile, restartR } from "../lib/app";
import * as editor from "../lib/editor";
import { getState, useStore } from "../lib/store";
import { ChevronIcon, TriangleIcon, WarnIcon } from "./Icons";
import { OutputCard } from "./OutputCard";

// Output cards inside the editor are separate React roots, mounted into the
// containers CodeMirror creates for them.
editor.setBlockRenderer((container, blockId) => {
  const root = createRoot(container);
  root.render(<OutputCard blockId={blockId} />);
  return () => setTimeout(() => root.unmount(), 0);
});

export function EditorPane() {
  const layout = useStore((state) => state.settings.outputLayout);
  const empty = useStore((state) => !state.tabs.some((tab) => tab.kind !== "data"));
  return (
    <main className="editor-pane" aria-label="Editor">
      <RStatusBanner />
      <PackageBanner />
      <div className={`editor-area layout-${layout}`}>
        <div className="editor-host-wrap">
          <EditorHost />
          {empty && <EmptyEditor />}
        </div>
        {(layout === "side" || layout === "stacked") && <OutputColumn />}
      </div>
    </main>
  );
}

/**
 * Where the cursor is in a long script, and a way to jump elsewhere. It
 * sits in the title bar beside the tabs, reading as the next step of a
 * path: script, then section. It appears only when the script has
 * sections, so short scripts stay bare.
 */
export function SectionBar() {
  const outline = useStore((state) => state.outline);
  const line = useStore((state) => state.cursorLine);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  if (!outline.length) return null;
  const here = [...outline].reverse().find((item) => item.line <= line);
  return (
    <div className="section-bar" ref={box}>
      <button type="button" className="section-button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="section-step" aria-hidden="true">
          <ChevronIcon size={12} />
        </span>
        <span className="section-current">{here ? here.label : "Top of the script"}</span>
        <ChevronIcon size={12} open />
      </button>
      {open && (
        <div role="menu" aria-label="Sections" className="popover section-menu">
          {outline.map((item, index) => (
            <button
              key={`${item.line}-${item.label}`}
              type="button"
              role="menuitem"
              autoFocus={index === 0}
              className={item === here ? "is-here" : ""}
              style={{ paddingLeft: `${0.7 + Math.max(0, item.level - 1) * 0.9}rem` }}
              onClick={() => {
                setOpen(false);
                goToLine(item.line);
              }}
            >
              <span>{item.label}</span>
              <span className="menu-hint-inline">line {item.line + 1}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function EditorHost() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const unmount = editor.mountEditor(host.current);
    const { active } = getState();
    if (active) editor.showDocument(active);
    return unmount;
  }, []);
  return <div ref={host} className="editor-host" />;
}

/** What the editor shows inside a project with no script open yet. */
function EmptyEditor() {
  return (
    <div className="editor-empty">
      <p>Choose a script from the sidebar, or start a new one.</p>
      <button type="button" className="button primary" onClick={newFile}>
        New script
      </button>
    </div>
  );
}

function RStatusBanner() {
  const status = useStore((state) => state.r.status);
  const message = useStore((state) => state.r.message);
  const log = useStore((state) => state.r.log);
  if (status !== "stopped" && status !== "failed") return null;
  return (
    <div className="banner tone-danger" role="alert">
      <TriangleIcon size={16} />
      <div className="banner-text">
        <strong>{status === "failed" ? "R could not start." : message}</strong> Your files are safe.
        {(log || (status === "failed" && message)) && (
          <details>
            <summary>Details</summary>
            <pre>{status === "failed" ? message : log}</pre>
          </details>
        )}
      </div>
      <button type="button" className="button primary" onClick={restartR}>
        Restart R
      </button>
    </div>
  );
}

function PackageBanner() {
  const missing = useStore((state) => state.missing);
  const status = useStore((state) => state.r.status);
  if (!missing.length || status === "starting") return null;
  const names = missing.map((item) => item.name);
  const first = missing[0];
  return (
    <div className="banner tone-warn" role="status">
      <WarnIcon size={16} />
      <span className="banner-text">
        {names.length === 1 ? (
          <>
            Line {first.line} uses <code>{first.name}</code>, which is not installed yet.
          </>
        ) : (
          <>
            This script uses {names.length} packages that are not installed yet: <code>{names.join(", ")}</code>.
          </>
        )}
      </span>
      <button type="button" className="button primary" onClick={() => installPackages(names)}>
        {names.length === 1 ? `Install ${first.name}` : "Install them"}
      </button>
      <button type="button" className="button quiet" onClick={dismissMissing}>
        Not now
      </button>
    </div>
  );
}

function OutputColumn() {
  const active = useStore((state) => state.active);
  const blocks = useStore((state) => state.blocks);
  const order = useStore((state) => state.blockOrder);
  // Statements that printed nothing are shown by their gutter check alone.
  const ids = order.filter((id) => {
    const block = blocks[id];
    return block?.file === active && !(block.status === "ok" && block.items.length === 0 && !block.paused);
  });
  const lines = active ? editor.blockLines(active) : new Map<string, number>();
  // Cards follow the code from top to bottom, matching what inline shows.
  ids.sort((a, b) => (lines.get(a) ?? blocks[a].toLine) - (lines.get(b) ?? blocks[b].toLine));
  return (
    <section className="output-column" aria-label="Results">
      {ids.length === 0 ? (
        <p className="muted output-column-empty">Results appear here when you run code.</p>
      ) : (
        ids.map((id) => <OutputCard key={id} blockId={id} showLine />)
      )}
    </section>
  );
}
