import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

// ROAD.JUNCTION.PAINT.1 — visual proof at a repaired junction.
//
// The unit proof (tests/junctionPaintLayoutProof.test.ts) asserts the LAYOUT invariants over
// every junction of four seeded worlds. This looks straight down at the busiest painted
// junction in the live boot world (seed 4242 — the same seed as the operator's evidence
// capture) so the repair is visible rather than merely asserted: one zebra band per
// approach, no barcode stack in the centre, no diagonal slashes across the interior.

test("junction paint: overhead shot of a repaired junction (no stripe fan, no diagonals)", async ({
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
        if (o.name === "RoadJunctionPaint") found = true;
      });
      return found;
    },
    undefined,
    { timeout: 90000 },
  );
  await page.waitForTimeout(2000);
  // Midday, so the white markings read against the asphalt. The world's time of day is
  // derived from Date.now, so offset it rather than freezing it.
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
  const worldView = page.getByRole("button", { name: /World View/i }).first();
  if (await worldView.isVisible().catch(() => false)) {
    await worldView.click();
    await page.waitForTimeout(2500);
  }

  // Aim at the junction carrying the MOST PAINT — the worst stripe-fan offender before
  // the fix, and therefore the most convincing place to look afterwards.
  const aim = await page.evaluate(() => {
    const scene = (window as any).__r3fScene;
    let paint: any = null;
    scene.traverse((o: any) => {
      if (o.name === "RoadJunctionPaint") paint = o;
    });
    const pos = paint.geometry.attributes.position;
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
    // Controls re-apply their transform every frame, so pin the camera from a rAF loop.
    const pin = () => {
      cam.position.set(cx + 0.01, cy + 55, cz + 0.01);
      if (controls?.target) controls.target.set(cx, cy, cz);
      cam.up.set(0, 0, -1);
      cam.lookAt(cx, cy, cz);
      cam.updateProjectionMatrix?.();
      (window as any).__paintShotRaf = requestAnimationFrame(pin);
    };
    pin();
    return { cx, cy, cz, verts: best!.n, junctions: buckets.size };
  });
  console.log(`junction paint shot aimed at ${JSON.stringify(aim)}`);
  expect(aim.junctions).toBeGreaterThan(0);

  await page.waitForTimeout(2500);
  const shot = await page.screenshot();
  // test-results/ is gitignored — the shot is evidence for the PR, not a repo asset.
  mkdirSync("test-results", { recursive: true });
  writeFileSync("test-results/junction-paint-overhead.png", shot);
  // A blank/solid frame compresses to a few KB; a rendered junction does not.
  expect(shot.byteLength).toBeGreaterThan(40000);
});
