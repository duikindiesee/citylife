import { describe, it, expect } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { samplePath } from "../src/colony/transit/path";

describe("Road Alignment, Transit Bus Loop Pavement & Coastal Roads", () => {
  it("road network on seed 4242 has zero duplicate reverse ways and snaps aligned to satellite spines", () => {
    const rt = new ColonyRuntime(4242);
    const ways = rt.sim.state.roadWays ?? rt.roadWays;

    // Check duplicate multi-point ways
    const waySignatures = new Set<string>();
    let duplicates = 0;
    for (const w of ways) {
      if (w.path.length > 2) {
        const p0 = w.path[0]!;
        const p1 = w.path[w.path.length - 1]!;
        const sig = `${Math.min(p0.x, p1.x)},${Math.min(p0.y, p1.y)}-${Math.max(p0.x, p1.x)},${Math.max(p0.y, p1.y)}`;
        if (waySignatures.has(sig)) duplicates++;
        waySignatures.add(sig);
      }
    }
    expect(
      duplicates,
      "Found duplicate reverse road ways in the road network",
    ).toBe(0);

    // Check top-right alignment: Wood3 spine endpoint and Wood3 trunk connector endpoint must match
    const wood3Spine = ways.find((w) =>
      w.path.some((p) => p.x === 420 && p.y === 120),
    );
    expect(wood3Spine).toBeDefined();
    // Spec 180 R11 — with the real-measure plots the Wood3 hamlet is shorter, so its trunk joins the
    // spine's carriageway at a cell beside the spine instead of at the spine's final point (the old
    // layout's spine ended exactly at the junction). The invariant is re-derived from the generator:
    // exactly one other way ends on a drivable road cell inside the spine's carriageway footprint
    // (<= 2 cells, half of the 3-cell carriageway plus its verge from the polyline), i.e. the
    // ribbons overlap with no seam.
    const spine = wood3Spine!.path;
    const distToSpine = (p: { x: number; y: number }): number => {
      let best = Infinity;
      for (let i = 0; i + 1 < spine.length; i++) {
        const a = spine[i]!, b = spine[i + 1]!;
        const dx = b.x - a.x, dy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
        best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
      }
      return best;
    };
    const roadKind = rt.sim.state.roadKind;
    const joins = ways.filter(
      (w) =>
        w !== wood3Spine &&
        [w.path[0]!, w.path[w.path.length - 1]!].some(
          (p) => roadKind.has(`${p.x},${p.y}`) && distToSpine(p) <= 2,
        ),
    );
    expect(joins.length, "the wood3 trunk connector joins the spine").toBe(1);
  });

  it("transit bus loop on seed 4242 has 100% of sample points on the drivable road surface", () => {
    const rt = new ColonyRuntime(4242);
    const fleetPaths = (rt as any).fleetPaths;
    expect(fleetPaths?.loop).toBeDefined();

    let totalSamples = 0;
    let onRoadSamples = 0;
    const failedPoints: { s: number; pt: { x: number; y: number } }[] = [];

    const step = 0.5;
    for (let s = 0; s < fleetPaths.loop.total; s += step) {
      totalSamples++;
      const pt = samplePath(fleetPaths.loop, s);
      if (rt.isRoadSurface(pt.x, pt.y)) {
        onRoadSamples++;
      } else {
        failedPoints.push({ s, pt: { x: pt.x, y: pt.y } });
      }
    }

    expect(
      failedPoints.length,
      `Bus loop has ${failedPoints.length} points off pavement: ${JSON.stringify(failedPoints.slice(0, 3))}`,
    ).toBe(0);
    expect(onRoadSamples).toBe(totalSamples);
  });

  it("bus route visits bottom road (southern highway connecting eastern and western hamlets)", () => {
    const rt = new ColonyRuntime(4242);
    const loop = rt.busRoute?.loop ?? [];
    expect(loop.length).toBeGreaterThan(10);

    // Southern highway / bottom road spans y >= 367 and x between 200 and 480
    const bottomRoadPoints = loop.filter(
      (p) => p.y >= 367 && p.x >= 200 && p.x <= 480,
    );
    expect(
      bottomRoadPoints.length,
      "Bus route must traverse the southern highway / bottom road between eastern and western hamlets",
    ).toBeGreaterThan(50);
  });

  it("west coast has ocean-view parcels and a connecting coastal road", () => {
    const rt = new ColonyRuntime(4242);
    const coastalParcels = rt.sim.state.neighborhood!.parcels.filter(
      (p) => p.id.startsWith("coast") || p.neighborhoodKey?.startsWith("coast"),
    );
    expect(
      coastalParcels.length,
      "Must survey ocean-view parcels along the western coast",
    ).toBeGreaterThanOrEqual(2);

    // Verify parcels are located on the western coast (x < 120)
    for (const p of coastalParcels) {
      expect(p.x).toBeLessThan(120);
    }

    // Verify coastal road connects commercial district towards the south
    const ways = rt.sim.state.roadWays ?? rt.roadWays;
    const coastalRoadWay = ways.find((w) =>
      w.path.some((p) => p.x <= 125 && p.y >= 320 && p.y <= 420),
    );
    expect(
      coastalRoadWay,
      "Must have a coastal road way running along the western shore",
    ).toBeDefined();
  });
});
