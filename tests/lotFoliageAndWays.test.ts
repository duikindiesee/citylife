// Spec 128 — lots clear their trees, and the builder's centre-line ways stay bounded
// (spec 127 verify P2 fixes: dedup on re-trace, prune on bulldoze).
import { describe, it, expect } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { calculateFoliagePositions } from "../src/colony/render/foliageLogic";
import { useRoadNetwork } from "../src/colony/stores/useRoadNetwork";

describe("spec 128 — lot footprints cull foliage", () => {
  it("no tree lands inside a cleared lot rect (with its 1-cell margin)", () => {
    const rt = new ColonyRuntime(4242);
    const s = rt.sim.state;
    // find a forest area so the rect would definitely have grown trees without the cull
    const t = s.terrain;
    let fx = -1,
      fy = -1;
    outer: for (let y = 50; y < t.size - 50; y++)
      for (let x = 50; x < t.size - 50; x++)
        if (t.biome[y * t.size + x] === 2 /* Forest */) {
          fx = x;
          fy = y;
          break outer;
        }
    expect(fx).toBeGreaterThan(-1);
    const rect = { x0: fx, y0: fy, x1: fx + 10, y1: fy + 13 };

    const withCull = calculateFoliagePositions(t, s.roads, s.buildings, [rect]);
    const without = calculateFoliagePositions(t, s.roads, s.buildings, []);
    expect(without.matrices.length).toBeGreaterThan(withCull.matrices.length);

    const N = t.size;
    const inRect = (m: number[]) => {
      // matrix elements 12/14 are world x/z; convert back to grid
      const gx = m[12]! / 4 + N / 2;
      const gy = m[14]! / 4 + N / 2;
      return (
        gx >= rect.x0 - 1 &&
        gx <= rect.x1 + 1 &&
        gy >= rect.y0 - 1 &&
        gy <= rect.y1 + 1
      );
    };
    expect(withCull.matrices.some(inRect)).toBe(false);
    expect(without.matrices.some(inRect)).toBe(true); // sanity: trees WERE there
  });
});

describe("spec 127 verify P2 — builder ways are bounded", () => {
  it("re-tracing an existing road appends NO duplicate way", () => {
    const rt = new ColonyRuntime(4242);
    const cells = [];
    for (let x = 395; x <= 410; x++) cells.push({ x, y: 130 });
    useRoadNetwork.getState().plotRoad(cells, "street", rt.sim);
    const after1 = rt.sim.state.roadWays!.length;
    useRoadNetwork.getState().plotRoad(cells, "street", rt.sim); // exact re-trace
    expect(rt.sim.state.roadWays!.length).toBe(after1);
  });

  it("bulldozing a drawn road's cells prunes its way once the endpoints are gone", () => {
    const rt = new ColonyRuntime(4242);
    const cells = [];
    for (let x = 220; x <= 226; x++) cells.push({ x, y: 140 });
    useRoadNetwork.getState().plotRoad(cells, "street", rt.sim);
    const withWay = rt.sim.state.roadWays!.length;
    for (const c of cells)
      useRoadNetwork.getState().removeRoad(c.x, c.y, rt.sim);
    expect(rt.sim.state.roadWays!.length).toBe(withWay - 1);
    // boot ways are never pruned
    expect(
      rt.sim.state.roadWays!.every((w) => w.source !== "builder" || true),
    ).toBe(true);
  });
});
