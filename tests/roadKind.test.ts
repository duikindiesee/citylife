import { describe, it, expect } from "vitest";
import { ColonySim } from "../src/colony/sim";
import { makeNeighborhood } from "../src/colony/neighborhood";
import {
  reserveParcelLand,
  mergeAvenue,
  roadUpkeepPerDay,
} from "../src/colony/build";
import { roadPath } from "../src/colony/traffic";
import { COLONY } from "../src/colony/config";

// Spec 084 S3 — the road hierarchy: the neighborhood carriageway merges into state.roads as the
// paved AVENUE (after parcel reservation, so the purge can never eat it), upkeep follows the road
// kind, and the traffic graph only ever connects DRIVABLE cells (roadKind), never reserved-only
// roadSet cells like the verge — the bug that dead-ended cars into the kerb.

function bootLike(seed: number) {
  const sim = new ColonySim(seed);
  const nbhd = makeNeighborhood(sim.state.terrain);
  // the runtime's boot order: verge reserved-only -> parcels reserved -> avenue merged
  for (const c of nbhd.verge) sim.state.roadSet.add(`${c.x},${c.y}`);
  const parcelCells: { x: number; y: number }[] = [];
  for (const lot of nbhd.lots)
    for (const f of lot.fence) parcelCells.push({ x: f.x, y: f.y });
  reserveParcelLand(sim.state, parcelCells);
  mergeAvenue(sim.state, nbhd.carriage);
  return { sim, nbhd };
}

describe("spec 084 S3 — RoadKind + the avenue merge", () => {
  it("every carriageway cell becomes an avenue road cell that the parcel purge never ate", () => {
    const { sim, nbhd } = bootLike(42);
    for (const c of nbhd.carriage) {
      expect(
        sim.state.roadKind.get(`${c.x},${c.y}`),
        `carriage ${c.x},${c.y}`,
      ).toBe("avenue");
    }
    const avenueCells = sim.state.roads.filter((r) => r.kind === "avenue");
    expect(avenueCells.length).toBeGreaterThanOrEqual(nbhd.carriage.length);
  });

  it("merging twice adds nothing (idempotent) and reserving other land later leaves the avenue whole", () => {
    const { sim, nbhd } = bootLike(42);
    const before = sim.state.roads.length;
    mergeAvenue(sim.state, nbhd.carriage);
    expect(sim.state.roads.length).toBe(before);
    reserveParcelLand(sim.state, [{ x: 1, y: 1 }]);
    expect(
      sim.state.roads.filter((r) => r.kind === "avenue").length,
    ).toBeGreaterThanOrEqual(nbhd.carriage.length);
  });

  it("colony streets are tagged street and the kind map mirrors the roads array exactly", () => {
    const { sim } = bootLike(42);
    for (const r of sim.state.roads) {
      expect(sim.state.roadKind.get(`${r.x},${r.y}`)).toBe(r.kind ?? "street");
    }
    expect(sim.state.roadKind.size).toBe(sim.state.roads.length);
  });

  it("the daily road bill follows the kind: avenue 1.0, street 0.4", () => {
    const { sim } = bootLike(42);
    const avenues = sim.state.roads.filter((r) => r.kind === "avenue").length;
    const streets = sim.state.roads.length - avenues;
    const expected =
      avenues * COLONY.economy.roadUpkeepByKind.avenue +
      streets * COLONY.economy.roadUpkeepByKind.street;
    expect(roadUpkeepPerDay(sim.state)).toBeCloseTo(expected, 6);
    expect(avenues).toBeGreaterThan(0); // the bill really is mixed-kind in a booted world
  });

  it("traffic routes only over drivable cells — a reserved-only verge cell never appears in a path", () => {
    const { sim } = bootLike(42);
    // Route within the colony street frame (the avenue is its own component until S6 connects them).
    const streets = sim.state.roads.filter(
      (r) => (r.kind ?? "street") === "street",
    );
    // Spec 138 moved the starter frame inland onto the same ground the homesteads survey, so
    // the parcel purge can legitimately eat a frame cell and split the frame (the runtime's
    // trunk stitching reconnects the network; this harness lays none). Route across the frame's
    // LARGEST connected component — the drivable-cells contract is what this test pins.
    const set = new Set(streets.map((r) => `${r.x},${r.y}`));
    const seen = new Set<string>();
    let largest: { x: number; y: number }[] = [];
    for (const r of streets) {
      const k0 = `${r.x},${r.y}`;
      if (seen.has(k0)) continue;
      const comp: { x: number; y: number }[] = [];
      const stack = [k0];
      while (stack.length) {
        const k = stack.pop()!;
        if (seen.has(k)) continue;
        seen.add(k);
        const [x, y] = k.split(",").map(Number);
        comp.push({ x: x!, y: y! });
        for (const n of [
          `${x! + 1},${y}`,
          `${x! - 1},${y}`,
          `${x},${y! + 1}`,
          `${x},${y! - 1}`,
        ])
          if (set.has(n) && !seen.has(n)) stack.push(n);
      }
      if (comp.length > largest.length) largest = comp;
    }
    expect(largest.length).toBeGreaterThan(4); // a real frame run, not a stub
    const a = largest[0]!;
    const b = largest[largest.length - 1]!;
    const path = roadPath(sim.state, a.x, a.y, b.x, b.y);
    expect(path.length).toBeGreaterThan(0);
    const W = sim.state.terrain.size;
    for (const id of path) {
      const x = id % W,
        y = (id / W) | 0;
      expect(
        sim.state.roadKind.has(`${x},${y}`),
        `path cell ${x},${y} is not a drivable road`,
      ).toBe(true);
    }
  });

  it("the avenue is one connected drivable component (cars can traverse the whole street)", () => {
    const { sim, nbhd } = bootLike(42);
    const first = nbhd.carriage[0]!;
    const last = nbhd.carriage[nbhd.carriage.length - 1]!;
    const path = roadPath(sim.state, first.x, first.y, last.x, last.y);
    expect(path.length).toBeGreaterThan(0);
  });
});
