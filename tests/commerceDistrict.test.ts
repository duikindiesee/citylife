import { describe, it, expect } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { cellOk } from "../src/colony/pathfind";
import { SHOP_SIZE } from "../src/colony/commerce/district";

// Drive the REAL runtime boot (neighbourhood + reserve search + survey) rather than reconstructing
// the layout — no drift between test and production. Booting is expensive, so cache per seed.
const RT_CACHE = new Map<number, ColonyRuntime>();
function rtFor(seed: number): ColonyRuntime {
  let rt = RT_CACHE.get(seed);
  if (!rt) {
    rt = new ColonyRuntime(seed);
    RT_CACHE.set(seed, rt);
  }
  return rt;
}

// Seeds that land on coastal flatland (the colony always does); 4242 is the live dev-server seed.
const SEEDS = [4242, 42, 7];

function footprintCells(p: {
  x: number;
  y: number;
  w: number;
  h: number;
}): string[] {
  const out: string[] = [];
  for (let y = p.y; y < p.y + p.h; y++)
    for (let x = p.x; x < p.x + p.w; x++) out.push(`${x},${y}`);
  return out;
}

/** Every cell a homestead occupies (fence bounding box + driveway) — what a shop must never touch. */
function residentialCells(rt: ColonyRuntime): Set<string> {
  const s = new Set<string>();
  for (const lot of rt.lots()) {
    const xs = lot.fence.map((f) => f.x),
      ys = lot.fence.map((f) => f.y);
    for (let y = Math.min(...ys); y <= Math.max(...ys); y++)
      for (let x = Math.min(...xs); x <= Math.max(...xs); x++)
        s.add(`${x},${y}`);
    for (const d of lot.driveway) s.add(`${d.x},${d.y}`);
  }
  return s;
}

describe("commercial district survey (spec 079 P0/P1)", () => {
  it("surveys shop plots on the coastal seeds", () => {
    for (const seed of SEEDS) {
      const d = rtFor(seed).commercialDistrict;
      expect(d).not.toBeNull();
      expect(d!.parcels.length).toBeGreaterThan(0);
    }
  }, 30000);

  it("every shop footprint is good ground (cellOk) and inside the reserve", () => {
    for (const seed of SEEDS) {
      const rt = rtFor(seed);
      const t = rt.sim.state.terrain;
      const reserve = rt.commercialReserve!;
      for (const p of rt.commercialDistrict!.parcels) {
        expect(SHOP_SIZE[p.kind]).toEqual({ w: p.w, d: p.h });
        for (let y = p.y; y < p.y + p.h; y++) {
          for (let x = p.x; x < p.x + p.w; x++) {
            expect(cellOk(t, x, y)).toBe(true);
            expect(x).toBeGreaterThanOrEqual(reserve.x);
            expect(x).toBeLessThan(reserve.x + reserve.w);
            expect(y).toBeGreaterThanOrEqual(reserve.y);
            expect(y).toBeLessThan(reserve.y + reserve.h);
          }
        }
      }
    }
  }, 30000);

  it("NO shop footprint lands on a homestead plot (the live-screenshot bug)", () => {
    for (const seed of SEEDS) {
      const rt = rtFor(seed);
      const residential = residentialCells(rt);
      for (const p of rt.commercialDistrict!.parcels) {
        for (const c of footprintCells(p))
          expect(residential.has(c)).toBe(false);
      }
    }
  }, 30000);

  it("shop footprints never overlap each other", () => {
    for (const seed of SEEDS) {
      const seen = new Set<string>();
      for (const p of rtFor(seed).commercialDistrict!.parcels) {
        for (const c of footprintCells(p)) {
          expect(seen.has(c)).toBe(false);
          seen.add(c);
        }
      }
    }
  }, 30000);

  it("every door sits on the front row, facing the high street", () => {
    for (const seed of SEEDS) {
      const d = rtFor(seed).commercialDistrict!;
      const streetY = d.reserve.y + Math.floor(d.reserve.h / 2);
      for (const p of d.parcels) {
        expect(p.doorY).toBe(p.side === -1 ? p.y + p.h - 1 : p.y);
        expect(p.doorX).toBe(p.x + Math.floor(p.w / 2));
        if (p.side === -1) expect(p.doorY).toBeLessThan(streetY);
        else expect(p.doorY).toBeGreaterThan(streetY);
      }
    }
  }, 30000);

  it("is deterministic — a fresh boot of the same seed replays an identical district", () => {
    for (const seed of SEEDS) {
      const a = rtFor(seed).commercialDistrict!;
      const b = new ColonyRuntime(seed).commercialDistrict!;
      expect(b.parcels).toEqual(a.parcels);
      expect(b.reserve).toEqual(a.reserve);
    }
  }, 30000);
});
