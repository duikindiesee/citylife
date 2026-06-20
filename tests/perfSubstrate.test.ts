import { describe, it, expect } from "vitest";
import { ColonySim } from "../src/colony/sim";
import { leastCostPath } from "../src/colony/pathfind";
import { reserveParcelLand } from "../src/colony/build";

// Spec 084 S1 — the perf substrate must be INVISIBLE: the scratch-buffer pathfinder returns
// byte-identical paths to the old per-call allocator (same Dijkstra, same scan order, same
// tie-breaks), and roadsVersion bumps on every road mutation so renderer + traffic rebuilds can
// key on it instead of the equal-length-blind roads.length.

function terrain(seed: number) {
  return new ColonySim(seed).state.terrain;
}

describe("spec 084 S1 — generation-stamped pathfind scratch", () => {
  // Road cells are routable ground by construction — the safest endpoints on any seed.
  function roadEnds(seed: number) {
    const s = new ColonySim(seed).state;
    const a = s.roads[0]!;
    const b = s.roads[s.roads.length - 1]!;
    return { t: s.terrain, a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } };
  }

  it("repeated identical calls return identical paths (scratch carries nothing between calls)", () => {
    const { t, a, b } = roadEnds(42);
    const first = leastCostPath(t, a, b, { slopeWeight: 0.6 });
    const second = leastCostPath(t, a, b, { slopeWeight: 0.6 });
    const third = leastCostPath(t, a, b, { slopeWeight: 0.6 });
    expect(first).not.toBeNull();
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it("interleaving different routes never bleeds state between calls", () => {
    const s = new ColonySim(7).state;
    const t = s.terrain;
    const a = s.roads[0]!;
    const b = s.roads[s.roads.length - 1]!;
    const c = s.roads[Math.floor(s.roads.length / 2)]!;
    const ab1 = leastCostPath(t, a, b, { slopeWeight: 0.6 });
    const ac = leastCostPath(t, a, c, { slopeWeight: 0.6 });
    const ab2 = leastCostPath(t, a, b, { slopeWeight: 0.6 });
    const ac2 = leastCostPath(t, a, c, { slopeWeight: 0.6 });
    expect(ab1).not.toBeNull();
    expect(ab2).toEqual(ab1);
    expect(ac2).toEqual(ac);
  });

  it("scratch survives multiple terrains in one process (results stable across reuse)", () => {
    const e1 = roadEnds(42);
    const e2 = roadEnds(99);
    const p1 = leastCostPath(e1.t, e1.a, e1.b, {});
    leastCostPath(e2.t, e2.a, e2.b, {});
    const p1again = leastCostPath(e1.t, e1.a, e1.b, {});
    expect(p1).not.toBeNull();
    expect(p1again).toEqual(p1);
  });

  it("an unreachable goal still returns null (stamped done check matches the old finite check)", () => {
    const { t, a, b } = roadEnds(42);
    const blockedEverywhere = leastCostPath(t, a, b, {
      blocked: (x, y) => !(x === a.x && y === a.y) && !(x === b.x && y === b.y),
    });
    expect(blockedEverywhere).toBeNull();
  });
});

describe("spec 084 S1 — roadsVersion", () => {
  it("laying the landing frame bumps the version above its initial value", () => {
    const sim = new ColonySim(42);
    expect(sim.state.roads.length).toBeGreaterThan(0);
    expect(sim.state.roadsVersion).toBeGreaterThan(1);
  });

  it("a purge bumps the version even when lengths could later re-converge", () => {
    const sim = new ColonySim(42);
    const before = sim.state.roadsVersion;
    const r = sim.state.roads[0]!;
    const purged = reserveParcelLand(sim.state, [{ x: r.x, y: r.y }]);
    expect(purged).toBe(1);
    expect(sim.state.roadsVersion).toBe(before + 1);
  });

  it("reserving land with no roads under it leaves the version untouched", () => {
    const sim = new ColonySim(42);
    const t = sim.state.terrain;
    let cell = { x: 1, y: 1 };
    outer: for (let y = 0; y < t.size; y++)
      for (let x = 0; x < t.size; x++) {
        if (
          !sim.state.roadSet.has(`${x},${y}`) &&
          !sim.state.occupied.has(`${x},${y}`)
        ) {
          cell = { x, y };
          break outer;
        }
      }
    const before = sim.state.roadsVersion;
    expect(reserveParcelLand(sim.state, [cell])).toBe(0);
    expect(sim.state.roadsVersion).toBe(before);
  });
});
