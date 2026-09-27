import { test, expect, devices, type Page, type Route } from "@playwright/test";
import { installStarterWorldFixture, starterWorldFixture } from "./starterWorldFixture";

// PLAYER.HOME.1D.S2 — verify mobile owned-car/map presentation for first move-in and
// returning residency through authenticated fixture truth. Physical arrival and its
// server-authoritative check remain a separate integration gate; this fixture never posts one.
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
const READY_MARKER = '[data-testid="player-wallet-hud"]';
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

async function routeAll(page: Page, s: DriveState): Promise<void> {
  const {manifest} = JSON.parse(await starterWorldFixture());
  const plot = manifest.plots.find((candidate: {plotId:string}) => candidate.plotId === "wood1_lot_1");
  if (!plot) throw new Error("Drive-home fixture requires its published home plot");
  const zone = plot.geometry.houseZone;
  const script = `house{w:${zone.width} d:${zone.depth} wallH:1 door:s} room{kind:living x:0 y:0 w:${zone.width} d:${zone.depth} win:1}`;
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
  await page.route("**/players/me/vehicle", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ owned: true, vehicleKey: "karoo-vonk-11" }) }),
  );
  await page.route("**/players/me/home/build", (route: Route) =>
    route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({
      plotId:plot.plotId,frameId:plot.frameId,layoutRevision:manifest.layoutRevision,
      geometry:plot.geometry,script,completed:true,
    })}),
  );
  await page.route(TRUTH_RE, (route: Route) => {
    const resident = s.resident || s.bootResident === true;
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        owned: true,
        status: "OWNED",
        neighbourhoodKey: plot.geometry.neighbourhoodKey,
        plotId: plot.plotId,
        frameId: plot.frameId,
        priceKco: 350,
        layoutRevision: manifest.layoutRevision,
        onboardingState: resident ? "RESIDENT" : "CAR_OWNED",
      }),
    });
  });
}

async function bootAs(
  page: Page,
  userId: string,
  s: DriveState,
): Promise<void> {
  await installStarterWorldFixture(page);
  // Scenario truth is registered after safe defaults so Playwright gives it precedence.
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

test("HOME.1D.S2: mobile first move-in uses the owned car and map, without the legacy cursor", async ({
  page,
}) => {
  test.setTimeout(330_000);
  const state: DriveState = {
    flagMode: "on",
    resident: false,
    arrivalCount: { n: 0 },
  };
  await bootAs(page, "demo-user", state);

  await expect(page.locator(ENTRY)).toHaveCount(0, { timeout: READY_TIMEOUT });
  await expect(page.locator(OVERLAY)).toHaveCount(0);
  await expect(page.getByTestId("owned-car-controls")).toBeVisible({ timeout: READY_TIMEOUT });
  await touchTap(page, '[data-testid="player-map-shortcut"]');
  await expect(page.getByTestId("city-map-mode")).toContainText("FIRST MOVE-IN");
  await expect(page.getByTestId("city-map-destination-home")).toBeVisible();
  await expect(page.getByTestId("city-map-destination-gearbox")).toBeVisible();
  expect(state.arrivalCount.n).toBe(0);
});

test("HOME.1D.S2: relogin / second-device boot shows resident free roam without the legacy cursor", async ({
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
  await expect(page.locator(ENTRY)).toHaveCount(0, { timeout: READY_TIMEOUT });
  await expect(page.getByTestId("owned-car-controls")).toBeVisible({ timeout: READY_TIMEOUT });
  await touchTap(page, '[data-testid="player-map-shortcut"]');
  await expect(page.getByTestId("city-map-mode")).toContainText("FREE ROAM");
  await expect(page.getByTestId("city-map-destination-home")).toBeVisible();
  expect(state.arrivalCount.n).toBe(0);
});
