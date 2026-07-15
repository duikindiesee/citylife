import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";

// Spec 097 R3.5 — a spur road connects the hilltop Rally Point to the colony road network, mirroring
// the commercial connector, so the guided walk and a rally-started race reach the bus-stop on a real
// drivable road. The spur is laid in the runtime constructor, is fully deterministic, and only ever
// paves clean (non-homestead) ground: a rally that lands amid homesteads gets no road through houses
// and stays foot-reachable (R3) — it fails soft rather than bulldozing a street through a home.
function rallyCell(rt: ColonyRuntime): { x: number; y: number } | null {
  const s = rt.sim.state.structures.find((st) => st.kind === "rally");
  return s ? { x: Math.round(s.x), y: Math.round(s.y) } : null;
}

function nearestRoadDist(
  rt: ColonyRuntime,
  cell: { x: number; y: number },
): number {
  let best = Infinity;
  for (const r of rt.sim.state.roads) {
    const d = Math.hypot(r.x - cell.x, r.y - cell.y);
    if (d < best) best = d;
  }
  return best;
}

describe("rally spur road (097 R3.5)", () => {
  it("lays the spur deterministically: same seed, identical road network", () => {
    const a = new ColonyRuntime(7);
    const b = new ColonyRuntime(7);
    const cell = rallyCell(a)!;
    expect(cell).not.toBeNull();
    // seed 7's overlook has a clean approach, so the spur reaches the bus-stop
    expect(nearestRoadDist(a, cell)).toBeLessThanOrEqual(1.5);
    // and it is byte-stable: a second colony from the same seed lays the identical network
    expect(b.sim.state.roads.length).toBe(a.sim.state.roads.length);
    expect(nearestRoadDist(b, cell)).toBe(nearestRoadDist(a, cell));
  });

  it("connects the rally on the default demo seed 4242, on high overlook ground", () => {
    // Spec 097 R1 bias — the overlook picker favours a knoll on the shoulder of rough ground, which the
    // neighborhood does not fill with homesteads, so the demo world (the default seed) gets a visible
    // spur road instead of failing soft. Regression guard for that fix.
    const rt = new ColonyRuntime(4242);
    const cell = rallyCell(rt)!;
    expect(cell).not.toBeNull();
    expect(nearestRoadDist(rt, cell)).toBeLessThanOrEqual(1.5);
    // and it is a genuine overlook: well above the colony floor (~0.1 worldY)
    expect(rt.sim.state.terrain.worldY(cell.x, cell.y)).toBeGreaterThan(5);
  });

  it("connects the rally on most seeds; an embedded overlook fails soft, never throwing", () => {
    const seeds = [1, 7, 12, 55, 99, 808, 1234, 2026, 4242, 314];
    let connected = 0;
    for (const seed of seeds) {
      const rt = new ColonyRuntime(seed);
      const cell = rallyCell(rt);
      expect(cell).not.toBeNull(); // the rally is always placed; construction never throws
      if (cell && nearestRoadDist(rt, cell) <= 1.5) connected++;
    }
    // the rough-shoulder bias connects the clear majority; the rare embedded overlook fails soft
    expect(connected).toBeGreaterThanOrEqual(9);
  }, 30_000);
});
