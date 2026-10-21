import { defineConfig } from "@playwright/test";

// Makes the README's screenshots from the browser build, once in light and
// once in dark, with `npm run screenshots`. Each is saved to docs/images
// with the appearance at the end of its name.
export default defineConfig({
  testDir: "tests/screenshots",
  timeout: 60_000,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:1420", viewport: { width: 1440, height: 900 } },
  projects: [
    { name: "light", use: { colorScheme: "light" } },
    { name: "dark", use: { colorScheme: "dark" } },
  ],
  webServer: { command: "npx vite --port 1420 --strictPort", url: "http://localhost:1420", reuseExistingServer: true },
});
