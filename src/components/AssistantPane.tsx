// The assistant, as a tab beside Environment and History. Before setup it
// says what the assistant does and offers the setup steps. After setup it
// is a short conversation: three one press requests about the code at the
// cursor, a box for any other question, and answers whose code can be put
// into the script with one press. Nothing the model writes runs by itself.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { assistOnCode, askAssistant, checkCode, chooseModel, clearConversation, codeBlocks, codeToConsole, insertAssistantCode, isOneOffStep, likeness, openAssistantSetup, replaceWithAssistantCode, stopAnswer } from "../lib/assistant";
import { useStore, type AssistantTurn } from "../lib/store";
import { CheckIcon, CopyIcon, SparkIcon, StopIcon, TriangleIcon } from "./Icons";

export function AssistantPane() {
  const assistant = useStore((state) => state.assistant);
  if (!assistant.model) return <AssistantIntro connecting={assistant.connecting} connected={Boolean(assistant.status?.connected)} />;
  return <AssistantChat />;
}

function AssistantIntro({ connecting, connected }: { connecting: boolean; connected: boolean }) {
  return (
    <section className="assistant-intro" aria-label="Assistant">
      <SparkIcon size={22} />
      <h3>An assistant that runs on this Mac</h3>
      <ul>
        <li>Explains errors and fixes them, in plain words</li>
        <li>Explains code, or adds comments to it</li>
        <li>Writes R from a description of what you want</li>
      </ul>
      <p className="muted">It is optional. It uses Ollama and a free model on this computer, so your code and data stay here.</p>
      {connecting ? (
        <p className="muted" role="status">
          Connecting to Ollama
        </p>
      ) : (
        <button type="button" className="button primary" onClick={openAssistantSetup}>
          {connected ? "Choose a model" : "Set up the assistant"}
        </button>
      )}
    </section>
  );
}

function AssistantChat() {
  const assistant = useStore((state) => state.assistant);
  const installed = assistant.status?.installed ?? [];
  const [question, setQuestion] = useState("");
  const log = useRef<HTMLDivElement>(null);
  const answering = Boolean(assistant.answering);

  // Follows the answer as it streams in.
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [assistant.turns]);

  function send() {
    const text = question.trim();
    if (!text || answering) return;
    setQuestion("");
    askAssistant({ kind: "ask", question: text }, text.length > 60 ? `${text.slice(0, 57)}...` : text);
  }

  return (
    <section className="assistant" aria-label="Assistant">
      <div className="pane-toolbar">
        {installed.length > 1 ? (
          <label className="assistant-model">
            <span className="visually-hidden">Model</span>
            <select value={assistant.model} onChange={(event) => chooseModel(event.target.value)}>
              {installed.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.id}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="muted truncate assistant-model-name">{assistant.model}</span>
        )}
        <button type="button" className="button small quiet push-end" onClick={openAssistantSetup}>
          Models
        </button>
        {assistant.turns.length > 0 && (
          <button type="button" className="button small quiet" onClick={clearConversation}>
            Clear
          </button>
        )}
      </div>
      <div className="assistant-quick" role="group" aria-label="Ask about the code at the cursor">
        <button type="button" className="chip" disabled={answering} onClick={() => assistOnCode("explainCode")}>
          Explain code
        </button>
        <button type="button" className="chip" disabled={answering} onClick={() => assistOnCode("comment")}>
          Add comments
        </button>
        <button type="button" className="chip" disabled={answering} onClick={() => assistOnCode("improve")}>
          Make clearer
        </button>
      </div>
      <div className="assistant-log" ref={log} role="log" aria-live="off" tabIndex={0} aria-label="Conversation">
        {assistant.turns.length === 0 && (
          <p className="muted pane-empty">Put the cursor on some code and press one of the buttons above, or ask anything about R below. When a line fails, its result has an Ask the assistant button.</p>
        )}
        {assistant.turns.map((turn) => (turn.role === "user" ? <p key={turn.id} className="turn-question">{turn.text}</p> : <Answer key={turn.id} turn={turn} />))}
      </div>
      {/* The finished answer is announced once, rather than word by word. */}
      <span className="visually-hidden" role="status">
        {!answering && assistant.turns.length > 0 ? "The assistant finished answering." : ""}
      </span>
      <form
        className="assistant-ask"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <textarea
          id="assistant-input"
          rows={2}
          value={question}
          placeholder="Ask about R, or describe the code you want"
          aria-label="Ask the assistant"
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            // Return sends, as in a chat. Shift Return starts a new line.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
        />
        {answering ? (
          <button type="button" className="button" onClick={stopAnswer}>
            <StopIcon size={11} /> Stop
          </button>
        ) : (
          <button type="submit" className="button primary" disabled={!question.trim()}>
            Ask
          </button>
        )}
      </form>
    </section>
  );
}

/** Inline code in backticks becomes code. Everything stays text, so
 * nothing the model writes can become markup. */
function inline(text: string): ReactNode[] {
  return text.split(/(`[^`\n]+`)/g).map((part, index) => (part.startsWith("`") && part.endsWith("`") && part.length > 2 ? <code key={index}>{part.slice(1, -1)}</code> : part));
}

/** Paragraphs and simple lists from an answer's text. */
function Prose({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  return (
    <>
      {blocks.map((block, index) => {
        const lines = block.split("\n");
        if (lines.every((line) => /^\s*(?:[-*]|\d+[.)])\s+/.test(line))) {
          const ordered = /^\s*\d/.test(lines[0]);
          const items = lines.map((line, item) => <li key={item}>{inline(line.replace(/^\s*(?:[-*]|\d+[.)])\s+/, ""))}</li>);
          return ordered ? <ol key={index}>{items}</ol> : <ul key={index}>{items}</ul>;
        }
        return <p key={index}>{inline(lines.join(" ").replace(/\*\*([^*]+)\*\*/g, "$1"))}</p>;
      })}
    </>
  );
}

function Answer({ turn }: { turn: AssistantTurn }) {
  // Text and code blocks in the order the model wrote them.
  const parts = turn.text.split(/(```[^\n]*\n[\s\S]*?(?:```|$))/g).filter((part) => part.trim());
  return (
    <article className={`turn-answer ${turn.error ? "has-error" : ""}`} aria-label={turn.label} aria-busy={!turn.done}>
      {parts.map((part, index) =>
        part.startsWith("```") ? <CodeSuggestion key={index} code={codeBlocks(part)[0] ?? ""} turn={turn} /> : <Prose key={index} text={part} />,
      )}
      {!turn.done && !turn.text && (
        <p className="muted" role="status">
          Thinking
        </p>
      )}
      {turn.error && (
        <p className="turn-error">
          <TriangleIcon size={14} /> {turn.error}
        </p>
      )}
    </article>
  );
}

/**
 * A code block from an answer, with its actions. Once the answer is done,
 * R's parser reads the code without running it, and the result is shown,
 * so code R cannot read is never inserted unnoticed.
 */
function CodeSuggestion({ code, turn }: { code: string; turn: AssistantTurn }) {
  const [check, setCheck] = useState<"complete" | "incomplete" | "invalid" | "unknown" | null>(null);
  const [copied, setCopied] = useState(false);
  // Replace is offered only for a reworked version of the original code,
  // never for a different step that would wipe it out.
  const replaceable = Boolean(turn.replace) && likeness(turn.replace?.code ?? "", code) >= 0.3;
  // A setup step, such as installing a package, belongs in the console.
  const oneOff = isOneOffStep(code);
  useEffect(() => {
    if (!turn.done || !code.trim()) return;
    let live = true;
    checkCode(code).then((result) => live && setCheck(result));
    return () => {
      live = false;
    };
  }, [turn.done, code]);
  return (
    <figure className="suggestion">
      <pre>
        <code>{code}</code>
      </pre>
      {turn.done && (
        <figcaption className="suggestion-foot">
          {check === "complete" && (
            <span className="check-ok">
              <CheckIcon size={14} /> R can read this code
            </span>
          )}
          {(check === "invalid" || check === "incomplete") && (
            <span className="check-bad">
              <TriangleIcon size={14} /> {check === "invalid" ? "R cannot read this code as written" : "This code looks unfinished"}
            </span>
          )}
          <span className="suggestion-actions">
            {replaceable && turn.replace && (
              <button type="button" className="button small primary" onClick={() => replaceWithAssistantCode(turn, code)}>
                Replace {turn.replace.from === turn.replace.to ? `line ${turn.replace.from + 1}` : `lines ${turn.replace.from + 1} to ${turn.replace.to + 1}`}
              </button>
            )}
            {oneOff && (
              <button type="button" className="button small primary" onClick={() => codeToConsole(code)}>
                Put in the console
              </button>
            )}
            <button type="button" className={`button small ${replaceable || oneOff ? "" : "primary"}`} onClick={() => insertAssistantCode(code)}>
              Insert at cursor
            </button>
            <button
              type="button"
              className="button small quiet"
              aria-label="Copy code"
              onClick={() =>
                navigator.clipboard.writeText(code).then(
                  () => setCopied(true),
                  () => setCopied(false),
                )
              }
            >
              <CopyIcon size={13} /> {copied ? "Copied" : "Copy"}
            </button>
          </span>
        </figcaption>
      )}
    </figure>
  );
}
