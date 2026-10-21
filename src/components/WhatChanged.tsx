// What changed since a line last ran, under its new result. A summary line
// says it in a few words and opens to the details: numbers that moved,
// printed lines that came or went, objects that changed, and the plot
// before and after, with a slider to wipe between them.
//
// Changes are marked with words as well as color, Gone and New, so they
// read the same in every palette and to a screen reader.

import { useState } from "react";
import { differenceSummary, type Difference } from "../lib/resultDiff";
import { ChevronIcon, HistoryIcon } from "./Icons";

export function WhatChanged({ diff }: { diff: Difference }) {
  const [open, setOpen] = useState(false);
  const [wipe, setWipe] = useState(50);
  if (diff.same) {
    return (
      <p className="what-changed is-same muted">
        <HistoryIcon size={13} /> Same as last time
      </p>
    );
  }
  return (
    <section className="what-changed" aria-label="What changed since last time">
      <button type="button" className="what-changed-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <HistoryIcon size={14} />
        <span>{differenceSummary(diff)}</span>
        <ChevronIcon size={12} open={open} />
      </button>
      {open && (
        <div className="what-changed-body">
          {diff.objects.map((item) => (
            <p key={item.name}>
              <code>{item.name}</code> was {item.before}, and is now {item.after}.
            </p>
          ))}
          {diff.numbers.length > 0 && (
            <ul className="what-changed-numbers">
              {diff.numbers.map((change, index) => (
                <li key={index}>
                  <span className="what-changed-move">
                    {change.before} to {change.after}
                  </span>
                  <code className="muted">{change.line}</code>
                </li>
              ))}
            </ul>
          )}
          {(diff.removed.length > 0 || diff.added.length > 0) && (
            <ul className="what-changed-lines">
              {diff.removed.map((line, index) => (
                <li key={`r${index}`} className="is-gone">
                  <span>Gone</span>
                  <code>{line}</code>
                </li>
              ))}
              {diff.added.map((line, index) => (
                <li key={`a${index}`} className="is-new">
                  <span>New</span>
                  <code>{line}</code>
                </li>
              ))}
            </ul>
          )}
          {diff.plot && (
            <div className="what-changed-plot">
              <div className="what-changed-frame">
                <img src={`data:image/png;base64,${diff.plot.before}`} alt="The plot from last time" />
                <img src={`data:image/png;base64,${diff.plot.after}`} alt="The plot now" style={{ clipPath: `inset(0 0 0 ${wipe}%)` }} />
              </div>
              <label className="what-changed-wipe">
                <span>Last time</span>
                <input type="range" min={0} max={100} value={wipe} aria-label="Wipe between the plot from last time and now" onChange={(event) => setWipe(Number(event.target.value))} />
                <span>Now</span>
              </label>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
