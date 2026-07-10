import { useMemo } from 'react';
import type { ColonySim } from '../sim';
import { applyCoastalCommercialDryBlend } from './terrainLeveling';
import { useSimSignal, type SimBridge } from './useSimSignal';
import { levelingSignature } from './simSignals';

// Match PlanetRenderer.ts behavior
export const RENDER_DRY_FLOOR = 0.65;

const SKIRT = 4;
const DEADZONE = 0.6;

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
  const N = state.terrain.size;

  // Subscribe to the mutable sim: the signature covers roadsVersion, built parcels and the
  // commercial district, so the leveling map recomputes exactly when those change.
  const levelingSig = useSimSignal(runtime, () => levelingSignature(state));
  return useMemo(() => {
    const next = new Map<number, number>();
    const t = state.terrain;
    const DRY = RENDER_DRY_FLOOR;

    const groundY = (x: number, y: number) => {
      // simplified groundY: just terrain.worldY for now (normally PlanetRenderer caches this)
      return t.worldY(x, y);
    };

    const put = (x: number, y: number, v: number) => {
      if (x >= 0 && y >= 0 && x < N && y < N) next.set(y * N + x, v);
    };

    const seatOf = (hz: { x: number; y: number; w: number; d: number }) =>
      Math.max(groundY(hz.x + (hz.w - 1) / 2, hz.y + (hz.d - 1) / 2), DRY);

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
        Math.max(groundY(r.x + (r.w - 1) / 2, r.y + (r.h - 1) / 2), DRY);

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
        // Compare against the EFFECTIVE ground — pads and the coastal dry-blend may already
        // have raised/lowered this cell, and it's the rendered surface the road must meet.
        // (Boot roads follow least-cost paths and rarely gap raw terrain; hand-drawn roads
        // across hills, segment-bridged dips and dry-blended coast cells are where the
        // floating happens.)
        const eff = next.has(i) ? next.get(i)! : Math.max(0, t.worldY(x, y));
        if (Math.abs(h - eff) <= DEADZONE) continue;
        graded.set(i, h);
      }

      for (const [i, h] of graded) {
        next.set(i, h);
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
        next.set(j, h * (1 - s) + nat * s);
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
        next.set(idx, base + offset);
      }
    }

    return next;
  }, [
    sim,
    levelingSig,
    roadRibbonCells,
    landscapeEdits
  ]);
}
