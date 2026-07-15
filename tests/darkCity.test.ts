// Spec 136 — the Dark City dressing: slab, rim, starfields, gas giant — all present, all
// deterministic, scaled from the world width, star shells beyond the orbit cap.
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { buildDarkCity } from "../src/colony/render/darkCity";

describe("spec 136 — Dark City", () => {
  const worldN = 608 * 4;
  const g = buildDarkCity(worldN);
  const byName = (n: string) => {
    let hit: THREE.Object3D | null = null;
    g.traverse((o) => {
      if (o.name === n && !hit) hit = o;
    });
    return hit as unknown as THREE.Object3D | null;
  };

  it("floats the island on a rock slab with the cyan rim", () => {
    const slab = byName("darkCity-slab") as THREE.Mesh | null;
    expect(slab).toBeTruthy();
    const geo = (slab as THREE.Mesh).geometry as THREE.CylinderGeometry;
    expect(geo.parameters.radiusTop).toBeCloseTo(worldN * 0.72, 6);
    expect(byName("darkCity-rim")).toBeTruthy();
    expect(byName("darkCity-rim-halo")).toBeTruthy();
  });

  it("hangs two star shells beyond the camera orbit cap (2500)", () => {
    for (const name of ["darkCity-stardust", "darkCity-stars"]) {
      const pts = byName(name) as THREE.Points | null;
      expect(pts).toBeTruthy();
      const pos = (pts as THREE.Points).geometry.getAttribute("position");
      expect(pos.count).toBeGreaterThan(300);
      let minR = Infinity;
      for (let i = 0; i < pos.count; i++) {
        const r = Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i));
        if (r < minR) minR = r;
      }
      expect(minR).toBeGreaterThan(2500);
      // deterministic: a second build produces identical positions
      const again = buildDarkCity(worldN);
      let pts2: THREE.Points | null = null;
      again.traverse((o) => {
        if (o.name === name && !pts2) pts2 = o as THREE.Points;
      });
      const pos2 = (pts2 as unknown as THREE.Points).geometry.getAttribute(
        "position",
      );
      expect(pos2.getX(7)).toBe(pos.getX(7));
    }
  });

  it("looms the blue gas giant with its atmosphere in the same spot", () => {
    const giant = byName("darkCity-gas-giant") as THREE.Mesh | null;
    const atmo = byName("darkCity-gas-giant-atmo") as THREE.Mesh | null;
    expect(giant).toBeTruthy();
    expect(atmo).toBeTruthy();
    expect(
      (giant as THREE.Mesh).position.distanceTo((atmo as THREE.Mesh).position),
    ).toBe(0);
    // beyond the orbit cap, inside the raised far plane
    const d = (giant as THREE.Mesh).position.length();
    expect(d).toBeGreaterThan(2500);
    expect(d).toBeLessThan(12000);
  });
});
