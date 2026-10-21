// Ask for help online: a question in the shape R forums ask for.
//
// Posit Community and Stack Overflow both ask for a reproducible example:
// the least code that shows the problem, data others can run it on, the
// error, and the versions. This writes one from a statement that failed,
// with the lines behind it found by the same reading as Where did this
// come from. Files on this computer cannot travel with the question, so a
// data frame read from one is replaced by a small sample, written by
// dput() so it can be pasted and run.

import { scriptSteps, stepsLeadingTo, type Step } from "./lineage";
import type { Reprex } from "./types";

export type QuestionPlan = { steps: Step[]; roots: Record<string, Step[]>; failing: string };

/** The steps a failing statement needs, read from its script. `before` is
 * the statement's first line in the script, counted from zero. */
export function planQuestion(script: string, failing: string, before: number): QuestionPlan {
  const reads = scriptSteps(failing).flatMap((step) => step.reads);
  const { steps, roots } = stepsLeadingTo(scriptSteps(script), reads, before);
  return { steps, roots, failing };
}

/** The question as Markdown, ready to paste. With samples, each root that
 * R could sample is made from its sample in place of its own lines. */
export function questionText(plan: QuestionPlan, error: string, about: Reprex | null, withData: boolean): string {
  const sampled = withData && about ? Object.keys(plan.roots).filter((name) => about.data[name]) : [];
  const replaced = new Set(sampled.flatMap((name) => plan.roots[name]));
  const lines: string[] = [];
  for (const name of sampled) lines.push(`# A sample of ${name}, the first rows only`, `${name} <- ${about!.data[name]}`, "");
  for (const step of plan.steps) if (!replaced.has(step)) lines.push(step.code);
  lines.push(plan.failing.trim());
  const code = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const parts = [
    "I get an error when I run this R code, and I cannot work out why.",
    "```r\n" + code + "\n```",
    "The error:",
    "```\n" + error.trim() + "\n```",
    "What I expected to happen:",
  ];
  if (about) {
    const packages = about.packages.length ? ` Packages: ${about.packages.join(", ")}.` : "";
    parts.push(`${about.r}, on ${about.platform}.${packages}`);
  }
  return parts.join("\n\n") + "\n";
}
