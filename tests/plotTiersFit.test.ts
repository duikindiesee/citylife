// Spec 180 Round 11 — real-measure plot tiers: every generated parcel is checked in metres against the
// approved tier table, the deed price, the house envelope setbacks/coverage, the road, the picket
// boundary and the starter garage. Thresholds are the Saldanha Bay (Langebaan) zoning scheme limits below.
import { describe, expect, it } from "vitest";
import { ColonySim } from "../src/colony/sim";
import { ColonyRuntime } from "../src/colony/runtime";
import { COLONY } from "../src/colony/config";
import { plotPriceBreakdown } from "../src/colony/land";
import { CELL_SIZE } from "../src/colony/scale";
import {
  BIG, COMPACT, ESTATE, GRAND, PARCEL_TIER_LABEL, houseEnvelopeM, makeNeighborhoodAt,
  type Parcel, type ParcelSize, type ParcelTier,
} from "../src/colony/neighborhood";
import { LAND_PRICE_PER_M2_KCO, plotBoardPriceKco, plotSizeM } from "../src/colony/landPrice";
import { parcelFencePlacements } from "../src/colony/render/parcelFencePlacement";
import { garageFootprintInside, starterGaragePlacement } from "../src/colony/render/starterGaragePlacement";
import { housePoseForParcel } from "../src/colony/render/housePlacement";
import { parcelStreetDirection } from "../src/colony/parcelGeometry";
import { gradePlot } from "../src/colony/slope/plotGrading";

const SIZE: Record<ParcelTier, ParcelSize> = { COMPACT, BIG, ESTATE, GRAND };
// [cells W x D, metres, m², inland price KCO]
const TABLE: Record<ParcelTier, { cells: [number, number]; m: [number, number]; m2: number; kco: number }> = {
  COMPACT: { cells: [5, 6], m: [20, 24], m2: 480, kco: 130 },
  BIG: { cells: [5, 8], m: [20, 32], m2: 640, kco: 173 },
  ESTATE: { cells: [7, 9], m: [28, 36], m2: 1008, kco: 272 },
  GRAND: { cells: [25, 25], m: [100, 100], m2: 10000, kco: 2700 },
};
// Saldanha Bay Municipality Integrated Zoning Scheme By-Law 2021 (Langebaan), via the Forge research
// note "Langebaan erf sizes", 22 Nov 2026. Street line 3 m (2 m if <= 250 m²); side line 2.5 m when the
// stand is wider than 16 m; rear line 3 m (1 m if <= 250 m²); coverage 60% (250-500 m²), 50% (500-750),
// 40% (750-1,500). Smallholding zone (>= 1 ha): 20 m street, 10 m side and rear, 5% coverage.
const RULES: Record<ParcelTier, { front: number; side: number; rear: number; coverage: number }> = {
  COMPACT: { front: 3, side: 2.5, rear: 3, coverage: 0.6 }, // 480 m²
  BIG: { front: 3, side: 2.5, rear: 3, coverage: 0.5 }, // 640 m²
  ESTATE: { front: 3, side: 2.5, rear: 3, coverage: 0.4 }, // 1,008 m²
  GRAND: { front: 20, side: 10, rear: 10, coverage: 0.05 }, // 10,000 m²
};
const PROOF_HOUSE_M = 11.5; // the 11.50 x 11.50 m walkable proof house

type Rect = { x0: number; x1: number; y0: number; y1: number }; // cell units, edges
const boundary = (p: Parcel): Rect => {
  const ring = [...p.fence, p.gate];
  return {
    x0: Math.min(...ring.map((c) => c.x)) - 0.5, x1: Math.max(...ring.map((c) => c.x)) + 0.5,
    y0: Math.min(...ring.map((c) => c.y)) - 0.5, y1: Math.max(...ring.map((c) => c.y)) + 0.5,
  };
};
const zoneRect = (p: Parcel): Rect => ({
  x0: p.houseZone.x - 0.5, x1: p.houseZone.x + p.houseZone.w - 0.5,
  y0: p.houseZone.y - 0.5, y1: p.houseZone.y + p.houseZone.d - 0.5,
});

function generated() {
  const out: { seed: number; mapSize: number; carriage: Set<string>; parcels: Parcel[]; rt?: ColonyRuntime }[] = [];
  for (const seed of [180, 42]) {
    const sim = new ColonySim(seed);
    const n = makeNeighborhoodAt(sim.state.terrain, sim.state.terrain.landing);
    out.push({ seed, mapSize: sim.state.terrain.size, carriage: new Set(n.carriage.map((c) => `${c.x},${c.y}`)), parcels: n.parcels });
  }
  return out;
}

describe("plot tier table (spec 180 Round 11)", () => {
  it("fits the placed ESTATE house, pool and lawn inside the real 28 x 36 m lot",()=>{
    const sim=new ColonySim(180),p=makeNeighborhoodAt(sim.state.terrain,sim.state.terrain.landing,{small:false}).parcels.find(x=>x.id==="lot_1")!;
    expect(p.tier).toBe("ESTATE");
    const grading=gradePlot(p,()=>0),pose=housePoseForParcel(p,sim.state.terrain.size,grading);
    const ring=[...p.fence,p.gate],bounds={x0:Math.min(...ring.map(c=>c.x))-.5,x1:Math.max(...ring.map(c=>c.x))+.5,y0:Math.min(...ring.map(c=>c.y))-.5,y1:Math.max(...ring.map(c=>c.y))+.5};
    const rect=(cx:number,cy:number,w:number,d:number)=>({x0:cx-w/2,x1:cx+w/2,y0:cy-d/2,y1:cy+d/2});
    const house=rect(pose.position[0]/CELL_SIZE+sim.state.terrain.size/2,pose.position[2]/CELL_SIZE+sim.state.terrain.size/2,11.5/CELL_SIZE,11.5/CELL_SIZE);
    const street=parcelStreetDirection(p),inland:[number,number]=[-street[0],-street[1]];
    const houseCentre:[number,number]=[pose.position[0]/CELL_SIZE+sim.state.terrain.size/2,pose.position[2]/CELL_SIZE+sim.state.terrain.size/2];
    const poolCentre:[number,number]=[houseCentre[0]+inland[0]*(8.75/CELL_SIZE),houseCentre[1]+inland[1]*(8.75/CELL_SIZE)];
    const lawnCentre:[number,number]=[poolCentre[0]+inland[0]*(5/CELL_SIZE),poolCentre[1]+inland[1]*(5/CELL_SIZE)];
    const pool=rect(poolCentre[0],poolCentre[1],(street[0]===0?8:4)/CELL_SIZE,(street[0]===0?4:8)/CELL_SIZE);
    const lawn=rect(lawnCentre[0],lawnCentre[1],(street[0]===0?8:5)/CELL_SIZE,(street[0]===0?5:8)/CELL_SIZE);
    for(const r of [house,pool,lawn]){expect(r.x0).toBeGreaterThanOrEqual(bounds.x0+2.5/CELL_SIZE);expect(r.x1).toBeLessThanOrEqual(bounds.x1-2.5/CELL_SIZE);expect(r.y0).toBeGreaterThanOrEqual(bounds.y0+3/CELL_SIZE);expect(r.y1).toBeLessThanOrEqual(bounds.y1-3/CELL_SIZE);}
    const rearClearance=((poolCentre[0]-p.gate.x)*inland[0]+(poolCentre[1]-p.gate.y)*inland[1]);
    expect(rearClearance-2/CELL_SIZE).toBeGreaterThanOrEqual(1/CELL_SIZE);
    expect(((poolCentre[0]-houseCentre[0])*inland[0]+(poolCentre[1]-houseCentre[1])*inland[1])-5.75/CELL_SIZE).toBeGreaterThanOrEqual(1/CELL_SIZE);
    expect(((poolCentre[0]-houseCentre[0])*inland[0]+(poolCentre[1]-houseCentre[1])*inland[1])).toBeGreaterThan(0);
    const coverage=(11.5*11.5+8*4)/(p.w*p.h*CELL_SIZE*CELL_SIZE);
    expect(coverage).toBeLessThanOrEqual(.4);
    expect([p.w*CELL_SIZE,p.h*CELL_SIZE]).toEqual([28,36]);
  });
  it("each tier has the approved cells, metres, m² and inland price; rate × area = price", () => {
    expect(LAND_PRICE_PER_M2_KCO).toBe(0.27);
    for (const tier of Object.keys(TABLE) as ParcelTier[]) {
      const s = SIZE[tier], row = TABLE[tier];
      expect([s.W, s.D], tier).toEqual(row.cells);
      expect(plotSizeM(s), tier).toEqual({ w: row.m[0], d: row.m[1], areaM2: row.m2 });
      const bill = plotPriceBreakdown(row.m2, 999, COLONY.economy.land);
      expect(bill, tier).toEqual({ baseKco: row.kco, premiumKco: 0, totalKco: row.kco });
      expect(Math.abs(row.m2 * LAND_PRICE_PER_M2_KCO - row.kco), `${tier} rounding`).toBeLessThanOrEqual(0.5);
      expect(PARCEL_TIER_LABEL[tier]).toBeTruthy();
    }
  });

  it("the house envelope is a real-metre footprint that fits the proof house, inside setbacks and coverage", () => {
    for (const tier of Object.keys(TABLE) as ParcelTier[]) {
      const s = SIZE[tier], e = houseEnvelopeM(s), r = RULES[tier];
      expect(e.w, `${tier} envelope width`).toBeGreaterThanOrEqual(PROOF_HOUSE_M);
      expect(e.d, `${tier} envelope depth`).toBeGreaterThanOrEqual(PROOF_HOUSE_M);
      expect(e.w).toBeLessThanOrEqual(20);
      expect(e.d).toBeLessThanOrEqual(16);
      expect((1 + s.setback) * CELL_SIZE, `${tier} front building line`).toBeGreaterThanOrEqual(r.front);
      expect(s.inset * CELL_SIZE, `${tier} side building line`).toBeGreaterThanOrEqual(r.side);
      expect((s.gardenDepth + s.farmDepth + 1) * CELL_SIZE, `${tier} rear building line`).toBeGreaterThanOrEqual(r.rear);
      expect(e.areaM2 / TABLE[tier].m2, `${tier} coverage`).toBeLessThanOrEqual(r.coverage);
    }
  });
});

describe("generated neighbourhoods at the new sizes", () => {
  const hoods = generated();

  it("every parcel matches its tier, and its house is the tier envelope (not stretched to the plot)", () => {
    for (const h of hoods) for (const p of h.parcels) {
      expect(p.tier, p.id).toBeDefined();
      const row = TABLE[p.tier!], b = boundary(p);
      expect([(b.x1 - b.x0) * CELL_SIZE, (b.y1 - b.y0) * CELL_SIZE].sort(), p.id).toEqual([...row.m].sort());
      const e = houseEnvelopeM(SIZE[p.tier!]);
      expect([p.houseZone.w * CELL_SIZE, p.houseZone.d * CELL_SIZE], p.id).toEqual([e.w, e.d]);
    }
  });

  it("house zone sits inside the boundary with the tier's front and side building lines", () => {
    for (const h of hoods) for (const p of h.parcels) {
      const b = boundary(p), z = zoneRect(p), r = RULES[p.tier!];
      const left = (z.x0 - b.x0) * CELL_SIZE, right = (b.x1 - z.x1) * CELL_SIZE;
      const near = (z.y0 - b.y0) * CELL_SIZE, far = (b.y1 - z.y1) * CELL_SIZE;
      const front = p.side === 1 ? near : far, rear = p.side === 1 ? far : near; // side +1 grows away in +y
      for (const v of [left, right, front, rear]) expect(v, p.id).toBeGreaterThan(0);
      expect(front, `${p.id} front`).toBeGreaterThanOrEqual(r.front);
      expect(Math.min(left, right), `${p.id} side`).toBeGreaterThanOrEqual(r.side);
      expect(rear, `${p.id} rear`).toBeGreaterThanOrEqual(r.rear);
      expect(houseEnvelopeM(SIZE[p.tier!]).areaM2 / (p.w * p.h * CELL_SIZE * CELL_SIZE), `${p.id} coverage`).toBeLessThanOrEqual(r.coverage);
    }
  });

  it("no driveway cell lies on the carriageway, and every driveway passes through its gate", () => {
    for (const h of hoods) for (const p of h.parcels) {
      for (const c of p.driveway) expect(h.carriage.has(`${c.x},${c.y}`), `${p.id} driveway ${c.x},${c.y}`).toBe(false);
      expect(p.driveway.some((c) => c.x === p.gate.x && c.y === p.gate.y), p.id).toBe(true);
    }
  });

  it("neighbouring boundaries never overlap (at least the 4 m strip between them)", () => {
    for (const h of hoods) {
      const rs = h.parcels.map(boundary);
      for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
        const a = rs[i]!, b = rs[j]!;
        const gapX = Math.max(b.x0 - a.x1, a.x0 - b.x1), gapY = Math.max(b.y0 - a.y1, a.y0 - b.y1);
        expect(Math.max(gapX, gapY) * CELL_SIZE, `${h.parcels[i]!.id} vs ${h.parcels[j]!.id}`).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it("the picket fence covers the whole metre boundary, leaving only the 3.7 m gate opening", () => {
    let checked = 0;
    for (const h of hoods) for (const p of h.parcels) {
      if (p.fenceType !== "fence") continue;
      checked++;
      const pl = parcelFencePlacements(p, h.mapSize), b = boundary(p);
      const w = (c: number) => (c - h.mapSize / 2) * CELL_SIZE;
      const X0 = w(b.x0), X1 = w(b.x1), Z0 = w(b.y0), Z1 = w(b.y1);
      const gate = pl.filter((q) => q.piece === "gate-driveway");
      expect(gate.length, p.id).toBe(1);
      const g = gate[0]!.position;
      const edges = [
        { horiz: true, fixed: Z0, lo: X0, hi: X1 }, { horiz: true, fixed: Z1, lo: X0, hi: X1 },
        { horiz: false, fixed: X0, lo: Z0, hi: Z1 }, { horiz: false, fixed: X1, lo: Z0, hi: Z1 },
      ];
      let gateEdges = 0;
      for (const e of edges) {
        const iv: [number, number][] = [];
        for (const q of pl) {
          if (q.piece !== "panel") continue;
          const horiz = Math.abs(Math.sin(q.rotationY)) < 1e-6;
          if (horiz !== e.horiz) continue;
          const along = e.horiz ? q.position[0] : q.position[2], across = e.horiz ? q.position[2] : q.position[0];
          if (Math.abs(across - e.fixed) > 1e-3) continue;
          const half = (q.length ?? 2) / 2;
          iv.push([along - half, along + half]);
        }
        const gAcross = e.horiz ? g[2] : g[0];
        if (Math.abs(gAcross - e.fixed) < 1e-3) { gateEdges++; const ga = e.horiz ? g[0] : g[2]; iv.push([ga - 1.85, ga + 1.85]); }
        iv.sort((a, c) => a[0] - c[0]);
        let cursor = e.lo;
        for (const [a, c] of iv) { expect(a - cursor, `${p.id} gap on edge at ${cursor.toFixed(2)}`).toBeLessThanOrEqual(0.05); cursor = Math.max(cursor, c); }
        expect(e.hi - cursor, `${p.id} gap at edge end`).toBeLessThanOrEqual(0.05);
      }
      expect(gateEdges, `${p.id} gate on boundary`).toBe(1);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("the 4 x 8 m starter garage fits inside the house envelope on every tier", () => {
    for (const h of hoods) for (const p of h.parcels) {
      expect(garageFootprintInside(p, starterGaragePlacement(p, h.mapSize), h.mapSize), p.id).toBe(true);
    }
  });
});

describe("for-sale board matches the deed", () => {
  it("board price == plotPriceK == round(full m² × rate) + waterfront premium, for every unreserved lot", () => {
    for (const seed of [180, 42]) {
      const rt = new ColonyRuntime(seed), t = rt.sim.state.terrain;
      for (const lot of rt.sim.state.neighborhood!.lots) {
        if (lot.reservedFor) { expect(rt.plotPriceK(lot)).toBe(Infinity); continue; }
        const dist = t.distToWater[t.idx(Math.round(lot.x), Math.round(lot.y))] ?? 999;
        const areaM2 = lot.w * lot.h * CELL_SIZE * CELL_SIZE;
        const bill = plotPriceBreakdown(areaM2, dist, COLONY.economy.land);
        expect(bill.baseKco, lot.id).toBe(Math.round(areaM2 * LAND_PRICE_PER_M2_KCO));
        expect(bill.baseKco + bill.premiumKco, lot.id).toBe(bill.totalKco);
        expect(bill.premiumKco, lot.id).toBeLessThanOrEqual(Math.ceil(bill.baseKco * 0.25) + 1);
        expect(plotBoardPriceKco(lot, dist), lot.id).toBe(rt.plotPriceK(lot));
        expect(rt.plotPriceK(lot), lot.id).toBe(bill.totalKco);
      }
    }
  });
});
