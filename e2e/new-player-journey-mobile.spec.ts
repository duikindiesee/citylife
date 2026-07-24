import { test, expect, devices } from "@playwright/test";

// PLAYER.FLAG.S3 — prove the fail-closed, default-OFF new-player-journey gate on a representative
// touch/mobile viewport, driven through the REAL authenticated bootstrap. We do not log in through
// the UI; instead we seed an authenticated session into sessionStorage before the app boots (so the
// operator is a genuine, non-null CITYLIFE_PLAYER — NOT the DEV skip-auth null-operator bypass) and
// stub the token-derived entitlement endpoint to drive OFF / allowlisted / account-switch.
//
// Non-cosmetic assertion: when the journey is OFF the garage entry affordance is ABSENT FROM THE DOM
// (count 0), not merely hidden — so it cannot be opened, and the interior overlay never mounts. When
// UAT allowlists the player it appears and opens by touch. An account switch back to an OFF user
// re-hides it, proving no positive entitlement bleeds across sessions.

const NAV_TIMEOUT = 30_000;
const ASSERT_TIMEOUT = 15_000;
const READY_TIMEOUT = 90_000; // one-off world-layout boot on a slow software-WebGL renderer

// The endpoint the client GETs (through the /kooker proxy). Matched loosely so a proxied host prefix
// never breaks the route.
const FLAG_GLOB = "**/feature-flags/new-player-journey-v1";
const SESSION_KEY = "citylife.session.v5";
const READY_MARKER = 'button[title="Sign out of CityLife"]';
const ENTRY = '[data-build-action="open-showroom"]';
const OVERLAY = '[data-testid="showroom-overlay"]';

test.use({
  ...devices["Pixel 5"],
  hasTouch: true,
  isMobile: true,
  actionTimeout: ASSERT_TIMEOUT,
  navigationTimeout: NAV_TIMEOUT,
});

// A real single-finger tap at the control's hit-tested centre. The showroom runs a continuous WebGL
// turntable that starves Playwright's rAF-based `.tap()` actionability sampling, so we resolve the
// on-screen centre + hit-test it in one evaluate (immune to that starvation) and dispatch a genuine
// touch — while still proving the control is the top-most element at its centre (an honest,
// occlusion-aware reachability check). This mirrors the proven helper in showroom-mobile.spec.ts.
async function touchTap(
  page: import("@playwright/test").Page,
  selector: string,
): Promise<void> {
  const locator = page.locator(selector);
  await expect(locator).toBeVisible({ timeout: ASSERT_TIMEOUT });
  const hit = await page.evaluate((sel) => {
    const target = document.querySelector(sel);
    if (!target) return { hasBox: false, onTarget: false, cx: 0, cy: 0 };
    target.scrollIntoView({ block: "center", inline: "center" });
    const r = target.getBoundingClientRect();
    if (r.width === 0 || r.height === 0)
      return { hasBox: false, onTarget: false, cx: 0, cy: 0 };
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const top = document.elementFromPoint(cx, cy);
    const onTarget = !!top && (top === target || target.contains(top));
    return { hasBox: true, onTarget, cx, cy };
  }, selector);
  expect(hit.hasBox, `${selector} should have a layout box`).toBe(true);
  expect(
    hit.onTarget,
    `${selector} must be the top-most element at its centre (reachable by touch)`,
  ).toBe(true);
  await page.touchscreen.tap(hit.cx, hit.cy);
}

/** Seed an authenticated (non-null operator) CityLife session for `userId` before any app script
 *  runs, so AuthGate mounts the colony straight into the authenticated bootstrap. The token is opaque
 *  (not a real JWT) — the entitlement endpoint is stubbed, so only the session identity matters. */
function authAs(userId: string) {
  return {
    token: `opaque.${userId}.token`,
    expiresAt: Date.now() + 60 * 60 * 1000,
    operator: {
      id: `Player ${userId}`,
      userId,
      scopes: [],
      roles: ["CITYLIFE_PLAYER"],
    },
  };
}

async function bootAs(
  page: import("@playwright/test").Page,
  userId: string,
  enabled: boolean,
): Promise<void> {
  // Stub the token-derived entitlement to the desired state (fail-closed = enabled:false).
  await page.route(FLAG_GLOB, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        enabled,
        state: enabled ? "UAT_ALLOWLIST" : "OFF",
      }),
    }),
  );
  await page.addInitScript(
    ([key, session]) => {
      try {
        window.sessionStorage.setItem(key as string, session as string);
      } catch {
        /* no storage */
      }
    },
    [SESSION_KEY, JSON.stringify(authAs(userId))] as const,
  );
  await page.goto("/", { timeout: NAV_TIMEOUT });
  await page.waitForSelector("canvas", { timeout: NAV_TIMEOUT });
  // The authenticated colony HUD (and thus the gated entry decision) is mounted once the world layout
  // boot resolves and the top bar renders its Log-out control.
  await page.waitForSelector(READY_MARKER, { timeout: READY_TIMEOUT });
}

test("new-player journey gate: OFF hides+blocks entry, allowlist opens it, switch re-hides", async ({
  page,
}) => {
  // Three independent authenticated world-layout boots on a software (non-GPU) WebGL renderer; sized
  // like the showroom-mobile twin. The hard bound remains the OS process-tree kill in the runner.
  test.setTimeout(330_000);

  // 1) Default-OFF authenticated player: the garage entry affordance is absent (not merely hidden)
  //    and the interior overlay never mounts — the gate is not cosmetic.
  await bootAs(page, "uat-off-1", false);
  await expect(page.locator(ENTRY)).toHaveCount(0, { timeout: ASSERT_TIMEOUT });
  await expect(page.locator(OVERLAY)).toHaveCount(0);

  // 2) Operator UAT allowlists this player → entry appears and enters the showroom by touch.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await bootAs(page, "uat-allow-1", true);
  await expect(page.locator(ENTRY)).toBeVisible({ timeout: READY_TIMEOUT });
  await touchTap(page, ENTRY);
  await expect(page.locator(OVERLAY)).toBeVisible({ timeout: ASSERT_TIMEOUT });
  // Acquisition stays honestly locked (preview only) — no economy/ownership in this slice.
  await expect(
    page.locator('[data-build-action="showroom-acquire-preview"]'),
  ).toBeDisabled({ timeout: ASSERT_TIMEOUT });
  await touchTap(page, '[data-build-action="showroom-exit"]');
  await expect(page.locator(OVERLAY)).toHaveCount(0, {
    timeout: ASSERT_TIMEOUT,
  });

  // 3) Account switch to a different, OFF player → the entry is hidden again. No positive
  //    entitlement bled across the session boundary.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await bootAs(page, "uat-off-2", false);
  await expect(page.locator(ENTRY)).toHaveCount(0, { timeout: ASSERT_TIMEOUT });
  await expect(page.locator(OVERLAY)).toHaveCount(0);
});
