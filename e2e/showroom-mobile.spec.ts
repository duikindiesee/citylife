import { test, expect, devices } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

// PLAYER.GARAGE.1.FIX1 — prove the Gearbox Auto Hub is reachable and fully usable on a representative
// touch/mobile viewport (Pixel 5, coarse pointer, real tap gestures — never a synthetic mouse click).
// A mobile player reaches the hub from the ground/walker frame, so entry, selection, bounded zoom and
// exit are all driven from there by touch; the fitted daylit exterior (PR #360 plot-fit lineage) is
// captured from the aerial survey first. Acquisition stays honestly locked. Screenshots are committed
// evidence (docs/evidence/).

const EVIDENCE_DIR = path.join("docs", "evidence");

// Explicit, bounded timeouts so no Playwright operation can ever wait indefinitely. Every action,
// navigation, assertion and readiness probe below is capped; combined with test.setTimeout the whole
// spec is guaranteed to terminate (pass or fail) instead of hanging a governed worker process.
const NAV_TIMEOUT = 30_000; // page.goto
const ACTION_TIMEOUT = 15_000; // taps, boundingBox, textContent, etc.
const ASSERT_TIMEOUT = 15_000; // expect(...).toBeVisible / toHaveText / ...
const READY_TIMEOUT = 60_000; // one-off scene-readiness probes

function assertNonBlank(file: string): void {
  const stat = fs.statSync(file);
  // A blank/near-uniform mobile PNG compresses to a few KB; a real lit scene does not.
  expect(stat.size, `${file} should be a non-blank screenshot`).toBeGreaterThan(
    18_000,
  );
}

// A representative modern phone: 393-wide CSS px, devicePixelRatio 2.75, coarse pointer, touch enabled.
// actionTimeout / navigationTimeout cap every implicit-wait operation (goto, textContent, boundingBox,
// waitForSelector) so none can block on the full test timeout.
test.use({
  ...devices["Pixel 5"],
  hasTouch: true,
  isMobile: true,
  actionTimeout: ACTION_TIMEOUT,
  navigationTimeout: NAV_TIMEOUT,
});

// A real single-finger tap at the control's on-screen centre. The showroom runs a continuous WebGL
// turntable, which starves Playwright's rAF-based `.tap()` actionability sampling on this device even
// though the button is provably static and unobstructed — so we dispatch a genuine touch at the hit-
// tested centre instead. We still assert the control is the top-most element at that point (an honest
// reachability check) before touching it, so this never masks a real overlap/occlusion regression.
async function touchTap(
  page: import("@playwright/test").Page,
  selector: string,
): Promise<void> {
  const locator = page.locator(selector);
  await expect(locator).toBeVisible({ timeout: ASSERT_TIMEOUT });
  // Resolve the on-screen centre AND hit-test it in a single in-page evaluate. The showroom's
  // continuous WebGL turntable saturates the (software) renderer, so Playwright's own
  // scrollIntoViewIfNeeded/boundingBox stability sampling never settles and each would burn its full
  // timeout. A synchronous getBoundingClientRect + elementFromPoint is one round-trip and is immune to
  // that — while still proving the control is the top-most element at its centre (an honest, occlusion-
  // aware reachability check). These HUD controls are always within the viewport, so no scrolling is
  // needed.
  const hit = await page.evaluate((sel) => {
    const target = document.querySelector(sel);
    if (!target) return { hasBox: false, onTarget: false, cx: 0, cy: 0 };
    // Bring the control into the viewport synchronously (no Playwright stability sampling to starve).
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

test("garage showroom on mobile touch: reachable portal, non-blank interior, touch selection, locked acquire, exit", async ({
  page,
}) => {
  // This drives the full mobile journey (aerial survey + exterior capture, return to ground, touch
  // entry, two lit interior captures, touch selection/zoom/wrap and exit) against a continuously
  // animating WebGL turntable. On a software (non-GPU) renderer that whole flow is slow — the desktop
  // twin needs ~3.7m — and the mobile flow does strictly more (an extra exterior survey + a second
  // interior capture), so it is given headroom above the desktop spec. The hard bound is the OS-level
  // process-tree kill in scripts/run-bounded-e2e.mjs; this per-test cap only guards a single slow run.
  test.setTimeout(360_000);
  const t0 = Date.now();
  const mark = (label: string) =>
    console.log(`[mark] +${((Date.now() - t0) / 1000).toFixed(1)}s ${label}`);

  await page.goto("/?skipauth=1", { timeout: NAV_TIMEOUT });
  await page.waitForSelector("canvas", { timeout: NAV_TIMEOUT });
  await page.waitForFunction(
    () => !!(window as any).__r3fScene && !!(window as any).__colony,
    undefined,
    { timeout: NAV_TIMEOUT },
  );
  // the world is dressed once foliage exists (same readiness probe as the desktop showroom spec)
  await page.waitForFunction(
    () => {
      let f = false;
      (window as any).__r3fScene?.traverse((o: any) => {
        if (o.name === "foliage") f = true;
      });
      return f;
    },
    undefined,
    { timeout: READY_TIMEOUT },
  );

  // Sanity: this really is a coarse-pointer / touch context (no synthetic desktop mouse).
  const isTouch = await page.evaluate(
    () =>
      navigator.maxTouchPoints > 0 ||
      window.matchMedia("(pointer: coarse)").matches,
  );
  expect(isTouch).toBe(true);

  // 1) Prove the commercial garage EXTERIOR: fly the aerial survey camera onto the rendered garage
  //    shell so the fitted daylit landmark fills the frame, then return to the ground frame.
  await touchTap(page, 'button[title="Enter Aerial World View"]');
  await page.waitForTimeout(1000);
  const focused = await page.evaluate(() => {
    const rt = (window as any).__colony;
    rt.debugSetClock(12, 0);
    const scene = (window as any).__r3fScene;
    let shell: any = null;
    scene?.traverse((o: any) => {
      if (o.name === "commercialDistrict.garagePad.garageAnchorShell") shell = o;
    });
    if (!shell) return { ok: false, reason: "no garageAnchorShell in scene" };
    shell.updateWorldMatrix(true, false);
    const wx = shell.matrixWorld.elements[12];
    const wz = shell.matrixWorld.elements[14];
    const N = rt.sim.state.terrain.size;
    const cx = Math.round(wx / 4 + N / 2);
    const cy = Math.round(wz / 4 + N / 2);
    return { ok: rt.focusSurveyCell(cx, cy), shellScale: shell.scale.x };
  });
  console.log(`mobile showroom exterior focus: ${JSON.stringify(focused)}`);
  expect(focused.ok).toBe(true);
  // The plot-fit scale contract from PR #360 must survive the rebase: the shell fills its pad.
  expect(focused.shellScale).toBe(4);
  await page.waitForTimeout(2800); // let the fly-to settle and the frame render

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const exteriorPng = path.join(
    EVIDENCE_DIR,
    "player-garage1-mobile-exterior.png",
  );
  await page.screenshot({ path: exteriorPng });
  assertNonBlank(exteriorPng);

  // Return to the ground/walker frame — the representative frame a mobile player enters the hub from.
  await touchTap(page, 'button[title="Exit World View"]');
  await page.waitForTimeout(800);

  // 2) The exterior portal affordance must be reachable and enter the showroom by TOUCH.
  await expect(
    page.locator('[data-build-action="open-showroom"]'),
  ).toBeVisible({ timeout: ASSERT_TIMEOUT });
  await touchTap(page, '[data-build-action="open-showroom"]');
  await page.waitForSelector('[data-testid="showroom-overlay"]', {
    timeout: ACTION_TIMEOUT,
  });
  await page.waitForTimeout(2000); // let the studio scene light and the turntable start

  // 3) The interior renders a real lit scene (non-blank), not an empty canvas.
  const vonkName = await page.textContent('[data-testid="showroom-card-name"]', {
    timeout: ACTION_TIMEOUT,
  });
  expect(vonkName).toBe("Karoo Vonk 1.1");
  const vonkTopSpeed = await page.textContent(
    '[data-testid="showroom-stat-top-speed"]',
    { timeout: ACTION_TIMEOUT },
  );
  const vonkPng = path.join(
    EVIDENCE_DIR,
    "player-garage1-mobile-showroom-vonk.png",
  );
  await page.screenshot({ path: vonkPng });
  assertNonBlank(vonkPng);

  // Acquisition stays honestly gated (disabled) — no economy/ownership yet.
  await expect(
    page.locator('[data-build-action="showroom-acquire-preview"]'),
  ).toBeDisabled({ timeout: ASSERT_TIMEOUT });

  // 4) Left/right selection by touch — the card and its stats must visibly change.
  await touchTap(page, '[data-build-action="showroom-next"]');
  await expect(page.locator('[data-testid="showroom-card-name"]')).toHaveText(
    "Karoo Kaap GT-V8",
    { timeout: ASSERT_TIMEOUT },
  );
  const kaapTopSpeed = await page.textContent(
    '[data-testid="showroom-stat-top-speed"]',
    { timeout: ACTION_TIMEOUT },
  );
  expect(kaapTopSpeed).not.toBe(vonkTopSpeed);

  // Bounded zoom by touch — tapping the zoom controls must not throw or blank the scene.
  await touchTap(page, '[data-build-action="showroom-zoom-in"]');
  await touchTap(page, '[data-build-action="showroom-zoom-in"]');
  await touchTap(page, '[data-build-action="showroom-zoom-out"]');
  await page.waitForTimeout(1200);
  const kaapPng = path.join(
    EVIDENCE_DIR,
    "player-garage1-mobile-showroom-kaap.png",
  );
  await page.screenshot({ path: kaapPng });
  assertNonBlank(kaapPng);

  // The two interior screenshots must differ (different car, different card).
  expect(fs.readFileSync(vonkPng).equals(fs.readFileSync(kaapPng))).toBe(false);

  // Selection wraps by touch: next from the last vehicle returns to the first.
  await touchTap(page, '[data-build-action="showroom-next"]');
  await expect(page.locator('[data-testid="showroom-card-name"]')).toHaveText(
    "Karoo Vonk 1.1",
    { timeout: ASSERT_TIMEOUT },
  );

  // 5) Exit by touch returns cleanly to the exterior frame (overlay gone, world canvas still mounted,
  //    and the portal affordance reachable again).
  await touchTap(page, '[data-build-action="showroom-exit"]');
  await expect(page.locator('[data-testid="showroom-overlay"]')).toHaveCount(
    0,
    { timeout: ASSERT_TIMEOUT },
  );
  await expect(page.locator("canvas").first()).toBeVisible({
    timeout: ASSERT_TIMEOUT,
  });
  await expect(
    page.locator('[data-build-action="open-showroom"]'),
  ).toBeVisible({ timeout: ASSERT_TIMEOUT });
});
