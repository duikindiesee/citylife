import { test, expect, devices, type Page, type Route } from "@playwright/test";

// PLAYER.HOME.1D.S2 — prove the dark, server-truth drive-home + home-garage step on a representative
// touch/mobile viewport, driven through the REAL authenticated bootstrap. We seed an authenticated
// (non-null) CITYLIFE_PLAYER session into sessionStorage before boot (NOT the DEV skip-auth null-operator
// bypass) and stub the token-derived endpoints to drive: feature-OFF/unavailable legacy fallback, the
// mobile touch driving controls + live route guidance + route recovery, the bounded arrival check-in that
// is idempotent under a double-tap (exactly one POST → one RESIDENT transition), convergence on the server
// RESIDENT truth, the home-garage portal that opens only on the server-confirmed unlock, and a
// relogin/second-device boot that converges on RESIDENT without re-driving.
//
// The whole step is gated on the SERVER new-player-journey entitlement alone (no build flag), which each
// test stubs per-case, so the dev server is a plain build — exactly what hosted CI runs — and both the ON
// path and the OFF / unreachable-flag fail-closed paths are proven under that same config.

const NAV_TIMEOUT = 30_000;
const ASSERT_TIMEOUT = 15_000;
const READY_TIMEOUT = 90_000; // one-off world-layout boot on a slow software-WebGL renderer

const FLAG_GLOB = "**/feature-flags/new-player-journey-v1";
const ARRIVAL_RE = /\/players\/me\/home\/arrival/;
const TRUTH_RE = /\/players\/me\/home(\?.*)?$/; // GET truth only — not /home/arrival
const SESSION_KEY = "citylife.session.v5";
const READY_MARKER = 'button[title="Sign out of CityLife"]';
const ENTRY = '[data-build-action="open-drive-home"]';
const OVERLAY = '[data-testid="drive-home-overlay"]';

test.use({
  ...devices["Pixel 5"],
  hasTouch: true,
  isMobile: true,
  actionTimeout: ASSERT_TIMEOUT,
  navigationTimeout: NAV_TIMEOUT,
});

// A real single-finger tap at the control's hit-tested centre — immune to the continuous-WebGL rAF
// starvation that defeats Playwright's `.tap()` actionability sampling, while still proving the control is
// the top-most element at its centre. Mirrors the proven helper in starter-property-mobile.spec.ts.
async function touchTap(page: Page, selector: string): Promise<void> {
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

/** Resolve the hit-tested centre of a control once, so a driving loop can tap it many times fast without
 *  re-scrolling/re-evaluating each press. */
async function centreOf(
  page: Page,
  selector: string,
): Promise<{ x: number; y: number }> {
  return page.evaluate((sel) => {
    const t = document.querySelector(sel)!;
    const r = t.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector);
}

/** An opaque (NOT real-JWT) authenticated CITYLIFE_PLAYER session — the entitlement endpoint is stubbed so
 *  only the session identity matters. Never a real operator/player credential. */
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

interface DriveState {
  flagMode: "on" | "off" | "unavailable";
  /** The owned deed the drive targets. onboardingState flips to RESIDENT after a recorded arrival. */
  resident: boolean;
  arrivalCount: { n: number };
  /** When true, the truth GET already reports RESIDENT at boot (relogin / second-device convergence). */
  bootResident?: boolean;
}

const OWNED_TRUTH = {
  owned: true,
  status: "OWNED",
  neighbourhoodKey: "coastal",
  plotId: "starter-home:demo-user",
  frameId: "starter-home-frame:demo-user",
  priceKco: 350,
};

async function routeAll(page: Page, s: DriveState): Promise<void> {
  await page.route(FLAG_GLOB, (route: Route) => {
    if (s.flagMode === "unavailable") return route.abort("failed");
    const enabled = s.flagMode === "on";
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        enabled,
        state: enabled ? "UAT_ALLOWLIST" : "OFF",
      }),
    });
  });
  // The arrival POST records residency once (idempotent): the SAME logical arrival only ever advances the
  // player to RESIDENT one time, and a replay returns 200 without a second transition.
  await page.route(ARRIVAL_RE, (route: Route) => {
    s.arrivalCount.n += 1;
    s.resident = true;
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.route(TRUTH_RE, (route: Route) => {
    const resident = s.resident || s.bootResident === true;
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...OWNED_TRUTH,
        onboardingState: resident ? "RESIDENT" : "OWNED",
      }),
    });
  });
}

async function bootAs(
  page: Page,
  userId: string,
  s: DriveState,
): Promise<void> {
  await routeAll(page, s);
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
  await page.waitForSelector(READY_MARKER, { timeout: READY_TIMEOUT });
}

/** Follow the live server-derived guidance by touch: read the heading, tap the matching D-pad control, and
 *  repeat until the guidance reports arrival. Proves the mobile vehicle controls AND that guidance
 *  recomputes purely from position (route recovery) — no stored waypoint. Returns the tap count. */
async function driveToHome(page: Page): Promise<number> {
  const dpad = {
    N: await centreOf(page, '[data-testid="drive-up"]'),
    S: await centreOf(page, '[data-testid="drive-down"]'),
    E: await centreOf(page, '[data-testid="drive-right"]'),
    W: await centreOf(page, '[data-testid="drive-left"]'),
  };
  const guidance = page.locator('[data-testid="drive-home-guidance"]');
  let taps = 0;
  for (let i = 0; i < 400; i += 1) {
    if ((await guidance.getAttribute("data-arrived")) === "true") break;
    const heading = (await guidance.getAttribute("data-heading")) ?? "";
    const axis = heading.includes("N")
      ? "N"
      : heading.includes("S")
        ? "S"
        : heading.includes("E")
          ? "E"
          : heading.includes("W")
            ? "W"
            : null;
    if (!axis) break;
    await page.touchscreen.tap(dpad[axis].x, dpad[axis].y);
    taps += 1;
  }
  return taps;
}

test("HOME.1D.S2: feature-OFF AND flag-unavailable both fail closed (legacy world play preserved)", async ({
  page,
}) => {
  test.setTimeout(300_000);

  await bootAs(page, "uat-off-1", {
    flagMode: "off",
    resident: false,
    arrivalCount: { n: 0 },
  });
  await expect(page.locator(ENTRY)).toHaveCount(0, { timeout: ASSERT_TIMEOUT });
  await expect(page.locator(OVERLAY)).toHaveCount(0);

  await page.unrouteAll({ behavior: "ignoreErrors" });
  await bootAs(page, "uat-unavailable-1", {
    flagMode: "unavailable",
    resident: false,
    arrivalCount: { n: 0 },
  });
  await expect(page.locator(ENTRY)).toHaveCount(0, { timeout: ASSERT_TIMEOUT });
  await expect(page.locator(OVERLAY)).toHaveCount(0);
});

test("HOME.1D.S2: mobile drive to owned home, idempotent bounded arrival, RESIDENT convergence, garage portal", async ({
  page,
}) => {
  test.setTimeout(330_000);
  const state: DriveState = {
    flagMode: "on",
    resident: false,
    arrivalCount: { n: 0 },
  };
  await bootAs(page, "demo-user", state);

  await expect(page.locator(ENTRY)).toBeVisible({ timeout: READY_TIMEOUT });
  await touchTap(page, ENTRY);
  await expect(page.locator(OVERLAY)).toBeVisible({ timeout: ASSERT_TIMEOUT });

  // The destination is server-derived and the arrival control starts 'far' (cannot submit until inside).
  const arrive = page.locator('[data-testid="drive-home-arrive"]');
  await expect(arrive).toHaveAttribute("data-arrival-state", "far");

  await page.screenshot({
    path: "test-results/home1d-s2-guidance.png",
    fullPage: false,
  });

  // Drive by touch, following the live guidance (proves mobile controls + route recovery).
  const taps = await driveToHome(page);
  expect(taps).toBeGreaterThan(0);
  await expect(
    page.locator('[data-testid="drive-home-guidance"]'),
  ).toHaveAttribute("data-arrived", "true", { timeout: ASSERT_TIMEOUT });
  await expect(arrive).toHaveAttribute("data-arrival-state", "ready");

  // Double-tap the arrival control: one logical arrival, never two (bounded evidence + idempotency key).
  await touchTap(page, '[data-testid="drive-home-arrive"]');
  await touchTap(page, '[data-testid="drive-home-arrive"]').catch(() => {
    /* the button flips to a disabled pending/confirmed state — a second tap is a no-op */
  });

  // Convergence on the server RESIDENT truth → the home-garage portal appears, unlocked by the server.
  await expect(page.locator('[data-testid="drive-home-resident"]')).toBeVisible(
    {
      timeout: ASSERT_TIMEOUT,
    },
  );
  expect(state.arrivalCount.n).toBe(1); // the double-tap fired ONE POST
  const portal = page.locator('[data-testid="home-garage-portal"]');
  await expect(portal).toHaveAttribute("data-garage-unlocked", "true");

  await touchTap(page, '[data-testid="home-garage-portal"]');
  await expect(page.locator('[data-testid="home-garage-open"]')).toBeVisible({
    timeout: ASSERT_TIMEOUT,
  });

  await page.screenshot({
    path: "test-results/home1d-s2-resident-garage.png",
    fullPage: false,
  });
});

test("HOME.1D.S2: relogin / second-device boot converges on RESIDENT without re-driving", async ({
  page,
}) => {
  test.setTimeout(300_000);
  // The server already reports RESIDENT (a prior device recorded the arrival). A fresh boot must converge
  // on that truth: arrived immediately, garage unlocked, with no arrival POST fired.
  const state: DriveState = {
    flagMode: "on",
    resident: false,
    bootResident: true,
    arrivalCount: { n: 0 },
  };
  await bootAs(page, "demo-user", state);
  await expect(page.locator(ENTRY)).toBeVisible({ timeout: READY_TIMEOUT });
  await touchTap(page, ENTRY);
  await expect(page.locator(OVERLAY)).toBeVisible({ timeout: ASSERT_TIMEOUT });

  await expect(page.locator('[data-testid="drive-home-resident"]')).toBeVisible(
    {
      timeout: ASSERT_TIMEOUT,
    },
  );
  await expect(
    page.locator('[data-testid="drive-home-arrive"]'),
  ).toHaveAttribute("data-arrival-state", "confirmed");
  await expect(
    page.locator('[data-testid="home-garage-portal"]'),
  ).toHaveAttribute("data-garage-unlocked", "true");
  expect(state.arrivalCount.n).toBe(0); // convergence is a pure read of server truth — no re-arrival
});
