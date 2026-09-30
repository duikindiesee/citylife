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
    const wood3Connector = ways.find(
      (w) => w !== wood3Spine && w.path.some((p) => p.x === 437 && p.y === 123),
    );
    expect(wood3Connector).toBeDefined();
    const spineEnd = wood3Spine!.path[wood3Spine!.path.length - 1]!;
    const connEnd = wood3Connector!.path[wood3Connector!.path.length - 1]!;
    expect(connEnd.x).toBe(spineEnd.x);
    expect(connEnd.y).toBe(spineEnd.y);
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
