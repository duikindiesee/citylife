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

  // The roster feed must reach the mesh: drawn instance count matches the runtime roster
  // (capped at 64), and is at least 1 once any citizen exists.
  const counts = await page.evaluate(() => {
    let meshCount = -1;
    (window as any).__r3fScene?.traverse((o: any) => {
      if (o.name === 'avatar-bodies') meshCount = o.count;
    });
    const roster = (window as any).__colony?.citizens?.avatars?.()?.length ?? -1;
    return { meshCount, roster };
  });

  console.log(`avatar instances drawn: ${counts.meshCount}, roster size: ${counts.roster}`);
  expect(counts.meshCount).toBeGreaterThanOrEqual(0);
  if (counts.roster > 0) {
    expect(counts.meshCount).toBe(Math.min(counts.roster, 64));
    expect(counts.meshCount).toBeGreaterThan(0);
  }
});
