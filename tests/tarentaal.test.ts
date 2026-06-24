import { describe, expect, it } from "vitest";
import { ColonySim } from "../src/colony/sim";

describe("Colony tarentaal flock", () => {
  it("seeds deterministic land-roaming adults and chicks", () => {
    const a = new ColonySim(4242);
    const b = new ColonySim(4242);

    expect(a.state.tarentaal).toHaveLength(10);
    expect(a.state.tarentaal).toEqual(b.state.tarentaal);
    expect(
      a.state.tarentaal.filter((bird) => bird.age === "adult"),
    ).toHaveLength(4);
    expect(
      a.state.tarentaal.filter((bird) => bird.age === "chick"),
    ).toHaveLength(6);
    expect(
      a.state.tarentaal.every((bird) => bird.isPublicSafe === true),
    ).toBe(true);
    expect(
      a.state.tarentaal.every(
        (bird) =>
          !a.state.terrain.isWater(Math.round(bird.x), Math.round(bird.y)),
      ),
    ).toBe(true);
  });

  it("keeps chicks following adults and produces deterministic chase bursts", () => {
    const sim = new ColonySim(4242);
    const before = sim.state.tarentaal.map((bird) => ({ ...bird }));

    const replay = new ColonySim(4242);
    for (let i = 0; i < 24; i++) {
      sim.step();
      replay.step();
    }

    expect(sim.state.tarentaal).toEqual(replay.state.tarentaal);
    const movedAdults = sim.state.tarentaal
      .filter((bird) => bird.age === "adult")
      .some((bird) => {
        const start = before.find((b) => b.id === bird.id)!;
        return Math.hypot(bird.x - start.x, bird.y - start.y) > 0.2;
      });
    expect(movedAdults).toBe(true);
    expect(sim.state.tarentaal.some((bird) => bird.behavior === "chase")).toBe(
      true,
    );

    for (const chick of sim.state.tarentaal.filter(
      (bird) => bird.age === "chick",
    )) {
      const adult = sim.state.tarentaal.find(
        (bird) => bird.id === chick.followId,
      )!;
      expect(
        Math.hypot(chick.x - adult.x, chick.y - adult.y),
      ).toBeLessThanOrEqual(4.5);
      expect(chick.behavior).toBe("follow");
    }
  });
});
