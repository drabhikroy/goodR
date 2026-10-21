// The assistant's setup, in three steps, the same steps as the other apps in
// this family: Ollama first, then an optional look at this Mac, then the
// models. One step shows at a time, with the steps named above it, so the
// person always knows where they are and how much is left (Nielsen 1994,
// visibility of system status). The machine check asks first and can be
// skipped, and the model list gives each model's strengths and weaknesses
// for this work, with a suggestion worked out from fit alone.

import { useEffect, useState } from "react";
import {
  cancelAssistantSetup,
  chooseModel,
  connectAssistant,
  downloadModel,
  installPrivateOllama,
  modelCatalog,
  readMachineSpecs,
  refreshAssistant,
  removeModel,
  removePrivateOllama,
} from "../lib/assistant";
import { openDialog, openUrl } from "../lib/app";
import { useStore } from "../lib/store";
import type { CatalogModel, MachineSpecs, ModelCatalog, ModelFit } from "../lib/types";
import { Modal } from "./Dialogs";
import { CheckIcon, HollowIcon, StopIcon, TriangleIcon } from "./Icons";

type Step = 0 | 1 | 2;
const STEPS = ["Ollama", "This Mac", "Models"];

const close = () => openDialog(null);

export function AssistantSetupDialog() {
  const status = useStore((state) => state.assistant.status);
  // A person who already finished setup comes back to the models.
  const [step, setStep] = useState<Step>(() => (status?.connected ? 2 : 0));
  const [specs, setSpecs] = useState<MachineSpecs | null>(null);
  useEffect(() => {
    refreshAssistant().catch(() => {});
  }, []);
  return (
    <Modal title="Set up the assistant" onClose={close} wide className="assistant-setup">
      <ol className="steps" aria-label="Setup steps">
        {STEPS.map((name, index) => (
          <li key={name} className={index === step ? "is-current" : index < step ? "is-done" : ""} aria-current={index === step ? "step" : undefined}>
            <span className="step-number" aria-hidden="true">
              {index + 1}
            </span>
            {name}
          </li>
        ))}
      </ol>
      {step === 0 && <OllamaStep onNext={() => setStep(1)} />}
      {step === 1 && <MachineStep specs={specs} onSpecs={setSpecs} onBack={() => setStep(0)} onNext={() => setStep(2)} />}
      {step === 2 && <ModelsStep specs={specs} onBack={() => setStep(1)} />}
    </Modal>
  );
}

function Progress({ label }: { label: string }) {
  const setup = useStore((state) => state.assistant.setup);
  if (!setup) return null;
  const share = setup.total > 0 ? Math.min(100, Math.round((setup.completed / setup.total) * 100)) : null;
  return (
    <div className="setup-progress" role="status">
      <div className="setup-progress-text">
        <span>{setup.stage}</span>
        {share !== null && <span className="muted">{`${share} percent of ${(setup.total / 1e9).toFixed(1)} GB`}</span>}
      </div>
      <div className={`meter ${share === null ? "is-waiting" : ""}`} aria-hidden="true">
        <span style={{ width: `${share ?? 100}%` }} />
      </div>
      <button type="button" className="button small quiet" onClick={cancelAssistantSetup}>
        <StopIcon size={11} /> Cancel {label}
      </button>
    </div>
  );
}

function OllamaStep({ onNext }: { onNext: () => void }) {
  const status = useStore((state) => state.assistant.status);
  const connecting = useStore((state) => state.assistant.connecting);
  const setup = useStore((state) => state.assistant.setup);
  const found = status?.found;
  const hasSystem = Boolean(found?.systemPath || found?.systemRunning);
  const [route, setRoute] = useState<"system" | "private">(() => (status?.connected === "private" || !hasSystem ? "private" : "system"));
  const [busy, setBusy] = useState(false);

  async function next() {
    // Pressing Continue twice must not start a second download.
    if (busy) return;
    setBusy(true);
    let ok = false;
    if (status?.connected === route) ok = true;
    else if (route === "system") ok = await connectAssistant("system");
    else if (found?.privateInstalled) ok = await connectAssistant("private");
    else ok = await installPrivateOllama();
    setBusy(false);
    if (ok) onNext();
  }

  return (
    <>
      <div className="dialog-body">
        <p>
          The assistant runs a language model on this Mac with Ollama, a free program. Nothing you type, and none of your code or data, leaves this computer.
        </p>
        <fieldset>
          <legend>Which Ollama should the assistant use?</legend>
          <div className="choices">
            <label className={`choice tall ${route === "system" ? "is-on" : ""} ${hasSystem ? "" : "is-unavailable"}`}>
              <input type="radio" name="ollama" checked={route === "system"} disabled={!hasSystem} onChange={() => setRoute("system")} data-autofocus={hasSystem ? true : undefined} />
              <span>
                <strong>Use the Ollama on this Mac</strong>
                {hasSystem ? (
                  <span className="muted">
                    {found?.systemRunning ? `Found and running, version ${found.systemVersion}.` : "Found. The app starts it when needed."} Models you already downloaded with it can be used.
                  </span>
                ) : (
                  <span className="muted">Not found on this Mac. Install it from ollama.com, then check again.</span>
                )}
              </span>
            </label>
            <label className={`choice tall ${route === "private" ? "is-on" : ""} ${found?.privateSupported === false ? "is-unavailable" : ""}`}>
              <input type="radio" name="ollama" checked={route === "private"} disabled={found?.privateSupported === false} onChange={() => setRoute("private")} data-autofocus={hasSystem ? undefined : true} />
              <span>
                <strong>Install a private copy inside this app</strong>
                <span className="muted">
                  {found?.privateInstalled
                    ? `Installed, version ${found.privateVersion}.`
                    : `Version ${found?.privateVersion ?? ""}, a 167 MB download, checked against Ollama's published checksum.`}{" "}
                  It lives in the app's own folder, runs only while the app is open, and can be removed here in one step.
                </span>
              </span>
            </label>
          </div>
        </fieldset>
        {!hasSystem && (
          <div className="button-row">
            <button type="button" className="button small" onClick={() => openUrl("ollama")}>
              Get Ollama from ollama.com
            </button>
            <button type="button" className="button small quiet" onClick={() => refreshAssistant().catch(() => {})}>
              Check again
            </button>
          </div>
        )}
        {setup?.target === "runtime" && <Progress label="the download" />}
        {status?.connected && (
          <p className="setup-ok">
            <CheckIcon size={16} /> Connected to {status.connected === "private" ? "the private copy" : "the Ollama on this Mac"}, version {status.version}.
          </p>
        )}
      </div>
      <div className="dialog-foot">
        {found?.privateInstalled && (
          <button type="button" className="button quiet hint" onClick={removePrivateOllama}>
            Remove the private copy
          </button>
        )}
        <button type="button" className="button" onClick={close}>
          Cancel
        </button>
        <button type="button" className="button primary" disabled={busy || connecting || (route === "system" && !hasSystem)} onClick={next}>
          {busy || connecting ? (route === "private" && !found?.privateInstalled ? "Installing" : "Connecting") : route === "private" && !found?.privateInstalled ? "Install and continue" : "Continue"}
        </button>
      </div>
    </>
  );
}

function MachineStep({ specs, onSpecs, onBack, onNext }: { specs: MachineSpecs | null; onSpecs: (specs: MachineSpecs) => void; onBack: () => void; onNext: () => void }) {
  const [reading, setReading] = useState(false);
  async function check() {
    setReading(true);
    try {
      onSpecs(await readMachineSpecs());
    } finally {
      setReading(false);
    }
  }
  return (
    <>
      <div className="dialog-body">
        <p>
          To suggest models that suit this Mac, the app can read how much memory and free disk space it has, and which chip it uses. The numbers stay on this computer and are not saved. This step is optional.
        </p>
        {specs ? (
          <dl className="specs">
            <div>
              <dt>Memory</dt>
              <dd>{specs.memoryGb} GB</dd>
            </div>
            <div>
              <dt>Free disk space</dt>
              <dd>{specs.freeDiskGb} GB</dd>
            </div>
            <div>
              <dt>Chip</dt>
              <dd>{specs.chip || "Not reported"}</dd>
            </div>
          </dl>
        ) : (
          <div className="button-row">
            <button type="button" className="button primary" data-autofocus onClick={check} disabled={reading}>
              {reading ? "Checking" : "Check this Mac"}
            </button>
          </div>
        )}
      </div>
      <div className="dialog-foot">
        <button type="button" className="button quiet hint" onClick={onBack}>
          Back
        </button>
        <button type="button" className={`button ${specs ? "primary" : ""}`} onClick={onNext} data-autofocus={specs ? true : undefined}>
          {specs ? "Continue" : "Skip this step"}
        </button>
      </div>
    </>
  );
}

const FIT_WORDS: Record<ModelFit, string> = {
  good: "Fits this Mac well",
  tight: "Runs, but slowly, and other apps may slow down",
  tooLarge: "Too large for this Mac's memory",
  noRoom: "Not enough free disk space",
};

function FitNote({ model }: { model: CatalogModel }) {
  if (!model.fit) return <span className="fit">{`Best with ${model.memoryFloorGb} GB of memory or more`}</span>;
  const Icon = model.fit === "good" ? CheckIcon : model.fit === "tight" ? HollowIcon : TriangleIcon;
  return (
    <span className={`fit fit-${model.fit}`}>
      <Icon size={14} />
      {FIT_WORDS[model.fit]}
    </span>
  );
}

function ModelsStep({ specs, onBack }: { specs: MachineSpecs | null; onBack: () => void }) {
  const assistant = useStore((state) => state.assistant);
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  useEffect(() => {
    modelCatalog(specs).then(setCatalog).catch(() => setCatalog({ models: [], suggested: "" }));
  }, [specs]);
  const installed = assistant.status?.installed ?? [];
  const installedIds = new Set(installed.map((model) => model.id));
  const known = new Set(catalog?.models.map((model) => model.id));
  // Models the person downloaded with Ollama themselves, from the terminal
  // or another app, are found and can be used too.
  const others = installed.filter((model) => !known.has(model.id));
  const downloading = assistant.setup && assistant.setup.target !== "runtime" ? assistant.setup.target : null;

  if (!assistant.status?.connected) {
    return (
      <>
        <div className="dialog-body">
          <p>Ollama is not connected, so models cannot be listed or downloaded yet. Go back to the first step to connect it.</p>
        </div>
        <div className="dialog-foot">
          <button type="button" className="button primary" onClick={onBack} data-autofocus>
            Back
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="dialog-body">
        <p>
          Each model below is free and runs on this Mac. Larger models give better answers but download more and answer more slowly. You can add or remove models at any time.
          {specs ? "" : " The memory each one needs is listed, since this Mac was not checked."}
        </p>
        <ul className="model-list" aria-label="Models">
          {catalog?.models.map((model) => {
            const isInstalled = installedIds.has(model.id);
            const inUse = assistant.model === model.id;
            const suggested = catalog.suggested === model.id;
            return (
              <li key={model.id} className={`model-card ${inUse ? "is-in-use" : ""}`}>
                <div className="model-head">
                  <strong>{model.name}</strong>
                  <span className="muted">{`${model.kind}, about ${model.sizeGb} GB`}</span>
                  {suggested && <span className="badge">{specs ? "Suggested for this Mac" : "A safe first choice"}</span>}
                </div>
                <FitNote model={model} />
                <div className="pros-cons">
                  <div>
                    <p className="pros-cons-label">Good at</p>
                    <ul>
                      {model.pros.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="pros-cons-label">Weaker at</p>
                    <ul>
                      {model.cons.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </div>
                <div className="model-actions">
                  {isInstalled ? (
                    <>
                      {inUse ? (
                        <span className="setup-ok">
                          <CheckIcon size={14} /> In use
                        </span>
                      ) : (
                        <button type="button" className="button small primary" onClick={() => chooseModel(model.id)}>
                          Use this model
                        </button>
                      )}
                      <button type="button" className="button small quiet" onClick={() => removeModel(model.id)}>
                        Remove
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="button small"
                      disabled={Boolean(downloading) || model.fit === "noRoom"}
                      onClick={() => downloadModel(model.id)}
                      aria-label={`Download ${model.name}, about ${model.sizeGb} GB`}
                    >
                      Download
                    </button>
                  )}
                </div>
                {downloading === model.id && <Progress label="the download" />}
              </li>
            );
          })}
        </ul>
        {others.length > 0 && (
          <section aria-label="Other models on this Mac">
            <h3 className="setup-subhead">Other models already on this Mac</h3>
            <ul className="model-list">
              {others.map((model) => (
                <li key={model.id} className={`model-card compact ${assistant.model === model.id ? "is-in-use" : ""}`}>
                  <div className="model-head">
                    <strong>{model.id}</strong>
                    <span className="muted">{`${model.parameters ? `${model.parameters} parameters, ` : ""}${model.sizeGb} GB`}</span>
                  </div>
                  <div className="model-actions">
                    {assistant.model === model.id ? (
                      <span className="setup-ok">
                        <CheckIcon size={14} /> In use
                      </span>
                    ) : (
                      <button type="button" className="button small primary" onClick={() => chooseModel(model.id)}>
                        Use this model
                      </button>
                    )}
                    <button type="button" className="button small quiet" onClick={() => removeModel(model.id)}>
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <div className="dialog-foot">
        <button type="button" className="button quiet hint" onClick={onBack}>
          Back
        </button>
        <button type="button" className="button primary" onClick={close} data-autofocus>
          {assistant.model ? "Done" : "Close"}
        </button>
      </div>
    </>
  );
}
