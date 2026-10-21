// The guided first project's card. It sits at the foot of the window,
// over nothing the user needs, lists five steps with the next one open,
// and ticks each step off as it is done, by any means. It is a region with
// a heading, and progress is announced as each step is done.

import { guideSteps, showGuideStep, stopGuide } from "../lib/firstProject";
import { useStore } from "../lib/store";
import { CheckIcon, CloseIcon, HollowIcon } from "./Icons";

export function FirstProject() {
  const open = useStore((state) => state.ui.guide);
  const objects = useStore((state) => state.objects);
  const tabs = useStore((state) => state.tabs);
  const blocks = useStore((state) => state.blocks);
  const plots = useStore((state) => state.plots);
  const report = useStore((state) => state.report);
  if (!open) return null;
  const steps = guideSteps({ objects, tabs, blocks, plots, report });
  const done = steps.filter((step) => step.done).length;
  const next = steps.find((step) => !step.done);
  return (
    <section className="first-project" aria-labelledby="first-project-title">
      <header className="first-project-head">
        <h2 id="first-project-title">Your first project</h2>
        <button type="button" className="icon-button" aria-label="Close the guide" onClick={stopGuide}>
          <CloseIcon size={14} />
        </button>
      </header>
      <p className="muted first-project-count" role="status">
        {done === steps.length ? "All five done" : `${done} of ${steps.length} done`}
      </p>
      <ol className="first-project-steps">
        {steps.map((step) => (
          <li key={step.id} className={`${step.done ? "is-done" : ""} ${step === next ? "is-next" : ""}`}>
            {step.done ? <CheckIcon size={14} label="Done" /> : <HollowIcon size={14} />}
            <div>
              <span className="first-project-title">{step.title}</span>
              {step === next && (
                <>
                  <p className="hint">{step.hint} Any way you do it counts.</p>
                  <button type="button" className="button small" onClick={() => showGuideStep(step.id)}>
                    {step.action}
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ol>
      {!next && <p className="hint">That is the whole shape of an analysis. Render the report to see it put together.</p>}
    </section>
  );
}
