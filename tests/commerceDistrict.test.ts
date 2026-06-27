import { describe, it, expect } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { cellOk } from "../src/colony/pathfind";
import { SHOP_SIZE } from "../src/colony/commerce/district";
import { COLONY } from "../src/colony/config";

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

function residentialSetbackCells(rt: ColonyRuntime): Set<string> {
  const s = residentialCells(rt);
  for (const lot of rt.lots()) {
    for (const f of lot.fence) {
      s.add(`${f.x},${f.y}`);
      s.add(`${f.x + 1},${f.y}`);
      s.add(`${f.x - 1},${f.y}`);
      s.add(`${f.x},${f.y + 1}`);
      s.add(`${f.x},${f.y - 1}`);
    }
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

  it("grows the reserve into a crossed block with a deterministic core intersection", () => {
    expect(COLONY.commerce.reserveW).toBe(88);
    expect(COLONY.commerce.reserveH).toBe(64);
    expect(COLONY.commerce.reserveFreePrimary).toBe(358);
    expect(COLONY.commerce.reserveFreeFallback).toBe(205);
    expect(COLONY.commerce.mallPadW).toBe(14);
    expect(COLONY.commerce.mallPadH).toBe(10);

    for (const seed of SEEDS) {
      const rt = rtFor(seed);
      const d = rt.commercialDistrict!;
      const reserve = rt.commercialReserve!;
      expect(reserve.w).toBe(88);
      expect(reserve.h).toBe(64);
      expect(d.crossStreet.length).toBeGreaterThan(0);
      expect(d.intersection).toEqual({
        x: reserve.x + Math.floor(reserve.w / 2),
        y: reserve.y + Math.floor(reserve.h / 2),
      });

      const shopCells = new Set<string>();
      for (const p of d.parcels)
        for (const c of footprintCells(p)) shopCells.add(c);
      for (const c of footprintCells(d.mallPad)) shopCells.add(c);
      if (d.garagePad) {
        for (const c of footprintCells(d.garagePad)) shopCells.add(c);
        shopCells.add(
          `${d.garagePad.islandCell.x},${d.garagePad.islandCell.y}`,
        );
      }
      const residential = residentialCells(rt);
      const residentialSetback = residentialSetbackCells(rt);
      const crossX = reserve.x + Math.floor(reserve.w / 2);
      const streetY = reserve.y + Math.floor(reserve.h / 2);
      const crossKeys = new Set(d.crossStreet.map((c) => `${c.x},${c.y}`));
      const streetKeys = new Set(d.street.map((c) => `${c.x},${c.y}`));

      expect(streetKeys.has(`${crossX},${streetY}`)).toBe(true);
      expect(crossKeys.has(`${crossX},${streetY}`)).toBe(true);
      expect(crossKeys.has(`${crossX},${streetY - 1}`)).toBe(true);
      expect(crossKeys.has(`${crossX},${streetY + 1}`)).toBe(true);

      for (const c of d.crossStreet) {
        const key = `${c.x},${c.y}`;
        expect(c.x).toBe(crossX);
        expect(c.x).toBeGreaterThanOrEqual(reserve.x);
        expect(c.x).toBeLessThan(reserve.x + reserve.w);
        expect(c.y).toBeGreaterThanOrEqual(reserve.y);
        expect(c.y).toBeLessThan(reserve.y + reserve.h);
        expect(cellOk(rt.sim.state.terrain, c.x, c.y)).toBe(true);
        expect(shopCells.has(key)).toBe(false);
        expect(residential.has(key)).toBe(false);
        for (const dx of [-1, 0, 1]) {
          const roadKey = `${c.x + dx},${c.y}`;
          if (!shopCells.has(roadKey) && !residentialSetback.has(roadKey))
            expect(rt.sim.state.roadKind.has(roadKey)).toBe(true);
        }
      }
      expect(rt.sim.state.roadKind.has(`${crossX},${streetY}`)).toBe(true);
    }
  }, 30000);

  it("is deterministic — a fresh boot of the same seed replays an identical district", () => {
    for (const seed of SEEDS) {
      const a = rtFor(seed).commercialDistrict!;
      const b = new ColonyRuntime(seed).commercialDistrict!;
      expect(b.parcels).toEqual(a.parcels);
      expect(b.reserve).toEqual(a.reserve);
      expect(b.crossStreet).toEqual(a.crossStreet);
      expect(b.intersection).toEqual(a.intersection);
      expect(b.mallPad).toEqual(a.mallPad);
      expect(b.garagePad).toEqual(a.garagePad);
    }
  }, 30000);
});
