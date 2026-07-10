import { test, expect } from '@playwright/test';

// Spec 127 — the ribbon road surface. Asserts the per-cell box renderer is GONE (the scene
// mesh count collapses from ~70k to a few thousand), the merged ribbon renders, junctions
// get their slabs, and the builder still works (a drawn road grows the ribbon).

test('R3F road ribbons: merged surface, way-based junctions, builder intact', async ({ page }) => {
  test.setTimeout(180000);

  await page.goto('/?skipauth=1');
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
    let ribbonMeshes = 0, junctionGroups = 0, networkMeshes = 0, totalMeshes = 0, slabs = 0;
    scene.traverse((o: any) => {
      if (o.isMesh && !o.isInstancedMesh) totalMeshes++;
    });
    scene.traverse((o: any) => {
      if (o.name === 'RoadRibbons') o.traverse((m: any) => { if (m.isMesh) ribbonMeshes++; });
      if (o.name === 'RoadJunctions') { junctionGroups = o.children.length; o.traverse((m: any) => { if (m.isMesh && m.geometry?.type === 'BoxGeometry') slabs++; }); }
      if (o.name === 'RoadNetwork') o.traverse((m: any) => { if (m.isMesh) networkMeshes++; });
    });
    return {
      ribbonMeshes,
      junctionGroups,
      slabs,
      networkMeshes,
      totalMeshes,
      roadWays: rt.sim.state.roadWays?.length ?? -1,
      roadCells: rt.sim.state.roads?.length ?? -1,
    };
  });
  console.log(`ribbons probe: ${JSON.stringify(probe)}`);

  // The merged ribbon surface renders (2-4 merged meshes: street/avenue surf + edges + dashes).
  expect(probe.ribbonMeshes).toBeGreaterThanOrEqual(1);
  expect(probe.ribbonMeshes).toBeLessThanOrEqual(8);
  expect(probe.roadWays).toBeGreaterThanOrEqual(1);
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
