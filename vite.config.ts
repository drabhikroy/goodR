import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { onlyRealChanges } from "./scripts/vite/onlyRealChanges";

// Tauri expects a fixed port in development and serves the built files
// from dist in a release build.
export default defineConfig({
  plugins: [react(), onlyRealChanges()],
  clearScreen: false,
  // Every package the interface loads is prepared before the first page
  // load. The Tauri modules are imported only inside the desktop app, so
  // without this list Vite would discover them at run time on a fresh
  // install and reload the page, and each reload restarted R.
  optimizeDeps: {
    include: [
      "@codemirror/autocomplete",
      "@codemirror/commands",
      "@codemirror/language",
      "@codemirror/legacy-modes/mode/r",
      "@codemirror/search",
      "@codemirror/state",
      "@codemirror/view",
      "@lezer/highlight",
      "@tauri-apps/api/core",
      "@tauri-apps/api/event",
      "@tauri-apps/api/window",
      "@tauri-apps/plugin-dialog",
      "@tauri-apps/plugin-opener",
      "react",
      "react-dom/client",
    ],
  },
  // Only the interface's own sources are watched. This file, the scripts it
  // loads, the TypeScript settings, the package files, and the page shell
  // are left out, since Vite restarts or reloads for each of them without
  // asking plugins, so a sync service touching them would do the same. In
  // use, a touch of the plugin file and of tsconfig.json just after start
  // still restarted the server once. The page is still read fresh on each
  // load; restart by hand after editing any of these.
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**", "**/target/**", "**/crates/**", "**/docs/**", "**/design/**", "**/tests/**", "**/test-results/**", "**/vite.config.ts", "**/index.html", "**/scripts/**", "**/tsconfig.json", "**/package.json", "**/package-lock.json", "**/public/**", "**/dist/**", "**/.github/**", "**/*.md"] },
  },
  // The app loads from disk, not the network, so one larger bundle costs
  // nothing at startup and the size warning does not apply.
  build: { target: "safari15", outDir: "dist", sourcemap: false, chunkSizeWarningLimit: 2000 },
  test: { include: ["tests/unit/**/*.test.ts"], environment: "node" },
});
