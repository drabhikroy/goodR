// The write-up under a test or model's result: the APA sentence to paste
// into a paper, with Copy, and its assumptions checked in plain words.
//
// The sentence comes first, since it is what people go on to use. The
// checks are summed up in one line, such as "1 of 3 assumptions needs a
// look", and open to show each one, so a result that is fine stays short
// and one that is not says why and what to do (progressive disclosure).

import { useState } from "react";
import { notify } from "../lib/app";
import type { StatsReport } from "../lib/types";
import { CheckIcon, ChevronIcon, CopyIcon, HollowIcon, WarnIcon } from "./Icons";

/** A sentence that wraps only between its statistics, so "p < .001" or
 * "t(340) = 32.72" never breaks across lines. Copying keeps plain spaces. */
function unbroken(sentence: string) {
  return sentence
    .split(", ")
    .map((part) => part.replace(/ /g, "\u00a0"))
    .join(", ");
}

function copy(text: string) {
  navigator.clipboard?.writeText(text).then(
    () => notify("Copied the write-up."),
    () => notify("The write-up could not be copied.", "error"),
  );
}

export function StatsWriteUp({ report }: { report: StatsReport }) {
  const checks = report.checks ?? [];
  const failing = checks.filter((check) => check.ok === false).length;
  const [open, setOpen] = useState(failing > 0);
  const terms = report.terms ?? [];
  const all = [report.sentence, ...terms.map((item) => `${item.term}: ${item.sentence}`)].filter(Boolean).join("\n");
  return (
    <section className="stats-writeup" aria-label={`Write-up of the ${report.title ?? "result"}`}>
      <div className="stats-head">
        <span className="stats-title">{report.title}</span>
        <button type="button" className="button small quiet" onClick={() => copy(all)}>
          <CopyIcon size={13} /> Copy write-up
        </button>
      </div>
      {report.sentence && <p className="stats-sentence">{unbroken(report.sentence)}</p>}
      {terms.length > 0 && (
        <dl className="stats-terms">
          {terms.map((item) => (
            <div key={item.term}>
              <dt>
                <code>{item.term}</code>
              </dt>
              <dd>{unbroken(item.sentence)}</dd>
            </div>
          ))}
        </dl>
      )}
      {checks.length > 0 && (
        <>
          <button type="button" className="stats-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
            {failing ? <WarnIcon size={14} /> : <CheckIcon size={14} />}
            <span>
              {failing === 0
                ? `The ${checks.length === 1 ? "assumption holds" : `${checks.length} assumptions hold`}`
                : `${failing} of ${checks.length} assumptions ${failing === 1 ? "needs" : "need"} a look`}
            </span>
            <ChevronIcon size={12} open={open} />
          </button>
          {open && (
            <ul className="stats-checks">
              {checks.map((check) => (
                <li key={check.name} className={check.ok === false ? "is-failing" : ""}>
                  {check.ok === true ? <CheckIcon size={14} label="Holds" /> : check.ok === false ? <WarnIcon size={14} /> : <HollowIcon size={14} />}
                  <div>
                    <strong>{check.name}</strong>
                    <p>{check.detail}</p>
                    {check.ok === false && check.advice && <p className="stats-advice">{check.advice}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
