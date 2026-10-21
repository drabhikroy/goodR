// The Updates page in Settings: every part of the setup that can be
// updated, one row each, saying what is installed, what is newest, and
// the one button that brings it up to date. A row with nothing to do says
// so in a word, so the page can be read at a glance.

import { useEffect, type ReactNode } from "react";
import { savedWhen } from "../lib/fileHistory";
import { useStore } from "../lib/store";
import { checkForUpdates, isNewer, packagesUpdated, openDownload, restartIntoUpdate, updateApp, updateModels, updatePackages } from "../lib/updates";
import { isBatchPending, updateSettings } from "../lib/app";
import { CheckIcon } from "./Icons";
import { Radio } from "./Dialogs";

function Row({ name, now, newest, children }: { name: string; now: string; newest?: string; children: ReactNode }) {
  return (
    <li className="update-row">
      <div className="update-what">
        <strong>{name}</strong>
        <span className="hint">
          {now}
          {newest && ` · newest ${newest}`}
        </span>
      </div>
      <div className="update-action">{children}</div>
    </li>
  );
}

function Current() {
  return (
    <span className="update-current">
      <CheckIcon size={14} label="" /> Up to date
    </span>
  );
}

export function UpdatesPane() {
  const settings = useStore((state) => state.settings);
  const updates = useStore((state) => state.updates);
  const version = useStore((state) => state.info?.version ?? "");
  const r = useStore((state) => state.r);
  const assistant = useStore((state) => state.assistant.status);
  const { latest, packages } = updates;
  const looked = settings.lastUpdateCheck ? `Last checked ${savedWhen(settings.lastUpdateCheck).replace(/^(Today|Yesterday)/, (day) => day.toLowerCase())}.` : "Not checked yet.";
  const appNewer = latest ? isNewer(latest.app, version) : false;
  const rNewer = latest ? isNewer(latest.r, r.version) : false;
  const ollamaNewer = latest && assistant?.connected === "system" ? isNewer(latest.ollama, assistant.version) : false;
  const models = assistant?.installed ?? [];
  const progress = updates.download;
  // The package update runs in R, behind this page, which stays open.
  const updatingPackages = useStore((state) => Boolean(state.updates.packagesBatch) && isBatchPending(state.activeSession, state.updates.packagesBatch ?? undefined));
  useEffect(() => {
    if (updates.packagesBatch && !updatingPackages && r.status === "ready") void packagesUpdated();
  }, [updates.packagesBatch, updatingPackages, r.status]);
  return (
    <>
      <fieldset>
        <legend>Checking for updates</legend>
        <div className="choices row">
          <Radio name="updateChecks" value="auto" current={settings.updateChecks} onChange={(updateChecks) => updateSettings({ updateChecks })}>
            Check once a day
          </Radio>
          <Radio name="updateChecks" value="manual" current={settings.updateChecks} onChange={(updateChecks) => updateSettings({ updateChecks })}>
            Only when I ask
          </Radio>
        </div>
        <div className="update-check">
          <span className="hint" role="status">
            {updates.checking ? "Checking for updates." : looked}
          </span>
          <button type="button" className="button" disabled={updates.checking} onClick={() => checkForUpdates()}>
            {updates.checking ? "Checking" : "Check now"}
          </button>
        </div>
        <p className="hint">Nothing is installed until you press its button. Checking asks GitHub, CRAN, and Ollama for their newest versions, and sends nothing else.</p>
      </fieldset>
      <fieldset>
        <legend>What can be updated</legend>
        <ul className="update-list">
          <Row name="This app" now={`Version ${version}`} newest={appNewer ? latest!.app : undefined}>
            {updates.installed ? (
              <button type="button" className="button primary" onClick={restartIntoUpdate}>
                Restart to finish
              </button>
            ) : progress ? (
              <progress max={progress.total ?? undefined} value={progress.done} aria-label="Downloading the update" />
            ) : appNewer ? (
              <button type="button" className="button primary" onClick={updateApp}>
                {latest!.appInPlace ? `Update to ${latest!.app}` : "Download"}
              </button>
            ) : latest?.app ? (
              <Current />
            ) : (
              <span className="hint">Not checked</span>
            )}
          </Row>
          <Row name="R" now={r.version ? `Version ${r.version}` : "Not running"} newest={rNewer ? latest!.r : undefined}>
            {rNewer ? (
              <button type="button" className="button" onClick={() => openDownload("r")}>
                Get R {latest!.r}
              </button>
            ) : latest?.r ? (
              <Current />
            ) : (
              <span className="hint">Not checked</span>
            )}
          </Row>
          {rNewer && latest!.r.split(".").slice(0, 2).join(".") === r.version.split(".").slice(0, 2).join(".") && <li className="update-note hint">Your packages carry over to R {latest!.r}, since its first two numbers are the same.</li>}
          <Row name="Packages" now={packages ? (packages.packages.length ? `${packages.packages.length} with newer versions` : packages.reached ? "All current" : "CRAN could not be reached") : r.status === "ready" ? "Not checked" : "R needs to be running to check"}>
            {updatingPackages ? (
              <span className="update-busy" role="status">
                Updating. Progress is on the canvas.
              </span>
            ) : packages?.packages.length ? (
              <button type="button" className="button" onClick={updatePackages}>
                Update all
              </button>
            ) : packages?.reached ? (
              <Current />
            ) : null}
          </Row>
          {packages && packages.packages.length > 0 && (
            <li className="update-detail">
              <ul>
                {packages.packages.slice(0, 8).map((item) => (
                  <li key={item.name}>
                    <code>{item.name}</code> {item.installed} to {item.available}
                  </li>
                ))}
                {packages.packages.length > 8 && <li className="hint">and {packages.packages.length - 8} more</li>}
              </ul>
            </li>
          )}
          <Row name="Ollama" now={!assistant?.connected ? "Not set up. It runs the optional assistant." : assistant.connected === "private" ? `Version ${assistant.version}, the app's own copy` : `Version ${assistant.version}`} newest={ollamaNewer ? latest!.ollama : undefined}>
            {ollamaNewer ? (
              <button type="button" className="button" onClick={() => openDownload("ollama")}>
                Get Ollama {latest!.ollama}
              </button>
            ) : assistant?.connected === "private" ? (
              <span className="hint">Updated with the app</span>
            ) : assistant?.connected && latest?.ollama ? (
              <Current />
            ) : null}
          </Row>
          <Row name="Assistant models" now={models.length ? models.map((model) => model.id).join(", ") : "None downloaded"}>
            {models.length > 0 && (
              <button type="button" className="button" disabled={updates.updatingModels} onClick={updateModels}>
                {updates.updatingModels ? "Updating" : models.length === 1 ? "Update the model" : "Update the models"}
              </button>
            )}
          </Row>
        </ul>
      </fieldset>
    </>
  );
}
