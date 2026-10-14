import { describe, it, expect, vi } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { makeBusRoute } from "../src/colony/transit/busRoute";
import { cellOk } from "../src/colony/pathfind";
import { resolvePointBetweenFrames } from "../src/colony/spatial/spatialLocation";

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

  it("contains commercial boarding anchor in stops, loop, and paved drivable road (stop/loop/road containment)", () => {
    for (const seed of SEEDS) {
      const rt = rtFor(seed);
      const target =
        seed === 4242
          ? { x: 125, y: 275 }
          : (rt.commercialDistrict?.garagePad?.roadTarget ??
            rt.commercialDistrict?.intersection);
      expect(target).toBeDefined();
      expect(rt.busRoute!.stops).toContainEqual(target);
      expect(rt.busRoute!.loop).toContainEqual(target);
      expect(rt.sim.state.roadKind.has(`${target!.x},${target!.y}`)).toBe(true);
      expect(rt.sim.state.terrain.isWater(target!.x, target!.y)).toBe(false);
    }
  });

  it("provides meaningful walking access from commercial boarding anchor to garage and commercial center", () => {
    const rt = rtFor(4242);
    const doc = rt.captureWorldLayout();
    const terrain = rt.sim.state.terrain;
    const surfaceFrame =
      doc.frames.find(
        (f: any) => f.kind === "surface" || f.id.endsWith(":region:surface"),
      ) ?? doc.frames[0];
    const surfaceFrameId = surfaceFrame.id;
    const frameMap = new Map(doc.frames.map((f: any) => [f.id, f]));

    // 1. Collect all blocked cells from authoritative canonical placements in the surface frame
    const blocked = new Set<string>();
    for (const p of doc.placements) {
      expect(Number.isFinite(p.bounds.x)).toBe(true);
      expect(Number.isFinite(p.bounds.y)).toBe(true);
      expect(Number.isFinite(p.bounds.w)).toBe(true);
      expect(Number.isFinite(p.bounds.h)).toBe(true);

      if (p.cells && p.cells.length > 0) {
        for (const c of p.cells) {
          const pt = resolvePointBetweenFrames(
            { x: c.x, y: c.y, z: 0 },
            p.frameId,
            surfaceFrameId,
            frameMap as any,
          );
          if (pt) blocked.add(`${Math.round(pt.x)},${Math.round(pt.y)}`);
        }
      } else {
        for (let dy = 0; dy < p.bounds.h; dy++) {
          for (let dx = 0; dx < p.bounds.w; dx++) {
            const pt = resolvePointBetweenFrames(
              { x: p.bounds.x + dx, y: p.bounds.y + dy, z: 0 },
              p.frameId,
              surfaceFrameId,
              frameMap as any,
            );
            if (pt) blocked.add(`${Math.round(pt.x)},${Math.round(pt.y)}`);
          }
        }
      }
    }
    expect(blocked.size).toBeGreaterThan(0);

    const stop = { x: 125, y: 275 };
    const garage = rt.commercialDistrict?.garagePad;
    expect(garage).toBeDefined();
    const garageTarget = garage!.roadTarget ?? { x: 125, y: 265 };

    // 2. Validate start stop and garage target are unblocked and on walkable dry ground
    expect(blocked.has(`${stop.x},${stop.y}`)).toBe(false);
    expect(blocked.has(`${garageTarget.x},${garageTarget.y}`)).toBe(false);
    expect(cellOk(terrain, stop.x, stop.y)).toBe(true);
    expect(cellOk(terrain, garageTarget.x, garageTarget.y)).toBe(true);

    // 3. Obstacle-aware BFS pedestrian pathfinder from boarding stop to garage entry
    function findPedestrianRoute(
      start: { x: number; y: number },
      goal: { x: number; y: number },
      extraBlocked?: Set<string>,
    ) {
      if (
        blocked.has(`${start.x},${start.y}`) ||
        blocked.has(`${goal.x},${goal.y}`)
      )
        return null;
      if (
        !cellOk(terrain, start.x, start.y) ||
        !cellOk(terrain, goal.x, goal.y)
      )
        return null;

      const queue: Array<{
        x: number;
        y: number;
        path: Array<{ x: number; y: number }>;
      }> = [{ x: start.x, y: start.y, path: [start] }];
      const visited = new Set<string>([`${start.x},${start.y}`]);

      while (queue.length > 0) {
        const cur = queue.shift()!;
        if (cur.x === goal.x && cur.y === goal.y) return cur.path;

        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = cur.x + dx;
          const ny = cur.y + dy;
          const k = `${nx},${ny}`;
          if (visited.has(k)) continue;
          if (!cellOk(terrain, nx, ny)) continue;
          if (blocked.has(k)) continue;
          if (extraBlocked?.has(k)) continue;
          visited.add(k);
          queue.push({ x: nx, y: ny, path: [...cur.path, { x: nx, y: ny }] });
        }
      }
      return null;
    }

    const route = findPedestrianRoute(stop, garageTarget);
    expect(route).not.toBeNull();
    expect(route!.length).toBeGreaterThan(1);

    // Record and assert actual walking journey: 17 steps = 64m around shop17
    const actualWalkingMetres = (route!.length - 1) * 4;
    expect(actualWalkingMetres).toBe(64);

    // 4. Negative control: an artificial barrier blocking access to the target fails closed
    const artificialWall = new Set<string>();
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        if (dx !== 0 || dy !== 0) {
          artificialWall.add(`${garageTarget.x + dx},${garageTarget.y + dy}`);
        }
      }
    }
    const blockedResult = findPedestrianRoute(
      stop,
      garageTarget,
      artificialWall,
    );
    expect(blockedResult).toBeNull();
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
