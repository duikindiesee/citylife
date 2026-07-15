// Spec 126 — the civic-art artifacts. Pins the pure placement transform the R3F component
// syncs from, and smoke-tests the geometry builder produces all 7 kinds (three runs in the
// node env).
import { describe, it, expect } from "vitest";
import type { VisualArtifact } from "../src/colony/artifacts";
import { ARTIFACT_KINDS } from "../src/colony/artifacts";
import {
  artifactTransform,
  buildArtifactAssets,
  nudgeOffRoads,
} from "../src/colony/render/artifactLayer";

function art(p: Partial<VisualArtifact>): VisualArtifact {
  return {
    id: "a",
    kind: "bench",
    x: 0,
    y: 0,
    rot: 0,
    footprint: { w: 1, h: 1 },
    category: "seating" as VisualArtifact["category"],
    isPublicSafe: true,
    ...p,
  };
}

describe("spec 126 — artifact placement transform", () => {
  it("maps to the 4m grid with a small lift, -rot yaw, and footprint scale", () => {
    const t = artifactTransform(
      art({ x: 10, y: 20, rot: Math.PI / 2, footprint: { w: 2, h: 3 } }),
      40,
      () => 2.5,
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
      expect(
        assets[kind].geometry.getAttribute("position").count,
      ).toBeGreaterThan(0);
      expect(assets[kind].material).toBeTruthy();
    }
    // clean up (the component disposes these; the test owns its own copies)
    for (const kind of ARTIFACT_KINDS) {
      assets[kind].geometry.dispose();
      assets[kind].material.dispose();
    }
  });
});

describe("spec 126 revision — artifacts stay off the carriageway", () => {
  const isRoadFrom = (cells: string[]) => {
    const s = new Set(cells);
    return (x: number, y: number) => s.has(`${x},${y}`);
  };
  it("an artifact off the road keeps its exact spot", () => {
    expect(nudgeOffRoads({ x: 10, y: 10 }, isRoadFrom(["5,5"]), 100)).toEqual({
      x: 10,
      y: 10,
    });
  });
  it("an artifact ON the road slides to the nearest unpaved cell", () => {
    // a 3-wide vertical carriageway through x=9..11; the artifact stands mid-lane
    const road: string[] = [];
    for (let y = 0; y < 30; y++)
      for (let x = 9; x <= 11; x++) road.push(`${x},${y}`);
    const spot = nudgeOffRoads({ x: 10, y: 10 }, isRoadFrom(road), 100);
    expect(spot).toBeTruthy();
    expect(spot!.x === 8 || spot!.x === 12).toBe(true); // first unpaved ring cell
  });
  it("an artifact drowned in asphalt hides instead of standing in the lane", () => {
    const road: string[] = [];
    for (let y = 0; y < 30; y++)
      for (let x = 0; x < 30; x++) road.push(`${x},${y}`);
    expect(nudgeOffRoads({ x: 10, y: 10 }, isRoadFrom(road), 30)).toBeNull();
  });
});
