// The map of a Shiny app: inputs on the left, the reactives and observers
// that work on them in the middle, and the outputs on the right, joined by
// lines for what reads what. Choosing any part highlights everything it
// depends on and everything that depends on it, and says so in words below
// the map, with a button to its line, so the map works the same from the
// keyboard and with a screen reader as with a pointer.
//
// The lines are placed after the parts are laid out, from where each part
// actually is, so the map can reflow with the width of the canvas.

import { useLayoutEffect, useRef, useState } from "react";
import { goToAppLine } from "../lib/shiny";
import { connected, type GraphNode, type ShinyGraph } from "../lib/shinyGraph";

const COLUMNS: { kinds: GraphNode["kind"][]; title: string }[] = [
  { kinds: ["input"], title: "Inputs" },
  { kinds: ["reactive", "observer"], title: "Reactives and observers" },
  { kinds: ["output"], title: "Outputs" },
];

type Line = { key: string; d: string; linked: boolean; sets: boolean };

/** A list of labels in words, joined with "and". */
function words(labels: string[]) {
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

export function ShinyMap({ graph }: { graph: ShinyGraph }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const linked = chosen ? connected(graph, chosen) : null;

  // Draws a curve from the right side of each part to the left side of
  // what reads it. A setter in the same column loops out to the right.
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const draw = () => {
      const frame = element.getBoundingClientRect();
      const place = (id: string) => element.querySelector<HTMLElement>(`[data-node="${CSS.escape(id)}"]`)?.getBoundingClientRect();
      const next: Line[] = [];
      for (const edge of graph.edges) {
        const a = place(edge.from);
        const b = place(edge.to);
        if (!a || !b) continue;
        const ay = a.top + a.height / 2 - frame.top;
        const by = b.top + b.height / 2 - frame.top;
        let d: string;
        if (Math.abs(a.left - b.left) < 4) {
          const x = a.right - frame.left;
          d = `M ${x} ${ay} C ${x + 36} ${ay}, ${x + 36} ${by}, ${x} ${by}`;
        } else {
          const ax = a.right - frame.left;
          const bx = b.left - frame.left;
          const bend = Math.max(24, (bx - ax) / 2);
          d = `M ${ax} ${ay} C ${ax + bend} ${ay}, ${bx - bend} ${by}, ${bx} ${by}`;
        }
        next.push({ key: `${edge.from}>${edge.to}`, d, sets: Boolean(edge.sets), linked: Boolean(linked?.has(edge.from) && linked.has(edge.to)) });
      }
      setLines(next);
      setSize({ width: frame.width, height: frame.height });
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(element);
    return () => observer.disconnect();
  }, [graph, chosen]);

  if (!graph.nodes.length) {
    return <p className="pane-empty muted">This app has no inputs, reactives, or outputs yet. Add an input in the UI and an output in the server, and they appear here.</p>;
  }

  const node = graph.nodes.find((item) => item.id === chosen) ?? null;
  const label = (id: string) => graph.nodes.find((item) => item.id === id)?.label ?? id;
  const reads = node ? graph.edges.filter((edge) => edge.to === node.id && !edge.sets).map((edge) => label(edge.from)) : [];
  const readBy = node ? graph.edges.filter((edge) => edge.from === node.id && !edge.sets).map((edge) => label(edge.to)) : [];
  const sets = node ? graph.edges.filter((edge) => edge.from === node.id && edge.sets).map((edge) => label(edge.to)) : [];
  const setBy = node ? graph.edges.filter((edge) => edge.to === node.id && edge.sets).map((edge) => label(edge.from)) : [];

  return (
    <div className="shiny-map-wrap">
      <p className="muted shiny-map-intro">Read from the code, before the app runs. Choose any part to see what it uses and what uses it.</p>
      <div className="shiny-map" ref={box} role="group" aria-label="How the app connects">
        <svg className="shiny-map-lines" width={size.width} height={size.height} aria-hidden="true">
          {lines.map((line) => (
            <path key={line.key} d={line.d} className={`${line.linked ? "is-linked" : ""} ${line.sets ? "is-set" : ""}`} />
          ))}
        </svg>
        {COLUMNS.map((column) => {
          const items = graph.nodes.filter((item) => column.kinds.includes(item.kind));
          return (
            <div key={column.title} className="shiny-map-column">
              <h3>{column.title}</h3>
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  data-node={item.id}
                  className={`shiny-node kind-${item.kind} ${linked?.has(item.id) ? "is-linked" : ""} ${chosen === item.id ? "is-chosen" : ""}`}
                  aria-pressed={chosen === item.id}
                  onClick={() => setChosen(chosen === item.id ? null : item.id)}
                >
                  {/* Long names break after the dollar sign, never mid word. */}
                  <code>
                    {item.label.includes("$") ? (
                      <>
                        {item.label.slice(0, item.label.indexOf("$") + 1)}
                        <wbr />
                        {item.label.slice(item.label.indexOf("$") + 1)}
                      </>
                    ) : (
                      item.label
                    )}
                  </code>
                </button>
              ))}
              {!items.length && <p className="muted shiny-map-none">None</p>}
            </div>
          );
        })}
      </div>
      {node && (
        <div className="shiny-map-detail" role="status">
          <p>
            <code>{node.label}</code>
            {node.kind === "input" && (readBy.length ? ` is read by ${words(readBy)}.` : " is not read anywhere in the server, so changing it does nothing yet.")}
            {node.kind !== "input" && (reads.length ? ` reads ${words(reads)}.` : node.kind === "output" ? " reads no inputs or reactives, so it is drawn once and never changes." : " reads no inputs or reactives.")}
            {node.kind === "reactive" && readBy.length > 0 && ` It is read by ${words(readBy)}.`}
            {sets.length > 0 && ` It sets ${words(sets)}.`}
            {setBy.length > 0 && ` It is set by ${words(setBy)}.`}
          </p>
          <button type="button" className="button small" onClick={() => goToAppLine(node.file, node.line, 0, 0)}>
            Go to line {node.line + 1}
          </button>
        </div>
      )}
    </div>
  );
}
