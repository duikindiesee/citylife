// Spec 127 — the ribbon data path: the runtime attaches its centre-lines on sim.state (the
// raceState precedent), the ribbon builds a HANDFUL of merged meshes (never per-cell), and
// the signature tracks both road edits and appended ways.
import { describe, it, expect } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { buildRoadRibbons } from "../src/colony/render/roadRibbon";
import { getSmoothRoadY } from "../src/colony/render/roadSurface";
import { roadwaySignature } from "../src/colony/render/simSignals";
import { useRoadNetwork } from "../src/colony/stores/useRoadNetwork";

describe("spec 127 — roadWays reach the render state", () => {
  it("the runtime attaches its roadWays array to sim.state (shared reference)", () => {
    const rt = new ColonyRuntime(4242);
    expect(rt.sim.state.roadWays).toBe(rt.roadWays);
    expect(rt.sim.state.roadWays!.length).toBeGreaterThanOrEqual(1);
  });

  it("buildRoadRibbons yields a few merged meshes, not per-cell geometry", () => {
    const rt = new ColonyRuntime(4242);
    const terrain = rt.sim.state.terrain;
    const N = terrain.size;
    const { group } = buildRoadRibbons(rt.sim.state.roadWays!, {
      terrain,
      wx: (x) => (x - N / 2) * 4,
      wz: (y) => (y - N / 2) * 4,
      roadY: (x, y) => getSmoothRoadY(terrain, x, y),
    });
    expect(group.name).toBe("RoadRibbons");
    let meshes = 0;
    group.traverse((o: any) => {
      if (o.isMesh) meshes++;
    });
    expect(meshes).toBeGreaterThanOrEqual(1);
    // street surf + avenue surf + edges + dashes — merged buffers, NEVER thousands of tiles
    expect(meshes).toBeLessThanOrEqual(4);
    // sanity: the same road data as CELLS is orders of magnitude more objects
    expect(rt.sim.state.roads.length).toBeGreaterThan(100);
  });

  it("roadwaySignature changes on roadsVersion bumps and on appended ways", () => {
    const rt = new ColonyRuntime(4242);
    const s0 = roadwaySignature(rt.sim.state);
    rt.sim.state.roadsVersion++;
    const s1 = roadwaySignature(rt.sim.state);
    expect(s1).not.toBe(s0);
    rt.sim.state.roadWays!.push({
      path: [
        { x: 1, y: 1 },
        { x: 9, y: 1 },
      ],
      kind: "street",
      width: 1,
    });
    const s2 = roadwaySignature(rt.sim.state);
    expect(s2).not.toBe(s1);
    expect(roadwaySignature(rt.sim.state)).toBe(s2); // stable when nothing changed
  });

  it("plotRoad appends the drawn centre-line so the ribbon renders builder roads", () => {
    const rt = new ColonyRuntime(4242);
    const before = rt.sim.state.roadWays!.length;
    const cells = [];
    for (let x = 20; x <= 40; x++) cells.push({ x, y: 20 });
    useRoadNetwork.getState().plotRoad(cells, "street", rt.sim);
    const ways = rt.sim.state.roadWays!;
    expect(ways.length).toBe(before + 1);
    const added = ways[ways.length - 1]!;
    expect(added.width).toBe(1);
    expect(added.path[0]).toEqual({ x: 20, y: 20 });
    expect(added.path[added.path.length - 1]).toEqual({ x: 40, y: 20 });
    // a single-cell road (cul-de-sac) appends NO way — the bulb renders it
    const before2 = ways.length;
    useRoadNetwork.getState().plotRoad([{ x: 60, y: 60 }], "culdesac", rt.sim);
    expect(rt.sim.state.roadWays!.length).toBe(before2);
  });
});
