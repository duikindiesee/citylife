import { test, expect, devices, type Page, type Route } from "@playwright/test";

// PLAYER.HOME.1C — prove the dark, server-truth starter-property step on a representative touch/mobile
// viewport, driven through the REAL authenticated bootstrap. We seed an authenticated (non-null)
// CITYLIFE_PLAYER session into sessionStorage before boot (NOT the DEV skip-auth null-operator bypass)
// and stub the token-derived endpoints to drive: feature-OFF legacy fallback, server-eligible-only
// rendering (private neighbourhood omitted by the authority), canonical price + wallet display, a
// double-tap-idempotent purchase that yields exactly one deterministic identity-bound house, cross-boot
// (re-login / second device) convergence on the SAME house, and loading/error/retry.
//
// The whole step is gated on the SERVER new-player-journey entitlement alone (no build flag), which each
// test stubs per-case, so the dev server is a plain build — exactly what hosted CI runs — and both the
// ON path and the OFF / unreachable-flag fail-closed paths are proven under that same config.

const NAV_TIMEOUT = 30_000;
const ASSERT_TIMEOUT = 15_000;
const READY_TIMEOUT = 90_000; // one-off world-layout boot on a slow software-WebGL renderer

const FLAG_GLOB = "**/feature-flags/new-player-journey-v1";
const ELIGIBLE_RE = /\/players\/me\/home\/eligible-neighbourhoods/;
const PURCHASE_RE = /\/players\/me\/home\/purchase/;
const TRUTH_RE = /\/players\/me\/home(\?.*)?$/; // GET truth only — not /home/purchase or /home/eligible-*
const SESSION_KEY = "citylife.session.v5";
const READY_MARKER = 'button[title="Sign out of CityLife"]';
const ENTRY = '[data-build-action="open-home"]';
const OVERLAY = '[data-testid="starter-property-overlay"]';

test.use({
  ...devices["Pixel 5"],
  hasTouch: true,
  isMobile: true,
  actionTimeout: ASSERT_TIMEOUT,
  navigationTimeout: NAV_TIMEOUT,
});

// A real single-finger tap at the control's hit-tested centre — immune to the continuous-WebGL rAF
// starvation that defeats Playwright's `.tap()` actionability sampling, while still proving the control
// is the top-most element at its centre (an honest, occlusion-aware reachability check). Mirrors the
// proven helper in new-player-journey-mobile.spec.ts.
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

/** An opaque (NOT real-JWT) authenticated CITYLIFE_PLAYER session — the entitlement endpoint is stubbed
 *  so only the session identity matters. Never a real operator/player credential. */
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

interface HomeState {
  /** on = server allowlists this player; off = server says OFF; unavailable = the flag endpoint is
   *  unreachable/errored (the hosted ECONNREFUSED case) — both non-on modes must fail closed. */
  flagMode: "on" | "off" | "unavailable";
  eligibleStatus?: number;
  eligible?: unknown;
  truth: Record<string, unknown>;
  /** flipped to true after a successful purchase, so the truth GET then reports OWNED */
  purchaseCount: { n: number };
}

async function routeAll(page: Page, s: HomeState): Promise<void> {
  await page.route(FLAG_GLOB, (route: Route) => {
    // Simulate an unreachable flag endpoint (backend down / proxy ECONNREFUSED) — the gate must fail
    // closed on it, exactly as it did on hosted CI where the entry correctly never rendered.
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
  await page.route(ELIGIBLE_RE, (route: Route) =>
    route.fulfill({
      status: s.eligibleStatus ?? 200,
      contentType: "application/json",
      body: JSON.stringify(s.eligible ?? { neighbourhoods: [] }),
    }),
  );
  await page.route(ELIGIBLE_RE, (route: Route) =>
    route.fulfill({
      status: s.eligibleStatus ?? 200,
      contentType: "application/json",
      body: JSON.stringify(s.eligible ?? { neighbourhoods: [] }),
    }),
  );
  await page.route(PURCHASE_RE, (route: Route) => {
    s.purchaseCount.n += 1;
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.route(TRUTH_RE, (route: Route) => {
    // Once a purchase has settled, the authoritative truth reports the OWNED deed.
    const body =
      s.purchaseCount.n > 0
        ? {
            owned: true,
            status: "OWNED",
            neighbourhoodKey: "coastal",
            plotId: "starter-home:demo-user",
            frameId: "starter-home-frame:demo-user",
            onboardingState: "OWNED",
            priceKco: 350,
          }
        : s.truth;
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

async function bootAs(page: Page, userId: string, s: HomeState): Promise<void> {
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

const NOT_OWNED = {
  owned: false,
  status: null,
  neighbourhoodKey: null,
  plotId: null,
  onboardingState: "NONE",
};

// The SERVER returns only public, eligible starter neighbourhoods — a private hamlet is omitted by the
// authority and so can never appear (the client adds no choice of its own).
const ELIGIBLE_PUBLIC = {
  neighbourhoods: [
    { key: "coastal", name: "Coastal Commons", priceKco: 350 },
    { key: "vale2", name: "Green Vale", priceKco: 350 },
  ],
};

test("HOME.1C: feature-OFF AND flag-unavailable both fail closed (legacy entry preserved)", async ({
  page,
}) => {
  test.setTimeout(300_000);

  // 1) Server says OFF → the entry is absent from the DOM (not merely hidden), so it cannot be opened
  //    and the legacy entry stands.
  await bootAs(page, "uat-off-1", {
    flagMode: "off",
    eligible: ELIGIBLE_PUBLIC,
    truth: NOT_OWNED,
    purchaseCount: { n: 0 },
  });
  await expect(page.locator(ENTRY)).toHaveCount(0, { timeout: ASSERT_TIMEOUT });
  await expect(page.locator(OVERLAY)).toHaveCount(0);

  // 2) The flag endpoint is UNREACHABLE (backend down / proxy ECONNREFUSED — the exact hosted case).
  //    The fail-closed entitlement must keep the entry absent; an outage never exposes the step.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await bootAs(page, "uat-unavailable-1", {
    flagMode: "unavailable",
    eligible: ELIGIBLE_PUBLIC,
    truth: NOT_OWNED,
    purchaseCount: { n: 0 },
  });
  await expect(page.locator(ENTRY)).toHaveCount(0, { timeout: ASSERT_TIMEOUT });
  await expect(page.locator(OVERLAY)).toHaveCount(0);
});

test("HOME.1C: eligible-only render, double-tap-idempotent purchase, deterministic identity-bound house, cross-boot convergence", async ({
  page,
}) => {
  test.setTimeout(330_000);
  const state: HomeState = {
    flagMode: "on",
    eligible: ELIGIBLE_PUBLIC,
    truth: NOT_OWNED,
    purchaseCount: { n: 0 },
  };
  await bootAs(page, "demo-user", state);

  // Enter the guided property step by touch.
  await expect(page.locator(ENTRY)).toBeVisible({ timeout: READY_TIMEOUT });
  await touchTap(page, ENTRY);
  await expect(page.locator(OVERLAY)).toBeVisible({ timeout: ASSERT_TIMEOUT });

  // Server-eligible choices only + canonical price + wallet truth are shown.
  await expect(page.locator('[data-testid="home-choice-coastal"]')).toBeVisible();
  await expect(page.locator('[data-testid="home-choice-vale2"]')).toBeVisible();
  await expect(page.locator('[data-testid="home-price-coastal"]')).toContainText(
    "350",
  );
  await expect(page.locator('[data-testid="home-wallet"]')).toBeVisible();
  // Private / non-eligible neighbourhood is omitted by the authority → never rendered.
  await expect(
    page.locator('[data-testid="home-choice-private-hamlet"]'),
  ).toHaveCount(0);

  await page.screenshot({
    path: "test-results/home1c-select.png",
    fullPage: false,
  });

  // Double-tap the purchase control: one logical purchase, never two.
  await touchTap(page, '[data-testid="home-purchase"]');
  await touchTap(page, '[data-testid="home-purchase"]').catch(() => {
    /* the button flips to a disabled pending/owned state — a second tap is a no-op */
  });

  // Exactly one deterministic, identity-bound house projects.
  const owned = page.locator('[data-testid="home-owned"]');
  await expect(owned).toBeVisible({ timeout: ASSERT_TIMEOUT });
  await expect(owned).toHaveCount(1);
  expect(state.purchaseCount.n).toBe(1); // the double-tap fired ONE POST

  const seed = await owned.getAttribute("data-house-seed");
  const placement = await owned.getAttribute("data-placement");
  expect(seed).toBeTruthy();
  expect(placement).toMatch(/^\d+,\d+$/);

  await page.screenshot({
    path: "test-results/home1c-owned.png",
    fullPage: false,
  });

  // Cross-boot convergence: a re-login / second device re-fetching the SAME authoritative truth must
  // land on the SAME house at the SAME place (pure projection of server truth, no client authority).
  await page.reload({ timeout: NAV_TIMEOUT });
  await page.waitForSelector(READY_MARKER, { timeout: READY_TIMEOUT });
  await touchTap(page, ENTRY);
  const owned2 = page.locator('[data-testid="home-owned"]');
  await expect(owned2).toBeVisible({ timeout: ASSERT_TIMEOUT });
  expect(await owned2.getAttribute("data-house-seed")).toBe(seed);
  expect(await owned2.getAttribute("data-placement")).toBe(placement);
});

test("HOME.1C: eligible-list read failure shows retry, then recovers", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const state: HomeState = {
    flagMode: "on",
    eligibleStatus: 500,
    eligible: {},
    truth: NOT_OWNED,
    purchaseCount: { n: 0 },
  };
  await bootAs(page, "retry-user", state);
  await expect(page.locator(ENTRY)).toBeVisible({ timeout: READY_TIMEOUT });
  await touchTap(page, ENTRY);
  await expect(page.locator('[data-testid="home-error"]')).toBeVisible({
    timeout: ASSERT_TIMEOUT,
  });

  // Recover the endpoint, then retry → the server-eligible choices load.
  await page.unroute(ELIGIBLE_RE);
  await page.route(ELIGIBLE_RE, (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(ELIGIBLE_PUBLIC),
    }),
  );
  await touchTap(page, '[data-testid="home-retry"]');
  await expect(page.locator('[data-testid="home-choice-coastal"]')).toBeVisible({
    timeout: ASSERT_TIMEOUT,
  });
});
