// What a failing line was working with, for the result that explains it.
//
// A line can fail because of a name it reads: one that was never made, one
// that was made under another spelling, or a data frame that does not have
// the column the line asks for. R's own message says so for one name at a
// time. This lists every name the line reads and what R holds under each
// right now, so the likely cause is in view without typing anything at the
// prompt. It reads the line as text and the objects as the canvas knows
// them, so it can be tested alone.

import { scriptSteps } from "./lineage";
import type { RObject } from "./types";

/** One name a line reads. An object is something R holds, a column is a
 * name that a data frame on the line has, such as the species in
 * aes(species), and anything else is a name R has nothing under. */
export type Used =
  | { kind: "missing"; name: string }
  | { kind: "object"; name: string; object: RObject }
  | { kind: "column"; name: string; of: string };

/**
 * The names `code` reads, the ones R has nothing under first, since those
 * are the likely cause, then the objects, then the columns. Function names,
 * argument names, columns written after a dollar sign, and keywords are not
 * names the line reads, so they are left out.
 */
export function usedBy(code: string, objects: RObject[]): Used[] {
  const names = [...new Set(scriptSteps(code).flatMap((step) => step.reads))];
  const held = new Map(objects.map((object) => [object.name, object]));
  const frames = names.map((name) => held.get(name)).filter((object): object is RObject => Boolean(object) && object!.kind === "data");
  const used = names.map((name): Used => {
    const object = held.get(name);
    if (object) return { kind: "object", name, object };
    const frame = frames.find((candidate) => candidate.columns.includes(name));
    return frame ? { kind: "column", name, of: frame.name } : { kind: "missing", name };
  });
  const order = { missing: 0, object: 1, column: 2 };
  return used.map((item, index) => ({ item, index })).sort((a, b) => order[a.item.kind] - order[b.item.kind] || a.index - b.index).map(({ item }) => item);
}
