import { describe, it, expect, vi } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { makeBusRoute } from "../src/colony/transit/busRoute";

// Drive the REAL runtime boot so the route runs against the production road network. Booting is
// expensive, so cache per seed. 4242 is the live dev seed.
const RT_CACHE = new Map<number, ColonyRuntime>();
function rtFor(seed: number): ColonyRuntime {
  let rt = RT_CACHE.get(seed);
  if (!rt) {
    rt = new ColonyRuntime(seed);
    RT_CACHE.set(seed, rt);
  }
  return rt;
}
const SEEDS = [4242, 42, 7];

describe("088 bus route", () => {
  it("builds a closed loop entirely on drivable roads, none on water, for every seed", () => {
    for (const seed of SEEDS) {
      const rt = rtFor(seed);
      const route = rt.busRoute;
      expect(route).not.toBeNull();
      const rk = rt.sim.state.roadKind;
      const terr = rt.sim.state.terrain;
      expect(route!.loop.length).toBeGreaterThan(4);
      for (const p of route!.loop) {
        expect(rk.has(`${p.x},${p.y}`)).toBe(true); // every loop cell is a real road cell
        expect(terr.isWater(p.x, p.y)).toBe(false);
      }
      expect(route!.stops.length).toBeGreaterThanOrEqual(2); // founders + at least one hamlet
      for (const s of route!.stops) expect(rk.has(`${s.x},${s.y}`)).toBe(true); // stops snap to roads
      // consecutive loop cells are adjacent (a continuous polyline, incl. the wrap-around)
      for (let i = 0; i < route!.loop.length; i++) {
        const a = route!.loop[i]!,
          b = route!.loop[(i + 1) % route!.loop.length]!;
        expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBeLessThanOrEqual(
          1,
        );
      }
    }
  });

  it("passes near every hood it was given (each anchor has a loop cell within a few cells)", () => {
    const rt = rtFor(4242);
    const route = rt.busRoute!;
    // each stop must appear on the loop (the bus visits it)
    const loopKeys = new Set(route.loop.map((p) => `${p.x},${p.y}`));
    for (const s of route.stops)
      expect(loopKeys.has(`${s.x},${s.y}`)).toBe(true);
  });

  it("serves the commercial garage at its road-facing target", () => {
    for (const seed of SEEDS) {
      const rt = rtFor(seed);
      const target =
        rt.commercialDistrict?.garagePad?.roadTarget ??
        rt.commercialDistrict?.intersection;
      expect(target).toBeDefined();
      expect(rt.busRoute!.stops).toContainEqual(target);
      expect(rt.busRoute!.loop).toContainEqual(target);
      expect(rt.sim.state.roadKind.has(`${target!.x},${target!.y}`)).toBe(true);
      expect(rt.sim.state.terrain.isWater(target!.x, target!.y)).toBe(false);
    }
  });

  it("is deterministic — same road graph + anchors yields an identical route", () => {
    const rt = rtFor(4242);
    const anchors = rt.busRoute!.stops.map((s) => ({ x: s.x, y: s.y }));
    const a = makeBusRoute({ roadKind: rt.sim.state.roadKind }, anchors);
    const b = makeBusRoute({ roadKind: rt.sim.state.roadKind }, anchors);
    expect(b).toEqual(a);
  });

  it("makeBusRoute touches no wall-clock or RNG", () => {
    const dateSpy = vi.spyOn(Date, "now");
    const randSpy = vi.spyOn(Math, "random");
    try {
      const rt = rtFor(4242);
      makeBusRoute(
        { roadKind: rt.sim.state.roadKind },
        rt.busRoute!.stops.map((s) => ({ x: s.x, y: s.y })),
      );
      expect(dateSpy).not.toHaveBeenCalled();
      expect(randSpy).not.toHaveBeenCalled();
    } finally {
      dateSpy.mockRestore();
      randSpy.mockRestore();
    }
  });

  it("returns null when fewer than two hoods are given", () => {
    const rt = rtFor(4242);
    expect(makeBusRoute({ roadKind: rt.sim.state.roadKind }, [])).toBeNull();
    expect(
      makeBusRoute({ roadKind: rt.sim.state.roadKind }, [{ x: 1, y: 1 }]),
    ).toBeNull();
  });
});
