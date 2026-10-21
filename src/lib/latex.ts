// LaTeX for PDFs: finding the one on this computer, and installing,
// canceling, and removing the app's own TinyTeX.
//
// The install is a large download, so it starts only when the user asks,
// after saying how large it is, and its progress shows wherever it was
// started from, in Settings or under a PDF that needed LaTeX. Lines the
// install prints are kept short, the latest few, since only the last one
// says where it has got to.

import type { Backend } from "./backend";
import { getState, setState } from "./store";

let api: Backend;
// Only the latest lines are worth showing.
const KEEP = 6;

function patch(change: Partial<ReturnType<typeof getState>["latex"]>) {
  setState((state) => ({ latex: { ...state.latex, ...change } }));
}

export async function initLatex(backend: Backend) {
  api = backend;
  await api.onLatex((text) => {
    if (!text.trim()) return;
    patch({ lines: [...getState().latex.lines, text].slice(-KEEP) });
  });
}

/** Looks again for LaTeX on this computer. */
export async function refreshLatex() {
  const status = await api.latexStatus().catch(() => null);
  if (status) patch({ status, installing: status.installing || getState().latex.installing });
}

/**
 * Installs TinyTeX into the app's own folder, after asking, since it is a
 * large download. Resolves true once it is ready to use.
 */
export async function installLatex(): Promise<boolean> {
  const sure = await api.confirm(
    "Install TinyTeX, a small LaTeX, for making PDFs? It downloads about 120 MB and takes a few minutes. It is kept in the app's own folder, and it adds the pieces a document needs the first time it needs them.",
    "Install",
  );
  if (!sure) return false;
  patch({ installing: true, lines: [], error: "" });
  try {
    await api.latexInstall();
    patch({ installing: false });
    await refreshLatex();
    return true;
  } catch (error) {
    patch({ installing: false, error: String(error).replace(/^Error: /, "") });
    await refreshLatex();
    return false;
  }
}

export function cancelLatex() {
  api.latexCancel().catch(() => {});
}

/** Removes the app's own TinyTeX, after asking. */
export async function removeLatex() {
  const sure = await api.confirm("Remove the app's own TinyTeX? PDFs made with LaTeX will need it, or another LaTeX, again.", "Remove");
  if (!sure) return;
  await api.latexRemove().catch((error) => patch({ error: String(error).replace(/^Error: /, "") }));
  await refreshLatex();
}
