import { test, devices } from "@playwright/test";
import { NAV_TIMEOUT, ACTION_TIMEOUT } from "./support/bounded";

// PLAYER.MOBILE.E2E.1 — worst-case stress proof, run on demand
// (`npm run test:e2e:mobile-harness:hang-canary`), NOT part of the default CI step. It
// reproduces the exact failure mode from the PLAYER.GARAGE.1.FIX1 incident: a raw, unprotected
// in-page busy loop inside `page.evaluate`, which has no timeout option of its own and is not
// covered by Playwright's actionTimeout. The point is to prove the *harness process*, not just
// the Playwright test runner, always terminates and reaps its browser/server children — run this
// through `scripts/run-bounded-e2e.mjs`, whose outer OS-level tree-kill is the actual backstop
// being proved; Playwright's own test.setTimeout is deliberately not trusted to be sufficient
// here, because the original incident showed it was not.
test.use({
  ...devices["Pixel 5"],
  hasTouch: true,
  isMobile: true,
  actionTimeout: ACTION_TIMEOUT,
  navigationTimeout: NAV_TIMEOUT,
});

test("deliberate runaway spin never escapes the harness bound", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/?skipauth=1", { timeout: NAV_TIMEOUT });
  await page.waitForSelector("canvas", { timeout: NAV_TIMEOUT });
  // Deliberately unbounded from this call's own perspective: a synchronous busy loop with no
  // internal timeout, awaited directly with no Promise.race guard. This is the exact shape that
  // hung the prior cycle. Proving the wrapper still reaps everything is the point of this file.
  await page.evaluate(() => {
    const start = Date.now();
    while (Date.now() - start < 10 * 60 * 1000) {
      // spin
    }
  });
});
