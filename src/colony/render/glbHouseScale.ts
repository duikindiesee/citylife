import { CELL_SIZE } from "../scale";

export interface GlbFootprintCells {
  w: number;
  d: number;
}

export interface GlbModelSize {
  x: number;
  y: number;
  z: number;
}

export type GlbScaleTuple = [number, number, number];

export function resolveGlbHouseScale({
  manifestScale,
  modelSize,
  footprint,
}: {
  manifestScale: GlbScaleTuple;
  modelSize: GlbModelSize;
  footprint?: GlbFootprintCells;
}): GlbScaleTuple {
  if (!footprint) return manifestScale;

  const targetWidth = footprint.w * CELL_SIZE;
  const targetDepth = footprint.d * CELL_SIZE;
  if (
    !Number.isFinite(targetWidth) ||
    !Number.isFinite(targetDepth) ||
    targetWidth <= 0 ||
    targetDepth <= 0 ||
    !Number.isFinite(modelSize.x) ||
    !Number.isFinite(modelSize.z) ||
    modelSize.x <= 0 ||
    modelSize.z <= 0
  ) {
    return manifestScale;
  }

  const fit = Math.min(targetWidth / modelSize.x, targetDepth / modelSize.z);
  if (!Number.isFinite(fit) || fit <= 0) return manifestScale;

  return [fit, fit, fit];
}
