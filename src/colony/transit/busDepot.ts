// Spec 149 — the BUS DEPOT plot: siting + internal layout. Pure and deterministic in
// (terrain, bus loop, blocked cells) — the commercial-reserve discipline (district.ts) applied to
// transit land: a surveyed pad the buses physically drive into, never a decal. The runtime reserves
// the winning pad (reserveParcelLand) and lays a real spur road gate -> roadCell; the renderer draws
// the apron/bays/shelter on it; the fleet machine (busFleet.ts) drives the bay paths computed here.
// No three.js, no DOM, no randomness.

import type { Pt } from "./path";

export interface Cell {
  x: number;
  y: number;
}

/** Terrain facade — the two predicates siting needs (Terrain satisfies it structurally). */
export interface DepotTerrain {
  inBounds(x: number, y: number): boolean;
  isWater(x: number, y: number): boolean;
  worldY(x: number, y: number): number;
}

export interface DepotSite {
  /** Grid AABB of the reserved pad (w x h cells; 12x7 or 7x12 depending on orientation). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** The pad-edge cell buses drive through; the spur road is laid gate -> roadCell. */
  gate: Cell;
  /** The bus-loop road cell the depot connects to (the spur junction). */
  roadCell: Cell;
  /** Unit vector from the gate edge INTO the pad. */
  inward: Cell;
}

export interface DepotSiteConfig {
  /** Pad long-axis length in cells; active fleet bays are spread across this edge. */
  longCells: number;
  /** Pad depth in cells (gate edge -> bay backs). */
  deepCells: number;
  /** Smallest / largest clear gap between the loop road cell and the gate edge. */
  minRoadGap: number;
  maxRoadGap: number;
  /** Maximum raw terrain relief accepted across the full pad footprint. */
  maxHeightSpreadM: number;
}

const key = (x: number, y: number) => `${x},${y}`;

export function depotPadHeightRange(
  t: Pick<DepotTerrain, "worldY">,
  s: Pick<DepotSite, "x" | "y" | "w" | "h">,
): { min: number; max: number; spread: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let y = s.y; y < s.y + s.h; y++)
    for (let x = s.x; x < s.x + s.w; x++) {
      const h = t.worldY(x, y);
      if (!Number.isFinite(h)) return { min: NaN, max: NaN, spread: Infinity };
      min = Math.min(min, h);
      max = Math.max(max, h);
    }
  return { min, max, spread: max - min };
}

/** Balanced cut-and-fill plane: halfway between the natural low and high pad edges. */
export function depotCutFillSeatY(
  t: Pick<DepotTerrain, "worldY">,
  s: Pick<DepotSite, "x" | "y" | "w" | "h">,
  dryFloor = 0,
): number {
  const range = depotPadHeightRange(t, s);
  if (!Number.isFinite(range.min) || !Number.isFinite(range.max))
    return dryFloor;
  return Math.max(dryFloor, (range.min + range.max) / 2);
}

/** Find the depot pad: scan gaps small-to-large, then the loop cells in route order, then the four
 *  cardinal orientations — first pad whose every cell is in-bounds, dry and unclaimed wins, provided
 *  the gap corridor (the future spur) is dry and crosses nothing but existing road. Deterministic in
 *  its inputs; null when no seed-side fit exists (callers fail soft to the legacy cosmetic bus). */
export function findDepotSite(
  t: DepotTerrain,
  loop: readonly Cell[],
  blocked: ReadonlySet<string>,
  roadKeys: ReadonlySet<string>,
  cfg: DepotSiteConfig,
  /** WORLD.SURVEY.1 — cells blocked ONLY because rendered road geometry covers them. The PAD must
   *  still keep clear of these (that reservation is why it exists: a cell-clean pad can otherwise
   *  overlap visible asphalt). The SPUR CORRIDOR must not, because the corridor is about to become
   *  a road itself — `layRoad` paves it moments after this returns. See corridorClear. */
  paveable: ReadonlySet<string> = new Set(),
): DepotSite | null {
  const L = cfg.longCells,
    D = cfg.deepCells;
  const dirs: Cell[] = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 0, y: -1 },
  ];
  const scan = (pave: ReadonlySet<string>): DepotSite | null => {
    for (let g = cfg.minRoadGap; g <= cfg.maxRoadGap; g++) {
      for (const r of loop) {
        for (const d of dirs) {
          const site = padAt(r, d, g, L, D);
          if (!padClear(t, site, blocked, cfg.maxHeightSpreadM)) continue;
          if (!corridorClear(t, r, site.gate, blocked, roadKeys, pave))
            continue;
          return site;
        }
      }
    }
    return null;
  };
  // TWO PASSES, and the order is the whole point. The strict scan runs first, so every world that
  // already sites a depot keeps the SAME pad it always had — the search returns the first fit, and
  // a relaxed first pass would let an earlier, smaller-gap candidate win and quietly relocate the
  // depot in every existing world. (Measured: seed 4242 moved from (181,299) to (188,301) when the
  // exemption was applied on the first pass.) Only when the strict scan finds nothing does the
  // corridor exemption come into play, so this is additive: it rescues worlds that had no depot at
  // all and moves none that did.
  return scan(EMPTY) ?? (paveable.size ? scan(paveable) : null);
}

const EMPTY: ReadonlySet<string> = new Set();

/** The pad rectangle for road cell r, road->pad direction d and gap g: the long (gate) edge faces the
 *  road, centred on r's row/column so the gate lines up with the junction. */
function padAt(r: Cell, d: Cell, g: number, L: number, D: number): DepotSite {
  const halfL = Math.floor(L / 2);
  if (d.x === 0) {
    // road runs east-west relative to the pad; long axis along x
    const y0 = d.y > 0 ? r.y + g : r.y - g - (D - 1);
    return {
      x: r.x - halfL,
      y: y0,
      w: L,
      h: D,
      gate: { x: r.x, y: d.y > 0 ? r.y + g : r.y - g },
      roadCell: { ...r },
      inward: { x: 0, y: d.y },
    };
  }
  const x0 = d.x > 0 ? r.x + g : r.x - g - (D - 1);
  return {
    x: x0,
    y: r.y - halfL,
    w: D,
    h: L,
    gate: { x: d.x > 0 ? r.x + g : r.x - g, y: r.y },
    roadCell: { ...r },
    inward: { x: d.x, y: 0 },
  };
}

function padClear(
  t: DepotTerrain,
  s: DepotSite,
  blocked: ReadonlySet<string>,
  maxHeightSpreadM: number,
): boolean {
  let minY = Infinity;
  let maxY = -Infinity;
  for (let y = s.y; y < s.y + s.h; y++)
    for (let x = s.x; x < s.x + s.w; x++) {
      if (!t.inBounds(x, y) || t.isWater(x, y)) return false;
      if (blocked.has(key(x, y))) return false;
      const h = t.worldY(x, y);
      if (!Number.isFinite(h)) return false;
      minY = Math.min(minY, h);
      maxY = Math.max(maxY, h);
    }
  return maxY - minY <= maxHeightSpreadM;
}

/** The gap between road and gate becomes the spur road — it must be dry, and cross nothing that a
 *  road may not be laid over. Crossing existing asphalt is fine. Crossing a parcel or a reserve is
 *  not.
 *
 *  WORLD.SURVEY.1 — `paveable` cells are fine too, and leaving them out was starving the search.
 *  A pad sits 2-6 cells off the loop, so its corridor is by construction road-ADJACENT, which is
 *  exactly where `conservativeRoadRibbonBlockedCells` reserves: the rendered carriageway is four
 *  cells wide plus the bilinear stencil, while `roadKind` marks only the ~3-cell rasterised
 *  centre-line. So nearly every corridor crossed reserved-but-not-road ground and was rejected.
 *  Measured over seeds 1-24: on the six seeds that routed a loop and still found no depot, the pad
 *  was clear on 20,703-32,263 candidate placements and EVERY ONE died here, for this reason —
 *  `ok` was zero. Even the seeds that succeeded did so on 52 and 755 survivors out of ~132,000.
 *
 *  That reservation exists to stop PLOTS overlapping visible road geometry. Applying it to a
 *  would-be road is a category error: `layRoad` paves this corridor moments later, so the ribbon
 *  it "conflicts" with is the ribbon it is about to become part of. The PAD still respects it. */
function corridorClear(
  t: DepotTerrain,
  road: Cell,
  gate: Cell,
  blocked: ReadonlySet<string>,
  roadKeys: ReadonlySet<string>,
  paveable: ReadonlySet<string>,
): boolean {
  const dx = Math.sign(gate.x - road.x),
    dy = Math.sign(gate.y - road.y);
  const steps = Math.abs(gate.x - road.x) + Math.abs(gate.y - road.y); // corridor is axis-aligned by construction
  for (let s = 1; s < steps; s++) {
    const x = road.x + dx * s,
      y = road.y + dy * s;
    if (!t.inBounds(x, y) || t.isWater(x, y)) return false;
    const k = key(x, y);
    if (blocked.has(k) && !roadKeys.has(k) && !paveable.has(k)) return false;
  }
  return true;
}

// ── Internal layout ──────────────────────────────────────────────────────────────────────

export interface DepotLayout {
  /** One entry per bay: the nose-in parking pose and the drive path gate -> lane -> bay. */
  bays: { park: Pt; heading: number; path: Pt[] }[];
  /** The gate stop — where departing/returning buses pause with doors open (the depot's bus stop). */
  gate: { x: number; y: number; headingOut: number };
  /** Boarding shelter position (beside the gate lane) and the lit sign next to it. */
  shelter: Pt;
  sign: Pt;
  /** Small office pad centre (the corner opposite the shelter). */
  office: Pt;
  /** Pad frame for renderers: corner origin, long-axis unit u, depth-axis unit (inward). */
  origin: Pt;
  u: Pt;
  inward: Pt;
}

export interface DepotLayoutConfig {
  baysTotal: number;
  /** Local depth (cells, from the gate edge) of the apron lane the buses drive along. */
  laneDepth: number;
  /** Local depth of the bay parking noses (the deep end of each bay path). */
  bayDepth: number;
}

/** Deterministic depot interior in GRID coords. Local frame: i along the long (gate) edge from
 *  `origin`, j inward from the gate edge; toGrid(i,j) = origin + u*i + inward*j. */
export function depotLayout(
  site: DepotSite,
  cfg: DepotLayoutConfig,
): DepotLayout {
  const inward = { x: site.inward.x, y: site.inward.y };
  // Long axis unit + the local origin corner (j=0 row is the gate edge).
  const u: Pt = inward.x === 0 ? { x: 1, y: 0 } : { x: 0, y: 1 };
  const long = inward.x === 0 ? site.w : site.h;
  const origin: Pt = {
    x: inward.x >= 0 ? site.x : site.x + site.w - 1,
    y: inward.y >= 0 ? site.y : site.y + site.h - 1,
  };
  const toGrid = (i: number, j: number): Pt => ({
    x: origin.x + u.x * i + inward.x * j,
    y: origin.y + u.y * i + inward.y * j,
  });
  const gateI = u.x !== 0 ? site.gate.x - origin.x : site.gate.y - origin.y;
  const lane = cfg.laneDepth;
  const deep = cfg.bayDepth;
  const bays: DepotLayout["bays"] = [];
  // Spread the active fleet across the usable row instead of packing coaches at one-cell pitch.
  // Keep a one-cell end margin and cap at two cells (8 m) so 12 m coaches remain visually distinct.
  const pitch =
    cfg.baysTotal > 1 ? Math.min(2, (long - 2) / (cfg.baysTotal - 1)) : 0;
  const firstI = (long - pitch * Math.max(0, cfg.baysTotal - 1)) / 2;
  for (let k = 0; k < cfg.baysTotal; k++) {
    const i = firstI + k * pitch;
    const path: Pt[] = [toGrid(gateI, 0)];
    if (Math.abs(i - gateI) > 1e-6) path.push(toGrid(gateI, lane));
    path.push(toGrid(i, lane), toGrid(i, deep));
    bays.push({
      park: toGrid(i, deep),
      heading: Math.atan2(inward.y, inward.x),
      path,
    });
  }
  const headingOut = Math.atan2(-inward.y, -inward.x);
  // Shelter on the gate lane's side with more room; office in the opposite gate-edge corner.
  const shelterSide = gateI < long / 2 ? 1 : -1;
  const shelterI = gateI + shelterSide * 2;
  return {
    bays,
    gate: { x: toGrid(gateI, 0).x, y: toGrid(gateI, 0).y, headingOut },
    shelter: toGrid(shelterI, 1),
    sign: toGrid(gateI + shelterSide * 3.5, 0.5),
    office: toGrid(gateI < long / 2 ? long - 2 : 1.5, 1),
    origin,
    u,
    inward,
  };
}
