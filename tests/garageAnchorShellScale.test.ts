import { describe, expect, it } from "vitest";
import { buildGarageAnchorShellModel } from "../src/colony/render/garageAnchorShell";
import { CELL_SIZE } from "../src/colony/scale";
import type { GaragePad } from "../src/colony/commerce/district";

// PLAYER.GARAGE.1 — the operator-reported "size is wrong" defect: the shell model is authored in
// grid cells while the render layer positions in world metres, so without the declared
// cells→metres renderScale the landmark drew at exactly quarter size on its pad.

const pad: GaragePad = {
  x: 130,
  y: 270,
  w: 16,
  h: 11,
  kind: "garage_landmark",
  publicName: "Gearbox Auto Hub",
  isPublicSafe: true,
  facingAngle: Math.PI,
  roadTarget: { x: 125, y: 265 },
  streetFrontDir: { x: -1, y: 0 },
  crossFrontDir: { x: 0, y: -1 },
  islandCell: { x: 131, y: 271 },
};

describe("garage anchor shell render scale", () => {
  it("declares the cells→metres factor the render layer must apply", () => {
    const model = buildGarageAnchorShellModel(pad, () => 1.25);
    expect(model.renderScale).toBe(CELL_SIZE);
  });

  it("fills its surveyed pad once the render scale is applied", () => {
    const model = buildGarageAnchorShellModel(pad, () => 1.25);
    const padWorldW = pad.w * CELL_SIZE;
    const padWorldD = pad.h * CELL_SIZE;
    // the night floor is the shell's widest ground element — scaled, it must cover most of the
    // pad but never spill past it
    const floorWorldW = model.nightFloor.w * model.renderScale;
    const floorWorldD = model.nightFloor.d * model.renderScale;
    expect(floorWorldW).toBeGreaterThan(padWorldW * 0.9);
    expect(floorWorldW).toBeLessThanOrEqual(padWorldW);
    expect(floorWorldD).toBeGreaterThan(padWorldD * 0.85);
    expect(floorWorldD).toBeLessThanOrEqual(padWorldD);
    // without the scale the same floor is a quarter-size postage stamp — the reported defect
    expect(model.nightFloor.w).toBeLessThan(padWorldW / 2);
  });
});
