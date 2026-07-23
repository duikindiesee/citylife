import { test, expect } from "@playwright/test";

// Spec 149 — the bus depot pad must clear its trees, exactly like neighborhood lots (spec 128) and
// junction zones (spec 137). Before the fix conifers grew across the apron and parking bays and
// half-buried the parked fleet. This asserts on what is ACTUALLY rendered: query the foliage
// InstancedMesh and prove ZERO instances fall inside the depot pad AABB, then frame the depot and
// screenshot it (apron + bays + shelter clear, buses parked). Seed-agnostic — it reads whatever pad
// the live app sited (tests/busDepotFoliage.test.ts pins the numeric guarantee on seed 4242).
// WebGL suite — run with --workers=1 (parallel specs crash the 4 GB GPU).

declare global {
  interface Window {
    __colony: any;
    __r3fScene?: any;
    __r3fCamera?: any;
    __r3fControls?: any;
  }
}

test.describe("spec 149 — bus depot foliage clearing", () => {
  test("no trees inside the depot pad; the apron + bays render clear", async ({
    page,
  }, testInfo) => {
    test.setTimeout(240000);

    await page.goto("/?skipauth=1");
    await page.waitForSelector("canvas", { timeout: 30000 });
    await page.waitForFunction(
      () => !!window.__r3fScene && !!window.__colony,
      undefined,
      { timeout: 30000 },
    );
    // The live seed must site a depot (else the fleet silently degrades to the legacy coach and this
    // regression means nothing) and the foliage mesh must exist.
    await page.waitForFunction(
      () => {
        let f = false;
        window.__r3fScene?.traverse((o: any) => {
          if (o.name === "foliage") f = true;
        });
        return (
          f &&
          !!window.__colony.busDepot &&
          !!window.__colony.sim.state.busDepotPad
        );
      },
      undefined,
      { timeout: 60000 },
    );

    // Park the whole fleet at the depot so the buses stand in the bays for the screenshot — the
    // exact regression the operator saw ("half-buried the parked buses"). Spec 150 PR2: the fleet
    // is a DETERMINISTIC REPLAY of canonical sol time and ignores sim speed and pause, so parking
    // it means driving the SOL clock into the overnight window before the 05:00 first departure via
    // debugSetSolTimeOfDay — the sim debugSetClock no longer moves the fleet (that is the exact
    // clock-contract change that broke the old setSpeed+debugSetClock wait).
    await page.evaluate(() => {
      window.__colony.debugSetSolTimeOfDay(1, 0);
    });
    await page.waitForFunction(
      () => {
        const rt = window.__colony;
        // Keep it overnight (service opens at 05:00) so nobody re-dispatches while it settles.
        if (rt.getUiState().clock.hour >= 4) rt.debugSetSolTimeOfDay(1, 0);
        return rt.busFleet?.buses.every((b: any) => b.mode === "parked");
      },
      undefined,
      { timeout: 120000, polling: 500 },
    );

    // Count foliage instances whose originating cell lands inside the depot pad AABB (+1 canopy
    // margin, exactly the houses.spec lot check). Invert the placement transform: cell = wx/4 + N/2.
    const probe = await page.evaluate(() => {
      const rt = window.__colony;
      const s = rt.sim.state;
      const N = s.terrain.size;
      const pad = s.busDepotPad as {
        x: number;
        y: number;
        w: number;
        h: number;
      };
      const rect = {
        x0: pad.x - 1,
        y0: pad.y - 1,
        x1: pad.x + pad.w,
        y1: pad.y + pad.h,
      };
      let foliage: any = null;
      window.__r3fScene.traverse((o: any) => {
        if (o.name === "foliage") foliage = o;
      });
      let treesInDepot = 0;
      if (foliage) {
        const m = foliage.instanceMatrix;
        for (let i = 0; i < foliage.count; i++) {
          const wx = m.array[i * 16 + 12],
            wz = m.array[i * 16 + 14];
          const gx = wx / 4 + N / 2,
            gy = wz / 4 + N / 2;
          if (gx >= rect.x0 && gx <= rect.x1 && gy >= rect.y0 && gy <= rect.y1)
            treesInDepot++;
        }
      }
      const poses = rt.busPoses();
      let minBusGap = Infinity;
      for (let i = 0; i < poses.length; i++)
        for (let j = i + 1; j < poses.length; j++)
          minBusGap = Math.min(
            minBusGap,
            Math.hypot(poses[i].x - poses[j].x, poses[i].y - poses[j].y),
          );
      const heights: number[] = [];
      for (let y = pad.y; y < pad.y + pad.h; y++)
        for (let x = pad.x; x < pad.x + pad.w; x++)
          heights.push(s.terrain.worldY(x, y));
      let apron: any = null;
      let foundation: any = null;
      let driveway: any = null;
      const bays: any[] = [];
      window.__r3fScene.traverse((o: any) => {
        if (o.name === "Depot_Apron") apron = o;
        if (o.name === "Depot_Foundation") foundation = o;
        if (o.name === "Depot_Driveway") driveway = o;
        if (/^Depot_Bay_\d{2}$/.test(o.name)) bays.push(o);
      });
      return {
        pad,
        treesInDepot,
        foliageCount: foliage ? foliage.count : -1,
        parked: poses.length,
        rawHeightSpread: Math.max(...heights) - Math.min(...heights),
        minNaturalY: Math.min(...heights),
        minBusGap,
        bayCount: bays.length,
        driveway: !!driveway,
        foundationBottomY: foundation?.userData?.foundationBottomY,
        foundationTopY: foundation?.userData?.foundationTopY,
        padTopY: apron?.userData?.padTopY,
      };
    });
    console.log(`depot foliage probe: ${JSON.stringify(probe)}`);

    // The whole point: trees on the depot is a big no, same as trees on lots.
    expect(probe.foliageCount).toBeGreaterThan(0);
    expect(probe.parked).toBe(5);
    expect(probe.treesInDepot).toBe(0);
    expect(probe.rawHeightSpread).toBeLessThanOrEqual(1.5);
    expect(probe.bayCount).toBe(5);
    expect(probe.driveway).toBe(true);
    expect(probe.minBusGap).toBeGreaterThanOrEqual(1.5);
    expect(probe.foundationBottomY).toBeLessThan(probe.minNaturalY);
    expect(probe.foundationTopY).toBeGreaterThan(probe.padTopY - 0.18);
    expect(probe.foundationTopY).toBeLessThan(probe.padTopY);
    expect(probe.padTopY).toBeGreaterThan(probe.foundationBottomY);

    // Spec 150 PR2 — bus and sky now share ONE canonical sol clock, so the fleet cannot be both
    // parked (overnight) and lit by day at the same instant. This frame proves the cut/fill pad
    // grading and the tree-cleared apron, which are independent of the fleet, so shoot it legibly
    // in daylight via the sol clock (debugSetClock no longer drives the sky either).
    await page.evaluate(() => {
      window.__colony.debugSetSolTimeOfDay(12, 0);
    });

    // Enter aerial World View: only then is MapControls (makeDefault) the active `controls`, so a
    // direct camera pose holds instead of being fought by the first-person controller.
    await page.getByRole("button", { name: /World View/i }).click();
    await page.waitForFunction(
      () => window.__r3fControls && !!window.__r3fControls.target,
      undefined,
      { timeout: 15000 },
    );

    // Frame the depot centre and shoot it — visible proof the apron + bays + shelter are clear and
    // the buses are parked in the open.
    await page.evaluate(() => {
      const rt = window.__colony;
      const s = rt.sim.state;
      const N = s.terrain.size;
      const pad = s.busDepotPad;
      const wx = (x: number) => (x - N / 2) * 4;
      const wz = (y: number) => (y - N / 2) * 4;
      const cx = wx(pad.x + (pad.w - 1) / 2);
      const cz = wz(pad.y + (pad.h - 1) / 2);
      const gy = Math.max(
        0,
        s.terrain.worldY(
          Math.round(pad.x + (pad.w - 1) / 2),
          Math.round(pad.y + (pad.h - 1) / 2),
        ),
      );
      const cam = window.__r3fCamera;
      const controls = window.__r3fControls;
      controls.target.set(cx, gy, cz);
      cam.position.set(cx + 40, gy + 52, cz + 40);
      cam.lookAt(cx, gy, cz);
      controls.update();
      cam.updateMatrixWorld();
    });
    // Let MapControls settle (damping) on the new pose.
    await page.waitForTimeout(800);
    await page.screenshot({
      path: testInfo.outputPath("depot-cut-fill-day.png"),
    });
    // Overnight sol time: the same cut/fill pad at night, with the fleet parked in the bays.
    await page.evaluate(() => window.__colony.debugSetSolTimeOfDay(1, 0));
    await page.waitForTimeout(800);
    await page.screenshot({
      path: testInfo.outputPath("depot-cut-fill-night.png"),
    });
  });
});
