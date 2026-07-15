import { test, expect } from "@playwright/test";

// Spec 143 — commercial venue plots. Asserts in the LIVE booted world that every built
// venue massing (a) seats its shell exactly on its parcel's pad seat (the ONE padSeatY
// formula, spec 128), and (b) stands clear of every road: no shell corner on a road cell.
// These are the operator's floating / toy-box / shop-on-the-junction complaints, pinned
// end-to-end. Junction-PAD clearance (the venue vs a junction's rBound, incl. apron
// beyond the road cells) is checked deterministically in tests/venuePlacement.test.ts
// against the same findJunctionZones(roadWays) the renderer uses — the spec-137 junction
// caps bake their footprint into merged geometry buffers, so there is no per-junction
// mesh to bbox here anymore.

test("commercial venues: shells seat on their pads and clear every road", async ({
  page,
}) => {
  test.setTimeout(180000);

  await page.goto("/?skipauth=1");
  await page.waitForSelector("canvas", { timeout: 30000 });
  await page.waitForFunction(
    () => !!(window as any).__r3fScene && !!(window as any).__colony,
    undefined,
    { timeout: 60000 },
  );
  // stage 1 (the city) has arrived when the commercial district layer exists
  await page.waitForFunction(
    () => {
      let found = false;
      (window as any).__r3fScene?.traverse((o: any) => {
        if (o.name === "commercialDistrict") found = true;
      });
      return found;
    },
    undefined,
    { timeout: 90000 },
  );
  await page.waitForTimeout(3000); // staged mount + grading settle

  const probe = await page.evaluate(() => {
    const scene = (window as any).__r3fScene;
    const rt = (window as any).__colony;
    const t = rt.sim.state.terrain;
    const roadSet: Set<string> = rt.sim.state.roadSet;

    // world-space AABB of one mesh, by hand (window.__THREE is the devtools version
    // string, not the module) — geometry bbox corners through matrixWorld
    const bboxOf = (m: any) => {
      m.updateWorldMatrix(true, false);
      m.geometry.computeBoundingBox();
      const bb = m.geometry.boundingBox;
      const e = m.matrixWorld.elements;
      const min = { x: Infinity, y: Infinity, z: Infinity };
      const max = { x: -Infinity, y: -Infinity, z: -Infinity };
      for (const x of [bb.min.x, bb.max.x])
        for (const y of [bb.min.y, bb.max.y])
          for (const z of [bb.min.z, bb.max.z]) {
            const wx = e[0] * x + e[4] * y + e[8] * z + e[12];
            const wy = e[1] * x + e[5] * y + e[9] * z + e[13];
            const wz = e[2] * x + e[6] * y + e[10] * z + e[14];
            if (wx < min.x) min.x = wx;
            if (wx > max.x) max.x = wx;
            if (wy < min.y) min.y = wy;
            if (wy > max.y) max.y = wy;
            if (wz < min.z) min.z = wz;
            if (wz > max.z) max.z = wz;
          }
      return { min, max };
    };

    const venues: any[] = [];
    scene.traverse((o: any) => {
      if (!o.name?.startsWith("venue.") || !o.userData?.venue) return;
      const v = o.userData.venue;
      const rec: any = {
        name: o.name,
        buildable: v.buildable,
        seatY: v.seatY,
        groupY: o.position.y,
        shellBottom: null,
        cornersOnRoad: [] as string[],
      };
      if (v.buildable) {
        let shell: any = null;
        o.traverse((m: any) => {
          if (m.name === "venueShell") shell = m;
        });
        if (shell) {
          const b = bboxOf(shell);
          rec.shellBottom = b.min.y;
          // shell corners -> grid cells (world -> grid: g = w/4 + size/2), slightly inset
          const inset = 0.2;
          for (const [wx, wz] of [
            [b.min.x + inset, b.min.z + inset],
            [b.max.x - inset, b.min.z + inset],
            [b.min.x + inset, b.max.z - inset],
            [b.max.x - inset, b.max.z - inset],
          ]) {
            const gx = Math.round(wx / 4 + t.size / 2);
            const gy = Math.round(wz / 4 + t.size / 2);
            if (roadSet.has(`${gx},${gy}`))
              rec.cornersOnRoad.push(`${gx},${gy}`);
          }
        }
      }
      venues.push(rec);
    });
    return { venues };
  });

  console.log(
    `venues probe: ${probe.venues.length} venues, ` +
      `${probe.venues.filter((v: any) => v.buildable).length} buildable`,
  );

  expect(probe.venues.length).toBeGreaterThan(5);
  const built = probe.venues.filter((v: any) => v.buildable);
  expect(built.length).toBeGreaterThan(5);

  for (const v of built) {
    // (a) the shell's bounding-box bottom sits ON the pad seat (within 0.3)
    expect(v.shellBottom, `${v.name} has no shell`).not.toBeNull();
    expect(
      Math.abs(v.shellBottom - v.seatY),
      `${v.name} floats: shell bottom ${v.shellBottom} vs seat ${v.seatY}`,
    ).toBeLessThanOrEqual(0.3);
    // the group itself is mounted at the seat (padSeatY parity all the way down)
    expect(Math.abs(v.groupY - v.seatY)).toBeLessThanOrEqual(0.01);
    // (b) no shell corner on a road cell (junction-pad clearance incl. apron is unit-
    // tested against the live rBound — see the file header)
    expect(v.cornersOnRoad, `${v.name} corners on road cells`).toEqual([]);
  }
});
