import {describe,it,expect} from "vitest";
import {BIG,COMPACT,ESTATE,GRAND,houseEnvelopeM,MAX_HOUSE_ENVELOPE_M,makeNeighborhoodAt} from "../src/colony/neighborhood";
import {plotPriceKook,plotPriceBreakdown} from "../src/colony/land";
import {COLONY} from "../src/colony/config";
import {CELL_SIZE} from "../src/colony/scale";
import {ColonySim} from "../src/colony/sim";
const tiers=[COMPACT,BIG,ESTATE,GRAND] as const, areas=[480,640,1008,10000], prices=[130,173,272,2700];
describe("real-measure residential plot tiers",()=>{
 it("keeps dimensions, odd frontages and depth identity",()=>{tiers.forEach((s,i)=>{expect(s.W%2).toBe(1);expect(s.W*s.D*16).toBe(areas[i]);expect(s.D).toBe(2+s.setback+s.houseDepth+s.gardenDepth+s.farmDepth);});});
 it("prices land and exposes the approved envelope",()=>{tiers.forEach((s,i)=>{expect(plotPriceKook(areas[i]!,999,COLONY.economy.land)).toBe(prices[i]);expect(plotPriceKook(areas[i]!,0,COLONY.economy.land)).toBe(Math.round(areas[i]!*0.27*1.25));const e=houseEnvelopeM(s);expect(e.w).toBeLessThanOrEqual(MAX_HOUSE_ENVELOPE_M.w);expect(e.d).toBeLessThanOrEqual(MAX_HOUSE_ENVELOPE_M.d);});expect(plotPriceBreakdown(480,0,COLONY.economy.land).premiumKco).toBe(32);expect(plotPriceBreakdown(480,60,COLONY.economy.land).premiumKco).toBe(0);});
 it("keeps slot-zero founders and tier-sized envelopes in generated neighborhoods",()=>{for(const seed of [180,42]){const sim=new ColonySim(seed),n=makeNeighborhoodAt(sim.state.terrain,sim.state.terrain.landing);expect(n.parcels.find(p=>p.id==="lot_1")?.slot).toBe(0);expect(n.parcels.find(p=>p.id==="lot_2")?.slot).toBe(0);expect(n.parcels.filter(p=>p.tier==="GRAND").length).toBeLessThanOrEqual(1);for(const p of n.parcels){if(!p.tier)continue;const e=houseEnvelopeM(({COMPACT,BIG,ESTATE,GRAND} as const)[p.tier]);expect(p.houseZone.w*CELL_SIZE).toBe(e.w);expect(p.houseZone.d*CELL_SIZE).toBe(e.d);}}});
});
