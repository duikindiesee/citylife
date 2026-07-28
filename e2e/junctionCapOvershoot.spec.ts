import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

// ROAD.JUNCTION.CAP.1 — visual proof at a repaired junction.
//
// The unit proof (tests/junctionCapEdgeProof.test.ts) shows the cap polygon never leaves
// the union of its arms' carriageways and the kerb paint is collinear with the ribbon's
// edge line. This walks the LIVE world and looks straight down at a real junction, so the
// repair is visible rather than merely asserted: no wedge of asphalt in the verge, and the
// white edge line running straight into the mouth.

test("junction cap: overhead shot of a real junction (no verge wedge, no paint notch)", async ({
  page,
}) => {
  test.setTimeout(180000);

  await page.goto("/?skipauth=1");
  await page.waitForSelector("canvas", { timeout: 30000 });
  await page.waitForFunction(
    () => !!(window as any).__r3fScene && !!(window as any).__r3fCamera,
    undefined,
    { timeout: 30000 },
  );
  await page.waitForFunction(
    () => {
      let found = false;
      (window as any).__r3fScene?.traverse((o: any) => {
        if (o.name === "RoadJunctionCaps") found = true;
      });
      return found;
    },
    undefined,
    { timeout: 90000 },
  );
  await page.waitForTimeout(2000);
  // Shift the sol clock to midday so the asphalt/verge boundary is actually legible; the
  // world's time of day is derived from Date.now, so offset it rather than freezing it.
  await page.evaluate(() => {
    const EPOCH = 1_780_092_000_000,
      MS_PER_SOL = 21_600_000;
    const real = Date.now.bind(Date);
    const now = real();
    const noon =
      EPOCH + (Math.floor((now - EPOCH) / MS_PER_SOL) + 0.5) * MS_PER_SOL;
    const off = noon - now;
    Date.now = () => real() + off;
  });
  // Leave the onboarding first-person view: World View hands the camera to the aerial
  // MapControls, which is the camera __r3fCamera exposes.
  const worldView = page.getByRole("button", { name: /World View/i }).first();
  if (await worldView.isVisible().catch(() => false)) {
    await worldView.click();
    await page.waitForTimeout(2500);
  }

  // Aim straight down at the junction whose cap has the most tarmac (the busiest crossing
  // in the boot world — the worst offender before the fix).
  const aim = await page.evaluate(() => {
    const scene = (window as any).__r3fScene;
    let cap: any = null;
    scene.traverse((o: any) => {
      if (o.name === "RoadJunctionCaps") cap = o;
    });
    const pos = cap.geometry.attributes.position;
    // cluster cap vertices into junctions by a coarse 30 m grid, take the fullest bucket
    const buckets = new Map<
      string,
      { x: number; y: number; z: number; n: number }
    >();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i),
        y = pos.getY(i),
        z = pos.getZ(i);
      const k = `${Math.round(x / 30)},${Math.round(z / 30)}`;
      const b = buckets.get(k) ?? { x: 0, y: 0, z: 0, n: 0 };
      b.x += x;
      b.y += y;
      b.z += z;
      b.n++;
      buckets.set(k, b);
    }
    let best: { x: number; y: number; z: number; n: number } | null = null;
    for (const b of buckets.values()) if (!best || b.n > best.n) best = b;
    const cx = best!.x / best!.n,
      cy = best!.y / best!.n,
      cz = best!.z / best!.n;
    const cam = (window as any).__r3fCamera;
    const controls = (window as any).__r3fControls as any;
    if (controls) controls.enabled = false;
    // The orbit/pan controls re-apply their own transform every frame, so pin the camera
    // from a rAF loop instead of setting it once.
    const pin = () => {
      cam.position.set(cx + 0.01, cy + 78, cz + 0.01);
      if (controls?.target) controls.target.set(cx, cy, cz);
      cam.up.set(0, 0, -1);
      cam.lookAt(cx, cy, cz);
      cam.updateProjectionMatrix?.();
      (window as any).__capShotRaf = requestAnimationFrame(pin);
    };
    pin();
    return {
      cx,
      cy,
      cz,
      verts: best!.n,
      junctions: buckets.size,
      camType: cam.type,
      camUuid: cam.uuid,
    };
  });
  console.log(`junction shot aimed at ${JSON.stringify(aim)}`);
  expect(aim.junctions).toBeGreaterThan(0);

  await page.waitForTimeout(2500);
  const where = await page.evaluate(() => {
    const c = (window as any).__r3fCamera;
    return { x: c.position.x, y: c.position.y, z: c.position.z };
  });
  console.log(`camera settled at ${JSON.stringify(where)}`);
  const shot = await page.screenshot();
  // test-results/ is gitignored — the shot is evidence for the PR, not a repo asset.
  mkdirSync("test-results", { recursive: true });
  writeFileSync("test-results/junction-cap-overhead.png", shot);
  // A blank/solid frame compresses to a few KB; a rendered junction does not.
  expect(shot.byteLength).toBeGreaterThan(40000);
});
