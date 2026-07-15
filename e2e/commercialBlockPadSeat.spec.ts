import { test, expect } from '@playwright/test';

test('builder-painted CommercialBlock seats on its graded sloped pad', async ({ page }) => {
  // Heavy builder + terrain-grading flow. It passed under the old 180s budget until the bus depot
  // (spec 149 follow-up) and ironwork pillars (spec 144) added scene meshes, which made every
  // per-plot terrain-level + collider recompute on the slow headless runner heavier and tipped
  // this one just over 180s (it reached the last waitForTimeout before dying). Give it the same
  // headroom the sibling builder specs already carry (zoning 300s, first_plot 600s); global
  // retries are 0 so a genuine hang still fails once, fast.
  test.setTimeout(420000);
  await page.goto('/?skipauth=1');
  await page.waitForSelector('canvas', { timeout: 30000 });
  await page.waitForFunction(
    () => !!(window as any).__r3fScene && !!(window as any).__colony && !!(window as any).useRoadNetwork,
    undefined,
    { timeout: 60000 },
  );

  const cityBuilder = page.locator('button', { hasText: 'City Builder' });
  if (await cityBuilder.isVisible()) await cityBuilder.click({ force: true });
  await page.locator('button', { hasText: /zoning/i }).click({ force: true });
  await page.locator('button', { hasText: /commercial/i }).click({ force: true });
  await expect.poll(() => page.evaluate(() => (window as any).useRoadNetwork.getState().builderMode))
    .toBe('zoning_commercial');

  const painted = await page.evaluate(() => {
    const rt = (window as any).__colony;
    const t = rt.sim.state.terrain;
    const ok = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= t.size || y >= t.size) return false;
      return t.buildable[y * t.size + x] !== 0;
    };

    let target: { x: number; y: number; relief: number } | null = null;
    for (let y = 80; y < t.size - 80 && !target; y += 4) {
      for (let x = 80; x < t.size - 80; x += 4) {
        let valid = true;
        let lo = Infinity;
        let hi = -Infinity;
        for (let dy = 0; dy < 18 && valid; dy++) {
          for (let dx = -12; dx <= 12; dx++) {
            if (!ok(x + dx, y + dy)) { valid = false; break; }
            const h = t.worldY(x + dx, y + dy);
            lo = Math.min(lo, h);
            hi = Math.max(hi, h);
          }
        }
        if (valid && hi - lo >= 0.6) {
          target = { x, y, relief: hi - lo };
          break;
        }
      }
    }
    if (!target) throw new Error('no sloped builder-safe commercial run found');

    const before = new Set(rt.neighborhood.lots.map((lot: any) => lot.id));
    const road = [];
    for (let x = target.x - 14; x <= target.x + 14; x++) road.push({ x, y: target.y - 1 });
    (window as any).useRoadNetwork.getState().plotRoad(road, 'street');

    const first = rt.placeZonedPlot(target.x - 4, target.y, 'n', 'COMPACT', 'commercial');
    const second = rt.placeZonedPlot(target.x + 4, target.y, 'n', 'COMPACT', 'commercial');
    if (!first || !second) throw new Error(`commercial paint failed: ${first}/${second}`);
    const lots = rt.neighborhood.lots.filter((lot: any) => !before.has(lot.id));
    for (const lot of lots) lot.built = true;
    rt.emit();
    return { count: new Set(lots.map((lot: any) => lot.id)).size, relief: target.relief };
  });

  expect(painted.count).toBe(2);
  expect(painted.relief).toBeGreaterThanOrEqual(0.6);

  await page.waitForFunction(() => {
    let found = false;
    (window as any).__r3fScene.traverse((o: any) => {
      if (o.name?.startsWith('commercialBlock.dynamic-')) found = true;
    });
    return found;
  }, undefined, { timeout: 60000 });
  await page.waitForTimeout(1500);

  const probe = await page.evaluate(() => {
    const scene = (window as any).__r3fScene;
    const t = (window as any).__colony.sim.state.terrain;
    let block: any = null;
    scene.traverse((o: any) => {
      if (!block && o.name?.startsWith('commercialBlock.dynamic-')) block = o;
    });
    if (!block) throw new Error('painted CommercialBlock missing');

    const fp = block.userData.commercialCluster.footprint;
    const expectedSeat = Math.max(
      t.worldYAt(fp.x + (fp.w - 1) / 2, fp.y + (fp.d - 1) / 2),
      0.65,
    ) + 0.02;

    block.updateWorldMatrix(true, true);
    let shellBottom = Infinity;
    block.traverse((mesh: any) => {
      if (!mesh.geometry) return;
      mesh.geometry.computeBoundingBox();
      const bb = mesh.geometry.boundingBox;
      const e = mesh.matrixWorld.elements;
      for (const x of [bb.min.x, bb.max.x])
        for (const y of [bb.min.y, bb.max.y])
          for (const z of [bb.min.z, bb.max.z]) {
            const worldY = e[1] * x + e[5] * y + e[9] * z + e[13];
            shellBottom = Math.min(shellBottom, worldY);
          }
    });
    return {
      groupY: block.position.y,
      shellBottom,
      expectedSeat,
      footprint: fp,
    };
  });

  expect(Math.abs(probe.groupY - probe.expectedSeat)).toBeLessThanOrEqual(0.01);
  expect(Math.abs(probe.shellBottom - probe.expectedSeat)).toBeLessThanOrEqual(0.3);

  await page.evaluate(() => {
    const scene = (window as any).__r3fScene;
    const camera = (window as any).__r3fCamera;
    const controls = (window as any).__r3fControls;
    let block: any = null;
    scene.traverse((o: any) => {
      if (!block && o.name?.startsWith('commercialBlock.dynamic-')) block = o;
    });
    const target = { x: block.position.x, y: block.position.y + 4, z: block.position.z + 6 };
    controls?.target?.set(target.x, target.y, target.z);
    camera.position.set(target.x + 75, target.y + 55, target.z + 85);
    camera.lookAt(target.x, target.y, target.z);
    controls?.update?.();
  });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'test-results/commercial-block-pad-seat.png', fullPage: true });

  await page.evaluate(() => {
    const scene = (window as any).__r3fScene;
    const camera = (window as any).__r3fCamera;
    const controls = (window as any).__r3fControls;
    scene.getObjectByName('foliage').visible = false;
    let block: any = null;
    scene.traverse((o: any) => {
      if (!block && o.name?.startsWith('commercialBlock.dynamic-')) block = o;
    });
    const target = { x: block.position.x, y: block.position.y + 3, z: block.position.z + 6 };
    controls?.target?.set(target.x, target.y, target.z);
    camera.position.set(target.x + 42, target.y + 30, target.z + 50);
    camera.lookAt(target.x, target.y, target.z);
    controls?.update?.();
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/commercial-block-pad-seat-close.png', fullPage: true });
});
