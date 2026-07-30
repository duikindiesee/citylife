import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import {
  barStoolGridPositions,
  CELL_M,
  FRONT_STRIP_M,
  junctionZonesToPads,
  localToWorldOffset,
  ROAD_HALF_CELLS,
  surveyVenuePlacements,
  venueRoadBlockedCells,
  venueSeatY,
  type JunctionPad,
  type VenuePlacement,
} from "../src/colony/render/venuePlacement";
import { findJunctionZones } from "../src/colony/render/roadJunctions";
import {
  ribbonCoverage,
  ribbonSurfaceCells,
} from "../src/colony/render/roadRibbon";
import { nearPoly } from "../src/colony/render/geom2d";
import { attachCapPolys } from "../src/colony/render/junctionCap";
import { getSmoothRoadY } from "../src/colony/render/roadSurface";
import { padSeatY } from "../src/colony/render/useTerrainLeveling";
import type { CommercialDistrict } from "../src/colony/commerce/district";

// Spec 143 — the venue placement survey. Drive the REAL runtime boot (the
// commerceDistrict.test.ts pattern) so the tests exercise the exact district, road ways
// and junction zones the renderer mounts — no reconstructed-layout drift. Booting is
// expensive; cache per seed. 4242 is the live dev-server seed.
const RT_CACHE = new Map<number, ColonyRuntime>();
function rtFor(seed: number): ColonyRuntime {
  let rt = RT_CACHE.get(seed);
  if (!rt) {
    rt = new ColonyRuntime(seed);
    RT_CACHE.set(seed, rt);
  }
  return rt;
}

const SEEDS = [4242, 42];

function surveyed(rt: ColonyRuntime): {
  district: CommercialDistrict;
  pads: JunctionPad[];
  placements: VenuePlacement[];
} {
  const district = rt.sim.state.commercialDistrict!;
  expect(district).toBeTruthy();
  // Cap outlines attached, exactly as commercialDistrictLayer does — the pad hit test needs the
  // junction's real footprint, not its broad-phase bounding circle.
  const pads = junctionZonesToPads(
    attachCapPolys(findJunctionZones(rt.sim.state.roadWays ?? [])),
  );
  const blocked = venueRoadBlockedCells(
    rt.sim.state.roadWays,
    rt.sim.state.terrain,
  );
  return {
    district,
    pads,
    placements: surveyVenuePlacements(district, pads, blocked),
  };
}

/** The building footprint's grid-space corners + edge midpoints (slightly inset so a
 *  boundary that merely TOUCHES a road cell's edge doesn't round into it). */
function footprintProbes(p: VenuePlacement): { x: number; y: number }[] {
  const probes: { x: number; y: number }[] = [];
  const hw = p.footprint.w / 2 - 0.05;
  const hd = p.footprint.d / 2 - 0.05;
  for (const [lx, lz] of [
    [-hw, -hd],
    [hw, -hd],
    [-hw, hd],
    [hw, hd],
    [0, hd],
    [0, -hd],
    [-hw, 0],
    [hw, 0],
    [0, 0],
  ] as const) {
    const w = localToWorldOffset(lx, lz, p.facing);
    probes.push({
      x: p.centerGX + w.x / CELL_M,
      y: p.centerGY + w.z / CELL_M,
    });
  }
  return probes;
}

describe("venue placement survey (spec 143)", () => {
  it("is deterministic in (district, pads)", () => {
    const rt = rtFor(4242);
    const { district, pads } = surveyed(rt);
    const blocked = venueRoadBlockedCells(
      rt.sim.state.roadWays,
      rt.sim.state.terrain,
    );
    const a = surveyVenuePlacements(district, pads, blocked);
    const b = surveyVenuePlacements(district, pads, blocked);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  for (const seed of SEEDS) {
    it(`seed ${seed}: every venue seats on the ONE pad-seat formula (spec 128 parity)`, () => {
      const rt = rtFor(seed);
      const { placements } = surveyed(rt);
      const t = rt.sim.state.terrain;
      expect(placements.length).toBeGreaterThan(0);
      for (const p of placements) {
        expect(venueSeatY(t, p)).toBeCloseTo(
          padSeatY(t, p.parcel.x, p.parcel.y, p.parcel.w, p.parcel.h),
          12,
        );
      }
    });

    it(`seed ${seed}: every venue faces its fronting road`, () => {
      const rt = rtFor(seed);
      const { placements } = surveyed(rt);
      const roadSet = rt.sim.state.roadSet;
      for (const p of placements) {
        // facing is the world-yaw of frontDir (the road furniture convention)
        expect(p.facing).toBeCloseTo(
          Math.atan2(p.frontDir.x, p.frontDir.y),
          12,
        );
        // Walking out of the front door, across the frontage strip, must reach the
        // fronting carriageway. Search a forward CONE (perpendicular offsets that widen
        // with distance), not a pin-straight line: the beach-road ban routes the high
        // street "along the grass line", so near the coast a real road curves a few cells
        // off the straight survey midline the parcels were placed against. The cone still
        // fails a genuinely backward-facing building while tolerating that curve.
        const maxWalk =
          p.footprint.d / 2 / CELL_M +
          FRONT_STRIP_M / CELL_M +
          ROAD_HALF_CELLS +
          4;
        const perp = { x: -p.frontDir.y, y: p.frontDir.x }; // frontage-axis unit
        let hit = false;
        for (let step = 0.5; step <= maxWalk && !hit; step += 0.5) {
          const fwd = p.footprint.d / 2 / CELL_M + step;
          const spread = Math.min(4, Math.ceil(step)); // cone half-width in cells
          for (let off = -spread; off <= spread && !hit; off++) {
            const gx = Math.round(
              p.centerGX + p.frontDir.x * fwd + perp.x * off,
            );
            const gy = Math.round(
              p.centerGY + p.frontDir.y * fwd + perp.y * off,
            );
            if (roadSet.has(`${gx},${gy}`)) hit = true;
          }
        }
        expect(hit, `${p.parcelId} front cone never reached a road`).toBe(true);
      }
    });

    it(`seed ${seed}: buildable footprints FILL their parcels (no more toy boxes)`, () => {
      const rt = rtFor(seed);
      const { placements } = surveyed(rt);
      const buildable = placements.filter((p) => p.buildable);
      expect(buildable.length).toBeGreaterThan(0);
      for (const p of buildable) {
        const parcelArea = p.parcel.w * CELL_M * (p.parcel.h * CELL_M);
        const coverage = (p.footprint.w * p.footprint.d) / parcelArea;
        expect(
          coverage,
          `${p.parcelId} coverage ${coverage}`,
        ).toBeGreaterThanOrEqual(0.3);
        expect(
          coverage,
          `${p.parcelId} coverage ${coverage}`,
        ).toBeLessThanOrEqual(0.85);
        // a venue is a walk-in building now: at least one storey at the eaves
        expect(p.wallHM).toBeGreaterThanOrEqual(3.5);
      }
      // the strip overall hits the 50 %+ mark (kiosks sit at ~0.5, stores/showrooms above)
      const median = buildable
        .map(
          (p) =>
            (p.footprint.w * p.footprint.d) /
            (p.parcel.w * CELL_M * p.parcel.h * CELL_M),
        )
        .sort((a, b) => a - b)[Math.floor(buildable.length / 2)]!;
      expect(median).toBeGreaterThanOrEqual(0.5);
    });

    it(`seed ${seed}: no venue intersects a road cell, the asphalt, or a junction cap`, () => {
      // WORLD.SURVEY.1 — this used to test against `ribbonCoverage` and the pads' BOUNDING CIRCLE.
      // Both are conservative proxies, and read as hard no-build masks they cost the district most
      // of its shops: 12 of 21 on seed 4242 and 14 of 21 on seed 3 found no legal footprint, and
      // `surveyVenuePlacements` leaves such a parcel open, so they silently did not render.
      //
      //   ribbonCoverage is the TERRAIN GRADING stencil. It stamps the four bilinear corners each
      //   rendered sample depends on, reaching ~1 cell past the kerb BY DESIGN, because the ground
      //   under a road must be graded slightly wider than the road. Standing on ground that was
      //   graded toward the road is not standing on the road.
      //
      //   pad.r is `rBound`, documented in roadJunctions as being "for cheap point rejection" — a
      //   circle out to the end of every arm mouth. The cap POLYGON is the footprint that paint
      //   suppression, coverage and foliage clearing already share.
      //
      // So test the real boundaries. Measured after the change: across seeds 4242 and 42, zero
      // probes land on a drivable cell, zero on the asphalt and zero inside a cap — only the
      // grading margin is now entered, which is what buildings are allowed to do.
      const rt = rtFor(seed);
      const { pads, placements } = surveyed(rt);
      const t = rt.sim.state.terrain;
      const roadSet = rt.sim.state.roadSet;
      const asphalt = ribbonSurfaceCells(rt.sim.state.roadWays ?? [], t);
      for (const p of placements.filter((v) => v.buildable)) {
        for (const probe of footprintProbes(p)) {
          const key = `${Math.round(probe.x)},${Math.round(probe.y)}`;
          expect(
            roadSet.has(key),
            `${p.parcelId} probe ${key} on a road cell`,
          ).toBe(false);
          expect(
            asphalt.has(key),
            `${p.parcelId} probe ${key} on the rendered asphalt`,
          ).toBe(false);
        }
        // rect-vs-circle against every junction pad bound
        const hw = p.footprint.w / 2 / CELL_M;
        const hd = p.footprint.d / 2 / CELL_M;
        const alongX = p.frontDir.y !== 0;
        for (const pad of pads) {
          const dx = Math.max(
            Math.abs(pad.cx - p.centerGX) - (alongX ? hw : hd),
            0,
          );
          const dy = Math.max(
            Math.abs(pad.cy - p.centerGY) - (alongX ? hd : hw),
            0,
          );
          if (dx * dx + dy * dy >= pad.r * pad.r) continue; // clear of even the bounding circle
          // Inside the circle is not inside the junction. Check the cap outline it stands for.
          expect(
            pad.poly && pad.poly.length >= 3,
            `pad at ${pad.cx},${pad.cy} has no cap outline — attachCapPolys not applied`,
          ).toBe(true);
          const hx = alongX ? hw : hd;
          const hy = alongX ? hd : hw;
          const inCap = [
            [p.centerGX, p.centerGY],
            [p.centerGX - hx, p.centerGY - hy],
            [p.centerGX + hx, p.centerGY - hy],
            [p.centerGX - hx, p.centerGY + hy],
            [p.centerGX + hx, p.centerGY + hy],
          ].some(([qx, qy]) => nearPoly(qx!, qy!, pad.poly!, 0));
          expect(
            inCap,
            `${p.parcelId} inside the junction cap at ${pad.cx},${pad.cy}`,
          ).toBe(false);
        }
      }
    });
  }

  it("bar stools stand on the frontage strip, never on the carriageway", () => {
    const rt = rtFor(4242);
    const { placements } = surveyed(rt);
    const t = rt.sim.state.terrain;
    const roadSet = rt.sim.state.roadSet;
    const ribbon = ribbonCoverage(rt.sim.state.roadWays ?? [], t, (x, y) =>
      getSmoothRoadY(t, x, y),
    );
    const bar = placements.find((p) => p.businessId === "nearest_bar");
    expect(bar).toBeTruthy();
    if (!bar?.buildable) return; // a junction ate the bar parcel on this seed — nothing to sit on
    const stools = barStoolGridPositions(bar, 3);
    expect(stools).toHaveLength(3);
    for (const s of stools) {
      const key = `${Math.round(s.x)},${Math.round(s.y)}`;
      expect(roadSet.has(key), `stool ${key} on a road cell`).toBe(false);
      expect(ribbon.has(key), `stool ${key} under the ribbon`).toBe(false);
      // inside the parcel's frontage band (not wandered off the plot)
      expect(s.x).toBeGreaterThanOrEqual(bar.parcel.x - 0.5);
      expect(s.x).toBeLessThanOrEqual(bar.parcel.x + bar.parcel.w - 0.5);
    }
  });

  it("a junction pad on the building spot slides or clears the parcel — never overlaps", () => {
    const rt = rtFor(4242);
    const { district } = surveyed(rt);
    const p0 = district.parcels[0]!;
    const bcx = p0.x + (p0.w - 1) / 2;
    const bcy = p0.y + (p0.h - 1) / 2;
    const pad: JunctionPad = { cx: bcx, cy: bcy, r: 3 };
    const placements = surveyVenuePlacements(district, [pad]);
    const v = placements[0]!;
    if (v.buildable) {
      const hw = v.footprint.w / 2 / CELL_M;
      const hd = v.footprint.d / 2 / CELL_M;
      const alongX = v.frontDir.y !== 0;
      const dx = Math.max(
        Math.abs(pad.cx - v.centerGX) - (alongX ? hw : hd),
        0,
      );
      const dy = Math.max(
        Math.abs(pad.cy - v.centerGY) - (alongX ? hd : hw),
        0,
      );
      expect(dx * dx + dy * dy).toBeGreaterThanOrEqual(pad.r * pad.r);
    } else {
      expect(v.footprint.w * v.footprint.d === 0 || !v.buildable).toBe(true);
    }
    // a pad far away changes nothing
    const far = surveyVenuePlacements(district, [
      { cx: p0.x - 200, cy: p0.y - 200, r: 3 },
    ]);
    expect(JSON.stringify(far)).toBe(
      JSON.stringify(surveyVenuePlacements(district, [])),
    );
  });
});
