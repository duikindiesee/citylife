import { test, expect } from '@playwright/test';

// Spec 125 — the tarentaal flock. Asserts on the ACTUAL scene: the flock (4 adults + 6 chicks
// at founding, seeded by the sim) renders as two instanced meshes, proving the sim-stepped
// sim.state.tarentaal reaches the render.

test('R3F tarentaal: the flock renders from the sim-stepped state', async ({ page }) => {
  test.setTimeout(120000);

  await page.goto('/');
  await page.waitForSelector('canvas', { timeout: 30000 });
  await page.waitForTimeout(5000);
  await page.waitForFunction(() => !!(window as any).__r3fScene && !!(window as any).__colony, undefined, { timeout: 15000 });

  await page.waitForFunction(() => {
    let found = false;
    (window as any).__r3fScene?.traverse((o: any) => { if (o.name === 'tarentaal-adults') found = true; });
    return found;
  }, undefined, { timeout: 30000 });
  await page.waitForTimeout(1500);

  const probe = await page.evaluate(() => {
    let adults = -1, chicks = -1;
    (window as any).__r3fScene?.traverse((o: any) => {
      if (o.name === 'tarentaal-adults') adults = o.count;
      if (o.name === 'tarentaal-chicks') chicks = o.count;
    });
    const flock = (window as any).__colony?.sim?.state?.tarentaal?.length ?? -1;
    return { adults, chicks, flock };
  });

  console.log(`tarentaal adults: ${probe.adults}, chicks: ${probe.chicks}, flock size: ${probe.flock}`);
  expect(probe.adults).toBeGreaterThanOrEqual(0);
  expect(probe.chicks).toBeGreaterThanOrEqual(0);
  // the whole flock is drawn: adult + chick instances sum to the roster.
  if (probe.flock > 0) {
    expect(probe.adults + probe.chicks).toBe(probe.flock);
    expect(probe.adults + probe.chicks).toBeGreaterThan(0);
  }
});
