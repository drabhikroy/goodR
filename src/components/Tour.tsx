// The tour, and the rings that point at parts of the app.
//
// The tour follows the walkthrough in Tessera: a card in the middle of the
// window with one point per step, a small animated picture of what the
// step is about, a row of dots for where it is, and Back and Next. Each
// picture is drawn in the app's own colors, so it matches every appearance
// and palette, and it stops moving when motion is reduced. Where the part
// a step describes is on screen, Show me hides the card for a moment and
// marks that part with rings that widen out from it, then brings the card
// back, so the step is seen in place rather than only described. The tour
// opens by itself once, on the first run, and again from Help or the
// opening screen whenever it is wanted.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { openExamples, setTour, updateSettings } from "../lib/app";
import { keyLabel } from "../lib/commands";
import { findTarget, pointAt, stopPointing, TARGETS, type GuideTarget } from "../lib/guide";
import { getState, useStore } from "../lib/store";
import { ArrowIcon, CloseIcon } from "./Icons";
import { trapTab } from "./focus";

type Step = { title: string; body: () => string; target?: GuideTarget; art: ReactNode };

// The pictures share a 320 by 170 stage and a few shapes: cards, lines of
// code, bars, and an arrow. Classes carry the colors, and the classes
// grow, rise, fade, and pulse carry the motion, each with a short delay so
// a picture builds in the order the step describes.
const Card = (props: { x: number; y: number; w: number; h: number; className?: string }) => <rect x={props.x} y={props.y} width={props.w} height={props.h} rx="8" className={`v-card ${props.className ?? ""}`} />;
const Line = (props: { x: number; y: number; w: number; className?: string }) => <rect x={props.x} y={props.y} width={props.w} height="7" rx="3.5" className={`v-line ${props.className ?? ""}`} />;
const Bar = (props: { x: number; h: number; base: number; className?: string }) => <rect x={props.x} y={props.base - props.h} width="20" height={props.h} rx="2" className={`v-bar grow ${props.className ?? ""}`} />;
const Arrow = (props: { x: number; y: number; className?: string }) => <path d={`M${props.x} ${props.y} h34 m-10 -10 l10 10 l-10 10`} className={`v-arrow ${props.className ?? ""}`} fill="none" />;

const STEPS: Step[] = [
  {
    title: "Where things go",
    body: () => "You write R on the left. Whatever it makes, a plot, a table, or a printed result, appears on the right at the largest size that fits.",
    art: (
      <>
        <Card x={14} y={18} w={128} h={134} />
        <Line x={28} y={36} w={72} className="fade d1" />
        <Line x={28} y={52} w={96} className="fade d2" />
        <Line x={28} y={68} w={58} className="fade d3" />
        <Line x={28} y={84} w={84} className="fade d4" />
        <Card x={160} y={18} w={146} h={134} />
        <Bar x={184} base={130} h={44} className="d3" />
        <Bar x={216} base={130} h={70} className="d4" />
        <Bar x={248} base={130} h={92} className="d5" />
      </>
    ),
  },
  {
    title: "Running a line",
    body: () => `Put the cursor on a line and press ${keyLabel("⌘↩")}, or press Run. The result appears on the right and the cursor moves down a line, so you can keep pressing to step through a script. ${keyLabel("⇧⌘↩")} runs the whole file.`,
    target: "run",
    art: (
      <>
        <Card x={14} y={18} w={128} h={134} />
        <Line x={28} y={40} w={80} />
        <rect x={20} y={56} width="116" height="18" rx="5" className="v-band rise d1" />
        <Line x={28} y={62} w={92} className="is-on" />
        <Line x={28} y={88} w={64} />
        <Arrow x={150} y={65} className="pulse" />
        <Card x={196} y={36} w={110} h={64} className="rise d2" />
        <Line x={208} y={52} w={60} className="fade d3" />
        <Line x={208} y={68} w={84} className="fade d4" />
      </>
    ),
  },
  {
    title: "Plots",
    body: () => "A new plot takes up the space on the right, with its text sized to match. Full size shows it over the whole window, and Export saves it for a slide, a paper, or a report.",
    target: "stage",
    art: (
      <>
        <Card x={30} y={10} w={260} h={150} />
        <path d="M54 136 H268 M54 136 V26" className="v-axis" fill="none" />
        <Bar x={78} base={136} h={52} className="d1" />
        <Bar x={118} base={136} h={78} className="d2" />
        <Bar x={158} base={136} h={64} className="d3" />
        <Bar x={198} base={136} h={98} className="d4" />
        <Bar x={238} base={136} h={86} className="d5" />
      </>
    ),
  },
  {
    title: "Going back to a result",
    body: () => "Click a line you have already run and its result comes back on the right. Running the name of a data frame shows it as a table you can sort.",
    target: "stage",
    art: (
      <>
        <Card x={14} y={18} w={118} h={134} />
        <Line x={26} y={40} w={70} />
        <Line x={26} y={64} w={86} />
        <Line x={26} y={88} w={60} />
        <rect x={18} y={34} width="110" height="19" rx="5" className="v-band follow" />
        <Card x={150} y={18} w={156} h={134} />
        <g className="swap-a">
          <Bar x={176} base={132} h={46} />
          <Bar x={210} base={132} h={80} />
          <Bar x={244} base={132} h={62} />
        </g>
        <g className="swap-b">
          <Line x={166} y={40} w={124} />
          <Line x={166} y={60} w={124} />
          <Line x={166} y={80} w={124} />
          <Line x={166} y={100} w={124} />
        </g>
      </>
    ),
  },
  {
    title: "Earlier results",
    body: () => "Under the result is a row of small previews, one for each thing you have run. Choose one to see it again, and the script moves to the line that made it. Pin one to keep it in view while you compare.",
    target: "timeline",
    art: (
      <>
        <Card x={20} y={14} w={280} h={88} />
        <Bar x={150} base={92} h={58} className="d1" />
        <rect x={24} y={116} width="62" height="40" rx="6" className="v-card fade d1" />
        <rect x={94} y={116} width="62" height="40" rx="6" className="v-card fade d2" />
        <rect x={164} y={116} width="62" height="40" rx="6" className="v-card fade d3" />
        <rect x={234} y={116} width="62" height="40" rx="6" className="v-card fade d4" />
        <rect x={24} y={116} width="62" height="40" rx="6" className="v-select hop" />
      </>
    ),
  },
  {
    title: "The R prompt",
    body: () => "For something quick that does not belong in the script, type in the box under it and press Return. Up brings back what you typed before, and ?mean opens the help for mean.",
    target: "prompt",
    art: (
      <>
        <Card x={30} y={20} w={260} h={80} />
        <Line x={50} y={44} w={150} className="fade d4" />
        <Line x={50} y={62} w={110} className="fade d5" />
        <rect x={30} y={116} width="260" height="36" rx="10" className="v-card is-input" />
        <text x={48} y={139} className="v-prompt">{">"}</text>
        <clipPath id="tour-type">
          <rect x={62} y={124} width="150" height="22" className="type" />
        </clipPath>
        <text x={64} y={139} className="v-code" clipPath="url(#tour-type)">summary(distance_au)</text>
      </>
    ),
  },
  {
    title: "Your objects",
    body: () => "Each object you make gets a small card along the top, with a few words about what it is. Choose a data frame to look through it. Above them, named views switch between the canvas, R help, Packages, History, and the assistant.",
    target: "objects",
    art: (
      <>
        <rect x={24} y={30} width="74" height="24" rx="12" className="v-card rise d1" />
        <rect x={106} y={30} width="96" height="24" rx="12" className="v-card rise d2" />
        <rect x={210} y={30} width="62" height="24" rx="12" className="v-card rise d3" />
        <Card x={24} y={70} w={272} h={84} className="fade d4" />
        <Line x={40} y={88} w={240} className="fade d5" />
        <Line x={40} y={106} w={240} className="fade d5" />
        <Line x={40} y={124} w={240} className="fade d5" />
      </>
    ),
  },
  {
    title: "Searching",
    body: () => `The search in the title bar, or ${keyLabel("⌘K")}, finds any command and any R function. Help, in the menu bar, explains each part of the app and can point it out for you, as this tour does.`,
    target: "search",
    art: (
      <>
        <rect x={40} y={24} width="240" height="34" rx="10" className="v-card is-input" />
        <circle cx={62} cy={41} r="7" className="v-axis" fill="none" />
        <path d="M67 46 l6 6" className="v-axis" />
        <Line x={82} y={38} w={90} className="is-on" />
        <Line x={52} y={78} w={200} className="fade d1" />
        <Line x={52} y={98} w={170} className="fade d2" />
        <Line x={52} y={118} w={186} className="fade d3" />
      </>
    ),
  },
  {
    title: "Projects and R",
    body: () => "Each project has its own copy of R, and so does a script that is not in a project, so work in one never affects another. The name at the top left says which is on show, and its menu switches between everything open.",
    target: "session",
    art: (
      <>
        <Card x={20} y={40} w={120} h={90} />
        <Card x={180} y={40} w={120} h={90} />
        <Line x={36} y={60} w={60} />
        <Line x={196} y={60} w={60} />
        <circle cx={80} cy={104} r="14" className="v-badge rise d1" />
        <circle cx={240} cy={104} r="14" className="v-badge rise d2" />
        <text x={75} y={109} className="v-badge-text">R</text>
        <text x={235} y={109} className="v-badge-text">R</text>
      </>
    ),
  },
  {
    title: "Help while writing",
    body: () => `Each line gets standard spacing when you press Return. If the assistant is set up, write a comment saying what you want and press ${keyLabel("⌥⌘G")}, and it drafts the code under the comment. Nothing is added until you press Insert.`,
    art: (
      <>
        <Card x={14} y={18} w={292} h={134} />
        <text x={30} y={46} className="v-code">
          # mean magnitude by kind
        </text>
        <rect x={24} y={60} width="272" height="62" rx="6" className="v-band rise d1" />
        <Line x={36} y={74} w={180} className="is-on fade d2" />
        <Line x={36} y={90} w={128} className="is-on fade d3" />
        <Line x={36} y={106} w={150} className="is-on fade d4" />
        <rect x={228} y={128} width="64" height="16" rx="5" className="v-badge rise d5" />
      </>
    ),
  },
  {
    title: "When something goes wrong",
    body: () => "The result explains the problem in plain words, underlines where it happened, and often offers a fix. Fix problems, in the Edit menu, finds and fixes them across a whole script, including code that packages have since retired. If you are still stuck, Ask for help online writes a question you can post on a forum.",
    target: "stage",
    art: (
      <>
        <Card x={14} y={18} w={128} h={134} />
        <Line x={28} y={40} w={80} />
        <Line x={28} y={62} w={92} className="is-on" />
        <path d="M28 76 q6 -5 12 0 t12 0 t12 0 t12 0" className="v-arrow fade d1" fill="none" />
        <Arrow x={150} y={65} className="pulse" />
        <Card x={196} y={30} w={110} h={110} className="rise d2" />
        <Line x={208} y={48} w={70} className="fade d3" />
        <Line x={208} y={64} w={86} className="fade d3" />
        <rect x={208} y={84} width="86" height="18" rx="5" className="v-badge rise d4" />
        <rect x={208} y={110} width="86" height="18" rx="5" className="v-band rise d5" />
      </>
    ),
  },
];

/** Ends the tour, remembering it was seen so it does not open by itself
 * again. */
function finish() {
  setTour(null);
  updateSettings({ tourSeen: true });
}

export function Tour() {
  const step = useStore((state) => state.ui.tour);
  const beacon = useStore((state) => state.ui.beacon);
  const hasWorkspace = useStore((state) => state.tabs.length > 0 || state.project !== null);
  // Whether this step's part is on screen, checked once the screen settles.
  const [canShow, setCanShow] = useState(false);
  useEffect(() => {
    if (step === null) return;
    const target = STEPS[step]?.target;
    const check = () => setCanShow(Boolean(target && findTarget(target)));
    const timer = setTimeout(check, 50);
    return () => clearTimeout(timer);
  }, [step, hasWorkspace]);
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (step === null || beacon) return;
    const onKey = (event: KeyboardEvent) => {
      // A dialog or the search opened over the tour has the keys.
      const { ui } = getState();
      if (ui.dialog || ui.palette) return;
      if (card.current) trapTab(card.current, event);
      if (event.key === "Escape") finish();
      else if (event.key === "ArrowRight" && step < STEPS.length - 1) setTour(step + 1);
      else if (event.key === "ArrowLeft" && step > 0) setTour(step - 1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [step, beacon]);
  // While the rings play, the card steps aside, then comes back.
  if (step === null || beacon) return null;
  const current = STEPS[Math.min(step, STEPS.length - 1)];
  const last = step >= STEPS.length - 1;
  return (
    <div className="overlay tour-overlay">
      <div className="dialog tour" role="dialog" aria-modal="true" aria-labelledby="tour-title" ref={card}>
        {/* Each new step is read out, since focus stays on Next. */}
        <p className="visually-hidden" aria-live="polite">
          Step {step + 1} of {STEPS.length}: {current.title}. {current.body()}
        </p>
        <button type="button" className="icon-button tour-close" aria-label="End the tour" title="End the tour" onClick={finish}>
          <CloseIcon size={13} />
        </button>
        {/* The key restarts the picture's animation on every step. */}
        <svg key={step} className="vignette" viewBox="0 0 320 170" aria-hidden="true">
          {current.art}
        </svg>
        {/* Every step's words share one place, with only the current one
            shown, so the card keeps the height of the longest step and the
            buttons stay put from step to step. */}
        <div className="tour-text">
          {STEPS.map((item, index) => (
            <div key={item.title} className={index === step ? "is-current" : ""} aria-hidden={index === step ? undefined : true}>
              <h2 id={index === step ? "tour-title" : undefined}>{item.title}</h2>
              <p>{item.body()}</p>
            </div>
          ))}
        </div>
        <div className="tour-dots" aria-label={`Step ${step + 1} of ${STEPS.length}`} role="img">
          {STEPS.map((item, index) => (
            <span key={item.title} className={`tour-dot ${index === step ? "is-current" : index < step ? "is-done" : ""}`} />
          ))}
        </div>
        <div className="tour-actions">
          {step > 0 && (
            <button type="button" className="button quiet" onClick={() => setTour(step - 1)}>
              <ArrowIcon direction="left" size={13} /> Back
            </button>
          )}
          {current.target && canShow && (
            <button type="button" className="button" aria-description={`Points at ${TARGETS[current.target].label} on screen`} onClick={() => pointAt(current.target!, () => setTour(step))}>
              Show me
            </button>
          )}
          {last && !hasWorkspace && (
            <button type="button" className="button" onClick={() => (finish(), openExamples())}>
              Open the examples
            </button>
          )}
          <button type="button" className="button primary push-end" autoFocus onClick={() => (last ? finish() : setTour(step + 1))}>
            {last ? "Start working" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The rings: an outline around the part being pointed at, and circles
 * that widen out from its center and fade, three at a time, so the eye
 * finds it wherever it sits. A label names it. Any click or key clears
 * them early.
 */
export function Beacon() {
  const target = useStore((state) => state.ui.beacon);
  const [box, setBox] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    if (!target) return setBox(null);
    const measure = () => setBox(findTarget(target)?.getBoundingClientRect() ?? null);
    measure();
    const timer = setInterval(measure, 250);
    const clear = () => stopPointing();
    window.addEventListener("resize", measure);
    document.addEventListener("pointerdown", clear, true);
    document.addEventListener("keydown", clear, true);
    return () => {
      clearInterval(timer);
      window.removeEventListener("resize", measure);
      document.removeEventListener("pointerdown", clear, true);
      document.removeEventListener("keydown", clear, true);
    };
  }, [target]);
  if (!target || !box) return null;
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  // The rings start a little larger than the part's shorter side, so a
  // wide part such as the stage still gets rings that read as circles.
  const size = Math.max(56, Math.min(box.width, box.height) + 24);
  const below = box.bottom + 56 < window.innerHeight;
  return (
    <div className="beacon" role="status" aria-live="polite">
      <div className="beacon-outline" style={{ left: box.left - 6, top: box.top - 6, width: box.width + 12, height: box.height + 12 }} />
      {[0, 1, 2].map((ring) => (
        <span key={ring} className={`beacon-ring r${ring}`} style={{ left: cx - size / 2, top: cy - size / 2, width: size, height: size }} />
      ))}
      <span className="beacon-label" style={{ left: Math.min(Math.max(12, cx - 90), window.innerWidth - 192), top: below ? box.bottom + 14 : box.top - 46 }}>
        {TARGETS[target].label}
      </span>
    </div>
  );
}
