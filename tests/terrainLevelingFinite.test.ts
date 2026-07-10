import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import {
  computeTerrainLeveling,
  padSeatY,
  RENDER_DRY_FLOOR,
} from "../src/colony/render/useTerrainLeveling";

// Regression for the boot NaN-geometry flood (r3f-colony-migration, 2026-07): every commercial
// pad has an EVEN width, so its centre x + (w - 1) / 2 is fractional; Terrain.worldY indexes the
// height array directly and returns NaN off the integer grid. The NaN seat smeared across every
// footprint + skirt cell of the leveling map, two whole terrain chunks rendered NaN Y vertices,
// and THREE.computeBoundingSphere dumped the full serialized geometry (megabytes) to
// console.error twice per boot — flooding the vite client-log relay during e2e runs.

// Drive the REAL runtime boot rather than reconstructing the layout (commerceDistrict.test.ts
// precedent) — no drift between test and production. 4242 is the live dev-server seed. Booting
// is expensive, so build lazily and share across tests.
let _rt: ColonyRuntime | null = null;
const rt = () => (_rt ??= new ColonyRuntime(4242));

describe("Terrain.worldYAt (continuous ground sampling)", () => {
  it("matches worldY exactly on integer cells", () => {
    const t = rt().sim.state.terrain;
    const last = t.size - 1;
    for (const [x, y] of [
      [0, 0],
      [10, 250],
      [last, last],
    ] as const) {
      expect(t.worldYAt(x, y)).toBeCloseTo(t.worldY(x, y), 10);
    }
  });

  it("is finite at fractional coordinates where raw worldY is not", () => {
    const t = rt().sim.state.terrain;
    // The even-width pad-centre shape: *.5 in both axes. Raw worldY reads an undefined array
    // slot there — the footgun this whole file guards.
    expect(Number.isFinite(t.worldY(102.5, 261.5))).toBe(false);
    const v = t.worldYAt(102.5, 261.5);
    expect(Number.isFinite(v)).toBe(true);
    // Bilinear stays inside the envelope of the four surrounding cells.
    const hs = [
      t.worldY(102, 261),
      t.worldY(103, 261),
      t.worldY(102, 262),
      t.worldY(103, 262),
    ];
    expect(v).toBeGreaterThanOrEqual(Math.min(...hs) - 1e-9);
    expect(v).toBeLessThanOrEqual(Math.max(...hs) + 1e-9);
  });

  it("clamps out-of-range coordinates instead of reading off the grid", () => {
    const t = rt().sim.state.terrain;
    expect(Number.isFinite(t.worldYAt(-7.3, 3.4))).toBe(true);
    expect(Number.isFinite(t.worldYAt(t.size + 20, t.size + 20.7))).toBe(true);
    expect(t.worldYAt(-100, -100)).toBeCloseTo(t.worldY(0, 0), 10);
  });
});

describe("terrain leveling map (terrainLevel) at the real boot state", () => {
  it("the boot commercial district has even-width pads — the NaN trigger shape", () => {
    const cd = rt().sim.state.commercialDistrict;
    expect(cd).toBeTruthy();
    expect(
      cd!.parcels.some(
        (p: { w: number; h: number }) => p.w % 2 === 0 || p.h % 2 === 0,
      ),
    ).toBe(true);
  });

  it("every pad seat is finite and floored at the dry level", () => {
    const t = rt().sim.state.terrain;
    const cd = rt().sim.state.commercialDistrict!;
    const pads = [
      ...cd.parcels,
      cd.mallPad,
      ...(cd.garagePad ? [cd.garagePad] : []),
    ];
    for (const p of pads) {
      const seat = padSeatY(t, p.x, p.y, p.w, p.h);
      expect(Number.isFinite(seat)).toBe(true);
      expect(seat).toBeGreaterThanOrEqual(RENDER_DRY_FLOOR);
    }
  });

  it("levels every commercial footprint and writes no non-finite override", () => {
    const state = rt().sim.state;
    const N = state.terrain.size;
    const level = computeTerrainLeveling(state, null, new Map());
    expect(level.size).toBeGreaterThan(0);
    // Presence matters, not just finiteness: computeTerrainLeveling now REFUSES non-finite
    // writes, so a regression back to NaN seats shows up as MISSING pad overrides.
    for (const p of state.commercialDistrict!.parcels) {
      let covered = 0;
      for (let y = p.y; y <= p.y + p.h; y++)
        for (let x = p.x; x <= p.x + p.w; x++)
          if (level.has(y * N + x)) covered++;
      expect(covered).toBeGreaterThan(0);
    }
    expect(
      [...level].filter(([, v]) => !Number.isFinite(v)),
    ).toEqual([]);
  });
});
