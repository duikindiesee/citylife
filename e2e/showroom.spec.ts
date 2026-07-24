import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

// PLAYER.GARAGE.1 — the Gearbox Auto Hub showroom: daylit fitted garage exterior, enterable
// showroom interior with the rotating white plinth, and a working two-vehicle selection whose
// specification card visibly changes. Screenshots are committed evidence (docs/evidence/).

const EVIDENCE_DIR = path.join("docs", "evidence");

function assertNonBlank(file: string): void {
  const stat = fs.statSync(file);
  // A blank/near-uniform 1280x720 PNG compresses to a few KB; a real scene does not.
  expect(stat.size, `${file} should be a non-blank screenshot`).toBeGreaterThan(
    30_000,
  );
}

test("garage showroom: exterior fit, interior plinth, two-vehicle selection", async ({
  page,
}) => {
  test.setTimeout(300_000);

  await page.goto("/?skipauth=1");
  await page.waitForSelector("canvas", { timeout: 30_000 });
  await page.waitForFunction(
    () => !!(window as any).__r3fScene && !!(window as any).__colony,
    undefined,
    { timeout: 30_000 },
  );
  // the world is dressed once foliage exists (same readiness probe as houses.spec.ts)
  await page.waitForFunction(
    () => {
      let f = false;
      (window as any).__r3fScene?.traverse((o: any) => {
        if (o.name === "foliage") f = true;
      });
      return f;
    },
    undefined,
    { timeout: 60_000 },
  );

  // The app boots into the walker; the aerial survey camera (MapControls + focusSurveyCell) only
  // exists in World View, so switch first.
  await page.click('button[title="Enter Aerial World View"]');
  await page.waitForTimeout(1000);

  // Daylight, then aim the aerial camera at the RENDERED garage shell (PR #360 lineage): find the
  // shell group in the scene, convert its world position to a survey cell, and fly there. This is
  // layout-source agnostic (works whether the district came from the sim or an authored map).
  const focused = await page.evaluate(() => {
    const rt = (window as any).__colony;
    rt.debugSetClock(12, 0);
    const scene = (window as any).__r3fScene;
    let shell: any = null;
    scene?.traverse((o: any) => {
      if (o.name === "commercialDistrict.garagePad.garageAnchorShell")
        shell = o;
    });
    if (!shell) return { ok: false, reason: "no garageAnchorShell in scene" };
    shell.updateWorldMatrix(true, false);
    const wx = shell.matrixWorld.elements[12];
    const wz = shell.matrixWorld.elements[14];
    const N = rt.sim.state.terrain.size;
    const cx = Math.round(wx / 4 + N / 2);
    const cy = Math.round(wz / 4 + N / 2);
    return {
      ok: rt.focusSurveyCell(cx, cy),
      cx,
      cy,
      shellScale: shell.scale.x,
    };
  });
  console.log(`showroom exterior focus: ${JSON.stringify(focused)}`);
  expect(focused.ok).toBe(true);
  // The operator-reported size defect: the shell must carry the cells→metres scale so the
  // landmark fills its 16×11-cell pad instead of rendering at quarter size.
  expect(focused.shellScale).toBe(4);
  await page.waitForTimeout(2500); // let the fly-to settle and the frame render

  // Wheel-zoom the aerial camera down onto the pad so the fitted garage fills the frame.
  await page.mouse.move(640, 360);
  for (let i = 0; i < 7; i++) {
    await page.mouse.wheel(0, -400);
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(1200);

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const exteriorPng = path.join(EVIDENCE_DIR, "player-garage1-exterior.png");
  await page.screenshot({ path: exteriorPng });
  assertNonBlank(exteriorPng);

  // Enter the showroom.
  await page.click('[data-build-action="open-showroom"]');
  await page.waitForSelector('[data-testid="showroom-overlay"]', {
    timeout: 10_000,
  });
  await page.waitForTimeout(2000); // let the studio scene light and the turntable start

  const vonkName = await page.textContent('[data-testid="showroom-card-name"]');
  expect(vonkName).toBe("Karoo Vonk 1.1");
  const vonkTopSpeed = await page.textContent(
    '[data-testid="showroom-stat-top-speed"]',
  );

  const vonkPng = path.join(EVIDENCE_DIR, "player-garage1-showroom-vonk.png");
  await page.screenshot({ path: vonkPng });
  assertNonBlank(vonkPng);

  // Move the selection right — the card and stats must visibly change.
  await page.click('[data-build-action="showroom-next"]');
  await expect(page.locator('[data-testid="showroom-card-name"]')).toHaveText(
    "Karoo Kaap GT-V8",
  );
  const kaapTopSpeed = await page.textContent(
    '[data-testid="showroom-stat-top-speed"]',
  );
  expect(kaapTopSpeed).not.toBe(vonkTopSpeed);
  await page.waitForTimeout(1200);

  const kaapPng = path.join(EVIDENCE_DIR, "player-garage1-showroom-kaap.png");
  await page.screenshot({ path: kaapPng });
  assertNonBlank(kaapPng);

  // The two interior screenshots must differ (different car, different card).
  const a = fs.readFileSync(vonkPng);
  const b = fs.readFileSync(kaapPng);
  expect(a.equals(b)).toBe(false);

  // Selection wraps: right from the last vehicle returns to the first.
  await page.click('[data-build-action="showroom-next"]');
  await expect(page.locator('[data-testid="showroom-card-name"]')).toHaveText(
    "Karoo Vonk 1.1",
  );

  // And the exit control leaves the interior cleanly.
  await page.click('[data-build-action="showroom-exit"]');
  await expect(page.locator('[data-testid="showroom-overlay"]')).toHaveCount(0);
});
