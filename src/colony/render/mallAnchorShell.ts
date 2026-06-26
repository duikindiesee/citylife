import type { Reserve } from "../commerce/district";

export function mallAnchorNightFloorEmissive(daylight: number): number {
  const clamped = Math.max(0, Math.min(1, daylight));
  return 0.08 + (1 - clamped) * 1.27;
}

export interface MallAnchorShellModel {
  kind: "mall_anchor_shell";
  center: { x: number; y: number };
  baseY: number;
  body: { w: number; h: number; d: number; y: number };
  wing: { w: number; h: number; d: number; xOffset: number; y: number };
  roof: { w: number; h: number; d: number; y: number };
  entranceCanopy: {
    w: number;
    h: number;
    d: number;
    zOffset: number;
    y: number;
  };
  nightFloor: {
    w: number;
    d: number;
    y: number;
    emissiveIntensity: { day: number; night: number };
  };
}

/**
 * Spec 106 — deterministic render model for the reserved commercial mall anchor pad.
 *
 * The district survey owns the pad rectangle; this helper only translates that already-stable
 * rectangle into a flat-roofed anchor shell. `surfaceY` is injected so the renderer can seat the mass
 * on the dried/render-levelled mall pad instead of raw coastal terrain while tests can prove the model
 * without a WebGL renderer.
 */
export function buildMallAnchorShellModel(
  pad: Reserve,
  surfaceY: (x: number, y: number) => number,
): MallAnchorShellModel {
  const center = { x: pad.x + (pad.w - 1) / 2, y: pad.y + (pad.h - 1) / 2 };
  const samples = [
    { x: pad.x, y: pad.y },
    { x: pad.x + pad.w - 1, y: pad.y },
    { x: pad.x, y: pad.y + pad.h - 1 },
    { x: pad.x + pad.w - 1, y: pad.y + pad.h - 1 },
    center,
  ];
  let baseY = Infinity;
  for (const c of samples) baseY = Math.min(baseY, surfaceY(c.x, c.y));
  if (!Number.isFinite(baseY)) baseY = 0;

  const body = {
    w: pad.w * 0.86,
    h: 2.15,
    d: pad.h * 0.78,
    y: 2.15 / 2,
  };
  const wing = {
    w: pad.w * 0.18,
    h: 1.55,
    d: pad.h * 0.58,
    xOffset: pad.w * 0.34,
    y: 1.55 / 2,
  };
  const roof = {
    w: pad.w * 0.92,
    h: 0.28,
    d: pad.h * 0.84,
    y: body.h + 0.28 / 2,
  };
  return {
    kind: "mall_anchor_shell",
    center,
    baseY,
    body,
    wing,
    roof,
    entranceCanopy: {
      w: pad.w * 0.42,
      h: 0.16,
      d: 0.92,
      zOffset: -(pad.h * 0.78) / 2 - 0.38,
      y: 1.48,
    },
    nightFloor: {
      w: pad.w * 1.04,
      d: pad.h * 0.96,
      y: 0.025,
      emissiveIntensity: { day: 0.08, night: 1.35 },
    },
  };
}
