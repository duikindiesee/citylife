import { expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { cellOk } from "../src/colony/pathfind";
import { createStarterParcelManifest } from "../src/colony/starterParcelManifest";
import { computeTerrainLeveling, padSeatY } from "../src/colony/render/useTerrainLeveling";
import { leveledWorldY } from "../src/colony/render/terrainLeveling";
import { ribbonCoverage } from "../src/colony/render/roadRibbon";
import { getSmoothRoadY } from "../src/colony/render/roadSurface";
import { findJunctionZones } from "../src/colony/render/roadJunctions";
import { attachCapPolys, capCoverageCells } from "../src/colony/render/junctionCap";

/**
 * Measures the same terrain-level map supplied to R3F. This is intentionally an
 * audit first: its receipt tells us the grade limits to enforce without inventing
 * a car-slope threshold from source-only assumptions.
 */
it("audits every published starter home's pad and driveway grade", () => {
  const runtime = new ColonyRuntime(4242, { surveyOnly: true });
  const terrain = runtime.sim.state.terrain;
  const manifest = createStarterParcelManifest({
    layout: runtime.captureWorldLayout(),
    parcels: runtime.lots(),
    groundClear: (cell) => cellOk(terrain, cell.x, cell.y),
  });
  const lots = runtime.lots();
  for (const lot of lots) lot.built = manifest.plots.some((plot) => plot.plotId === lot.id);

  const roadY = (x: number, y: number) => getSmoothRoadY(terrain, x, y);
  const cover = ribbonCoverage(runtime.sim.state.roadWays ?? [], terrain, roadY);
  for (const [key, height] of capCoverageCells(
    attachCapPolys(findJunctionZones(runtime.sim.state.roadWays ?? [])), terrain, roadY,
  )) {
    const previous = cover.get(key);
    if (previous === undefined || height > previous) cover.set(key, height);
  }
  const level = computeTerrainLeveling(runtime.sim.state, cover, new Map());
  const audit = manifest.plots.map((plot) => {
    const h = plot.geometry.houseZone;
    const pad = padSeatY(terrain, h.x, h.y, h.width, h.depth);
    const footprint = Array.from({ length: h.width + 1 }, (_, dx) =>
      Array.from({ length: h.depth + 1 }, (_, dy) => ({
        x: h.x + dx, y: h.y + dy,
        error: Math.abs(leveledWorldY(terrain, level, h.x + dx, h.y + dy) - pad),
      })),
    ).flat();
    const drivewayHeights = plot.geometry.driveway.map((cell) =>
      leveledWorldY(terrain, level, cell.x, cell.y),
    );
    const maxStep = drivewayHeights.reduce((maximum, height, index) =>
      index === 0 ? 0 : Math.max(maximum, Math.abs(height - drivewayHeights[index - 1]!)), 0);
    return {
      plotId: plot.plotId,
      houseZone: h,
      overlappingRoadCells: Array.from({ length: h.width + 1 }, (_, dx) =>
        Array.from({ length: h.depth + 1 }, (_, dy) => `${h.x + dx},${h.y + dy}`),
      ).flat().filter((key) => cover.has(key)),
      padError: Math.max(...footprint.map((point) => point.error)),
      padErrorCells: footprint.filter((point) => point.error >= 0.001),
      maxDrivewayStepMetres: maxStep,
      roadTransitionMetres: Math.abs(
        drivewayHeights[0]! - getSmoothRoadY(terrain, plot.geometry.driveway[0]!.x, plot.geometry.driveway[0]!.y),
      ),
    };
  });
  console.info(JSON.stringify(audit));
  expect(audit).toHaveLength(10);
  expect(audit.every((plot) => plot.padError < 0.001)).toBe(true);
});
