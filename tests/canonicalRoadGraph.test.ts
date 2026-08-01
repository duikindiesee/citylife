import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { ribbonSurfaceCells } from "../src/colony/render/roadRibbon";
import { busLoopPath, samplePath } from "../src/colony/transit/path";

function cellsFromSet(
  cells: ReadonlySet<string>,
  px: number,
  py: number,
  limit = 6,
): number {
  let best = Infinity;
  const cx = Math.round(px);
  const cy = Math.round(py);
  for (let r = 0; r <= limit && best > r - 0.5; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (!cells.has(`${cx + dx},${cy + dy}`)) continue;
        best = Math.min(best, Math.hypot(px - (cx + dx), py - (cy + dy)));
      }
    }
  }
  return best;
}

describe("ROAD.NET.CANON.1 — one road graph for render, transit and driving", () => {
  it("seed 4242 renders an authored surface under every driven bus-route sample", () => {
    const rt = new ColonyRuntime(4242, { surveyOnly: true } as never);
    expect(rt.busRoute).not.toBeNull();

    const surface = ribbonSurfaceCells(
      rt.sim.state.roadWays ?? [],
      rt.sim.state.terrain,
    );
    const loopPath = busLoopPath(rt.busRoute!.loop);
    const uncovered: string[] = [];

    for (let s = 0; s < loopPath.total; s += 0.5) {
      const p = samplePath(loopPath, s);
      if (cellsFromSet(surface, p.x, p.y) > 2) {
        uncovered.push(`${p.x.toFixed(2)},${p.y.toFixed(2)}`);
      }
    }

    expect(uncovered).toEqual([]);
    expect(
      rt.sim.state.roadWays?.some((way) => way.source === "transit-loop"),
    ).toBe(true);
  });

  it("seed 4242 has no visible asphalt cell outside the drivable graph", () => {
    const rt = new ColonyRuntime(4242, { surveyOnly: true } as never);
    const surface = ribbonSurfaceCells(
      rt.sim.state.roadWays ?? [],
      rt.sim.state.terrain,
    );
    const missing = [...surface].filter((cell) => !rt.sim.state.roadKind.has(cell));

    expect(missing).toEqual([]);
  });
});
