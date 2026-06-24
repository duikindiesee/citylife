import { describe, expect, it } from "vitest";
import {
  artifactCatalogEntries,
  summarizeRenderableArtifacts,
} from "../src/colony/artifacts";
import { ColonySim } from "../src/colony/sim";

const EXPECTED_KINDS = [
  "bench",
  "lamppost",
  "planter",
  "fountain",
  "shade_tree",
  "notice_board",
  "wayfinder",
];

describe("Colony visual artifacts", () => {
  it("exports a deterministic public-safe artifact catalog inventory", () => {
    expect(artifactCatalogEntries()).toEqual([
      {
        kind: "bench",
        category: "furniture",
        footprint: { w: 1.4, h: 0.55 },
        isPublicSafe: true,
      },
      {
        kind: "lamppost",
        category: "lighting",
        footprint: { w: 0.35, h: 0.35 },
        isPublicSafe: true,
      },
      {
        kind: "planter",
        category: "greenery",
        footprint: { w: 1, h: 1 },
        isPublicSafe: true,
      },
      {
        kind: "fountain",
        category: "civic-art",
        footprint: { w: 1.6, h: 1.6 },
        isPublicSafe: true,
      },
      {
        kind: "shade_tree",
        category: "greenery",
        footprint: { w: 1.8, h: 1.8 },
        isPublicSafe: true,
      },
      {
        kind: "notice_board",
        category: "civic-art",
        footprint: { w: 1.2, h: 0.45 },
        isPublicSafe: true,
      },
      {
        kind: "wayfinder",
        category: "civic-art",
        footprint: { w: 0.75, h: 0.5 },
        isPublicSafe: true,
      },
    ]);
  });

  it("freezes catalog inventory entries so consumers cannot mutate shared prefill data", () => {
    const [bench] = artifactCatalogEntries();

    expect(Object.isFrozen(bench)).toBe(true);
    expect(Object.isFrozen(bench.footprint)).toBe(true);
  });

  it("partitions renderable artifacts by known kind and drops unsafe entries", () => {
    const items = [
      { id: "bench-0", kind: "bench" },
      { id: "future-house", kind: "house" },
      { id: "bench-1", kind: "bench" },
      { id: "lamppost-0", kind: "lamppost" },
    ];

    const summary = summarizeRenderableArtifacts(items, 1);

    expect(summary.renderable.map((item) => item.id)).toEqual([
      "bench-0",
      "lamppost-0",
    ]);
    expect(summary.counts).toEqual({
      bench: 1,
      lamppost: 1,
      planter: 0,
      fountain: 0,
      shade_tree: 0,
      notice_board: 0,
      wayfinder: 0,
    });
    expect(summary.unknown).toBe(1);
    expect(summary.overflow).toBe(1);
  });

  it("seeds a deterministic furniture/artifact catalog on dry land", () => {
    const a = new ColonySim(4242);
    const b = new ColonySim(4242);

    expect(a.state.artifacts).toEqual(b.state.artifacts);
    expect(a.state.artifacts.map((item) => item.kind)).toEqual(EXPECTED_KINDS);
    expect(a.state.artifacts.map((item) => item.category)).toEqual([
      "furniture",
      "lighting",
      "greenery",
      "civic-art",
      "greenery",
      "civic-art",
      "civic-art",
    ]);

    for (const item of a.state.artifacts) {
      expect(item.isPublicSafe).toBe(true);
      expect(typeof item.x).toBe("number");
      expect(typeof item.y).toBe("number");
      expect(item.rot).toBeGreaterThanOrEqual(0);
      expect(item.rot).toBeLessThan(Math.PI * 2);
      expect(item.footprint.w).toBeGreaterThan(0);
      expect(item.footprint.h).toBeGreaterThan(0);
      expect(item.isPublicSafe).toBe(true);
      expect(
        a.state.terrain.isWater(Math.round(item.x), Math.round(item.y)),
      ).toBe(false);
    }
  });
});
