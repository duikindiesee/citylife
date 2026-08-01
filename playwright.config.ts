import { defineConfig, devices } from "@playwright/test";

// The dev-server port defaults to 5191 (unchanged for CI) but can be overridden so a governed worker
// can keep e2e inside its own allocated port range and never collide with another worker's server.
const PORT = Number(process.env.CITYLIFE_E2E_PORT) || 5191;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // The mobile/touch UAT harness (PLAYER.MOBILE.E2E.1) has its own isolated config, port and
  // process-tree-kill wrapper (playwright.mobile-harness.config.ts, npm run
  // test:e2e:mobile-harness) — it must never be swept into this suite's default testMatch, or
  // its opt-in hang canary would run here unprotected by that wrapper.
  testIgnore: "**/mobile-harness/**",
  timeout: 60_000,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  // CI.E2E.RETRY.1 — one retry on CI, none locally.
  //
  // The verify job is pinned to ONE self-hosted GPU box (ci.yml: `kooker1-gpu`), and the concurrency
  // group is `ci-${{ github.ref }}` — per BRANCH, so runs on different branches never serialise
  // against each other. With a ~24-minute e2e leg at `workers: 1`, several branches' runs sit on that
  // machine at once and a WebGL page load can miss its budget for no reason of its own.
  //
  // The signature is unmistakable, and it is CONTENTION, not a broken spec — three consecutive CI
  // failures, three DIFFERENT victims, every one a timeout with everything else green:
  //
  //   2026-07-31 23:16  claude-citylife/ui-version-stamp  vitest districtDeterminism (5.5 min for one
  //                                                       test) + worldLayoutImportPreflight (10.6 min)
  //   2026-08-01 09:51  chore/bump-0.45.0                 e2e portFinish.spec.ts — canvas never
  //                                                       appeared in 90s. 64 passed, 1 failed.
  //   2026-08-01 09:50  PR 468                            e2e passwordRecovery PWD.REC.9 — page.goto
  //                                                       timeout. 64 passed, 1 failed.
  //
  // A spec that were genuinely broken would fail the same way twice; this picks a new one each run.
  // (The `ECONNREFUSED 127.0.0.1:8081` in those logs is NOT the cause — CI has no kooker gateway, so
  // every run prints it, including the green ones.)
  //
  // ONE retry, deliberately. It is the same trade vite.config.ts already made for vitest (`retry: 2`,
  // and see the note there): a genuine breakage still fails both attempts and still reddens the build,
  // while a contention timeout self-heals instead of costing a human a rerun and another 24 minutes of
  // queue. It is a stopgap for the capacity problem, not a fix for it — the real fix is to stop running
  // a 24-minute GPU e2e leg on every push to every branch.
  //
  // Zero locally: a developer running this on a quiet machine should see a flake, not have it hidden.
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: process.env.CITYLIFE_HARDWARE_WEBGL
          ? {
              args: [
                "--enable-gpu",
                "--ignore-gpu-blocklist",
                "--use-angle=d3d11",
              ],
            }
          : undefined,
      },
    },
  ],
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${PORT}`,
    url: `${BASE_URL}/?skipauth=1`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
