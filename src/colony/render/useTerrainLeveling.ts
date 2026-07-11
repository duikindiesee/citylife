import { useMemo } from 'react';
import type { ColonySim } from '../sim';
import type { Terrain } from '../terrain';
import { applyCoastalCommercialDryBlend } from './terrainLeveling';
import { useSimSignal, type SimBridge } from './useSimSignal';
import { levelingSignature } from './simSignals';

// Match PlanetRenderer.ts behavior
export const RENDER_DRY_FLOOR = 0.65;

const SKIRT = 4;
const DEADZONE = 0.6;

/** The ONE pad-seat formula (spec 128): the ground height at the pad's CENTRE, floored to the
 *  dry level. Samples via worldYAt because an even-width pad's centre is fractional and raw
 *  worldY is NaN there (the NaN-chunk boot regression — full story in spec 128). Exported so
 *  the house/shop renderers seat meshes with EXACTLY the height the pad is graded to — the
 *  two must never drift. A corrupt zone (non-finite fields) falls to the dry floor rather
 *  than seating a mesh at NaN. */
export function padSeatY(
  t: Terrain,
  x: number,
  y: number,
  w: number,
  d: number,
): number {
  const s = t.worldYAt(x + (w - 1) / 2, y + (d - 1) / 2);
  return Number.isFinite(s) ? Math.max(s, RENDER_DRY_FLOOR) : RENDER_DRY_FLOOR;
}

/**
 * Replaces PlanetRenderer's relevelTerrain and gradeRoadsInto. Pure — exported for the
 * regression tests; the hook below memoizes it against the sim signals.
 * Returns a Map of overridden cell heights (terrainLevel).
 */
export function computeTerrainLeveling(
  state: ColonySim['state'],
  /** Spec 130 — ribbon coverage: cell key -> the SURFACE height the road mesh renders over
   *  that cell (segment-bridged, not the cell's own local height). */
  roadRibbonCells: ReadonlyMap<string, number> | null,
  landscapeEdits: Map<string, number>,
): Map<number, number> {
  const N = state.terrain.size;
  const next = new Map<number, number>();
  const t = state.terrain;
  const DRY = RENDER_DRY_FLOOR;

  // A single non-finite height in this map renders as NaN mesh vertices (and THREE floods
  // the console with full geometry dumps), so refuse the write — the cell falls back to its
  // natural ground, which degrades gracefully. Counted, and reported once per compute at the
  // end (recomputes are event-driven and infrequent, so the log stays bounded but every new
  // rebuild re-reports — a session-latched warning would silence the NEXT producer bug).
  let dropped = 0;
  const putIdx = (i: number, v: number) => {
    if (!Number.isFinite(v)) {
      dropped++;
      return;
    }
    next.set(i, v);
  };
  const put = (x: number, y: number, v: number) => {
    if (x >= 0 && y >= 0 && x < N && y < N) putIdx(y * N + x, v);
  };

  const seatOf = (hz: { x: number; y: number; w: number; d: number }) =>
    padSeatY(t, hz.x, hz.y, hz.w, hz.d);

  // 1) Neighborhood pads
  const nh = state.neighborhood;
  if (nh) {
    for (const lot of nh.parcels) {
      if (!lot.built) continue;
      const hz = lot.houseZone;
      const py = seatOf(hz);

      // Dry footprint
      let x0 = hz.x, x1 = hz.x + hz.w, y0 = hz.y, y1 = hz.y + hz.d;
      const ext = (x: number, y: number) => {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      };
      for (const f of lot.fence) ext(f.x, f.y);
      for (const d of lot.driveway) ext(d.x, d.y);
      if (lot.gate) ext(lot.gate.x, lot.gate.y);

      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          if (t.worldY(x, y) < DRY && !roadRibbonCells?.has(`${x},${y}`)) {
            put(x, y, DRY);
          }
        }
      }

      // Grade skirt
      const fx1 = hz.x + hz.w;
      const fy1 = hz.y + hz.d;
      for (let y = hz.y - SKIRT + 1; y < fy1 + SKIRT; y++) {
        for (let x = hz.x - SKIRT + 1; x < fx1 + SKIRT; x++) {
          const dist = Math.max(0, hz.x - x, x - fx1, hz.y - y, y - fy1);
          if (dist === 0) put(x, y, py);
          else if (dist < SKIRT && x >= 0 && y >= 0 && x < N && y < N) {
            const nat = Math.max(t.worldY(x, y), DRY);
            const s = dist / SKIRT;
            const sm = s * s * (3 - 2 * s);
            put(x, y, py + (nat - py) * sm);
          }
        }
      }
    }
  }

  // 2) Commercial District pads
  const cd = state.commercialDistrict;
  if (cd) {
    const seats = [
      ...cd.parcels.map((p: any) => ({ x: p.x, y: p.y, w: p.w, h: p.h })),
      { x: cd.mallPad.x, y: cd.mallPad.y, w: cd.mallPad.w, h: cd.mallPad.h },
      ...(cd.garagePad ? [{ x: cd.garagePad.x, y: cd.garagePad.y, w: cd.garagePad.w, h: cd.garagePad.h }] : []),
    ];

    const seatY = (r: { x: number; y: number; w: number; h: number }) =>
      padSeatY(t, r.x, r.y, r.w, r.h);

    // Skirts
    for (const r of seats) {
      const py = seatY(r);
      const fx1 = r.x + r.w;
      const fy1 = r.y + r.h;
      for (let y = r.y - SKIRT + 1; y < fy1 + SKIRT; y++) {
        for (let x = r.x - SKIRT + 1; x < fx1 + SKIRT; x++) {
          if (x < 0 || y < 0 || x >= N || y >= N) continue;
          if (roadRibbonCells?.has(`${x},${y}`)) continue;
          const dist = Math.max(0, r.x - x, x - fx1, r.y - y, y - fy1);
          if (dist > 0 && dist < SKIRT) {
            const nat = Math.max(t.worldY(x, y), DRY);
            const s = dist / SKIRT;
            put(x, y, py + (nat - py) * (s * s * (3 - 2 * s)));
          }
        }
      }
    }

    // Footprints
    for (const r of seats) {
      const py = seatY(r);
      for (let y = r.y; y <= r.y + r.h; y++) {
        for (let x = r.x; x <= r.x + r.w; x++) {
          if (x < 0 || y < 0 || x >= N || y >= N) continue;
          if (roadRibbonCells?.has(`${x},${y}`)) continue;
          put(x, y, py);
        }
      }
    }

    applyCoastalCommercialDryBlend({
      next,
      n: N,
      terrain: t,
      rects: [
        ...cd.parcels.map((p: any) => ({ x: p.x - 1, y: p.y - 1, w: p.w + 2, h: p.h + 2 })),
        { x: cd.mallPad.x, y: cd.mallPad.y, w: cd.mallPad.w, h: cd.mallPad.h },
        ...(cd.garagePad ? [{ x: cd.garagePad.x, y: cd.garagePad.y, w: cd.garagePad.w, h: cd.garagePad.h }] : []),
      ],
      roadRibbonCells,
      dry: DRY,
    });
  }

  // 2b) Bus depot pad (spec 140) — one flat apron at the pad-centre seat height with the same
  // smoothstep skirt the commercial pads use, so the slab, the parked buses and the walker's
  // ground guardrail all agree on ONE height instead of a max-corner slab floating over a slope.
  const depot = state.busDepotPad;
  if (depot) {
    const py = padSeatY(t, depot.x, depot.y, depot.w, depot.h);
    const fx1 = depot.x + depot.w;
    const fy1 = depot.y + depot.h;
    for (let y = depot.y - SKIRT + 1; y < fy1 + SKIRT; y++) {
      for (let x = depot.x - SKIRT + 1; x < fx1 + SKIRT; x++) {
        if (x < 0 || y < 0 || x >= N || y >= N) continue;
        if (roadRibbonCells?.has(`${x},${y}`)) continue;
        const dist = Math.max(0, depot.x - x, x - fx1, depot.y - y, y - fy1);
        if (dist === 0) put(x, y, py);
        else if (dist < SKIRT) {
          const nat = Math.max(t.worldY(x, y), DRY);
          const s = dist / SKIRT;
          put(x, y, py + (nat - py) * (s * s * (3 - 2 * s)));
        }
      }
    }
  }

  // 3) Grade Roads Into (spec 130 — the legacy spec-095 regrade, un-stubbed). The old code
  // compared t.worldY against ITSELF ("approximation for now"), so the deadzone always
  // skipped and NO ground was ever graded to the road: on any slope the ribbon (riding the
  // max-filtered getSmoothRoadY) floated above the local terrain and the walker could see
  // straight under the road. Grade every ribbon-covered cell to the ribbon's OWN height
  // function where it genuinely differs (the DEADZONE keeps flat roads flush, no berms),
  // and ramp a smoothstep SKIRT shoulder around graded cells so hill roads meet the land
  // instead of ending in cliffs.
  if (roadRibbonCells && roadRibbonCells.size > 0) {
    const ROAD_SKIRT = 3;
    const ribbon = new Set<number>();
    const graded = new Map<number, number>();
    for (const [key, surfaceH] of roadRibbonCells) {
      const c = key.indexOf(",");
      const x = +key.slice(0, c);
      const y = +key.slice(c + 1);
      if (x < 0 || y < 0 || x >= N || y >= N) continue;
      const i = y * N + x;
      ribbon.add(i);
      const h = Math.max(0, surfaceH);
      // A corrupt (non-finite) ribbon height must not enter `graded`: NaN passes the
      // deadzone test below (|NaN - eff| <= DEADZONE is false) and its skirt entries would
      // then shadow finite neighbours in the nearest-d competition before being dropped —
      // leaving shoulder cells with NO ramp at all. Skip it here; the cell stays in `ribbon`
      // so the shoulder pass still never disturbs it.
      if (!Number.isFinite(h)) {
        dropped++;
        continue;
      }
      // Compare against the EFFECTIVE ground — pads and the coastal dry-blend may already
      // have raised/lowered this cell, and it's the rendered surface the road must meet.
      // (Boot roads follow least-cost paths and rarely gap raw terrain; hand-drawn roads
      // across hills, segment-bridged dips and dry-blended coast cells are where the
      // floating happens.)
      const eff = next.has(i) ? next.get(i)! : Math.max(0, t.worldY(x, y));
      // ASYMMETRIC deadzone (operator invariant, 2026-07-11: "the ground go above the
      // roads; that should never happen"). The old |h - eff| <= DEADZONE tolerated
      // ground up to 0.6 ABOVE the road surface — but the ribbon rides only +0.18, so
      // tolerated bumps crested THROUGH the asphalt as sand/grass islands. Ground above
      // the surface is always CUT to it; only the raise direction keeps the deadzone
      // (small hollows under a flush road are invisible and not worth a berm).
      if (eff > h) {
        graded.set(i, h);
        continue;
      }
      if (h - eff <= DEADZONE) continue;
      graded.set(i, h);
    }

    for (const [i, h] of graded) {
      putIdx(i, h);
    }
    // Shoulder: ramp ONLY around graded cells, nearest road height -> natural ground.
    // Never disturb a road cell (graded or deliberately flush) or an existing pad override.
    const skirt = new Map<number, { h: number; d: number }>();
    for (const [i, h] of graded) {
      const cx = i % N;
      const cy = (i / N) | 0;
      for (let dy = -ROAD_SKIRT; dy <= ROAD_SKIRT; dy++)
        for (let dx = -ROAD_SKIRT; dx <= ROAD_SKIRT; dx++) {
          const d = Math.max(Math.abs(dx), Math.abs(dy));
          if (d === 0) continue;
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= N || y >= N) continue;
          const j = y * N + x;
          if (ribbon.has(j) || next.has(j)) continue;
          const cur = skirt.get(j);
          if (!cur || d < cur.d) skirt.set(j, { h, d });
        }
    }
    for (const [j, { h, d }] of skirt) {
      const x = j % N;
      const y = (j / N) | 0;
      const nat = Math.max(0, t.worldY(x, y));
      const t01 = d / (ROAD_SKIRT + 1);
      const s = t01 * t01 * (3 - 2 * t01); // smoothstep road -> natural
      putIdx(j, h * (1 - s) + nat * s);
    }
  }

  // 4) Apply user landscape edits (raise/lower/flatten)
  for (const [key, offset] of landscapeEdits.entries()) {
    if (offset === 0) continue;
    const [xStr, yStr] = key.split(',');
    const x = parseInt(xStr, 10);
    const y = parseInt(yStr, 10);

    if (x >= 0 && y >= 0 && x < N && y < N) {
      const idx = y * N + x;
      // If there's already an override (like a road/building), we add to that.
      // Otherwise we add to the base terrain height.
      const base = next.has(idx) ? next.get(idx)! : t.worldY(x, y);
      putIdx(idx, base + offset);
    }
  }

  // Final sweep: applyCoastalCommercialDryBlend writes into `next` with its own putter, so
  // it (and any future producer handed the raw map) bypasses putIdx. Nothing non-finite may
  // leave this function — the map feeds mesh vertices directly.
  for (const [i, v] of next) {
    if (!Number.isFinite(v)) {
      next.delete(i);
      dropped++;
    }
  }
  if (dropped > 0) {
    console.warn(
      `[citylife] terrain leveling dropped ${dropped} non-finite height override(s) — an upstream height producer is emitting NaN/Infinity`,
    );
  }

  return next;
}

/**
 * Replaces PlanetRenderer's relevelTerrain and gradeRoadsInto.
 * Returns a Map of overridden cell heights (terrainLevel).
 */
export function useTerrainLeveling(
  sim: ColonySim,
  /** Spec 130 — ribbon coverage: cell key -> the SURFACE height the road mesh renders over
   *  that cell (segment-bridged, not the cell's own local height). */
  roadRibbonCells: ReadonlyMap<string, number> | null,
  landscapeEdits: Map<string, number>,
  runtime?: SimBridge
): Map<number, number> {
  const state = sim.state;

  // Subscribe to the mutable sim: the signature covers roadsVersion, built parcels and the
  // commercial district, so the leveling map recomputes exactly when those change.
  const levelingSig = useSimSignal(runtime, () => levelingSignature(state));
  return useMemo(
    () => computeTerrainLeveling(state, roadRibbonCells, landscapeEdits),
    // levelingSig is the rebuild trigger for the mutable sim.state (dead-memo rule).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      sim,
      levelingSig,
      roadRibbonCells,
      landscapeEdits
    ]
  );
}
