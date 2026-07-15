import { test, expect } from '@playwright/test';

// Spec 121 — the ambient pedestrian crowd. Asserts on the ACTUAL scene: the pedestrian
// instanced meshes exist and the drawn count tracks the colony population (one figure per
// colonist, capped at the 28-figure pool), proving the decorative crowd renders.

test('R3F pedestrians: the crowd renders and tracks the colony population', async ({ page }) => {
  test.setTimeout(120000);

  await page.goto('/?skipauth=1');
  await page.waitForSelector('canvas', { timeout: 30000 });
  await page.waitForTimeout(5000);

  await page.waitForFunction(() => !!(window as any).__r3fScene && !!(window as any).__colony, undefined, { timeout: 15000 });

  // The crowd mounts at boot stage 1 with the rest of the city.
  await page.waitForFunction(() => {
    let found = false;
    (window as any).__r3fScene?.traverse((o: any) => { if (o.name === 'pedestrian-bodies') found = true; });
    return found;
  }, undefined, { timeout: 30000 });

  // Give the frame loop a moment to seed the pool and sync counts.
  await page.waitForTimeout(1500);

  const probe = await page.evaluate(() => {
    let bodies = -1, heads = -1;
    (window as any).__r3fScene?.traverse((o: any) => {
      if (o.name === 'pedestrian-bodies') bodies = o.count;
      if (o.name === 'pedestrian-heads') heads = o.count;
    });
    const colonists = (window as any).__colony?.sim?.state?.colonists ?? -1;
    return { bodies, heads, colonists };
  });

  console.log(`pedestrian bodies: ${probe.bodies}, heads: ${probe.heads}, colonists: ${probe.colonists}`);
  // Bodies and heads share the transform, so their counts must match.
  expect(probe.bodies).toBe(probe.heads);
  expect(probe.bodies).toBeGreaterThanOrEqual(0);
  expect(probe.bodies).toBeLessThanOrEqual(28);
  if (probe.colonists >= 0) {
    expect(probe.bodies).toBe(Math.max(0, Math.min(28, Math.round(probe.colonists))));
  }
});
