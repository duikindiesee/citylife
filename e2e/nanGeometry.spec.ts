import { test, expect } from '@playwright/test';

// Regression (r3f-colony-migration, 2026-07): the even-width commercial pads seated at NaN
// (Terrain.worldY sampled at a fractional pad centre), two terrain chunks rendered NaN Y
// vertices, and THREE.computeBoundingSphere dumped the FULL serialized geometry (megabytes)
// to console.error twice at boot — flooding the vite client-log relay and dragging every e2e
// run. Boot must produce zero NaN-position geometry and zero such console errors.

test('boot renders no NaN geometry and no computeBoundingSphere NaN errors', async ({ page }) => {
  test.setTimeout(120000);

  const nanErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && m.text().includes('Computed radius is NaN'))
      nanErrors.push(m.text().slice(0, 160));
  });

  await page.goto('/');
  await page.waitForSelector('canvas', { timeout: 30000 });
  await page.waitForFunction(() => !!(window as any).__r3fScene && !!(window as any).__colony, undefined, { timeout: 30000 });
  // stage 1 (the city) has arrived when the ribbon layer exists (roadRibbons.spec.ts precedent);
  // then a settle window covering the ~2s post-load flood the original bug showed.
  await page.waitForFunction(() => {
    let found = false;
    (window as any).__r3fScene?.traverse((o: any) => { if (o.name === 'RoadRibbons') found = true; });
    return found;
  }, undefined, { timeout: 60000 });
  await page.waitForTimeout(4000);

  // Belt and braces beyond the console assertion: no mesh in the booted scene carries a
  // non-finite position component (culling only computes bounding spheres lazily, so a NaN
  // mesh that hasn't been culled yet would otherwise slip through).
  const nanMeshes = await page.evaluate(() => {
    const bad: string[] = [];
    (window as any).__r3fScene.traverse((o: any) => {
      const pos = o.geometry?.attributes?.position;
      if (!pos) return;
      const arr = pos.array as ArrayLike<number>;
      for (let i = 0; i < arr.length; i++) {
        if (!Number.isFinite(arr[i])) {
          const chain: string[] = [];
          let cur = o;
          while (cur) { chain.unshift(cur.name || cur.type); cur = cur.parent; }
          bad.push(`${chain.join(' > ')} (component ${i} = ${arr[i]})`);
          break;
        }
      }
    });
    return bad;
  });

  expect(nanMeshes).toEqual([]);
  expect(nanErrors).toEqual([]);
});
