// ARCADE.2A — REAL authenticated UAT capture. Unlike scripts/arcade-2a-screens-synthetic.mjs, this harness
// fabricates NOTHING and stubs NOTHING:
//   - it seeds ONLY a REAL, backend-issued disposable-player session that the OPERATOR obtained by a real
//     login (supplied via the KOOKER_TEST_SESSION env var — never hard-coded, never logged, never
//     committed); and
//   - it does NOT intercept the `citylife-arcade-3d-v1` entitlement endpoint. The venue's visibility is
//     decided by the REAL kooker backend answering the real per-user/cohort flag for that real bearer
//     token, through the app's own /kooker proxy to a REAL non-production gateway (KOOKER_GATEWAY).
//
// This is therefore genuine authenticated evidence: a real JWT the backend authenticates, and a real
// server entitlement decision. It is OPERATOR-GATED — see docs/arcade-2a-authenticated-uat.md for the full
// runbook (stand up the ephemeral backend, create the disposable account, grant/kill the scoped flag,
// export the session, run this, then CLEAN UP). No production flag is ever enabled by this script.
//
// SECURITY: the session/token is read from the environment and is NEVER printed. Do not paste a token on a
// command line that gets shell-logged; prefer a throwaway env export the operator clears afterwards.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.ARCADE_BASE ?? "http://127.0.0.1:5630";
const OUT = "evidence/arcade-2a-authenticated";
const SESSION_KEY = "citylife.session.v5";
const READY_MARKER = 'button[title="Sign out of CityLife"]';
const NAV_TIMEOUT = 60000;
const READY_TIMEOUT = 120000;

// The REAL disposable-player session JSON (the app's session shape, carrying the backend-issued token).
// Absent ⇒ we refuse to run rather than silently degrade into a fake capture.
const REAL_SESSION = process.env.KOOKER_TEST_SESSION ?? "";
// What the operator has arranged server-side for this run: "allow" (flag granted to the disposable player)
// or "deny" (no grant / flag OFF / killed). Drives which assertions + shots we take. Default: allow.
const EXPECT = (process.env.ARCADE_EXPECT ?? "allow").toLowerCase();

if (!REAL_SESSION) {
  console.error(
    "[ARCADE.2A] REFUSING TO RUN: KOOKER_TEST_SESSION is empty. This harness must use a REAL, " +
      "backend-issued disposable-player session — it will not fabricate one. See " +
      "docs/arcade-2a-authenticated-uat.md.",
  );
  process.exit(2);
}
if (!process.env.KOOKER_GATEWAY) {
  console.error(
    "[ARCADE.2A] REFUSING TO RUN: KOOKER_GATEWAY is unset. Point the DEV build's /kooker proxy at a REAL " +
      "NON-PRODUCTION gateway so the entitlement endpoint is answered for real (never api.kooker.co.za).",
  );
  process.exit(2);
}
console.log(
  `[ARCADE.2A] REAL authenticated UAT — expect=${EXPECT}. No stubbing, no fabrication. ` +
    "Session + token read from env and never printed.",
);
mkdirSync(OUT, { recursive: true });

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

/** Boot signed-out (no session seeded) — the app must show the login gate and never the venue affordance. */
async function bootSignedOut(page) {
  await page.goto("/", { timeout: NAV_TIMEOUT, waitUntil: "domcontentloaded" });
  await page
    .waitForSelector("canvas", { timeout: NAV_TIMEOUT })
    .catch(() => {});
}

/** Boot with the REAL session seeded. The entitlement endpoint is deliberately NOT routed/stubbed, so the
 *  real backend decides visibility via the app's own proxied GET with the real bearer token. */
async function bootAuthenticated(page) {
  await page.addInitScript(
    ([key, session]) => {
      try {
        window.sessionStorage.setItem(key, session);
      } catch {
        /* no storage */
      }
    },
    [SESSION_KEY, REAL_SESSION],
  );
  await page.goto("/", { timeout: NAV_TIMEOUT, waitUntil: "domcontentloaded" });
  await page.waitForSelector("canvas", { timeout: NAV_TIMEOUT });
  await page.waitForSelector(READY_MARKER, { timeout: READY_TIMEOUT });
}

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
  // --- Signed-out: no session at all → the venue affordance must be absent (real fail-closed deny). ---
  {
    const context = await newContext(vp);
    const page = await context.newPage();
    try {
      await bootSignedOut(page);
      const count = await page
        .locator('[data-build-action="open-gamehouse"]')
        .count();
      if (count !== 0)
        throw new Error(
          `signed-out: entry affordance present (count ${count})`,
        );
      await page.screenshot({
        path: `${OUT}/${vp.name}-00-signedout-denied.png`,
      });
      console.log(`[${vp.name}] signed-out deny OK (affordance absent)`);
    } catch (e) {
      failed = true;
      console.log(`[${vp.name}] signed-out FAILED: ${e.message}`);
    } finally {
      await context.close();
    }
  }

  // --- Authenticated: REAL session, REAL backend entitlement decision (nothing stubbed). ---
  {
    const context = await newContext(vp);
    const page = await context.newPage();
    page.on("console", (m) => {
      if (m.type() === "error")
        console.log(`[${vp.name} console.error] ${m.text()}`);
    });
    try {
      await bootAuthenticated(page);
      const affordance = page.locator('[data-build-action="open-gamehouse"]');

      if (EXPECT === "deny") {
        // Operator arranged NO grant / flag OFF / killed → the real entitlement must deny this real player.
        await page.waitForTimeout(2000); // allow the real entitlement round-trip to resolve
        const count = await affordance.count();
        if (count !== 0)
          throw new Error(`authed-deny: affordance present (count ${count})`);
        await page.screenshot({
          path: `${OUT}/${vp.name}-10-authed-killed-or-off-denied.png`,
        });
        console.log(`[${vp.name}] authed deny (killed/OFF) OK`);
      } else {
        // Operator granted the scoped flag to this real disposable player → real allow, enter + inspect.
        await affordance.waitFor({ state: "visible", timeout: READY_TIMEOUT });
        await page.waitForTimeout(1000);
        await page.screenshot({
          path: `${OUT}/${vp.name}-20-authed-allowed-affordance.png`,
        });
        await pointerClick(page, '[data-build-action="open-gamehouse"]');
        await page.waitForSelector('[data-testid="gamehouse-overlay"]', {
          timeout: 15000,
        });
        await page.waitForTimeout(800);
        await page.screenshot({
          path: `${OUT}/${vp.name}-21-authed-venue.png`,
        });
        await pointerClick(
          page,
          '[data-build-action="gamehouse-inspect-cabinet"]',
        );
        await page.waitForSelector('[data-testid="cabinet-inspect-modal"]', {
          timeout: 15000,
        });
        await page.waitForTimeout(2500);
        await page.screenshot({
          path: `${OUT}/${vp.name}-22-authed-cabinet-inspect.png`,
        });
        await pointerClick(page, '[data-build-action="inspect-close"]');
        await page.waitForSelector('[data-testid="cabinet-inspect-modal"]', {
          state: "detached",
          timeout: 15000,
        });
        console.log(`[${vp.name}] authed allow OK`);
      }
    } catch (e) {
      failed = true;
      console.log(`[${vp.name}] authed (${EXPECT}) FAILED: ${e.message}`);
    } finally {
      await context.close();
    }
  }
}

await browser.close();
process.exit(failed ? 1 : 0);
