import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { cellOk } from "../src/colony/pathfind";
import type { Cell } from "../src/colony/pathfind";
// @ts-ignore Vite/Vitest raw import for source-scan coverage.
import districtSource from "../src/colony/commerce/district.ts?raw";
// @ts-ignore Vite/Vitest raw import for source-scan coverage.
import businessesSource from "../src/colony/commerce/businesses.ts?raw";
// @ts-ignore Vite/Vitest raw import for source-scan coverage.
import runtimeSource from "../src/colony/runtime.ts?raw";

const SEEDS = [4242, 42, 7] as const;

const GOLDEN: Record<
  number,
  {
    intersection: Cell;
    reserve: { x: number; y: number; w: number; h: number };
    mallPad: { x: number; y: number; w: number; h: number };
    crossStreetHash: string;
    parcelFootprintHash: string;
    mallPadHash: string;
  }
> = {
  4242: {
    intersection: { x: 113, y: 265 },
    reserve: { x: 81, y: 241, w: 64, h: 48 },
    mallPad: { x: 99, y: 248, w: 14, h: 10 },
    crossStreetHash: "0fd0df1b",
    parcelFootprintHash: "3659109e",
    mallPadHash: "6bba75f7",
  },
  42: {
    intersection: { x: 156, y: 382 },
    reserve: { x: 124, y: 358, w: 64, h: 48 },
    mallPad: { x: 142, y: 365, w: 14, h: 10 },
    crossStreetHash: "3b4adb2a",
    parcelFootprintHash: "ea4dec66",
    mallPadHash: "2af4f7cf",
  },
  7: {
    intersection: { x: 189, y: 323 },
    reserve: { x: 157, y: 299, w: 64, h: 48 },
    mallPad: { x: 175, y: 306, w: 14, h: 10 },
    crossStreetHash: "bae6d232",
    parcelFootprintHash: "82049b40",
    mallPadHash: "120d1aa3",
  },
};

function key(c: Cell): string {
  return `${c.x},${c.y}`;
}

function sortedHash(cells: Cell[]): string {
  const joined = cells
    .map(key)
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
    .join("|");
  let hash = 2166136261;
  for (let i = 0; i < joined.length; i++) {
    hash ^= joined.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function sourceBetween(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  expect(a).toBeGreaterThanOrEqual(0);
  const b = src.indexOf(end, a);
  expect(b).toBeGreaterThan(a);
  return src.slice(a, b);
}

function parcelFootprintHash(rt: ColonyRuntime): string {
  const cells: Cell[] = [];
  for (const p of rt.commercialDistrict!.parcels)
    for (let y = p.y; y < p.y + p.h; y++)
      for (let x = p.x; x < p.x + p.w; x++) cells.push({ x, y });
  return sortedHash(cells);
}

function rectCells(rect: {
  x: number;
  y: number;
  w: number;
  h: number;
}): Cell[] {
  const cells: Cell[] = [];
  for (let y = rect.y; y < rect.y + rect.h; y++)
    for (let x = rect.x; x < rect.x + rect.w; x++) cells.push({ x, y });
  return cells;
}

function rectCenter(rect: { x: number; y: number; w: number; h: number }): {
  x: number;
  y: number;
} {
  return { x: rect.x + (rect.w - 1) / 2, y: rect.y + (rect.h - 1) / 2 };
}

function referenceIntersection(
  street: Cell[],
  crossStreet: Cell[],
): Cell | undefined {
  const union: Cell[] = [];
  const seen = new Set<string>();
  for (const c of [...street, ...crossStreet]) {
    const k = key(c);
    if (!seen.has(k)) {
      seen.add(k);
      union.push(c);
    }
  }
  let best: Cell | undefined;
  let bestDegree = -1;
  for (const c of union) {
    const degree = [
      { x: c.x + 1, y: c.y },
      { x: c.x - 1, y: c.y },
      { x: c.x, y: c.y + 1 },
      { x: c.x, y: c.y - 1 },
    ].filter((n) => seen.has(key(n))).length;
    if (
      degree > bestDegree ||
      (degree === bestDegree &&
        (!best || c.x < best.x || (c.x === best.x && c.y < best.y)))
    ) {
      best = c;
      bestDegree = degree;
    }
  }
  return best;
}

function degreeAt(cell: Cell, street: Cell[], crossStreet: Cell[]): number {
  const unionKeys = new Set([...street, ...crossStreet].map(key));
  return [
    { x: cell.x + 1, y: cell.y },
    { x: cell.x - 1, y: cell.y },
    { x: cell.x, y: cell.y + 1 },
    { x: cell.x, y: cell.y - 1 },
  ].filter((n) => unionKeys.has(key(n))).length;
}

function coastalCandidateKeys(rt: ColonyRuntime): Set<string> {
  const t = rt.sim.state.terrain;
  const lighthouse = rt.sim.state.structures.find(
    (s) => s.kind === "lighthouse",
  );
  expect(lighthouse).toBeTruthy();
  const W = 64,
    H = 48;
  const clampX = (v: number) =>
    Math.max(0, Math.min(t.size - W, Math.round(v)));
  const clampY = (v: number) =>
    Math.max(0, Math.min(t.size - H, Math.round(v)));
  const toLanding = Math.sign(t.landing.x - lighthouse!.x) || 1;
  const out = new Set<string>();
  for (const along of [16, 28, 40, 52, 8])
    for (const off of [0, -16, 16, -32, 32]) {
      const cx = lighthouse!.x + toLanding * along;
      const cy = lighthouse!.y + off;
      out.add(`${clampX(cx - W / 2)},${clampY(cy - H / 2)}`);
    }
  return out;
}

describe("phase 2A/2B district determinism gate", () => {
  it("source-scans the deterministic district path", () => {
    const runtimeCommercialPath = [
      sourceBetween(
        runtimeSource,
        "this.commercialReserve = (() => {",
        "// Spec 086 — SATELLITE HAMLETS",
      ),
      sourceBetween(
        runtimeSource,
        "const shopCells = new Set<string>();",
        "// Spec 088 — the BUS route",
      ),
      sourceBetween(
        runtimeSource,
        "private raceCommercialCenter()",
        "private raceTick",
      ),
    ].join("\n");
    const sources = [districtSource, businessesSource, runtimeCommercialPath];
    for (const src of sources)
      expect(src).not.toMatch(
        /Math\.random|Date\.now|performance\.now|new Date/,
      );
  });

  it("pins golden intersections and hashes on live seeds", () => {
    for (const seed of SEEDS) {
      const rt = new ColonyRuntime(seed);
      const d = rt.commercialDistrict!;
      const golden = GOLDEN[seed];
      expect(rt.commercialReserve).toEqual(golden.reserve);
      expect(
        coastalCandidateKeys(rt).has(`${golden.reserve.x},${golden.reserve.y}`),
      ).toBe(true);
      expect(d.intersection).toEqual(golden.intersection);
      expect(d.mallPad).toEqual(golden.mallPad);
      expect(sortedHash(d.crossStreet)).toBe(golden.crossStreetHash);
      expect(parcelFootprintHash(rt)).toBe(golden.parcelFootprintHash);
      expect(sortedHash(rectCells(d.mallPad))).toBe(golden.mallPadHash);
    }
  }, 30000);

  it("reserves a deterministic mall pad inside the district end nearest the intersection", () => {
    for (const seed of SEEDS) {
      const rt = new ColonyRuntime(seed);
      const d = rt.commercialDistrict!;
      const reserve = rt.commercialReserve!;
      const mallPad = d.mallPad;
      const shopCells = new Set<string>();
      for (const p of d.parcels)
        for (let y = p.y; y < p.y + p.h; y++)
          for (let x = p.x; x < p.x + p.w; x++) shopCells.add(`${x},${y}`);
      const streetKeys = new Set(d.street.map(key));
      const crossStreetKeys = new Set(d.crossStreet.map(key));
      const center = rectCenter(mallPad);
      const intersection = d.intersection!;

      expect(mallPad.w).toBe(14);
      expect(mallPad.h).toBe(10);
      expect(mallPad.x).toBeGreaterThanOrEqual(reserve.x);
      expect(mallPad.y).toBeGreaterThanOrEqual(reserve.y);
      expect(mallPad.x + mallPad.w).toBeLessThanOrEqual(reserve.x + reserve.w);
      expect(mallPad.y + mallPad.h).toBeLessThanOrEqual(reserve.y + reserve.h);
      expect(center.y).toBeLessThan(intersection.y);

      for (const c of rectCells(mallPad)) {
        const k = key(c);
        expect(cellOk(rt.sim.state.terrain, c.x, c.y)).toBe(true);
        expect(streetKeys.has(k)).toBe(false);
        expect(crossStreetKeys.has(k)).toBe(false);
        expect(shopCells.has(k)).toBe(false);
      }

      const replay = new ColonyRuntime(seed).commercialDistrict!;
      expect(replay.mallPad).toEqual(mallPad);
      expect(sortedHash(rectCells(replay.mallPad))).toBe(
        sortedHash(rectCells(mallPad)),
      );
    }
  }, 30000);

  it("matches the spec reference picker and keeps the core crossing degree 4", () => {
    for (const seed of SEEDS) {
      const rt = new ColonyRuntime(seed);
      const d = rt.commercialDistrict!;
      const reserve = rt.commercialReserve!;
      const expected = {
        x: reserve.x + Math.floor(reserve.w / 2),
        y: reserve.y + Math.floor(reserve.h / 2),
      };
      expect(d.intersection).toEqual(
        referenceIntersection(d.street, d.crossStreet),
      );
      expect(d.intersection).toEqual(expected);
      expect(degreeAt(d.intersection!, d.street, d.crossStreet)).toBe(4);
    }
  }, 30000);

  it("weakly replays cross-street and intersection across fresh boots", () => {
    for (const seed of SEEDS) {
      const a = new ColonyRuntime(seed).commercialDistrict!;
      const b = new ColonyRuntime(seed).commercialDistrict!;
      expect(b.crossStreet).toEqual(a.crossStreet);
      expect(b.intersection).toEqual(a.intersection);
    }
  }, 30000);
});
