import { defineConfig } from "@playwright/test";

// PLAYER.GARAGE.1.FIX1 — bounded, timeout-safe, self-cleaning harness for the garage showroom
// mobile/touch UAT. It reuses the PLAYER.MOBILE.E2E.1 pattern (playwright.mobile-harness.config.ts
// + scripts/run-bounded-e2e.mjs OS-level process-tree kill) but is scoped to the single
// showroom-mobile spec and binds its dev server inside this governed worker's allocated port range
// (5630-5639) instead of the shared harness port, so it can never collide with another worker.
//
//   CITYLIFE_E2E_PORT=5630 node scripts/run-bounded-e2e.mjs --config e2e/showroom-mobile.harness.config.ts
//
// The port is env-overridable (default 5630) and stays within 5630-5639. Every bound below mirrors
// the merged mobile harness so a runaway WebGL page can never hang this governed worker.
const PORT = Number(process.env.CITYLIFE_E2E_PORT) || 5630;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./",
  testMatch: /showroom-mobile\.spec\.ts$/,
  // The spec sets its own per-test cap (test.setTimeout) sized for a slow software-WebGL renderer;
  // this default is aligned so the whole mobile journey is never truncated below that. The real
  // last-resort bound is the OS-level process-tree kill in scripts/run-bounded-e2e.mjs.
  timeout: 360_000,
  expect: { timeout: 10_000 },
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
    url: `${BASE_URL}/?skipauth=1`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
