import { describe, expect, it } from "vitest";
import { BIG, COMPACT, ESTATE, GRAND, makeNeighborhoodAt } from "../src/colony/neighborhood";
import { ColonySim } from "../src/colony/sim";
import { ColonyRuntime } from "../src/colony/runtime";
import { COLONY } from "../src/colony/config";
import { plotPriceKook } from "../src/colony/land";
import { CELL_SIZE } from "../src/colony/scale";
import { LAND_PRICE_PER_M2_KCO, plotBoardPriceKco, plotPricePerM2Kco, plotSizeM } from "../src/colony/landPrice";

describe("parcel land price board", () => {
  it("exports the house-zone area rate per full parcel square metre", () => {
    expect(LAND_PRICE_PER_M2_KCO).toBe(0.0375);
    expect(plotPricePerM2Kco()).toBe(0.0375);
    expect(plotSizeM(ESTATE)).toEqual({ w: ESTATE.W * CELL_SIZE, d: ESTATE.D * CELL_SIZE, areaM2: 10672 });
  });

  it("shows inland house-zone prices for each parcel tier", () => {
    const prices = [
      ["ESTATE", ESTATE.houseDepth * (ESTATE.W - 2 * ESTATE.inset), 160],
      ["GRAND", GRAND.houseDepth * (GRAND.W - 2 * GRAND.inset), 221],
      ["BIG", BIG.houseDepth * (BIG.W - 2 * BIG.inset), 32],
      ["COMPACT", COMPACT.houseDepth * (COMPACT.W - 2 * COMPACT.inset), 21],
    ] as const;
    for (const [tier, cells, price] of prices) {
      expect(plotPriceKook(cells, 999, COLONY.economy.land), `${tier} inland price`).toBe(price);
    }
  });

  it("matches runtime deed inputs for a real neighborhood parcel", () => {
    const sim = new ColonySim(180);
    const parcel = makeNeighborhoodAt(sim.state.terrain, sim.state.terrain.landing, { small: false }).parcels.find(p => p.fenceType === "fence")!;
    const distToWater = sim.state.terrain.distToWater[sim.state.terrain.idx(Math.round(parcel.x), Math.round(parcel.y))] ?? 999;
    expect(plotBoardPriceKco(parcel, distToWater)).toBe(
      plotPriceKook(parcel.houseZone.w * parcel.houseZone.d, distToWater, COLONY.economy.land),
    );
  });

  it("board total equals plotPriceK for the matching lot", () => {
    const rt = new ColonyRuntime(180);
    const lot =
      rt.sim.state.neighborhood!.lots.find((l) => l.fenceType === "fence" && l.w === ESTATE.W && !l.reservedFor) ??
      rt.sim.state.neighborhood!.lots.find((l) => l.fenceType === "fence" && !l.reservedFor)!;
    const t = rt.sim.state.terrain;
    const distToWater = t.distToWater[t.idx(Math.round(lot.x), Math.round(lot.y))] ?? 999;
    expect(plotBoardPriceKco(lot, distToWater)).toBe(rt.plotPriceK(lot));
  });
});
