import { defineConfig } from "@playwright/test";

// PLAYER.MOBILE.E2E.1 — deterministic, timeout-safe, self-cleaning mobile/touch UAT harness.
// Isolated from playwright.config.ts (and its own dev-server port) so this suite's bounds are
// never diluted by other specs, and so it can be run standalone via
// scripts/run-bounded-e2e.mjs, whose outer OS-level timeout is the last-resort backstop if a
// runaway page ever prevents Playwright's own graceful teardown from completing.
export default defineConfig({
  testDir: "./e2e/mobile-harness",
  testMatch: process.env.MOBILE_HARNESS_INCLUDE_HANG_CANARY
    ? /.*\.spec\.ts/
    : /^(?!.*\.hang\.spec\.ts$).*\.spec\.ts$/,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:5194",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "mobile-chromium" }],
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5194",
    url: "http://127.0.0.1:5194/?skipauth=1",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
