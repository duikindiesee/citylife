// Spec 130 — the ground grades up to the road. Contracts: the pure coverage covers every
// cell the mesh build records; each cell's target is the SURFACE height the mesh renders
// there (segment-bridged, never below the local road height); and a short steep player-style
// road produces real see-under gaps for the grading to close (boot roads follow least-cost
// paths that avoid slopes — floating roads come from hand-drawn strokes and bridged dips).
import { describe, it, expect } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { Biome } from "../src/colony/terrain";
import {
  buildRoadRibbons,
  ribbonCoverage,
  type RoadWay,
} from "../src/colony/render/roadRibbon";
import { getSmoothRoadY } from "../src/colony/render/roadSurface";

describe("spec 130 — ribbon coverage + road grading inputs", () => {
  const rt = new ColonyRuntime(4242);
  const terrain = rt.sim.state.terrain;
  const N = terrain.size;
  const ways = rt.sim.state.roadWays!;
  const roadY = (x: number, y: number) => getSmoothRoadY(terrain, x, y);

  it("pure coverage covers every cell the mesh build records", () => {
    const { cells: fromBuild } = buildRoadRibbons(ways, {
      terrain,
      wx: (x) => (x - N / 2) * 4,
      wz: (y) => (y - N / 2) * 4,
      roadY,
    });
    const cover = ribbonCoverage(ways, terrain, roadY);
    let missing = 0;
    for (const k of fromBuild) if (!cover.has(k)) missing++;
    expect(missing).toBe(0); // the load-bearing invariant: every mesh cell is graded
    // The midpoint sweep may stamp a few extra edge cells; it must stay the same order.
    // Bound relaxed 1.25 -> 1.35 with the spec-137 cap-quality pass: string-pulling the
    // spine ribbon ways (runtime.ts) makes the founders' avenue + hamlet spines straighter,
    // which nudges the coverage/mesh ratio up (~1.28 on seed 4242) — benign extra grading
    // near the road edge; the mesh itself renders continuous (no dropped segments).
    expect(cover.size).toBeLessThan(fromBuild.size * 1.35);
  });

  it("unbuildable LAND pockets under the ways are covered (spec 133) — water never is", () => {
    // Pin the land contract directly instead of relying on a particular generated boot way to cross
    // a rough pocket. Water-safe ribbon fallback can legitimately choose a nearby routed line and
    // remove that incidental seed fixture without changing the rule that rough dry land is renderable.
    let pocket: { x: number; y: number } | null = null;
    for (let y = 2; y < N - 2 && !pocket; y++) {
      for (let x = 2; x < N - 2; x++) {
        const i = y * N + x;
        if (terrain.water[i] || terrain.buildable[i] !== 0) continue;
        if (
          terrain.biome[i] === Biome.Ocean ||
          terrain.biome[i] === Biome.Shallows ||
          terrain.biome[i] === Biome.River
        )
          continue;
        if (terrain.water[i - 2] || terrain.water[i + 2]) continue;
        pocket = { x, y };
        break;
      }
    }
    expect(pocket).not.toBeNull();
    const roughLandWay: RoadWay[] = [
      {
        path: [
          { x: pocket!.x - 2, y: pocket!.y },
          pocket!,
          { x: pocket!.x + 2, y: pocket!.y },
        ],
        kind: "street",
        width: 1,
      },
    ];
    expect(
      ribbonCoverage(roughLandWay, terrain, roadY).has(
        `${pocket!.x},${pocket!.y}`,
      ),
    ).toBe(true);

    const cover = ribbonCoverage(ways, terrain, roadY);
    let waterCovered = 0;
    for (const key of cover.keys()) {
      const c = key.indexOf(",");
      const x = +key.slice(0, c);
      const y = +key.slice(c + 1);
      const i = y * N + x;
      if (terrain.water[i]) waterCovered++;
    }
    expect(waterCovered).toBe(0); // the spec-115 water guard holds
  });

  it("a short steep player-style road yields real gaps for the grading to close", () => {
    const DEADZONE = 0.6;
    // find the steepest short hop (6 cells apart) on buildable dry land
    let best: { a: { x: number; y: number }; b: { x: number; y: number }; drop: number } | null = null;
    for (let y = 150; y < N - 150; y += 2) {
      for (let x = 150; x < N - 150; x += 2) {
        const i = y * N + x;
        if (terrain.water[i] || terrain.buildable[i] === 0) continue;
        const j = y * N + (x + 6);
        if (terrain.water[j] || terrain.buildable[j] === 0) continue;
        const drop = Math.abs(terrain.worldY(x, y) - terrain.worldY(x + 6, y));
        if (!best || drop > best.drop)
          best = { a: { x, y }, b: { x: x + 6, y }, drop };
      }
    }
    expect(best).not.toBeNull();
    expect(best!.drop).toBeGreaterThan(DEADZONE);
    const drawn: RoadWay[] = [
      { path: [best!.a, best!.b], kind: "street", width: 1, source: "builder" },
    ];
    const cover = ribbonCoverage(drawn, terrain, roadY);
    let gaps = 0;
    for (const [key, h] of cover) {
      const c = key.indexOf(",");
      const x = +key.slice(0, c);
      const y = +key.slice(c + 1);
      if (h - Math.max(0, terrain.worldY(x, y)) > DEADZONE) gaps++;
    }
    // the low end of the hop sits under the bridged surface — the grading must fill it
    expect(gaps).toBeGreaterThan(0);
  });
});
