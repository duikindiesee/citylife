import { describe, expect, it } from "vitest";
import { BIG, COMPACT, ESTATE, GRAND, makeNeighborhoodAt } from "../src/colony/neighborhood";
import { ColonySim } from "../src/colony/sim";
import { ColonyRuntime } from "../src/colony/runtime";
import { COLONY } from "../src/colony/config";
import { plotPriceKook } from "../src/colony/land";
import { CELL_SIZE } from "../src/colony/scale";
import { LAND_PRICE_PER_M2_KCO, plotBoardPriceKco, plotPricePerM2Kco, plotSizeM } from "../src/colony/landPrice";

describe("parcel land price board", () => {
  it("uses the approved full-parcel square metre rate", () => {
    expect(LAND_PRICE_PER_M2_KCO).toBe(0.27);
    expect(plotPricePerM2Kco()).toBe(0.27);
    expect(plotSizeM(ESTATE)).toEqual({ w: 28, d: 36, areaM2: 1008 });
  });
  it("prices the inland tiers on full parcel areas", () => {
    for (const [size, price] of [[COMPACT,130],[BIG,173],[ESTATE,272],[GRAND,2700]] as const)
      expect(plotPriceKook(size.W*size.D*CELL_SIZE*CELL_SIZE,999,COLONY.economy.land)).toBe(price);
  });
  it("board and deed use the same full-area formula", () => {
    const sim=new ColonySim(180), parcels=makeNeighborhoodAt(sim.state.terrain,sim.state.terrain.landing).parcels;
    const parcel=parcels.find(p=>p.fenceType==="fence")!;
    const dist=sim.state.terrain.distToWater[sim.state.terrain.idx(Math.round(parcel.x),Math.round(parcel.y))]??999;
    expect(plotBoardPriceKco(parcel,dist)).toBe(plotPriceKook(parcel.w*parcel.h*16,dist,COLONY.economy.land));
    const rt=new ColonyRuntime(180), lot=rt.sim.state.neighborhood!.lots.find(l=>l.fenceType==="fence"&&!l.reservedFor)!;
    const t=rt.sim.state.terrain,d=t.distToWater[t.idx(Math.round(lot.x),Math.round(lot.y))]??999;
    expect(plotBoardPriceKco(lot,d)).toBe(rt.plotPriceK(lot));
  });
});
