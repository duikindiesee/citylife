// Spec 126 — the civic-art artifacts. Pins the pure placement transform the R3F component
// syncs from, and smoke-tests the geometry builder produces all 7 kinds (three runs in the
// node env).
import { describe, it, expect } from "vitest";
import type { VisualArtifact } from "../src/colony/artifacts";
import { ARTIFACT_KINDS } from "../src/colony/artifacts";
import { artifactTransform, buildArtifactAssets } from "../src/colony/render/artifactLayer";

function art(p: Partial<VisualArtifact>): VisualArtifact {
  return {
    id: "a", kind: "bench", x: 0, y: 0, rot: 0, footprint: { w: 1, h: 1 },
    category: "seating" as VisualArtifact["category"], isPublicSafe: true, ...p,
  };
}

describe("spec 126 — artifact placement transform", () => {
  it("maps to the 4m grid with a small lift, -rot yaw, and footprint scale", () => {
    const t = artifactTransform(
      art({ x: 10, y: 20, rot: Math.PI / 2, footprint: { w: 2, h: 3 } }),
      40,
      () => 2.5
    );
    expect(t.wx).toBe((10 - 20) * 4);
    expect(t.wz).toBe((20 - 20) * 4);
    expect(t.wy).toBeCloseTo(2.515, 6); // ground 2.5 + 0.015 lift
    expect(t.rotY).toBeCloseTo(-Math.PI / 2, 6);
    expect(t.scaleW).toBe(2);
    expect(t.scaleH).toBe(3);
  });

  it("never sinks below sea level", () => {
    expect(artifactTransform(art({}), 10, () => -5).wy).toBeCloseTo(0.015, 6);
  });
});

describe("spec 126 — geometry builder", () => {
  it("builds a geometry + material for every artifact kind", () => {
    const assets = buildArtifactAssets();
    for (const kind of ARTIFACT_KINDS) {
      expect(assets[kind]).toBeTruthy();
      expect(assets[kind].geometry.getAttribute("position").count).toBeGreaterThan(0);
      expect(assets[kind].material).toBeTruthy();
    }
    // clean up (the component disposes these; the test owns its own copies)
    for (const kind of ARTIFACT_KINDS) {
      assets[kind].geometry.dispose();
      assets[kind].material.dispose();
    }
  });
});
