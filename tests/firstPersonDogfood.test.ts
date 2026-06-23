import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { driveFirstPersonRouteDogfood } from "../src/colony/bot/firstPersonDogfood";

function distance(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe("first-person route dogfood", () => {
  it("reports when first-person walking is blocked by water", () => {
    const rt = new ColonyRuntime(4242);
    const me = rt.getUiState().citizens.list[0]!;
    const terrain = rt.sim.state.terrain;
    let edge: { land: { x: number; y: number }; water: { x: number; y: number } } | null = null;
    for (let y = 1; y < terrain.size - 1 && !edge; y++) {
      for (let x = 1; x < terrain.size - 1 && !edge; x++) {
        if (terrain.isWater(x, y)) continue;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const wx = x + dx;
          const wy = y + dy;
          if (terrain.isWater(wx, wy)) {
            edge = { land: { x, y }, water: { x: wx, y: wy } };
            break;
          }
        }
      }
    }
    if (!edge) throw new Error("test terrain needs a land/water boundary");
    rt.enterFirstPerson(me.id);
    expect(
      rt.placeFirstPersonDogfood(
        edge.land,
        Math.atan2(edge.water.y - edge.land.y, edge.water.x - edge.land.x),
      ),
    ).toBe(true);

    rt.setFpKey("KeyW", true);
    rt.stepFirstPersonDogfood(1);
    rt.setFpKey("KeyW", false);

    const ui = rt.getUiState();
    expect(ui.firstPerson.view!.ground.isWater).toBe(false);
    expect(ui.firstPerson.blockedReason).toBe("water");
  });

  it("accepts browser KeyboardEvent.code movement names directly", () => {
    const rt = new ColonyRuntime(4242);
    const me = rt.getUiState().citizens.list[0]!;
    rt.enterFirstPerson(me.id);
    const before = rt.getUiState().firstPerson.view!.citizen.positionXY;

    rt.setFpKey("KeyW", true);
    rt.stepFirstPersonDogfood(0.25);
    rt.setFpKey("KeyW", false);

    const after = rt.getUiState().firstPerson.view!.citizen.positionXY;
    expect(distance(before, after)).toBeGreaterThan(0.1);
  });

  it("ramps movement speed up and coasts down after release", () => {
    const rt = new ColonyRuntime(4242);
    const me = rt.getUiState().citizens.list[0]!;

    const run = driveFirstPersonRouteDogfood(rt, me.id, [
      { label: "start walking", keys: ["w"], seconds: 0.2 },
      { label: "release and coast", keys: [], seconds: 0.2 },
    ]);

    const startDistance = distance(
      run.samples[0]!.before.position,
      run.samples[0]!.after.position,
    );
    const coastDistance = distance(
      run.samples[1]!.before.position,
      run.samples[1]!.after.position,
    );

    expect(startDistance).toBeGreaterThan(0.05);
    expect(startDistance).toBeLessThan(0.68);
    expect(coastDistance).toBeGreaterThan(0.05);
    expect(coastDistance).toBeLessThan(startDistance);
  });

  it("walks a deterministic route and samples live view position plus heading", () => {
    const rt = new ColonyRuntime(4242);
    const me = rt.getUiState().citizens.list[0]!;

    const run = driveFirstPersonRouteDogfood(rt, me.id, [
      { label: "walk forward", keys: ["w"], seconds: 0.5 },
      { label: "turn right", keys: ["d"], seconds: 0.5 },
      { label: "back up", keys: ["s"], seconds: 0.25 },
    ]);

    expect(run.citizenId).toBe(me.id);
    expect(run.samples).toHaveLength(3);
    expect(run.samples[0]!.label).toBe("walk forward");
    expect(distance(run.samples[0]!.before.position, run.samples[0]!.after.position)).toBeGreaterThan(0.5);
    expect(run.samples[1]!.after.heading).toBeGreaterThan(run.samples[1]!.before.heading);
    expect(distance(run.samples[2]!.before.position, run.samples[2]!.after.position)).toBeGreaterThan(0.2);

    for (const sample of run.samples) {
      expect(sample.after.viewPosition.x).toBeCloseTo(sample.after.position.x, 5);
      expect(sample.after.viewPosition.y).toBeCloseTo(sample.after.position.y, 5);
      expect(sample.after.viewHeading).toBeCloseTo(sample.after.heading, 5);
    }
  });
});
