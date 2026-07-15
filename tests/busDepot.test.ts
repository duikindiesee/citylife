import { describe, expect, it } from "vitest";
import {
  findDepotSite,
  depotLayout,
  depotPadHeightRange,
  depotCutFillSeatY,
  type DepotTerrain,
} from "../src/colony/transit/busDepot";

// Spec 149 — depot siting is a pure function of (terrain, loop, blocked): the pad lands beside the
// bus loop on dry unclaimed ground, its gate lines up with the junction road cell, and the interior
// layout keeps active fleet bays and their drive paths inside the pad. A retained ten-bay fixture
// below proves depotLayout remains generic for a future deliberate expansion; runtime uses five.

const CFG = {
  longCells: 12,
  deepCells: 7,
  minRoadGap: 2,
  maxRoadGap: 6,
  maxHeightSpreadM: 1.5,
};
const LAYOUT_CFG = { baysTotal: 10, laneDepth: 2.0, bayDepth: 4.8 };

function makeTerrain(
  size: number,
  water?: (x: number, y: number) => boolean,
  height: (x: number, y: number) => number = () => 0,
): DepotTerrain {
  const terrain = {
    inBounds: (x: number, y: number) =>
      x >= 0 && y >= 0 && x < size && y < size,
    isWater: (x: number, y: number) => (water ? water(x, y) : false),
    worldY: height,
  };
  return terrain as DepotTerrain;
}

/** A straight east-west road at y=10 doubling as the bus loop. */
const road: { x: number; y: number }[] = [];
for (let x = 5; x <= 30; x++) road.push({ x, y: 10 });
const roadKeys = new Set(road.map((c) => `${c.x},${c.y}`));

describe("bus depot siting", () => {
  it("lands the pad beside the loop with the gate aligned to the junction, never on road cells", () => {
    const t = makeTerrain(40);
    const site = findDepotSite(t, road, roadKeys, roadKeys, CFG);
    expect(site).not.toBeNull();
    const s = site!;
    // The gate edge faces the road across the min gap and the gate lines up with the junction.
    expect(
      Math.abs(s.gate.x - s.roadCell.x) + Math.abs(s.gate.y - s.roadCell.y),
    ).toBe(CFG.minRoadGap);
    expect(roadKeys.has(`${s.roadCell.x},${s.roadCell.y}`)).toBe(true);
    for (let y = s.y; y < s.y + s.h; y++)
      for (let x = s.x; x < s.x + s.w; x++) {
        expect(roadKeys.has(`${x},${y}`)).toBe(false);
        expect(t.inBounds(x, y)).toBe(true);
      }
    expect(s.w * s.h).toBe(CFG.longCells * CFG.deepCells);
  });

  it("is deterministic and respects blocked land", () => {
    const t = makeTerrain(40);
    const a = findDepotSite(t, road, roadKeys, roadKeys, CFG);
    const b = findDepotSite(t, road, roadKeys, roadKeys, CFG);
    expect(a).toEqual(b);
    // Block the winning pad entirely — the search must find a DIFFERENT clear pad, not give up.
    const blocked = new Set(roadKeys);
    for (let y = a!.y; y < a!.y + a!.h; y++)
      for (let x = a!.x; x < a!.x + a!.w; x++) blocked.add(`${x},${y}`);
    const c = findDepotSite(t, road, blocked, roadKeys, CFG);
    expect(c).not.toBeNull();
    expect(c).not.toEqual(a);
  });

  it("rejects a steep first-choice pad and keeps scanning for a flatter fit", () => {
    const flat = makeTerrain(40);
    const first = findDepotSite(flat, road, roadKeys, roadKeys, CFG)!;
    const slope = makeTerrain(40, undefined, (x, y) => {
      const inFirst =
        x >= first.x &&
        x < first.x + first.w &&
        y >= first.y &&
        y < first.y + first.h;
      return inFirst ? (x - first.x) * 0.4 : 0;
    });
    const site = findDepotSite(slope, road, roadKeys, roadKeys, CFG);
    expect(site).not.toBeNull();
    expect(site).not.toEqual(first);
    const heights: number[] = [];
    for (let y = site!.y; y < site!.y + site!.h; y++)
      for (let x = site!.x; x < site!.x + site!.w; x++)
        heights.push((slope as any).worldY(x, y));
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(
      CFG.maxHeightSpreadM,
    );
  });

  it("accepts exactly 1.5 m relief and rejects the first candidate above the threshold", () => {
    const first = findDepotSite(
      makeTerrain(40),
      road,
      roadKeys,
      roadKeys,
      CFG,
    )!;
    const terrainAtRelief = (relief: number) =>
      makeTerrain(40, undefined, (x, y) => {
        const inFirst =
          x >= first.x &&
          x < first.x + first.w &&
          y >= first.y &&
          y < first.y + first.h;
        return inFirst
          ? ((x - first.x) / Math.max(1, first.w - 1)) * relief
          : 0;
      });
    expect(
      findDepotSite(terrainAtRelief(1.5), road, roadKeys, roadKeys, CFG),
    ).toEqual(first);
    expect(
      findDepotSite(terrainAtRelief(1.500001), road, roadKeys, roadKeys, CFG),
    ).not.toEqual(first);
  });

  it("rejects non-finite footprint samples and continues scanning", () => {
    const first = findDepotSite(
      makeTerrain(40),
      road,
      roadKeys,
      roadKeys,
      CFG,
    )!;
    const corrupt = makeTerrain(40, undefined, (x, y) =>
      x === first.x && y === first.y ? Number.NaN : 0,
    );
    const site = findDepotSite(corrupt, road, roadKeys, roadKeys, CFG);
    expect(site).not.toBeNull();
    expect(site).not.toEqual(first);
  });

  it("fails soft when every otherwise-clear pad exceeds the height-spread gate", () => {
    const steep = makeTerrain(40, undefined, (x, y) => x * 2 + y * 2);
    expect(findDepotSite(steep, road, roadKeys, roadKeys, CFG)).toBeNull();
  });

  it("avoids water: with the south side flooded the pad sites north of the road", () => {
    const t = makeTerrain(40, (_x, y) => y >= 12);
    const site = findDepotSite(t, road, roadKeys, roadKeys, CFG);
    expect(site).not.toBeNull();
    expect(site!.inward.y).toBe(-1); // gate edge south, pad extending north
    expect(site!.y + site!.h).toBeLessThanOrEqual(12);
  });

  it("returns null when nothing fits (all-water world)", () => {
    const t = makeTerrain(40, () => true);
    expect(findDepotSite(t, road, roadKeys, roadKeys, CFG)).toBeNull();
  });
});

describe("bus depot cut-and-fill seat", () => {
  it("uses the natural footprint mid-range so cut and fill stay balanced", () => {
    const t = makeTerrain(40, undefined, (x, y) => 10 + x * 0.1 + y * 0.02);
    const site = findDepotSite(t, road, roadKeys, roadKeys, {
      ...CFG,
      maxHeightSpreadM: 5,
    })!;
    const range = depotPadHeightRange(t, site);
    expect(range.spread).toBeGreaterThan(0);
    expect(depotCutFillSeatY(t, site, 0.65)).toBeCloseTo(
      (range.min + range.max) / 2,
      10,
    );
  });
});

describe("bus depot layout", () => {
  it("spaces five owned-fleet bays across the row so parked coaches remain distinct", () => {
    const site = findDepotSite(makeTerrain(40), road, roadKeys, roadKeys, CFG)!;
    const layout = depotLayout(site, { ...LAYOUT_CFG, baysTotal: 5 });
    expect(layout.bays).toHaveLength(5);
    const axis = layout.u.x !== 0 ? "x" : "y";
    const positions = layout.bays.map((bay) => bay.park[axis]);
    for (let i = 1; i < positions.length; i++) {
      expect(
        Math.abs(positions[i]! - positions[i - 1]!),
      ).toBeGreaterThanOrEqual(1.5);
    }
  });

  it("keeps all ten bays and their drive paths inside the pad, starting at the gate", () => {
    const t = makeTerrain(40);
    const site = findDepotSite(t, road, roadKeys, roadKeys, CFG)!;
    const layout = depotLayout(site, LAYOUT_CFG);
    expect(layout.bays.length).toBe(10);
    const inPad = (p: { x: number; y: number }) =>
      p.x >= site.x - 0.5 &&
      p.x <= site.x + site.w - 0.5 &&
      p.y >= site.y - 0.5 &&
      p.y <= site.y + site.h - 0.5;
    const parks = new Set<string>();
    for (const bay of layout.bays) {
      expect(inPad(bay.park)).toBe(true);
      parks.add(`${bay.park.x.toFixed(2)},${bay.park.y.toFixed(2)}`);
      // Every drive path starts at the gate cell and ends at this bay's nose.
      expect(bay.path[0]!.x).toBeCloseTo(layout.gate.x);
      expect(bay.path[0]!.y).toBeCloseTo(layout.gate.y);
      const last = bay.path[bay.path.length - 1]!;
      expect(last.x).toBeCloseTo(bay.park.x);
      expect(last.y).toBeCloseTo(bay.park.y);
      for (const p of bay.path.slice(1)) expect(inPad(p)).toBe(true);
    }
    expect(parks.size).toBe(10); // ten DISTINCT bays
    // The gate cell sits on the pad's road-facing edge and the shelter/office are on the pad.
    expect(inPad({ x: layout.gate.x, y: layout.gate.y })).toBe(true);
    expect(inPad(layout.shelter)).toBe(true);
    expect(inPad(layout.office)).toBe(true);
  });
});
