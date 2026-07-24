import { defineConfig } from "@playwright/test";

// PLAYER.FLAG.S3 — bounded, timeout-safe, self-cleaning harness for the new-player-journey
// entitlement gate mobile UAT. It reuses the PLAYER.GARAGE.1.FIX1 pattern
// (scripts/run-bounded-e2e.mjs OS-level process-tree kill) and binds its dev server inside this
// governed worker's allocated port range (5630-5639), on 5631 so it can never collide with the
// showroom harness (5630) or another worker.
//
//   CITYLIFE_E2E_PORT=5631 node scripts/run-bounded-e2e.mjs --config e2e/new-player-journey-mobile.harness.config.ts
//
// The port is env-overridable (default 5631) and stays within 5630-5639. The real last-resort bound
// is the OS-level process-tree kill in scripts/run-bounded-e2e.mjs.
const PORT = Number(process.env.CITYLIFE_E2E_PORT) || 5631;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./",
  testMatch: /new-player-journey-mobile\.spec\.ts$/,
  timeout: 340_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "mobile-chromium" }],
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
