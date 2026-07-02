// Spec 079 P0 / 103 — the commercial high street. A pure, deterministic survey of shop plots along a
// market street through the reserved commercial land bank (now a larger district reserve at the avenue's
// inland end, runtime.commercialReserve). Mirrors the residential neighbourhood survey's discipline:
// every cell is gated through cellOk (in-bounds, buildable, dry, not rock — the shared land contract),
// the footprint is collision-checked against a claimed set so shops never overlap, and the whole thing
// is a pure function of (terrain, reserve) with no clock or random source, so it replays identically and
// is node-testable headless. The vibrant render + the buy/build economy layer on top of this.
import { cellOk, type Cell } from "../pathfind";
import { COLONY } from "../config";
import type { Terrain } from "../terrain";
import { assignBusinesses, type BusinessId } from "./businesses";

export type ShopKind = "kiosk" | "store" | "showroom";

/** A surveyed shop plot fronting the high street. Keeps the public fields the engine + renderer read
 *  (id, x, y, w, h, side, doorX, doorY, ownerCitizenId, built); the buy/build slice fills ownership. */
export interface ShopParcel {
  id: string;
  kind: ShopKind;
  /** Footprint min-corner cell. */
  x: number;
  y: number;
  /** Footprint size in cells (w along the street, h deep). */
  w: number;
  h: number;
  /** Which side of the high street the shop fronts (-1 = toward -y, +1 = toward +y). */
  side: -1 | 1;
  /** The shop door cell, on the street-facing front row, centred on the frontage. */
  doorX: number;
  doorY: number;
  ownerCitizenId?: string;
  built: boolean;
  /** The real kooker app this plot fronts (its identity/destiny; assigned deterministically). */
  business?: BusinessId;
}

export interface CommercialDistrict {
  /** The surveyed high-street cells (a dry midline through the reserve). */
  street: Cell[];
  /** The shop plots flanking the street, in deterministic placement order. */
  parcels: ShopParcel[];
  /** The perpendicular cross-street centreline, surveyed in ascending y. */
  crossStreet: Cell[];
  /** The degree-argmax core intersection over street + crossStreet centrelines. */
  intersection?: Cell;
  /** The reserved mall anchor pad; massing/rendering lands in Phase 2C. */
  mallPad: Reserve;
  /** The standalone road-facing garage landmark pad (spec 109 P1/P2). */
  garagePad?: GaragePad;
  /** The land bank this district was surveyed within. */
  reserve: Reserve;
}

export interface GaragePad extends Reserve {
  kind: "garage_landmark";
  publicName: "Gearbox Auto Hub";
  isPublicSafe: true;
  /** Three.js Y rotation: local +z points toward the district road/intersection. */
  facingAngle: number;
  /** The deterministic road/intersection cell the forecourt faces. */
  roadTarget: Cell;
  /** Unit direction from the garage lot toward the high-street frontage. */
  streetFrontDir: Cell;
  /** Unit direction from the garage lot toward the cross-street drive-in frontage. */
  crossFrontDir: Cell;
  /** The corner-island cell that carries the garage pylon sign. */
  islandCell: Cell;
}

export interface Reserve {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Footprint of each shop kind: w along the street frontage, d deep away from it (079 spec sizes). */
export const SHOP_SIZE: Record<ShopKind, { w: number; d: number }> = {
  kiosk: { w: 4, d: 4 },
  store: { w: 6, d: 5 },
  showroom: { w: 8, d: 6 },
};

// A fixed rhythm of shop sizes down the street — bigger anchors interleaved with kiosks, so the strip
// reads as a varied market rather than a row of identical boxes. Offset per side so the two rows differ.
const KIND_CYCLE: ShopKind[] = [
  "showroom",
  "store",
  "kiosk",
  "store",
  "kiosk",
  "showroom",
  "store",
  "kiosk",
];
const FRONT_GAP = 1; // empty cells between adjacent shop frontages along the street
const SETBACK = 1; // cells of pavement between the street and a shop's front row

/** Survey the commercial district: a high street down the middle of the reserve, with shop plots
 *  fronting it on both sides. Pure + deterministic in (terrain, reserve, blocked). `blocked` is the
 *  set of cells already taken by the residential parcels + roads ('x,y' keys) — shops never land on
 *  homestead land or the avenue, the same collision discipline the homestead survey uses. */
export function makeCommercialDistrict(
  t: Terrain,
  reserve: Reserve,
  blocked: ReadonlySet<string> = new Set(),
): CommercialDistrict {
  const streetY = reserve.y + Math.floor(reserve.h / 2);
  const street: Cell[] = [];
  for (let x = reserve.x; x < reserve.x + reserve.w; x++) {
    if (cellOk(t, x, streetY) && !blocked.has(`${x},${streetY}`))
      street.push({ x, y: streetY });
  }

  const claimed = new Set<string>();
  const parcels: ShopParcel[] = [];
  let id = 0;

  // Two rows flank the street: the -y side, then the +y side (fixed order = deterministic).
  for (const side of [-1, 1] as const) {
    let cursorX = reserve.x;
    let k = side === -1 ? 0 : 3; // stagger the kind rhythm so the facing rows are not mirror-identical
    while (cursorX + 1 < reserve.x + reserve.w) {
      const kind = KIND_CYCLE[k % KIND_CYCLE.length]!;
      const { w, d } = SHOP_SIZE[kind];
      // The front row faces the street; the footprint extends away from it.
      const frontY =
        side === -1 ? streetY - SETBACK - 1 : streetY + SETBACK + 1;
      const y0 = side === -1 ? frontY - (d - 1) : frontY;
      const y1 = y0 + d - 1;
      const x0 = cursorX;
      const x1 = cursorX + w - 1;

      if (fits(t, reserve, claimed, blocked, x0, y0, x1, y1)) {
        const doorX = x0 + Math.floor(w / 2);
        claim(claimed, x0, y0, x1, y1);
        parcels.push({
          id: `shop_${id++}`,
          kind,
          x: x0,
          y: y0,
          w,
          h: d,
          side,
          doorX,
          doorY: frontY,
          built: false,
        });
        cursorX = x1 + 1 + FRONT_GAP;
        k++;
      } else {
        cursorX++; // this kind does not fit here (terrain/edge); slide along and retry — cursor only grows
      }
    }
  }

  const shopCells = new Set<string>();
  for (const p of parcels)
    claim(shopCells, p.x, p.y, p.x + p.w - 1, p.y + p.h - 1);

  const crossStreetX = reserve.x + Math.floor(reserve.w / 2);
  const crossStreet: Cell[] = [];
  for (let y = reserve.y; y < reserve.y + reserve.h; y++) {
    const key = `${crossStreetX},${y}`;
    if (cellOk(t, crossStreetX, y) && !shopCells.has(key) && !blocked.has(key))
      crossStreet.push({ x: crossStreetX, y });
  }

  const intersection = pickMajorIntersection(street, crossStreet);
  const mallPad = pickMallPad(
    t,
    reserve,
    street,
    crossStreet,
    parcels,
    claimed,
  );
  const garagePad = findGarageSite(
    t,
    reserve,
    street,
    crossStreet,
    new Set(),
    mallPad,
  );
  const garageCells = new Set(footprintKeys(garagePad));
  garageCells.add(`${garagePad.islandCell.x},${garagePad.islandCell.y}`);
  const garageClearParcels = parcels.filter((p) =>
    footprintKeys(p).every((k) => !garageCells.has(k)),
  );

  // Each plot fronts a real kooker app — assign its business identity (deterministic).
  const biz = assignBusinesses(garageClearParcels);
  for (const p of garageClearParcels) p.business = biz[p.id];

  return {
    street,
    parcels: garageClearParcels,
    crossStreet,
    intersection,
    mallPad,
    garagePad,
    reserve,
  };
}

export function pickMajorIntersection(
  street: readonly Cell[],
  crossStreet: readonly Cell[],
): Cell | undefined {
  const union: Cell[] = [];
  const seen = new Set<string>();
  for (const c of street) {
    const k = `${c.x},${c.y}`;
    if (!seen.has(k)) {
      seen.add(k);
      union.push(c);
    }
  }
  for (const c of crossStreet) {
    const k = `${c.x},${c.y}`;
    if (!seen.has(k)) {
      seen.add(k);
      union.push(c);
    }
  }

  let best: Cell | undefined;
  let bestDegree = -1;
  for (const c of union) {
    const degree = [
      `${c.x + 1},${c.y}`,
      `${c.x - 1},${c.y}`,
      `${c.x},${c.y + 1}`,
      `${c.x},${c.y - 1}`,
    ].filter((k) => seen.has(k)).length;
    if (
      degree > bestDegree ||
      (degree === bestDegree &&
        (!best || c.x < best.x || (c.x === best.x && c.y < best.y)))
    ) {
      best = { x: c.x, y: c.y };
      bestDegree = degree;
    }
  }
  return best;
}

export function pickMallPad(
  t: Terrain,
  reserve: Reserve,
  street: readonly Cell[],
  crossStreet: readonly Cell[],
  parcels: readonly ShopParcel[],
  shopCells: ReadonlySet<string>,
): Reserve {
  const w = COLONY.commerce.mallPadW;
  const h = COLONY.commerce.mallPadH;
  const intersection = pickMajorIntersection(street, crossStreet) ?? {
    x: reserve.x + Math.floor(reserve.w / 2),
    y: reserve.y + Math.floor(reserve.h / 2),
  };
  const streetKeys = new Set(street.map((c) => `${c.x},${c.y}`));
  const crossKeys = new Set(crossStreet.map((c) => `${c.x},${c.y}`));
  const northLimit = Math.min(
    ...parcels.filter((p) => p.side === -1).map((p) => p.y),
    intersection.y,
  );
  const southLimit = Math.max(
    ...parcels.filter((p) => p.side === 1).map((p) => p.y + p.h - 1),
    intersection.y,
  );
  let best: Reserve | undefined;
  let bestDistance = Infinity;
  const consider = (x: number, y: number) => {
    const pad = { x, y, w, h };
    if (!mallPadFits(t, reserve, pad, shopCells, streetKeys, crossKeys)) return;
    const cx = x + (w - 1) / 2;
    const cy = y + (h - 1) / 2;
    const d = (cx - intersection.x) ** 2 + (cy - intersection.y) ** 2;
    if (
      d < bestDistance ||
      (d === bestDistance &&
        (!best || x < best.x || (x === best.x && y < best.y)))
    ) {
      best = pad;
      bestDistance = d;
    }
  };

  for (let y = reserve.y; y <= reserve.y + reserve.h - h; y++) {
    const northEnd = y + h - 1 < northLimit;
    const southEnd = y > southLimit;
    if (!northEnd && !southEnd) continue;
    for (let x = reserve.x; x <= reserve.x + reserve.w - w; x++) consider(x, y);
  }

  return best ?? { x: reserve.x, y: reserve.y, w, h };
}

export function findGarageSite(
  t: Terrain,
  reserve: Reserve,
  street: readonly Cell[],
  crossStreet: readonly Cell[],
  shopCells: ReadonlySet<string>,
  mallPad: Reserve,
): GaragePad {
  const w = COLONY.commerce.garagePadW;
  const h = COLONY.commerce.garagePadH;
  const intersection = pickMajorIntersection(street, crossStreet) ?? {
    x: reserve.x + Math.floor(reserve.w / 2),
    y: reserve.y + Math.floor(reserve.h / 2),
  };
  const streetKeys = new Set(street.map((c) => `${c.x},${c.y}`));
  const crossKeys = new Set(crossStreet.map((c) => `${c.x},${c.y}`));
  const mallCells = new Set(footprintKeys(mallPad));
  type Candidate = Reserve & {
    streetFrontDir: Cell;
    crossFrontDir: Cell;
  };
  let best: GaragePad | undefined;
  let bestScore = Infinity;

  const consider = (candidate: Candidate) => {
    const pad = { x: candidate.x, y: candidate.y, w, h };
    if (
      !garagePadFits(
        t,
        reserve,
        pad,
        shopCells,
        streetKeys,
        crossKeys,
        mallCells,
      )
    )
      return;
    const cx = candidate.x + (w - 1) / 2;
    const cy = candidate.y + (h - 1) / 2;
    const dx = intersection.x - cx;
    const dy = intersection.y - cy;
    // Keep the rectangular drive-in shell square to the selected cross-street
    // frontage. A diagonal centre-to-intersection angle makes the 16x11 pad read
    // skewed against the orthogonal roads and pulls its forecourt/pylon off the
    // surveyed corner.
    const facingAngle = Math.atan2(
      candidate.crossFrontDir.x,
      candidate.crossFrontDir.y,
    );
    const cornerX =
      candidate.streetFrontDir.x < 0 ? reserve.x + reserve.w - 1 : reserve.x;
    const cornerY =
      candidate.crossFrontDir.y < 0 ? reserve.y + reserve.h - 1 : reserve.y;
    const pylonCell = {
      // The sign is mounted on the garage pad border, not a freestanding
      // pole on the grey road ribbon. Inset it one cell from the two road-
      // facing edges so the visible lightbox still reads as the corner sign
      // while staying inside the brown commercial footprint.
      x:
        candidate.streetFrontDir.x < 0
          ? candidate.x + 1
          : candidate.x + w - 2,
      y:
        candidate.crossFrontDir.y < 0
          ? candidate.y + 1
          : candidate.y + h - 2,
    };
    const cornerDistance =
      (pylonCell.x - cornerX) ** 2 +
      (pylonCell.y - cornerY) ** 2;
    const roadDistance = Math.abs(dx) + Math.abs(dy);
    const score = cornerDistance * 100 + roadDistance;
    if (
      score < bestScore ||
      (score === bestScore &&
        (!best || pad.x < best.x || (pad.x === best.x && pad.y < best.y)))
    ) {
      best = {
        ...pad,
        kind: "garage_landmark",
        publicName: "Gearbox Auto Hub",
        isPublicSafe: true,
        facingAngle,
        roadTarget: { ...intersection },
        streetFrontDir: { ...candidate.streetFrontDir },
        crossFrontDir: { ...candidate.crossFrontDir },
        islandCell: pylonCell,
      };
      bestScore = score;
    }
  };

  for (const sx of [-1, 1] as const) {
    for (const sy of [-1, 1] as const) {
      consider({
        // Spec 114/116 — keep the whole visual garage, including the
        // brown forecourt/night floor and the corner sign, behind the final
        // rendered road ribbon. The ribbon is wider than the centre-line road
        // cells, so this needs two extra clear cells beyond the old sim-only
        // setback.
        x: sx < 0 ? intersection.x + 5 : intersection.x - w - 4,
        y: sy < 0 ? intersection.y + 5 : intersection.y - h - 4,
        w,
        h,
        streetFrontDir: { x: sx, y: 0 },
        crossFrontDir: { x: 0, y: sy },
      });
    }
  }

  return (
    best ?? {
      x: reserve.x,
      y: reserve.y,
      w,
      h,
      kind: "garage_landmark",
      publicName: "Gearbox Auto Hub",
      isPublicSafe: true,
      facingAngle: Math.atan2(
        intersection.x - reserve.x,
        intersection.y - reserve.y,
      ),
      roadTarget: { ...intersection },
      streetFrontDir: { x: 1, y: 0 },
      crossFrontDir: { x: 0, y: 1 },
      islandCell: { x: intersection.x - 1, y: intersection.y - 1 },
    }
  );
}

function garagePadFits(
  t: Terrain,
  reserve: Reserve,
  pad: Reserve,
  shopCells: ReadonlySet<string>,
  streetKeys: ReadonlySet<string>,
  crossKeys: ReadonlySet<string>,
  mallCells: ReadonlySet<string>,
): boolean {
  if (pad.x < reserve.x || pad.y < reserve.y) return false;
  if (pad.x + pad.w > reserve.x + reserve.w) return false;
  if (pad.y + pad.h > reserve.y + reserve.h) return false;
  for (let y = pad.y; y < pad.y + pad.h; y++)
    for (let x = pad.x; x < pad.x + pad.w; x++) {
      const k = `${x},${y}`;
      if (!cellOk(t, x, y)) return false;
      if (
        shopCells.has(k) ||
        streetKeys.has(k) ||
        crossKeys.has(k) ||
        mallCells.has(k)
      )
        return false;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nk = `${x + dx},${y + dy}`;
        if (streetKeys.has(nk) || crossKeys.has(nk)) return false;
      }
    }
  return true;
}

function footprintKeys(p: Reserve): string[] {
  const out: string[] = [];
  for (let y = p.y; y < p.y + p.h; y++)
    for (let x = p.x; x < p.x + p.w; x++) out.push(`${x},${y}`);
  return out;
}

function mallPadFits(
  t: Terrain,
  reserve: Reserve,
  pad: Reserve,
  shopCells: ReadonlySet<string>,
  streetKeys: ReadonlySet<string>,
  crossKeys: ReadonlySet<string>,
): boolean {
  if (pad.x < reserve.x || pad.y < reserve.y) return false;
  if (pad.x + pad.w > reserve.x + reserve.w) return false;
  if (pad.y + pad.h > reserve.y + reserve.h) return false;
  for (let y = pad.y; y < pad.y + pad.h; y++)
    for (let x = pad.x; x < pad.x + pad.w; x++) {
      const k = `${x},${y}`;
      if (!cellOk(t, x, y)) return false;
      if (shopCells.has(k) || streetKeys.has(k) || crossKeys.has(k))
        return false;
    }
  return true;
}

/** Every cell of [x0..x1]×[y0..y1] must be inside the reserve, good ground, not already taken by a
 *  homestead/road (blocked), and unclaimed by another shop. */
function fits(
  t: Terrain,
  reserve: Reserve,
  claimed: Set<string>,
  blocked: ReadonlySet<string>,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  if (x0 < reserve.x || x1 >= reserve.x + reserve.w) return false;
  if (y0 < reserve.y || y1 >= reserve.y + reserve.h) return false;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const key = `${x},${y}`;
      if (!cellOk(t, x, y)) return false;
      if (blocked.has(key)) return false;
      if (claimed.has(key)) return false;
    }
  }
  return true;
}

function claim(
  claimed: Set<string>,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) claimed.add(`${x},${y}`);
}
