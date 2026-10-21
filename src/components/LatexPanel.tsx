// LaTeX on this computer, and the app's own TinyTeX, in one panel. It is
// shown in Settings, under Reports, and under a PDF that could not be made
// for lack of LaTeX, so installing looks and works the same from both.
//
// Each LaTeX found is a choice, named the way its maker names it, such as
// TeX Live 2025, with where it lives. The app's own TinyTeX is offered
// only when it is not installed, with its size stated before anything
// downloads, and progress shows in place while it installs.

import { useEffect } from "react";
import { shortPath, updateSettings } from "../lib/app";
import { cancelLatex, installLatex, refreshLatex, removeLatex } from "../lib/latex";
import { useStore } from "../lib/store";

export function LatexPanel({ onInstalled, compact = false }: { onInstalled?: () => void; compact?: boolean }) {
  const latex = useStore((state) => state.latex);
  const chosen = useStore((state) => state.settings.latexDir);
  useEffect(() => {
    refreshLatex();
  }, []);
  const found = latex.status?.found ?? [];
  const builtin = found.find((item) => item.builtin);
  const install = async () => {
    if (await installLatex()) onInstalled?.();
  };

  return (
    <div className="latex-panel">
      {latex.status === null && <p className="muted">Looking for LaTeX on this computer</p>}
      {latex.status !== null && !found.length && !latex.installing && <p>There is no LaTeX on this computer yet.</p>}
      {!compact && found.length > 0 && (
        <div className="choices" role="radiogroup" aria-label="Which LaTeX to use">
          <label className="check">
            <input type="radio" name="latex-dir" checked={!chosen || !found.some((item) => item.dir === chosen)} onChange={() => updateSettings({ latexDir: "" })} />
            <span>
              The first one found
              <span className="hint">{found[0].name}</span>
            </span>
          </label>
          {found.map((item) => (
            <label key={item.dir} className="check">
              <input type="radio" name="latex-dir" checked={chosen === item.dir} onChange={() => updateSettings({ latexDir: item.dir })} />
              <span>
                {item.builtin ? `The app's own ${item.name}` : item.name}
                <span className="hint">{shortPath(item.dir)}</span>
              </span>
            </label>
          ))}
        </div>
      )}
      {compact && found.length > 0 && !latex.installing && <p>LaTeX is ready: {found[0].builtin ? `the app's own ${found[0].name}` : found[0].name}.</p>}
      {latex.installing ? (
        <div className="latex-progress">
          <p role="status">Installing TinyTeX. This takes a few minutes.</p>
          <progress aria-label="Installing TinyTeX" />
          {latex.lines.length > 0 && <p className="muted truncate latex-line">{latex.lines[latex.lines.length - 1]}</p>}
          <button type="button" className="button quiet" onClick={cancelLatex}>
            Cancel
          </button>
        </div>
      ) : builtin ? (
        !compact && (
          <div className="button-row">
            <button type="button" className="button quiet" onClick={removeLatex}>
              Remove the app's own TinyTeX
            </button>
          </div>
        )
      ) : (
        <div className="latex-offer">
          <p className="hint">
            {found.length
              ? "You can also install TinyTeX, a small LaTeX the app keeps in its own folder."
              : "TinyTeX is a small LaTeX, kept up by Posit, that adds the pieces a document needs as it needs them. The app keeps it in its own folder."}
          </p>
          <button type="button" className={`button ${found.length ? "" : "primary"}`} onClick={install}>
            Install TinyTeX, about 120 MB
          </button>
        </div>
      )}
      {latex.error && (
        <p className="form-note" role="alert">
          {latex.error}
        </p>
      )}
    </div>
  );
}
