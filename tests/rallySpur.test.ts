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

  it("connects the rally on most seeds; an embedded overlook fails soft, never throwing", () => {
    const seeds = [1, 7, 12, 55, 99, 808, 1234, 2026, 4242, 314];
    let connected = 0;
    for (const seed of seeds) {
      const rt = new ColonyRuntime(seed);
      const cell = rallyCell(rt);
      expect(cell).not.toBeNull(); // the rally is always placed; construction never throws
      if (cell && nearestRoadDist(rt, cell) <= 1.5) connected++;
    }
    // a clean spur is laid wherever the overlook has a non-homestead approach (the majority)
    expect(connected).toBeGreaterThanOrEqual(7);
  });
});
