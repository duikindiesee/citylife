import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import {
  plotClearsRoadFootprint,
  plotRoadOverlapCells,
  conservativeRoadRibbonBlockedCells,
} from "../src/colony/placementValidation";

// Shared placement-validation contract. New rectangular plot/pad surveys must consume these helpers:
// logical road centre cells are insufficient because the smooth rendered ribbon is wider and curved.
describe("plot/pad placement versus rendered roads", () => {
  it("fails every plot/pad rectangle that overlaps a conservative road-footprint cell", () => {
    const roadCells = new Set(["10,10", "11,10", "12,10"]);
    expect(plotClearsRoadFootprint({ x: 8, y: 8, w: 3, h: 3 }, roadCells)).toBe(false);
    expect(plotRoadOverlapCells({ x: 8, y: 8, w: 3, h: 3 }, roadCells)).toEqual([
      "10,10",
    ]);
    expect(plotClearsRoadFootprint({ x: 2, y: 2, w: 3, h: 3 }, roadCells)).toBe(true);
  });

  it("keeps the live seed depot pad outside the conservative pre-existing ribbon footprint", () => {
    const rt = new ColonyRuntime(4242);
    const pad = rt.sim.state.busDepotPad!;
    const preExistingWays = (rt.sim.state.roadWays ?? []).filter(
      (way) => way.source !== "depot-spur",
    );
    const roadCells = conservativeRoadRibbonBlockedCells(preExistingWays, rt.sim.state.terrain);
    expect(plotRoadOverlapCells(pad, roadCells)).toEqual([]);
  });
});
