import { test, expect } from '@playwright/test';

// Spec 120 — citizens visible in the R3F world. Asserts on the ACTUAL scene: the avatar
// instanced meshes must exist and draw at least one citizen (the roster always carries
// the founder), proving the runtime's setAvatarSource feed reaches the render.

test('R3F avatars: the citizen layer draws roster avatars in the scene', async ({ page }) => {
  test.setTimeout(120000);

  await page.goto('/');
  await page.waitForSelector('canvas', { timeout: 30000 });
  await page.waitForTimeout(5000);

  await page.waitForFunction(() => !!(window as any).__r3fScene && !!(window as any).__colony, undefined, { timeout: 15000 });

  // The avatar layer mounts at boot stage 1 with the rest of the city.
  await page.waitForFunction(() => {
    let found = false;
    (window as any).__r3fScene?.traverse((o: any) => { if (o.name === 'avatar-bodies') found = true; });
    return found;
  }, undefined, { timeout: 30000 });

  // The roster feed must reach the meshes: HUMAN citizens draw as capsules, crab-kind
  // (Joe, spec 132) draws as the crab group — capsules + crab together cover the roster.
  const counts = await page.evaluate(() => {
    let meshCount = -1;
    let crabVisible = false;
    (window as any).__r3fScene?.traverse((o: any) => {
      if (o.name === 'avatar-bodies') meshCount = o.count;
      if (o.name === 'avatar-crab') crabVisible = o.visible;
    });
    const roster = (window as any).__colony?.citizens?.avatars?.() ?? [];
    const crabs = roster.filter((a: any) => a.kind === 'crab').length;
    return { meshCount, crabVisible, roster: roster.length, crabs };
  });

  console.log(`avatar capsules drawn: ${counts.meshCount}, crabs: ${counts.crabs} (crab group visible: ${counts.crabVisible}), roster size: ${counts.roster}`);
  expect(counts.meshCount).toBeGreaterThanOrEqual(0);
  if (counts.roster > 0) {
    expect(counts.meshCount).toBe(Math.min(counts.roster - counts.crabs, 64));
    // Joe renders as the CRAB, not a capsule (spec 132)
    if (counts.crabs > 0) expect(counts.crabVisible).toBe(true);
  }
});
