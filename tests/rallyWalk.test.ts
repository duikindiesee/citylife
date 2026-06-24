import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";

function distance(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe("R3 — first-person Walk to Rally", () => {
  it("guides the active avatar to the hilltop rally point", () => {
    const rt = new ColonyRuntime(4242);
    const terrain = rt.sim.state.terrain;
    let rally = rt.sim.state.structures.find((s) => s.kind === "rally");
    if (!rally) {
      // Seeds without a qualifying hilltop overlook place no rally — inject a deterministic
      // one on dry walkable land so this test exercises the guided walk regardless of seed.
      let cell: { x: number; y: number } | null = null;
      for (let y = 4; y < terrain.size - 4 && !cell; y++) {
        for (let x = 4; x < terrain.size - 4 && !cell; x++) {
          const key = `${x},${y}`;
          if (
            !terrain.isWater(x, y) &&
            !rt.sim.state.occupied.has(key) &&
            !rt.sim.state.roadSet.has(key)
          ) {
            cell = { x, y };
          }
        }
      }
      if (!cell) throw new Error("test terrain needs a dry walkable cell");
      rt.sim.state.structures.push({ kind: "rally", x: cell.x, y: cell.y });
      rally = rt.sim.state.structures.find((s) => s.kind === "rally")!;
    }

    const me = rt.getUiState().citizens.list[0]!;
    expect(rt.enterFirstPerson(me.id)).toBe(true);
    expect(rt.goToRallyPoint()).toBe(true);

    const ui = rt.getUiState().firstPerson;
    expect(ui.guidedTarget).toBeTruthy();
    expect(ui.guidedTarget!.label).toBe("the Rally Point");
    // Walks to the rally cell, or a reachable approach cell adjacent to it.
    expect(distance(ui.guidedTarget!, rally!)).toBeLessThanOrEqual(
      Math.SQRT2 + 0.001,
    );
    expect(ui.narration).toBe("Guiding you to the Rally Point.");
    expect(
      JSON.stringify({ guidedTarget: ui.guidedTarget, narration: ui.narration }),
    ).not.toMatch(/wallet|token|secret|operator/i);
  });

  it("returns false with a clear message when no rally point exists", () => {
    const rt = new ColonyRuntime(4242);
    for (let i = rt.sim.state.structures.length - 1; i >= 0; i--) {
      if (rt.sim.state.structures[i]!.kind === "rally") {
        rt.sim.state.structures.splice(i, 1);
      }
    }
    const me = rt.getUiState().citizens.list[0]!;
    expect(rt.enterFirstPerson(me.id)).toBe(true);
    expect(rt.goToRallyPoint()).toBe(false);
    expect(rt.getUiState().firstPerson.narration).toBe(
      "No rally point in this colony yet.",
    );
  });

  it("requires first-person mode", () => {
    const rt = new ColonyRuntime(4242);
    expect(rt.goToRallyPoint()).toBe(false);
  });
});
