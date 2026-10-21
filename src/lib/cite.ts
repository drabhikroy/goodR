// Citations in a document, from a DOI or a title.
//
// A citation takes three steps by hand: find the reference, copy its
// BibTeX into a references file, and point the document at that file.
// Insert citation does all three. A DOI, pasted in any of its usual forms,
// is looked up at doi.org. Anything else is searched for at Crossref, the
// registry behind DOIs, and the works found are listed to choose from.
// The entry goes into references.bib beside the document, the document's
// header gains a bibliography line if it has none, and [@key] is placed at
// the cursor, which Quarto and R Markdown turn into a citation and a
// reference list.
//
// The reading of replies and of the header is here, apart from the
// interface, so it can be tested alone.

import type { Backend } from "./backend";
import * as editor from "./editor";
import { activateTab, notify, openDialog, sessionOfFile } from "./app";
import { isDocument } from "./chunks";
import { getState, sessionOf } from "./store";

let api: Backend;

export function initCite(backend: Backend) {
  api = backend;
}

/** The DOI in text such as "doi:10.1038/x", "https://doi.org/10.1038/x",
 * or "10.1038/x", or null when the text is not a DOI. */
export function doiIn(text: string): string | null {
  const found = /(?:^|doi\.org\/|doi:\s*)(10\.\d{4,9}\/\S+)$/i.exec(text.trim());
  return found ? found[1].replace(/[.,;]+$/, "") : null;
}

/** One work found at Crossref, as the dialog lists it. */
export type Work = { doi: string; title: string; authors: string; year: string; journal: string };

/** The works in a Crossref search reply. */
export function worksFrom(json: string): Work[] {
  try {
    const items = JSON.parse(json)?.message?.items;
    if (!Array.isArray(items)) return [];
    return items
      .filter((item) => typeof item?.DOI === "string")
      .map((item) => {
        const names: string[] = (item.author ?? []).map((person: { family?: string; name?: string }) => person.family ?? person.name ?? "").filter(Boolean);
        const authors = names.length > 2 ? `${names[0]} and others` : names.join(" and ");
        return {
          doi: item.DOI,
          title: (item.title?.[0] ?? "Untitled").replace(/<[^>]+>/g, ""),
          authors,
          year: String(item.issued?.["date-parts"]?.[0]?.[0] ?? ""),
          journal: item["container-title"]?.[0] ?? "",
        };
      });
  } catch {
    return [];
  }
}

/**
 * The edit that names references.bib in a document's header: where to
 * insert and what, or null when the header already names a bibliography.
 * A document with no header gets one. Nothing else in it changes.
 */
export function bibliographyEdit(text: string): { at: number; insert: string } | null {
  const lines = text.split("\n");
  if (lines[0]?.trim() === "---") {
    const close = lines.findIndex((line, index) => index > 0 && /^(---|\.\.\.)\s*$/.test(line));
    if (close > 0) {
      if (lines.slice(1, close).some((line) => /^bibliography\s*:/.test(line))) return null;
      const at = lines.slice(0, close).reduce((sum, line) => sum + line.length + 1, 0);
      return { at, insert: "bibliography: references.bib\n" };
    }
  }
  return { at: 0, insert: "---\nbibliography: references.bib\n---\n\n" };
}

/** Opens Insert citation, for a saved document. */
export function openCitation() {
  const { active, tabs } = getState();
  const tab = tabs.find((item) => item.path === active);
  if (!active || !tab || !isDocument(active)) return notify("Citations go in a Quarto or R Markdown document. Open one, and put the cursor where the citation belongs.");
  if (tab.untitled) return notify("Save the document first, so its references file has a folder to go in.");
  openDialog("cite");
}

/** Whether R is free to look a reference up, saying why when it is not. */
function rReady(path: string) {
  const status = sessionOf(sessionOfFile(path)).r.status;
  if (status === "ready") return true;
  notify(status === "busy" ? "R is busy. Look the reference up once this run finishes." : "Citations are looked up through R, which is not running. Start it with Restart R.");
  return false;
}

/** Plain words for a lookup that did not work. */
function lookupProblem(text: string) {
  return /cannot open|resolve|timed out|connect/i.test(text)
    ? "The reference could not be looked up. Check the internet connection, then try again."
    : `The reference could not be looked up. ${text}`;
}

/** Searches Crossref for works matching a title or other words. */
export async function searchWorks(query: string): Promise<Work[] | string> {
  const { active } = getState();
  if (!active || !rReady(active)) return "R is not free to look this up.";
  const reply = await api.cite(sessionOfFile(active), "search", query).catch((error) => ({ ok: false, text: String(error) }));
  if (!reply.ok) return lookupProblem(reply.text);
  return worksFrom(reply.text);
}

/**
 * Cites the work with this DOI at the cursor: adds its BibTeX to
 * references.bib, names that file in the header when it is not named yet,
 * and inserts [@key]. Returns a problem in words, or null when it worked.
 */
export async function citeDoi(doi: string): Promise<string | null> {
  const { active } = getState();
  if (!active || !rReady(active)) return "R is not free to look this up.";
  const reply = await api.cite(sessionOfFile(active), "doi", doi).catch((error) => ({ ok: false, text: String(error) }));
  if (!reply.ok) return lookupProblem(reply.text);
  if (!reply.text.trim().startsWith("@")) return "That DOI did not lead to a reference. Check it, or search by title instead.";
  let key: string;
  try {
    key = await api.bibAdd(active, reply.text);
  } catch (error) {
    return String(error);
  }
  // Only the header changes, and the cursor keeps its place in the text,
  // so the citation lands where it was.
  const edit = bibliographyEdit(editor.getText(active));
  if (edit) editor.replaceSpan(active, edit.at, edit.at, edit.insert);
  openDialog(null);
  // The citation goes at the cursor of the document it was asked for, which
  // comes back to the front if another took its place during the lookup.
  if (getState().active !== active) {
    if (!getState().tabs.some((tab) => tab.path === active)) return null;
    activateTab(active);
  }
  editor.insertAtCursor(`[@${key}]`);
  notify(`Cited as [@${key}]. The reference is in references.bib, and the list of references appears when the document renders.`);
  return null;
}
