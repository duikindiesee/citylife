import { defineConfig } from "@playwright/test";

// PLAYER.HOME.1C — bounded, timeout-safe, self-cleaning harness for the starter-property selection +
// identity-bound house-projection mobile UAT. It reuses the PLAYER.GARAGE.1.FIX1 pattern
// (scripts/run-bounded-e2e.mjs OS-level process-tree kill) and binds its dev server inside this
// governed worker's allocated port range (5630-5639), on 5632 so it can never collide with the
// showroom harness (5630) or the new-player-journey harness (5631).
//
//   CITYLIFE_E2E_PORT=5632 node scripts/run-bounded-e2e.mjs --config e2e/starter-property-mobile.harness.config.ts
//
// The port is env-overridable (default 5632) and stays within 5630-5639. The real last-resort bound is
// the OS-level process-tree kill in scripts/run-bounded-e2e.mjs. The dev server is a plain build (no
// special env) — exactly what hosted CI runs — because the whole step is gated on the SERVER
// new-player-journey entitlement, which each test stubs, so both the ON and OFF/unavailable paths are
// proven without any build flag.
const PORT = Number(process.env.CITYLIFE_E2E_PORT) || 5632;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./",
  testMatch: /starter-property-mobile\.spec\.ts$/,
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
