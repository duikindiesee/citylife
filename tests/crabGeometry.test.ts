// Spec 132 — Joe the Crab, with the operator's Sol-34 corrections: BLUE headset, lightning
// accents ON the earcup outer faces (the sides of the headset — not his mouth, not loose
// above him), and a separate hover bolt for the component to animate.
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  buildCrabGeometry,
  buildHoverBoltGeometry,
  CRAB_COLORS,
} from "../src/colony/render/crabGeometry";

function verticesOfColor(geo: THREE.BufferGeometry, hex: number) {
  const want = new THREE.Color(hex);
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const col = geo.getAttribute("color") as THREE.BufferAttribute;
  const out: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i < pos.count; i++) {
    if (
      Math.abs(col.getX(i) - want.r) < 1e-3 &&
      Math.abs(col.getY(i) - want.g) < 1e-3 &&
      Math.abs(col.getZ(i) - want.b) < 1e-3
    ) {
      out.push({ x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) });
    }
  }
  return out;
}

describe("spec 132 — Joe the Crab", () => {
  const geo = buildCrabGeometry();

  it("wears a BLUE headset — blue cups and a blue-white band, no black anywhere on it", () => {
    expect(verticesOfColor(geo, CRAB_COLORS.cup).length).toBeGreaterThan(0);
    expect(verticesOfColor(geo, CRAB_COLORS.band).length).toBeGreaterThan(0);
    // the cup blue is genuinely blue (b dominant), the band blue-leaning white
    const cup = new THREE.Color(CRAB_COLORS.cup);
    expect(cup.b).toBeGreaterThan(cup.r);
    const band = new THREE.Color(CRAB_COLORS.band);
    expect(band.b).toBeGreaterThan(band.r);
  });

  it("the lightning accents sit ON the earcup sides — one per cup, at earcup height", () => {
    const bolts = verticesOfColor(geo, CRAB_COLORS.bolt);
    expect(bolts.length).toBeGreaterThan(0);
    const left = bolts.filter((v) => v.x < -0.35);
    const right = bolts.filter((v) => v.x > 0.35);
    expect(left.length).toBeGreaterThan(0); // one on each side
    expect(right.length).toBeGreaterThan(0);
    for (const v of bolts) {
      expect(Math.abs(v.x)).toBeGreaterThan(0.33); // outboard of the shell = ON the cups
      expect(v.y).toBeGreaterThan(0.14); // at headset height…
      expect(v.y).toBeLessThan(0.42); // …not floating above him
      expect(v.z).toBeLessThan(0.15); // …and nowhere near his mouth/front
    }
  });

  it("the hover bolt is its own animatable geometry with a connected zigzag", () => {
    const bolt = buildHoverBoltGeometry();
    const pos = bolt.getAttribute("position") as THREE.BufferAttribute;
    expect(pos.count).toBeGreaterThan(0);
    bolt.computeBoundingBox();
    const bb = bolt.boundingBox!;
    // the two strokes overlap vertically (connected elbow), total height ~0.35
    expect(bb.max.y - bb.min.y).toBeGreaterThan(0.25);
    expect(bb.max.y - bb.min.y).toBeLessThan(0.5);
    bolt.dispose();
  });
});
