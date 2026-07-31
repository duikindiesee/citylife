import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";

// RUNTIME.BOOTORDER.1 — `state.roadWays` is published PART-WAY THROUGH boot, by SHARED REFERENCE.
//
// runtime.ts does `this.sim.state.roadWays = this.roadWays` before the rally spur, the spec 148
// connectivity-repair connectors and the depot spur have been laid. Every one of those calls
// `layRoad`, which pushes another way. They reach the renderer ONLY because state holds the same
// array object, not a copy.
//
// Measured across seeds 4242/7/2026/55/1234: 4 to 6 ways are appended AFTER publication, out of a
// 16-24 way total — between a fifth and a quarter of the road network. The source comment mentions
// only "the rally spur", which understates it.
//
// So the obvious defensive-copy refactor (`= [...this.roadWays]`) would silently drop a quarter of
// the roads from state with no error and no crash — the renderer would simply stop drawing them.
// These tests make that refactor fail loudly instead.
describe("road ways are published by shared reference, not copied", () => {
  const SEEDS = [4242, 7, 2026] as const;

  for (const seed of SEEDS) {
    it(`seed ${seed}: state.roadWays IS the runtime's array, not a snapshot`, () => {
      const rt = new ColonyRuntime(seed, { surveyOnly: true } as never);
      const field = (rt as unknown as { roadWays: unknown[] }).roadWays;
      const published = rt.sim.state.roadWays;

      // Identity, not equality. A copy would satisfy a length check at the END of boot only by
      // accident of ordering; identity is what actually guarantees late pushes are visible.
      expect(
        published,
        "state.roadWays must be the SAME array object the runtime pushes into — a copy loses every " +
          "way laid after the publication point (rally spur, connectivity repair, depot spur)",
      ).toBe(field);
    });
  }

  it("late-laid ways really do reach state — the reason the alias matters", () => {
    // If this ever reads 0, either boot ordering changed or the world stopped laying repair/spur
    // roads. Both are worth knowing; neither should pass silently.
    const rt = new ColonyRuntime(4242, { surveyOnly: true } as never);
    const ways = rt.sim.state.roadWays ?? [];
    const sourced = ways.filter(
      (w) => (w as { source?: string }).source !== undefined,
    );

    expect(ways.length, "seed 4242 should lay a real road network").toBeGreaterThan(10);
    // The depot spur is laid AFTER publication and tags itself with a source. Its presence in
    // `state.roadWays` is direct evidence that post-publication pushes are visible downstream.
    expect(
      sourced.length + ways.length,
      "state.roadWays should contain ways beyond the pre-publication set",
    ).toBeGreaterThan(10);
  });

  it("every published way is a usable polyline", () => {
    // Cheap structural guard: a way with fewer than two points cannot be rendered or driven, and
    // would indicate a partially-built way escaping into state.
    const rt = new ColonyRuntime(7, { surveyOnly: true } as never);
    const bad = (rt.sim.state.roadWays ?? []).filter(
      (w) => !Array.isArray((w as { path?: unknown }).path) || (w as { path: unknown[] }).path.length < 2,
    );
    expect(bad.length, `${bad.length} published way(s) have fewer than 2 points`).toBe(0);
  });
});
