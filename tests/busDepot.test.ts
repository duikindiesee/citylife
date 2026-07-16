import { describe, expect, it } from "vitest";
import {
  findDepotSite,
  depotLayout,
  type DepotTerrain,
} from "../src/colony/transit/busDepot";

// Spec 149 — depot siting is a pure function of (terrain, loop, blocked): the pad lands beside the
// bus loop on dry unclaimed ground, its gate lines up with the junction road cell, and the interior
// layout keeps all ten bays (and their drive paths) inside the pad.

const CFG = { longCells: 12, deepCells: 7, minRoadGap: 2, maxRoadGap: 6 };
const LAYOUT_CFG = { baysTotal: 10, laneDepth: 2.0, bayDepth: 4.8 };

function makeTerrain(size: number, water?: (x: number, y: number) => boolean): DepotTerrain {
  return {
    inBounds: (x, y) => x >= 0 && y >= 0 && x < size && y < size,
    isWater: (x, y) => (water ? water(x, y) : false),
  };
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
    expect(Math.abs(s.gate.x - s.roadCell.x) + Math.abs(s.gate.y - s.roadCell.y)).toBe(
      CFG.minRoadGap,
    );
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

describe("bus depot layout", () => {
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
