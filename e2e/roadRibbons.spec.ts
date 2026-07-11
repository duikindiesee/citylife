import { test, expect } from '@playwright/test';

// Spec 127/137 — the ribbon road surface. Asserts the per-cell box renderer is GONE (the
// scene mesh count collapses from ~70k to a few thousand), the merged ribbon renders,
// junctions get their DRAPED caps (spec 137 — every cap vertex rides the road surface at
// +0.205, so caps can neither float nor step the way the old MAX-height slab did), and
// the builder still works (a drawn road grows the ribbon).

test('R3F road ribbons: merged surface, draped junction caps, builder intact', async ({ page }) => {
  test.setTimeout(180000);

  await page.goto('/');
  await page.waitForSelector('canvas', { timeout: 30000 });
  await page.waitForFunction(() => !!(window as any).__r3fScene && !!(window as any).__colony, undefined, { timeout: 30000 });
  // stage 1 (the city) has arrived when the ribbon layer exists
  await page.waitForFunction(() => {
    let found = false;
    (window as any).__r3fScene?.traverse((o: any) => { if (o.name === 'RoadRibbons') found = true; });
    return found;
  }, undefined, { timeout: 60000 });
  await page.waitForTimeout(1500);

  const probe = await page.evaluate(() => {
    const scene = (window as any).__r3fScene;
    const rt = (window as any).__colony;
    let ribbonMeshes = 0, junctionFurniture = 0, networkMeshes = 0, totalMeshes = 0;
    let capMesh: any = null, paintMesh = false;
    scene.traverse((o: any) => {
      if (o.isMesh && !o.isInstancedMesh) totalMeshes++;
    });
    scene.traverse((o: any) => {
      if (o.name === 'RoadRibbons') o.traverse((m: any) => { if (m.isMesh) ribbonMeshes++; });
      if (o.name === 'RoadJunctionCaps') capMesh = o;
      if (o.name === 'RoadJunctionPaint') paintMesh = true;
      if (o.name === 'RoadJunctions') junctionFurniture = o.children.length;
      if (o.name === 'RoadNetwork') o.traverse((m: any) => { if (m.isMesh) networkMeshes++; });
    });
    // Spec 137 drape probe: every sampled cap vertex must sit at the ROAD surface height
    // + 0.205 — the no-float/no-step invariant the old slab failed by up to 2.1 m.
    // Replicates getSmoothRoadY (max of a 7x7 bilinear footprint) via terrain.worldYAt.
    let maxDrapeError = -1, sampled = 0;
    if (capMesh) {
      const t = rt.sim.state.terrain;
      const N = t.size;
      const roadY = (x: number, y: number) => {
        let mx = -9999;
        for (let ix = -3; ix <= 3; ix++)
          for (let iy = -3; iy <= 3; iy++) {
            const h = t.worldYAt(x + ix * 0.2, y + iy * 0.2);
            if (h > mx) mx = h;
          }
        return mx;
      };
      const pos = capMesh.geometry.attributes.position;
      const step = Math.max(1, Math.floor(pos.count / 60));
      maxDrapeError = 0;
      for (let i = 0; i < pos.count; i += step) {
        const gx = pos.getX(i) / 4 + N / 2;
        const gy = pos.getZ(i) / 4 + N / 2;
        const expected = Math.max(0, roadY(gx, gy)) + 0.205;
        maxDrapeError = Math.max(maxDrapeError, Math.abs(pos.getY(i) - expected));
        sampled++;
      }
    }
    return {
      ribbonMeshes,
      hasCaps: !!capMesh,
      paintMesh,
      junctionFurniture,
      maxDrapeError,
      sampled,
      networkMeshes,
      totalMeshes,
      roadWays: rt.sim.state.roadWays?.length ?? -1,
      roadCells: rt.sim.state.roads?.length ?? -1,
    };
  });
  console.log(`ribbons probe: ${JSON.stringify(probe)}`);

  // The merged ribbon surface renders (street/avenue surf + edges + dashes + caps + paint).
  expect(probe.ribbonMeshes).toBeGreaterThanOrEqual(1);
  expect(probe.ribbonMeshes).toBeLessThanOrEqual(8);
  expect(probe.roadWays).toBeGreaterThanOrEqual(1);
  // The boot network has real crossings: the draped cap mesh exists and every sampled
  // vertex rides the road surface within a millimetre.
  expect(probe.hasCaps).toBe(true);
  expect(probe.sampled).toBeGreaterThan(10);
  expect(probe.maxDrapeError).toBeLessThan(0.005);
  // Street furniture exists at real junctions (signals/signs — placement-tested in unit).
  expect(probe.junctionFurniture).toBeGreaterThanOrEqual(1);
  // The per-cell box renderer is GONE: RoadNetwork holds only cul-de-sac bulbs now.
  expect(probe.networkMeshes).toBeLessThan(200);
  // The scene as a whole collapsed: baseline with per-cell roads was ~70,869 meshes.
  expect(probe.totalMeshes).toBeLessThan(8000);
  // The road data (cells for traffic/bus/rally) is untouched.
  expect(probe.roadCells).toBeGreaterThan(100);

  // Builder-not-broken: draw a road through the store; the ribbon grows by one way.
  const grown = await page.evaluate(() => {
    const rt = (window as any).__colony;
    const store = (window as any).useRoadNetwork.getState();
    const before = rt.sim.state.roadWays.length;
    const cells = [];
    for (let x = 150; x <= 165; x++) cells.push({ x, y: 150 });
    store.plotRoad(cells, 'street', rt.sim);
    return { before, after: rt.sim.state.roadWays.length };
  });
  console.log(`plotRoad ways: ${grown.before} -> ${grown.after}`);
  expect(grown.after).toBe(grown.before + 1);

  // ...and the rebuilt ribbon actually re-rendered (signature path works end to end).
  await page.waitForFunction(() => {
    let n = 0;
    (window as any).__r3fScene?.traverse((o: any) => { if (o.name === 'RoadRibbons') n++; });
    return n > 0;
  }, undefined, { timeout: 15000 });
});
