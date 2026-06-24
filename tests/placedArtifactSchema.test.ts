import { describe, expect, it } from "vitest";
import { ColonySim } from "../src/colony/sim";
import {
  PLACED_ARTIFACT_KIND_REGISTRY,
  PLACED_ARTIFACT_SCHEMA_VERSION,
  artifactRegistryVariants,
  parsePlacedArtifact,
  placedArtifactFromVisualArtifact,
  serializePlacedArtifact,
  type PlacedArtifact,
} from "../src/colony/artifactSchema";

const GOLDEN_V1_BENCH =
  '{"schemaVersion":1,"id":"artifact-0-bench","kind":"furniture","transform":{"x":300,"y":304,"rot":1.5707963267948966},"footprint":{"w":1.4,"h":0.55},"category":"furniture","data":{"variant":"bench"}}';

describe("PlacedArtifact schema", () => {
  it("registers every seeded artifact variant in exactly one placed-artifact kind", () => {
    const seen = new Map<string, string>();
    for (const entry of Object.values(PLACED_ARTIFACT_KIND_REGISTRY)) {
      expect(Object.isFrozen(entry)).toBe(true);
      expect(Object.isFrozen(entry.variants)).toBe(true);
      for (const variant of entry.variants) {
        expect(seen.has(variant), `${variant} registered twice`).toBe(false);
        seen.set(variant, entry.kind);
      }
    }

    expect([...seen.keys()].sort()).toEqual([...artifactRegistryVariants()].sort());
    expect(seen.get("bench")).toBe("furniture");
    expect(seen.get("lamppost")).toBe("prop");
    expect(seen.get("fountain")).toBe("prop");
    expect(seen.get("planter")).toBe("landscaping");
  });

  it("converts seeded visual artifacts to PlacedArtifact without quantising rot", () => {
    const sim = new ColonySim(4242);
    const placed = sim.state.artifacts.map(placedArtifactFromVisualArtifact);

    expect(placed.map((item) => item.kind)).toEqual([
      "furniture",
      "prop",
      "landscaping",
      "prop",
    ]);
    expect(placed.map((item) => item.data.variant)).toEqual([
      "bench",
      "lamppost",
      "planter",
      "fountain",
    ]);
    expect(placed[2]!.transform.rot).toBeCloseTo(Math.PI * 0.25, 12);
    expect(placed[3]!.transform.rot).toBeCloseTo(Math.PI * 0.75, 12);
  });

  it("keeps the v1 golden payload structurally compatible and serializes canonically", () => {
    const canonical: PlacedArtifact = {
      schemaVersion: PLACED_ARTIFACT_SCHEMA_VERSION,
      id: "artifact-0-bench",
      kind: "furniture",
      transform: { x: 300, y: 304, rot: Math.PI * 0.5 },
      footprint: { w: 1.4, h: 0.55 },
      category: "furniture",
      data: { variant: "bench" },
    };

    expect(parsePlacedArtifact(GOLDEN_V1_BENCH)).toEqual(canonical);
    expect(JSON.parse(serializePlacedArtifact(canonical))).toEqual(canonical);
    expect(serializePlacedArtifact(parsePlacedArtifact(GOLDEN_V1_BENCH))).toBe(
      GOLDEN_V1_BENCH,
    );
  });

  it("drops unknown fields into the canonical v1 form and is idempotent", () => {
    const noisy = JSON.stringify({
      schemaVersion: 1,
      id: "artifact-2-planter",
      kind: "landscaping",
      transform: { x: 296, y: 298, rot: Math.PI * 0.25, junk: "drop-me" },
      footprint: { w: 1, h: 1, legacy: true },
      category: "greenery",
      children: [],
      data: { variant: "planter", paint: "ignored" },
      futureField: "ignored",
    });

    const canonical = parsePlacedArtifact(noisy);
    expect(canonical).toEqual({
      schemaVersion: 1,
      id: "artifact-2-planter",
      kind: "landscaping",
      transform: { x: 296, y: 298, rot: Math.PI * 0.25 },
      footprint: { w: 1, h: 1 },
      category: "greenery",
      data: { variant: "planter" },
    });
    const emitted = serializePlacedArtifact(canonical);
    expect(parsePlacedArtifact(emitted)).toEqual(canonical);
    expect(serializePlacedArtifact(parsePlacedArtifact(emitted))).toBe(emitted);
  });
});
