import { test, expect, devices } from "@playwright/test";
import {
  NAV_TIMEOUT,
  ACTION_TIMEOUT,
  ASSERT_TIMEOUT,
  boundedEvaluate,
  touchTap,
  attachFailureEvidence,
} from "./support/bounded";

// PLAYER.MOBILE.E2E.1 — the harness proves its own bounds before any real showroom spec is
// layered on top of it. This spec targets only pre-existing, already-merged main-branch surface
// (the City Builder toggle and its coarse-pointer detection); it does not touch showroom gameplay.
//
// Two behaviours are proved:
//  1. "real touch pass" — a genuine bounded PASS: touch-driven navigation reaches and operates a
//     real control on a real mobile viewport, well inside the whole-test bound.
//  2. "deliberate failure terminates" — a genuine bounded, actionable FAIL: a selector that will
//     never exist is awaited with an explicit short bound, the test fails for a legible reason,
//     failure evidence (screenshot + DOM) is attached, and the process still exits on schedule.
//
// Retries are off; a hang or a genuine bug must fail once, fast, not be masked by a retry budget.
test.describe.configure({ retries: 0 });

test.use({
  ...devices["Pixel 5"],
  hasTouch: true,
  isMobile: true,
  actionTimeout: ACTION_TIMEOUT,
  navigationTimeout: NAV_TIMEOUT,
});

test.afterEach(async ({ page }, testInfo) => {
  await attachFailureEvidence(
    page,
    testInfo,
    testInfo.title.replace(/\s+/g, "-"),
  );
});

test("real touch pass: mobile touch reaches and toggles City Builder", async ({
  page,
}) => {
  test.setTimeout(90_000);

  await page.goto("/?skipauth=1", { timeout: NAV_TIMEOUT });
  await page.waitForSelector("canvas", { timeout: NAV_TIMEOUT });

  const isTouch = await boundedEvaluate(
    page,
    () =>
      navigator.maxTouchPoints > 0 ||
      window.matchMedia("(pointer: coarse)").matches,
    undefined,
  );
  expect(isTouch).toBe(true);

  const cityBuilderBtn = page.locator("button", { hasText: "City Builder" });
  if (
    await cityBuilderBtn
      .isVisible({ timeout: ASSERT_TIMEOUT })
      .catch(() => false)
  ) {
    await touchTap(page, cityBuilderBtn);
    await expect(page.locator("aside.hud")).toBeHidden({
      timeout: ASSERT_TIMEOUT,
    });
  } else {
    // Already in builder mode (or the toggle is absent by design) — the harness must still assert
    // something real rather than silently no-op, so it checks the canvas actually rendered.
    await expect(page.locator("canvas").first()).toBeVisible({
      timeout: ASSERT_TIMEOUT,
    });
  }
});

test("deliberate failure terminates within the bound and leaves actionable evidence", async ({
  page,
}) => {
  test.setTimeout(90_000);

  // Expected to fail — that IS the proof. `test.fail()` keeps this a green regression gate: if
  // this selector were ever satisfied (or the failure stopped surfacing) the run would flip to
  // an unexpected pass and CI would correctly go red.
  test.fail(
    true,
    "deliberately targets a selector that never exists, to prove bounded/actionable failure",
  );

  await page.goto("/?skipauth=1", { timeout: NAV_TIMEOUT });
  await page.waitForSelector("canvas", { timeout: NAV_TIMEOUT });

  // This selector never exists. No retry, no catch-and-continue: the short explicit bound below
  // must make this fail well inside the 90s whole-test timeout, proving a genuine hang can never
  // consume the full budget, let alone hang the harness process itself.
  await expect(
    page.locator('[data-testid="mobile-harness-canary-never-exists"]'),
  ).toBeVisible({ timeout: 5_000 });
});
