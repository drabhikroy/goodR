// Text R printed, with any warnings in it explained. Script results and
// commands typed at the prompt both show printed text through this, so a
// warning reads the same wherever it appears.
//
// A warning is laid out like an error, headline first, but in the warning
// color and with a different mark, since the line did run. A failed
// package install folds its long build log away behind a button, because
// the explanation already says what the log means.

import { useState } from "react";
import { notify } from "../lib/app";
import { openFixProblems } from "../lib/fixProblems";
import { useStore } from "../lib/store";
import { explainWarning, splitWarnings, type RWarning } from "../lib/warnings";
import { AlertIcon, CopyIcon } from "./Icons";

export function StreamText({ text, name, className = "output-text" }: { text: string; name: string; className?: string }) {
  const platform = useStore((state) => state.info?.platform ?? "macos");
  const [showLog, setShowLog] = useState(false);
  const shown = text.replace(/\n$/, "");
  const split = name === "stderr" ? splitWarnings(shown) : null;
  if (!split || !split.warnings.length) return <pre className={`${className} stream-${name}`}>{shown}</pre>;
  // The same warning repeated, as in a loop, is shown once with a count.
  const counted = new Map<string, { warning: RWarning; count: number }>();
  for (const warning of split.warnings) {
    const key = `${warning.call}\u0000${warning.message}`;
    const seen = counted.get(key);
    if (seen) seen.count += 1;
    else counted.set(key, { warning, count: 1 });
  }
  const before = split.before.replace(/\n$/, "");
  const failedInstall = split.warnings.some((warning) => /had non-zero exit status/.test(warning.message));
  const after = split.after.replace(/\n$/, "");
  return (
    <>
      {before && failedInstall && (
        <div className="install-log">
          <button type="button" className="button small quiet" aria-expanded={showLog} onClick={() => setShowLog(!showLog)}>
            {showLog ? "Hide the install log" : "Show the install log"}
          </button>
          {showLog && (
            <pre className={`${className} stream-${name}`} tabIndex={0} aria-label="Install log">
              {before}
            </pre>
          )}
        </div>
      )}
      {before && !failedInstall && <pre className={`${className} stream-${name}`}>{before}</pre>}
      {[...counted.values()].map(({ warning, count }, index) => (
        <WarningNote key={index} warning={warning} count={count} log={shown} platform={platform} />
      ))}
      {after && <pre className={`${className} stream-${name}`}>{after}</pre>}
    </>
  );
}

/** One warning: what happened, why, what to try, and R's own words. */
function WarningNote({ warning, count, log, platform }: { warning: RWarning; count: number; log: string; platform: string }) {
  const [showOriginal, setShowOriginal] = useState(false);
  const explained = explainWarning(warning, log, platform === "browser" ? "macos" : platform);
  const command = explained.system?.command;
  const copy = async () => {
    if (!command) return;
    try {
      await navigator.clipboard.writeText(command);
      notify("Copied the command. Paste it into Terminal.");
    } catch {
      notify("The command could not be copied. Select it and copy it instead.", "error");
    }
  };
  return (
    <div className="output-warning" role="group" aria-label={`Warning: ${explained.title}`}>
      <p className="warning-title">
        <AlertIcon size={15} />
        <span>
          {explained.title}
          {count > 1 && <span className="muted"> ({count} times)</span>}
        </span>
      </p>
      <p>{explained.detail}</p>
      {command && (
        <div className="warning-command">
          <code>{command}</code>
          <button type="button" className="button small" onClick={copy}>
            <CopyIcon size={13} /> Copy
          </button>
        </div>
      )}
      {explained.hint && (
        <p className="error-hint">
          <strong>Try this:</strong> {explained.hint}
        </p>
      )}
      <div className="button-row">
        {/deprecated|superseded|retired/i.test(warning.message) && (
          <button type="button" className="button small" onClick={openFixProblems}>
            Fix retired code in this script
          </button>
        )}
        <button type="button" className="button small quiet" aria-expanded={showOriginal} onClick={() => setShowOriginal(!showOriginal)}>
          {showOriginal ? "Hide the R message" : "Show the R message"}
        </button>
      </div>
      {showOriginal && <pre className="output-text error-original">{explained.original}</pre>}
    </div>
  );
}
