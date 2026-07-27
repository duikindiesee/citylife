// ARCADE.2A — SYNTHETIC component evidence. This is NOT authenticated UAT and must never be described as
// such. It captures desktop + narrow-viewport screenshots of the flag-gated Gamehouse venue and the
// isolated 3D cabinet inspection against a locally-served DEV build, but the "player" and the server truth
// are BOTH fabricated in the browser, not real:
//   - it INJECTS a hand-built CITYLIFE_PLAYER session object into sessionStorage before the app boots
//     (an opaque, non-verifiable token — no real login, no real JWT, no real auth backend); and
//   - it STUBS the `citylife-arcade-3d-v1` entitlement endpoint via page.route(...fulfill) to the state
//     it wants (ON for the canary, OFF for the deny shot) — no real feature-flag / cohort service answers.
// What it therefore PROVES: the client-side gate + render/interaction wiring behave correctly given a
// player session and an entitlement answer (a useful, deterministic component check, and it does use a
// real occlusion-aware pointer click rather than a programmatic el.click()). What it CANNOT prove: that a
// real signed-in player is authenticated by the backend or entitled by a real server flag. That REAL,
// disposable, authenticated proof is a separate deliverable — see scripts/arcade-2a-authenticated-uat.mjs
// and docs/arcade-2a-authenticated-uat.md. No production flag is ever enabled; the flag stays globally OFF.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

console.log(
  "[ARCADE.2A] SYNTHETIC evidence: injected session + STUBBED entitlement endpoint. " +
    "This is component evidence, NOT authenticated UAT. See arcade-2a-authenticated-uat for real proof.",
);

const BASE = process.env.ARCADE_BASE ?? "http://127.0.0.1:5630";
// Synthetic captures land in their own clearly-labelled folder so they can never be mistaken for the
// real authenticated UAT evidence (evidence/arcade-2a-authenticated/).
const OUT = "evidence/arcade-2a-synthetic";
mkdirSync(OUT, { recursive: true });

// The token-derived entitlement endpoint the client GETs (through the /kooker proxy). Matched loosely so
// a proxied host prefix never breaks the route.
const FLAG_GLOB = "**/feature-flags/citylife-arcade-3d-v1";
const SESSION_KEY = "citylife.session.v5";
const READY_MARKER = 'button[title="Sign out of CityLife"]';
const NAV_TIMEOUT = 60000;
const READY_TIMEOUT = 120000; // one-off world-layout boot on a slow software-WebGL renderer

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "narrow", width: 390, height: 844 },
];

const browser = await chromium.launch({
  args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
});

function newContext(vp) {
  return browser.newContext({
    baseURL: BASE,
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
  });
}

/** A FABRICATED (non-null operator) CityLife player session for `userId` — NOT a real login. The token is
 *  a made-up opaque string the backend never issued or validated; combined with the stubbed entitlement
 *  endpoint, only the client-side session identity + CITYLIFE_PLAYER role are being exercised here. */
function fabricatedSessionAs(userId) {
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

/** Inject the FABRICATED session + STUB the per-user entitlement to `enabled`, then boot the app to the
 *  HUD (the Sign-out control proves the world-layout boot resolved). Both inputs are synthetic. */
async function bootAs(page, userId, enabled) {
  await page.route(FLAG_GLOB, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ enabled, state: enabled ? "ON" : "OFF" }),
    }),
  );
  await page.addInitScript(
    ([key, session]) => {
      try {
        window.sessionStorage.setItem(key, session);
      } catch {
        /* no storage */
      }
    },
    [SESSION_KEY, JSON.stringify(fabricatedSessionAs(userId))],
  );
  await page.goto("/", { timeout: NAV_TIMEOUT, waitUntil: "domcontentloaded" });
  await page.waitForSelector("canvas", { timeout: NAV_TIMEOUT });
  await page.waitForSelector(READY_MARKER, { timeout: READY_TIMEOUT });
}

/** A real, occlusion-aware pointer click: resolve the control's on-screen centre, assert it is the
 *  top-most element there (an honest reachability check — NOT a programmatic el.click() that would fire
 *  even under an overlay), then dispatch a genuine mouse click at that point. */
async function pointerClick(page, selector) {
  const hit = await page.evaluate((sel) => {
    const target = document.querySelector(sel);
    if (!target) return { ok: false, reason: "absent", cx: 0, cy: 0 };
    target.scrollIntoView({ block: "center", inline: "center" });
    const r = target.getBoundingClientRect();
    if (r.width === 0 || r.height === 0)
      return { ok: false, reason: "no-box", cx: 0, cy: 0 };
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const top = document.elementFromPoint(cx, cy);
    const onTarget = !!top && (top === target || target.contains(top));
    return { ok: onTarget, reason: onTarget ? "ok" : "occluded", cx, cy };
  }, selector);
  if (!hit.ok)
    throw new Error(`${selector} is not reachable by pointer: ${hit.reason}`);
  await page.mouse.click(hit.cx, hit.cy);
}

let failed = false;
for (const vp of VIEWPORTS) {
  // --- Denied state: the SAME authenticated player, flag OFF → the entry affordance is absent. ---
  {
    const context = await newContext(vp);
    const page = await context.newPage();
    try {
      await bootAs(page, "arcade-canary-off", false);
      const count = await page
        .locator('[data-build-action="open-gamehouse"]')
        .count();
      if (count !== 0)
        throw new Error(`OFF: entry affordance present (count ${count})`);
      await page.screenshot({
        path: `${OUT}/${vp.name}-00-authed-off-denied.png`,
      });
      console.log(`[${vp.name}] OFF-deny OK (affordance absent)`);
    } catch (e) {
      failed = true;
      console.log(`[${vp.name}] OFF-deny FAILED: ${e.message}`);
      await page
        .screenshot({ path: `${OUT}/${vp.name}-00-ERROR.png` })
        .catch(() => {});
    } finally {
      await context.close();
    }
  }

  // --- Entitled canary: authenticated CITYLIFE_PLAYER, flag ON → enter by real pointer, inspect. ---
  {
    const context = await newContext(vp);
    const page = await context.newPage();
    page.on("console", (m) => {
      if (m.type() === "error")
        console.log(`[${vp.name} console.error] ${m.text()}`);
    });
    try {
      await bootAs(page, "arcade-canary-on", true);
      await page.waitForSelector('[data-build-action="open-gamehouse"]', {
        timeout: READY_TIMEOUT,
      });
      await page.waitForTimeout(1200);
      await page.screenshot({
        path: `${OUT}/${vp.name}-01-world-affordance.png`,
      });

      // Enter the venue through the governed-plot affordance by a real, occlusion-aware pointer click.
      await pointerClick(page, '[data-build-action="open-gamehouse"]');
      await page.waitForSelector('[data-testid="gamehouse-overlay"]', {
        timeout: 15000,
      });
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${OUT}/${vp.name}-02-venue.png` });

      // Inspect the cabinet → isolated 3D inspection (real pointer click again).
      await pointerClick(page, '[data-build-action="gamehouse-inspect-cabinet"]');
      await page.waitForSelector('[data-testid="cabinet-inspect-modal"]', {
        timeout: 15000,
      });
      await page.waitForTimeout(2500); // let the 3D viewer settle
      await page.screenshot({
        path: `${OUT}/${vp.name}-03-cabinet-inspect.png`,
      });

      await pointerClick(page, '[data-build-action="inspect-close"]');
      await page.waitForSelector('[data-testid="cabinet-inspect-modal"]', {
        state: "detached",
        timeout: 15000,
      });
      await page.waitForTimeout(400);
      await page.screenshot({
        path: `${OUT}/${vp.name}-04-closed-back-to-venue.png`,
      });
      // The inverse enter/exit portal pair itself is proven at the layout level by the runtime test
      // (gamehousePortalRuntime); this capture proves the authenticated entry + cabinet inspection path.
      console.log(`[${vp.name}] ON-canary OK`);
    } catch (e) {
      failed = true;
      console.log(`[${vp.name}] ON-canary FAILED: ${e.message}`);
      await page
        .screenshot({ path: `${OUT}/${vp.name}-ON-ERROR.png` })
        .catch(() => {});
    } finally {
      await context.close();
    }
  }
}

await browser.close();
process.exit(failed ? 1 : 0);
