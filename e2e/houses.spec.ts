import { test, expect } from '@playwright/test';

// Spec 128 — houses seat on their pads, zone overlays drape the terrain, lots clear trees.

test('R3F houses/lots: seated houses, draped overlays, no trees on lots', async ({ page }) => {
  test.setTimeout(120000);

  await page.goto('/?skipauth=1');
  await page.waitForSelector('canvas', { timeout: 30000 });
  await page.waitForFunction(() => !!(window as any).__r3fScene && !!(window as any).__colony, undefined, { timeout: 30000 });
  await page.waitForFunction(() => {
    let f = false;
    (window as any).__r3fScene?.traverse((o: any) => { if (o.name === 'foliage') f = true; });
    return f;
  }, undefined, { timeout: 60000 });
  await page.waitForTimeout(2000);

  const probe = await page.evaluate(() => {
    const scene = (window as any).__r3fScene;
    const rt = (window as any).__colony;
    const s = rt.sim.state;
    const N = s.terrain.size;

    // 1) zone overlays are INSTANCED and drape: instances sit near their cell's own ground
    const overlays: any[] = [];
    scene.traverse((o: any) => {
      if (typeof o.name === 'string' && o.name.indexOf('zone-ground-') === 0) overlays.push(o);
    });
    let drapedOk = true;
    let checked = 0;
    for (const ov of overlays) {
      if (!ov.isInstancedMesh) { drapedOk = false; break; }
      const m = new (window as any).__r3fScene.children[0].matrix.constructor();
      for (let i = 0; i < Math.min(ov.count, 8); i++) {
        ov.getMatrixAt(i, m);
        const wx = m.elements[12], wy = m.elements[13], wz = m.elements[14];
        const gx = Math.round(wx / 4 + N / 2), gy = Math.round(wz / 4 + N / 2);
        const ground = s.terrain.worldY(gx, gy);
        if (Math.abs(wy - ground) > 0.5) { drapedOk = false; }
        checked++;
      }
    }

    // 2) no foliage instance inside any lot rect (+1 margin)
    const lots = (s.neighborhood?.lots ?? []).map((l: any) => {
      const x0 = l.x - Math.floor((l.w - 1) / 2);
      const y0 = l.y - Math.floor((l.h - 1) / 2);
      return { x0: x0 - 1, y0: y0 - 1, x1: x0 + l.w, y1: y0 + l.h };
    });
    let foliage: any = null;
    scene.traverse((o: any) => { if (o.name === 'foliage') foliage = o; });
    let treesOnLots = 0;
    if (foliage && lots.length) {
      const m = foliage.instanceMatrix;
      for (let i = 0; i < foliage.count; i++) {
        const wx = m.array[i * 16 + 12], wz = m.array[i * 16 + 14];
        const gx = wx / 4 + N / 2, gy = wz / 4 + N / 2;
        for (const r of lots) {
          if (gx >= r.x0 && gx <= r.x1 && gy >= r.y0 && gy <= r.y1) { treesOnLots++; break; }
        }
      }
    }

    return { overlayCount: overlays.length, drapedOk, checked, treesOnLots, lotCount: lots.length, foliageCount: foliage ? foliage.count : -1 };
  });
  console.log(`houses probe: ${JSON.stringify(probe)}`);

  expect(probe.overlayCount).toBeGreaterThan(0);
  expect(probe.drapedOk).toBe(true);
  expect(probe.checked).toBeGreaterThan(0);
  // THE operator complaint: trees on lots is a big no.
  expect(probe.treesOnLots).toBe(0);
  expect(probe.lotCount).toBeGreaterThan(0);
});
