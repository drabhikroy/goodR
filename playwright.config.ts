import { defineConfig } from "@playwright/test";

// Interface tests run the browser build, which uses the stand-in backend
// from src/lib/mockBackend.ts. Real R is covered by the Rust integration
// tests and by the desktop smoke test.
export default defineConfig({
  testDir: "tests/ui",
  timeout: 30_000,
  fullyParallel: true,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:1420", viewport: { width: 1440, height: 900 } },
  webServer: { command: "npx vite --port 1420 --strictPort", url: "http://localhost:1420", reuseExistingServer: true },
});
