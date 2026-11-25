// The bar along the top of the window a running Shiny app opens in, as
// RStudio's: the app's address, Open in browser, and Reload. The app itself
// is a separate view below this one, loaded straight from its address (see
// app_window in src-tauri/src/shiny.rs), so this page never holds it. The
// address comes from the app's R by way of the fragment, and only an
// address on this computer is shown.

import "@fontsource-variable/dm-sans/opsz.css";
import { invoke } from "@tauri-apps/api/core";
import tokens from "./theme/tokens.json";
import "./styles/appWindow.css";

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

/** Shows the address of the app on show. */
function showAddress(url: string) {
  const local = localAddress(url);
  if (local) address.textContent = local;
}

declare global {
  interface Window {
    showAddress?: (url: string) => void;
  }
}

if (typeof document !== "undefined" && address) {
  const start = fromFragment();
  applyMode(start.mode);
  window.showAddress = showAddress;
  if (start.url) showAddress(start.url);
  document.getElementById("reload")?.addEventListener("click", () => {
    invoke("app_reload").catch(() => {});
  });
  document.getElementById("open")?.addEventListener("click", () => {
    invoke("app_open").catch(() => {});
  });
}
