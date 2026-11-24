// The window a running Shiny app opens in, as RStudio opens one: the app's
// address, Open in browser, and Reload above the app itself. The app is a
// page from its own R on this computer, held in a frame at its own address,
// so its scripts and forms work but it cannot reach this window or the app
// around it. The address comes from the app's R by way of the window's
// fragment, and only an address on this computer is shown.

import "@fontsource-variable/dm-sans/opsz.css";
import { invoke } from "@tauri-apps/api/core";
import tokens from "./theme/tokens.json";
import "./styles/appWindow.css";

const frame = document.getElementById("app") as HTMLIFrameElement;
const address = document.getElementById("address") as HTMLElement;

/** Only an app served from this computer, by the app's own R. */
export function localAddress(url: string) {
  return /^http:\/\/127\.0\.0\.1:\d{2,5}(\/[^\s]*)?$/.test(url) ? url : null;
}

/** Reads the address and the appearance from the fragment, as
 * mode=dark&url=http://127.0.0.1:4741/. */
function fromFragment() {
  const fields = new URLSearchParams(window.location.hash.slice(1));
  return { url: localAddress(fields.get("url") ?? ""), mode: fields.get("mode") ?? "light" };
}

/** The toolbar takes the colors of the main window's appearance. */
function applyMode(mode: string) {
  const modes = tokens.modes as Record<string, Record<string, string>>;
  const values = modes[mode] ?? modes.light;
  const root = document.documentElement;
  for (const key of ["window", "surface", "border", "text", "textMuted", "hover", "focus"]) {
    root.style.setProperty(`--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`, values[key]);
  }
  root.style.colorScheme = mode === "dark" ? "dark" : "light";
}

/** Shows an app, or loads the one on show again. */
function showApp(url: string) {
  const local = localAddress(url);
  if (!local) return;
  address.textContent = local;
  // Setting the same address again loads the page afresh.
  frame.src = "about:blank";
  requestAnimationFrame(() => {
    frame.src = local;
  });
}

declare global {
  interface Window {
    showApp?: (url: string) => void;
  }
}

if (typeof document !== "undefined" && frame) {
  const start = fromFragment();
  applyMode(start.mode);
  window.showApp = showApp;
  if (start.url) showApp(start.url);
  document.getElementById("reload")?.addEventListener("click", () => {
    if (address.textContent) showApp(address.textContent);
  });
  document.getElementById("open")?.addEventListener("click", () => {
    invoke("app_open").catch(() => {});
  });
}
