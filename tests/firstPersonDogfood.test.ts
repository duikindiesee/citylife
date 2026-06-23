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
