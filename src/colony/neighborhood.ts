// The Neighbourhood — large HOMESTEAD PARCELS served by a terrain-aware street (spec 076).
//
// This replaces the old cramped 4x4 lots. Each citizen gets a big bordered PARCEL zoned front-to-back
// from the street: a front yard (setback), the HOUSE, a GARDEN, then a FARM field at the rear, ringed
// by a fence with one gate. Parcels flank a SPINE street routed as a least-cost path over the terrain
// (pathfind.ts), so it stays straight on flat ground and bends around water/slope, never running over
// the sea. Everything is a pure, deterministic function of the terrain so the layout is reproducible
// and unit-testable.
import type { Terrain } from "./terrain";
import { Biome } from "./terrain";
import type { DoorDir } from "./voxelHouse";
import { cellOk, leastCostPath, type Cell } from "./pathfind";

export type FenceType = "fence" | "hedge" | "wall";

/** An axis-aligned rectangle of cells: min-corner (x,y), `w` wide (along the street), `d` deep. */
export interface Zone {
  x: number;
  y: number;
  w: number;
  d: number;
}

/** A homestead parcel — the unit of household land. Keeps the public fields the engine already reads
 *  (id, x, y, w, h, doorX, doorY, built, ownerCitizenId, houseSeed) plus the new homestead structure. */
export interface Parcel {
  id: string;
  /** The stable engine key of the satellite hamlet this parcel belongs to (wood1/hill2/vale2), set at
   *  world build. Undefined for the primary coastal neighbourhood — bare lots are open land. Pairs with
   *  the backend neighbourhoods table so a PRIVATE hamlet can be allowlist-gated at buy time. */
  neighborhoodKey?: string;
  /** Parcel centre cell. */
  x: number;
  y: number;
  /** Parcel footprint in cells (w along the street, h deep). */
  w: number;
  h: number;
  /** Which side of the spine the parcel sits on (-1 = toward -y, +1 = toward +y). */
  side: -1 | 1;
  /** The house door cell, facing the street. */
  doorX: number;
  doorY: number;
  ownerCitizenId?: string;
  /** Spec 078 — a permanently reserved FOUNDER parcel (Joe the Crab). Never auto-assigned to a newcomer
   *  and not freed by ordinary demolition. */
  reservedFor?: string;
  built: boolean;
  houseSeed: number;
  /** Spec 077 — the citizen's authored house blueprint script (the DSL from blueprintScript.ts). When set
   *  on a BUILT parcel the renderer compiles it and draws the fancy greedy-meshed brick house; with none it
   *  falls back to the legacy per-block instanced cottage. P3/P4 will store the bot/human-authored script
   *  here; until then defaultBlueprint() seeds a deterministic one so the merged render path is exercised. */
  blueprint?: string;
  fenceType: FenceType;
  /** The house build-zone (the voxel house sits here, set back from the street). */
  houseZone: Zone;
  /** The vegetable garden band, between house and field. */
  garden: Zone;
  /** The worked farm field at the rear of the parcel. */
  farm: Zone;
  /** The gate gap in the front fence where the driveway meets the parcel. */
  gate: Cell;
  /** The driveway path cells from the carriageway across the verge + front yard to the door. */
  driveway: Cell[];
  /** The perimeter fence cells (the border ring minus the gate gap). */
  fence: Cell[];
}

// Back-compat alias: runtime.ts imports `type Lot`; a Parcel IS the lot now.
export type Lot = Parcel;

export interface Neighborhood {
  /** The routed spine centre-line cells. */
  spine: Cell[];
  /** The 3-wide carriageway cells (walkable + drawn as the road surface). */
  carriage: Cell[];
  /** The kerb/verge ring cells (drawn as the verge, not walkable road). */
  verge: Cell[];
  /** The walkable street cells merged into the colony roads (== carriageway). */
  street: Cell[];
  /** The homestead parcels. */
  parcels: Parcel[];
  /** Back-compat alias so existing code reading `.lots` keeps working. */
  lots: Parcel[];
}

// ── Homestead dimensions ─────────────────────────────────────────────────────
// Depth budget D, from the street inward: front border (1) + setback + house + garden + farm + rear
// border (1). Width W: a 1-cell fence border each side, the house inset `inset` more cells each
// side — the estate tiers inset one EXTRA cell, creating the clear side strip the spec-084 S2
// L-walkway needs to reach east/west doors.
interface ParcelSize {
  W: number; // frontage (along the street)
  D: number; // depth (away from the street)
  setback: number; // front-yard cells between the front fence and the house
  houseDepth: number;
  gardenDepth: number;
  farmDepth: number;
  inset: number; // house-zone inset from the side fence (1 legacy, 2 estate — the side strip)
}
// Spec 084 S6 — the estate tiers of WORLD v2. Odd widths keep the compiled door's centre column on
// the parcel axis, so the n/s driveway column never shifts on a redesign.
const GRAND: ParcelSize = {
  W: 27,
  D: 33,
  setback: 4,
  houseDepth: 16,
  gardenDepth: 6,
  farmDepth: 5,
  inset: 2,
}; // houseZone 23x16 — founders + waterfront
const ESTATE: ParcelSize = {
  W: 23,
  D: 29,
  setback: 3,
  houseDepth: 14,
  gardenDepth: 5,
  farmDepth: 5,
  inset: 2,
}; // houseZone 19x14 — the standard plot
// The legacy tiers remain the small-ground fallback (their houses abut the side fence).
const BIG: ParcelSize = {
  W: 11,
  D: 14,
  setback: 2,
  houseDepth: 6,
  gardenDepth: 2,
  farmDepth: 2,
  inset: 1,
};
const COMPACT: ParcelSize = {
  W: 9,
  D: 11,
  setback: 1,
  houseDepth: 5,
  gardenDepth: 2,
  farmDepth: 1,
  inset: 1,
};
const GAP = 4; // empty green cells between adjacent parcels along the street (beyond each fence)
const MAX_PER_SIDE = 6; // up to 6 homesteads per side of the avenue (084 S6)
// Offset of the parcel's front fence from the spine centre: carriageway half (1) + verge (1) + 2.
const FRONT_OFFSET = 4;

function key(x: number, y: number): string {
  return `${x},${y}`;
}

/** Dilate a set of cells by their 4-neighbours that pass cellOk — turns the 1-cell spine into a
 *  ~3-wide carriageway that follows every bend, and the carriageway into its verge ring. */
function dilate(t: Terrain, cells: Cell[], have: Set<string>): Cell[] {
  const out: Cell[] = [];
  const seen = new Set<string>();
  for (const c of cells) {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const x = c.x + dx,
        y = c.y + dy;
      const k = key(x, y);
      if (have.has(k) || seen.has(k)) continue;
      if (!cellOk(t, x, y)) continue;
      seen.add(k);
      out.push({ x, y });
    }
  }
  return out;
}

/** Spiral outward from (cx,cy) up to `r` for the nearest cell that passes cellOk. */
function slideToLand(t: Terrain, cx: number, cy: number, r = 8): Cell | null {
  for (let rr = 0; rr <= r; rr++) {
    for (let dy = -rr; dy <= rr; dy++) {
      for (let dx = -rr; dx <= rr; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== rr) continue;
        if (cellOk(t, cx + dx, cy + dy)) return { x: cx + dx, y: cy + dy };
      }
    }
  }
  return null;
}

interface Corridor {
  spine: Cell[];
  carriage: Cell[];
  verge: Cell[];
  carriageSet: Set<string>;
  blocked: Set<string>; // carriage + verge — parcels may not touch these
  colY: Map<number, number>; // x -> the spine y at that column nearest the baseline
}

/** Route the spine between two anchors at the baseline y and build its carriageway + verge. `taken`
 *  (spec 086) is cells already used by other neighbourhoods/commercial — the spine routes around them
 *  and the carriage/verge never sit on them, so scattered clusters never overlap. */
function buildCorridor(
  t: Terrain,
  lx: number,
  baselineY: number,
  span: number,
  taken?: ReadonlySet<string>,
): Corridor | null {
  const start = slideToLand(t, lx - Math.floor(span / 2), baselineY);
  const end = slideToLand(t, lx + Math.ceil(span / 2), baselineY);
  if (!start || !end) return null;
  const avoid =
    taken && (taken.has(key(start.x, start.y)) || taken.has(key(end.x, end.y)));
  if (avoid) return null;
  const spine = leastCostPath(t, start, end, {
    slopeWeight: 0.6,
    blocked: taken ? (x, y) => taken.has(key(x, y)) : undefined,
  });
  if (!spine || spine.length < span * 0.6) return null;
  const spineSet = new Set(spine.map((c) => key(c.x, c.y)));
  const notTaken = (c: Cell) => !taken || !taken.has(key(c.x, c.y));
  const carriage = [...spine, ...dilate(t, spine, spineSet)].filter(notTaken);
  const carriageSet = new Set(carriage.map((c) => key(c.x, c.y)));
  const verge = dilate(t, carriage, carriageSet).filter(notTaken);
  const blocked = new Set([...carriageSet, ...verge.map((c) => key(c.x, c.y))]);
  // For each spine column, the spine y nearest the baseline (parcels attach against this).
  const colY = new Map<number, number>();
  for (const c of spine) {
    const prev = colY.get(c.x);
    if (
      prev === undefined ||
      Math.abs(c.y - baselineY) < Math.abs(prev - baselineY)
    )
      colY.set(c.x, c.y);
  }
  return { spine, carriage, verge, carriageSet, blocked, colY };
}

/** Build one parcel anchored at spine column (sx, syStreet) on `side`, or null if any cell is bad
 *  ground, hits the road corridor, or collides with an already-claimed cell. On success, every cell
 *  it occupies (plus a GAP halo) is added to `claimed` so neighbours keep their distance. */
function tryParcel(
  t: Terrain,
  sx: number,
  syStreet: number,
  side: -1 | 1,
  sz: ParcelSize,
  corridor: Corridor,
  claimed: Set<string>,
  id: number,
): Parcel | null {
  const uHalf = (sz.W - 1) / 2;
  const houseSeed = (sx * 73856093) ^ (syStreet * 19349663);
  // Absolute coords from a lateral offset u and a depth d (0 = front fence row).
  const ax = (u: number) => sx + u;
  const ay = (d: number) => syStreet + side * (FRONT_OFFSET + d);

  // 1. Validate the whole footprint: every cell good ground, off the road, unclaimed.
  for (let d = 0; d < sz.D; d++) {
    for (let u = -uHalf; u <= uHalf; u++) {
      const x = ax(u),
        y = ay(d);
      const k = key(x, y);
      if (!cellOk(t, x, y)) return null;
      if (corridor.blocked.has(k)) return null;
      if (claimed.has(k)) return null;
    }
  }

  // 2. Depth bands from the street inward.
  const houseD0 = 1 + sz.setback;
  const gardenD0 = houseD0 + sz.houseDepth;
  const farmD0 = gardenD0 + sz.gardenDepth;
  // A normalized rect covering depths [dA, dB] x lateral [uA, uB].
  const rect = (dA: number, dB: number, uA: number, uB: number): Zone => {
    const ys = [ay(dA), ay(dB)];
    return {
      x: ax(uA),
      y: Math.min(ys[0]!, ys[1]!),
      w: uB - uA + 1,
      d: Math.abs(dB - dA) + 1,
    };
  };
  const houseUHalf = uHalf - sz.inset; // estate tiers inset 2: the clear SIDE STRIP for e/w walkways
  const houseZone = rect(
    houseD0,
    houseD0 + sz.houseDepth - 1,
    -houseUHalf,
    houseUHalf,
  );
  const garden = rect(
    gardenD0,
    gardenD0 + sz.gardenDepth - 1,
    -(uHalf - 1),
    uHalf - 1,
  );
  const farm = rect(farmD0, farmD0 + sz.farmDepth - 1, -(uHalf - 1), uHalf - 1);

  // 3. Door (house front, on the street side), gate (front fence at the door column), driveway.
  // The door column is the house-zone CENTRE: compileBlueprint centres the door on the door edge
  // (doorCellPlot), so this is the only column where the driveway actually lands on the door. The
  // old ±1 jitter made the path miss the door by a cell on two of three parcels.
  const doorX = ax(0);
  const doorY = ay(houseD0);
  const gate = { x: doorX, y: ay(0) };
  // Frontage rule: a carriageway cell must sit directly street-ward of the gate column.
  if (
    !corridor.carriageSet.has(key(doorX, syStreet + side * 1)) &&
    !corridor.carriageSet.has(key(doorX, syStreet))
  ) {
    return null;
  }
  // The driveway runs from the verge across the front yard all the way to the door cell (offset
  // FRONT_OFFSET + houseD0), so it actually reaches the door — no one-cell gap. When the carriageway
  // does not sit directly beside the verge at this column (the dilated road skipped a cell), the
  // drive extends one row street-ward so it still MEETS the road.
  const oStart = corridor.carriageSet.has(key(doorX, syStreet + side * 1))
    ? 2
    : 1;
  const driveway: Cell[] = [];
  for (let o = oStart; o <= FRONT_OFFSET + houseD0; o++) {
    const x = doorX,
      y = syStreet + side * o;
    if (!cellOk(t, x, y)) return null; // keep the drive on good ground
    driveway.push({ x, y });
  }

  // 4. Fence ring (perimeter), minus the gate gap.
  const fence: Cell[] = [];
  for (let u = -uHalf; u <= uHalf; u++) {
    for (const d of [0, sz.D - 1]) {
      const x = ax(u),
        y = ay(d);
      if (x === gate.x && y === gate.y) continue; // leave the gate open
      fence.push({ x, y });
    }
  }
  for (let d = 1; d < sz.D - 1; d++) {
    fence.push({ x: ax(-uHalf), y: ay(d) });
    fence.push({ x: ax(uHalf), y: ay(d) });
  }

  // Spec 114 — the visible plot border is a floor/border footprint, so it
  // must not touch the final road corridor. `corridor.blocked` is the local
  // carriage + verge road envelope; reject parcels whose fence ring would be
  // 4-neighbour adjacent to it, not just directly on it.
  for (const f of fence) {
    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      if (corridor.blocked.has(key(f.x + dx, f.y + dy))) return null;
    }
  }

  // 5. Claim the footprint plus a GAP halo so neighbours never crowd it.
  for (let d = -GAP; d < sz.D + GAP; d++) {
    for (let u = -uHalf - GAP; u <= uHalf + GAP; u++) {
      claimed.add(key(ax(u), ay(d)));
    }
  }

  const cx = sx,
    cy = ay((sz.D - 1) / 2);
  return {
    id: `lot_${id}`,
    x: cx,
    y: Math.round(cy),
    w: sz.W,
    h: sz.D,
    side,
    doorX,
    doorY,
    built: false,
    houseSeed,
    fenceType: (["fence", "hedge", "wall"] as const)[(houseSeed >>> 8) % 3]!,
    houseZone,
    garden,
    farm,
    gate,
    driveway,
    fence,
  };
}

// ── Door access contract (spec 077/083) ─────────────────────────────────────
// The compiled house's door is a pure function of the house zone + the blueprint's door facing
// (compileBlueprint scales the design to the zone and centres the door on its edge), so the parcel's
// access — door cell, gate, driveway, fence gaps — can always be re-aimed at the REAL door.

/** The street-facing door direction for a parcel (which way the house front looks at the spine). */
export function streetDoorDir(p: Parcel): "n" | "s" {
  return p.side === 1 ? "n" : "s";
}

/** The world cell of a compiled blueprint's door on this parcel, for a given facing. */
export function blueprintDoorCell(p: Parcel, dir: DoorDir): Cell {
  const z = p.houseZone;
  switch (dir) {
    case "n":
      return { x: z.x + Math.floor(z.w / 2), y: z.y };
    case "s":
      return { x: z.x + Math.floor(z.w / 2), y: z.y + z.d - 1 };
    case "e":
      return { x: z.x + z.w - 1, y: z.y + Math.floor(z.d / 2) };
    case "w":
      return { x: z.x, y: z.y + Math.floor(z.d / 2) };
  }
}

/** Rebuild the perimeter fence ring from the parcel rect, leaving the given gap cells open. */
function rebuildFence(p: Parcel, gaps: Cell[]): void {
  const xHalf = (p.w - 1) / 2;
  const x0 = p.x - xHalf,
    x1 = p.x + xHalf;
  const y0 = p.side === 1 ? p.gate.y : p.gate.y - p.h + 1;
  const y1 = p.side === 1 ? p.gate.y + p.h - 1 : p.gate.y;
  const gap = new Set(gaps.map((c) => key(c.x, c.y)));
  const fence: Cell[] = [];
  for (let x = x0; x <= x1; x++)
    for (const y of [y0, y1]) if (!gap.has(key(x, y))) fence.push({ x, y });
  for (let y = y0 + 1; y <= y1 - 1; y++)
    for (const x of [x0, x1]) if (!gap.has(key(x, y))) fence.push({ x, y });
  p.fence = fence;
}

/** Re-aim the parcel's access at the door of the COMPILED blueprint. doorX/doorY become the real
 *  door cell (citizens walk to the actual door). A street-facing door pulls the gate + driveway onto
 *  its column so the path lands exactly on the door. For side (e/w) and rear doors the behaviour
 *  depends on the parcel tier (spec 084 S2): when a clear SIDE STRIP exists between the house zone
 *  and the side fence (the new estate tiers inset the zone one extra cell), a full L-WALKWAY is
 *  laid — along the front yard, up the inside-fence strip, around to the door — ending ON the door
 *  cell, every cell inside the parcel rect. Legacy tiers, where the house abuts the fence, keep the
 *  geometrically honest minimum: a side fence gap beside an e/w door, a garden doorstep pad behind
 *  a rear door. Pure and deterministic — call it whenever a blueprint lands on the parcel. */
export function retargetParcelAccess(p: Parcel, dir: DoorDir): void {
  const street = streetDoorDir(p);
  const door = blueprintDoorCell(p, dir);
  p.doorX = door.x;
  p.doorY = door.y;
  // The porch path: verge row, gate row, front yard, ending ON the house-front row — at the door
  // column when the door faces the street, else at the front centre.
  const front = dir === street ? door : blueprintDoorCell(p, street);
  // Preserve the street-most row tryParcel chose (it knows where the carriageway actually is).
  const startY = p.driveway[0]?.y ?? p.gate.y - p.side;
  const cells: Cell[] = [];
  for (let y = startY; p.side > 0 ? y <= front.y : y >= front.y; y += p.side)
    cells.push({ x: front.x, y });
  p.gate = { x: front.x, y: p.gate.y };
  const gaps: Cell[] = [p.gate];
  if (dir !== street) {
    const z = p.houseZone;
    const x0 = p.x - (p.w - 1) / 2; // the west fence column
    const hasStrip = z.x >= x0 + 2; // a clear walkway column between the side fence and the house
    if (!hasStrip) {
      if (dir === "e" || dir === "w")
        gaps.push({ x: door.x + (dir === "e" ? 1 : -1), y: door.y });
      else cells.push({ x: door.x, y: door.y + p.side }); // rear doorstep onto the garden
    } else {
      // The L-walkway. Front-yard leg: along the setback row just street-ward of the house front,
      // from the porch column to the strip. Strip leg: along the inside-fence column to the door
      // row (rear doors continue one row further, into the garden, and wrap along it).
      const fyOut = front.y - p.side;
      const west =
        dir === "w" || ((dir === "n" || dir === "s") && door.x <= p.x);
      const xs = west ? z.x - 1 : z.x + z.w;
      const stepX = xs > front.x ? 1 : -1;
      for (let x = front.x + stepX; stepX > 0 ? x <= xs : x >= xs; x += stepX)
        cells.push({ x, y: fyOut });
      const endY = dir === "n" || dir === "s" ? door.y + p.side : door.y;
      for (
        let y = fyOut + p.side;
        p.side > 0 ? y <= endY : y >= endY;
        y += p.side
      )
        cells.push({ x: xs, y });
      if (dir === "n" || dir === "s") {
        const stepBX = door.x > xs ? 1 : -1;
        for (
          let x = xs + stepBX;
          stepBX > 0 ? x <= door.x : x >= door.x;
          x += stepBX
        )
          cells.push({ x, y: endY });
      }
      cells.push({ x: door.x, y: door.y }); // the walkway ENDS on the door cell, like the front drive
    }
  }
  p.driveway = cells;
  rebuildFence(p, gaps);
}

/** Lay as many parcels as fit along the spine, alternating both sides. Spec 084 S6 — each side
 *  carries its own size SEQUENCE (sizeFor(index)) and its own placement cursor, so a masterplan can
 *  mix tiers (the GRAND waterfront pair first, then the ESTATE row). Columns iterate shore-ward
 *  first when the corridor's shore end is known, so index 0 (the GRAND tier) lands by the water. */
function layParcels(
  t: Terrain,
  corridor: Corridor,
  sizeFor: (index: number) => ParcelSize,
  maxPerSide: number = MAX_PER_SIDE,
  taken?: ReadonlySet<string>,
): Parcel[] {
  let xs = [...corridor.colY.keys()].sort((a, b) => a - b);
  if (xs.length === 0) return [];
  // Iterate from the shore-ward corridor end (terrain.distToWater is the precomputed BFS field).
  const dAt = (x: number) =>
    t.distToWater[t.idx(x, corridor.colY.get(x)!)] ?? 999;
  if (dAt(xs[xs.length - 1]!) < dAt(xs[0]!)) xs = xs.reverse();
  // Spec 086 — seed the claimed set with cells other clusters/commercial already own, so a scattered
  // hamlet's parcels can never land on top of them.
  const claimed = new Set<string>(taken ?? []);
  const parcels: Parcel[] = [];
  let id = 1;
  const perSide = { [-1]: 0, [1]: 0 } as Record<number, number>;
  const nextAt = { [-1]: -Infinity, [1]: -Infinity } as Record<number, number>; // per-side |x| cursor
  const step0 = xs[0]! <= xs[xs.length - 1]! ? 1 : -1; // travel direction along the column order
  for (const x of xs) {
    const syStreet = corridor.colY.get(x)!;
    for (const side of [-1, 1] as const) {
      if (perSide[side]! >= maxPerSide) continue;
      if (step0 > 0 ? x < nextAt[side]! : x > nextAt[side]!) continue;
      const sz = sizeFor(perSide[side]!);
      const p = tryParcel(t, x, syStreet, side, sz, corridor, claimed, id);
      if (p) {
        parcels.push(p);
        perSide[side]!++;
        id++;
        nextAt[side] = x + step0 * (sz.W + GAP);
      }
    }
    if (perSide[-1]! >= maxPerSide && perSide[1]! >= maxPerSide) break;
  }
  return parcels;
}

/** Trim the spine to the span the parcels actually occupy (plus a short stub each end), then rebuild
 *  the carriageway + verge from the trimmed spine — so the lane hugs the homesteads instead of running
 *  off into the wilderness. */
function trimCorridor(
  t: Terrain,
  corridor: Corridor,
  parcels: Parcel[],
): Corridor {
  if (parcels.length === 0) return corridor;
  const xs = parcels.map((p) => p.x);
  const minX = Math.min(...xs) - 4,
    maxX = Math.max(...xs) + 4;
  const spine = corridor.spine.filter((c) => c.x >= minX && c.x <= maxX);
  if (spine.length < 4) return corridor;
  const spineSet = new Set(spine.map((c) => key(c.x, c.y)));
  const fenceSetback = new Set<string>();
  for (const p of parcels) {
    for (const f of p.fence) {
      fenceSetback.add(key(f.x, f.y));
      fenceSetback.add(key(f.x + 1, f.y));
      fenceSetback.add(key(f.x - 1, f.y));
      fenceSetback.add(key(f.x, f.y + 1));
      fenceSetback.add(key(f.x, f.y - 1));
    }
  }
  const notFenceSetback = (c: Cell) => !fenceSetback.has(key(c.x, c.y));
  const carriage = [...spine, ...dilate(t, spine, spineSet)].filter(
    notFenceSetback,
  );
  const carriageSet = new Set(carriage.map((c) => key(c.x, c.y)));
  const verge = dilate(t, carriage, carriageSet).filter(notFenceSetback);
  return { ...corridor, spine, carriage, verge };
}

function assemble(
  t: Terrain,
  corridor: Corridor,
  parcels: Parcel[],
): Neighborhood {
  // Spec 084 S6 — plot order is a DECLARED contract: the GRAND tier numbers first (the founders'
  // plots 1 + 2), then everything by distance to water ascending (ties by x). Joe takes lot_1,
  // Viw lot_2 — exactly the operator's plot-one-and-plot-two ask.
  const dw = (p: Parcel) =>
    t.distToWater[t.idx(Math.round(p.x), Math.round(p.y))] ?? 999;
  const grand = (p: Parcel) => p.w >= GRAND.W;
  const byShore = [...parcels].sort((a, b) => {
    if (grand(a) !== grand(b)) return grand(a) ? -1 : 1;
    const da = dw(a),
      db = dw(b);
    return da !== db ? da - db : a.x - b.x;
  });
  byShore.forEach((p, i) => {
    p.id = `lot_${i + 1}`;
  });
  return {
    spine: corridor.spine,
    carriage: corridor.carriage,
    verge: corridor.verge,
    street: corridor.carriage,
    parcels: byShore,
    lots: byShore,
  };
}

/** Lay out the homestead neighbourhood on the best dry ground a short walk from the colony core.
 *  Spec 084 S6 — the ESTATE MASTERPLAN comes first: per side, a GRAND waterfront plot then a row of
 *  ESTATEs along the avenue. Smaller tiers remain the fallback for cramped seeds. Wider baseline
 *  sweep for the 608 world. Pure + deterministic from the terrain. */
export function makeNeighborhood(t: Terrain): Neighborhood {
  return makeNeighborhoodAt(t, { x: t.landing.x, y: t.landing.y });
}

/** Spec 086 — the distributed city: lay a homestead neighbourhood centred on ANY anchor, not just
 *  the landing. makeNeighborhood is this anchored on t.landing; the satellites (hills, woods) anchor
 *  elsewhere. Same corridor + parcel construction, so every scattered plot is a valid, buildable,
 *  for-sale Parcel the renderer + ledger already understand. Pure + deterministic in (terrain, anchor). */
export function makeNeighborhoodAt(
  t: Terrain,
  anchor: { x: number; y: number },
  opts: { small?: boolean; blocked?: ReadonlySet<string> } = {},
): Neighborhood {
  const lx = anchor.x,
    ly = anchor.y;
  const blocked = opts.blocked;
  // A SMALL hamlet (the satellites) needs only a short flat strip — 2 plots a side of the COMPACT
  // tier — so it fits a woodland/hill clearing; the coastal primary keeps the full estate masterplan.
  const maxPerSide = opts.small ? 2 : MAX_PER_SIDE;
  const PLANS: ReadonlyArray<(i: number) => ParcelSize> = opts.small
    ? [() => COMPACT, () => BIG]
    : [
        (i) => (i === 0 ? GRAND : ESTATE),
        () => ESTATE,
        () => BIG,
        () => COMPACT,
      ];
  const dySweep = opts.small
    ? [0, -8, 8, -16, 16]
    : [0, -12, 12, -24, 24, -36, 36, -48, 48, -64, 64, -80, 80];
  const minParcels = opts.small ? 1 : 2;
  const spanFor = (plan: (i: number) => ParcelSize) => {
    let s = 4;
    for (let i = 0; i < maxPerSide; i++) s += plan(i).W + GAP;
    return s;
  };
  let best: { corridor: Corridor; parcels: Parcel[] } | null = null;
  for (const plan of PLANS) {
    const span = spanFor(plan);
    for (const dy of dySweep) {
      const corridor = buildCorridor(t, lx, ly + dy, span, blocked);
      if (!corridor) continue;
      const parcels = layParcels(t, corridor, plan, maxPerSide, blocked);
      if (!best || parcels.length > best.parcels.length)
        best = { corridor, parcels };
      if (parcels.length >= maxPerSide * 2) break; // a full band — good enough, stop early
    }
    if (best && best.parcels.length >= minParcels)
      return assemble(
        t,
        trimCorridor(t, best.corridor, best.parcels),
        best.parcels,
      );
  }
  // Fallback: return the best corridor even if cramped (matches the original makeNeighborhood — a
  // carriage-only result still serves the commercial reserve; the runtime skips empty satellites).
  if (best)
    return assemble(
      t,
      trimCorridor(t, best.corridor, best.parcels),
      best.parcels,
    );
  return {
    spine: [],
    carriage: [],
    verge: [],
    street: [],
    parcels: [],
    lots: [],
  };
}

/** Spec 086 — find spread-out, buildable anchors for satellite neighbourhoods, biased toward the
 *  woods (Forest) and hills (Highland) so the city fills distinct parts of the map. Deterministic: a
 *  fixed coarse-grid scan scored by buildable room in a window + distance from the coast + a biome
 *  bonus, then a greedy spread pick. Anchors are at least SEP cells from each other and the coast. */
export function findSatelliteAnchors(
  t: Terrain,
  coast: { x: number; y: number },
  count: number,
): Cell[] {
  const STEP = 12,
    WIN = 11,
    SEP = 52,
    MIN_ROOM = 60;
  // Buildable AREA density in a window (sampled) — irregular forest/coast rarely has a long flat ROW,
  // but a hamlet only needs a buildable blob; the corridor's dy-sweep finds a workable line within it.
  const roomAt = (cx: number, cy: number): number => {
    let room = 0;
    for (let dy = -WIN; dy <= WIN; dy += 2)
      for (let dx = -WIN; dx <= WIN; dx += 2)
        if (cellOk(t, cx + dx, cy + dy)) room++;
    return room; // out of ~144 samples
  };
  const cands: { c: Cell; score: number; ord: number }[] = [];
  for (let cy = WIN; cy < t.size - WIN; cy += STEP) {
    for (let cx = WIN; cx < t.size - WIN; cx += STEP) {
      if (!cellOk(t, cx, cy)) continue;
      const dCoast = Math.hypot(cx - coast.x, cy - coast.y);
      if (dCoast < SEP) continue;
      const room = roomAt(cx, cy);
      if (room < MIN_ROOM) continue;
      const b = t.biome[t.idx(cx, cy)];
      const biomeBonus =
        b === Biome.Forest
          ? 28
          : b === Biome.Highland
            ? 24
            : b === Biome.Plains
              ? 10
              : 0;
      cands.push({
        c: { x: cx, y: cy },
        score: room + biomeBonus + dCoast * 0.08,
        ord: cy * t.size + cx,
      });
    }
  }
  cands.sort((a, b) => b.score - a.score || a.ord - b.ord);
  const picked: Cell[] = [];
  for (const cand of cands) {
    if (picked.length >= count) break;
    if (picked.every((p) => Math.hypot(p.x - cand.c.x, p.y - cand.c.y) >= SEP))
      picked.push(cand.c);
  }
  return picked;
}

// Spec 077 P5 — a strong deterministic hash for the design generator (splitmix-style avalanche), so
// every seed bit reaches every design choice and nearby parcel seeds still get wildly different homes.
function designHash(seed: number, salt: number): number {
  let h = (seed ^ (salt * 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

/** Spec 077 P5 — EVERY CITIZEN DESIGNS THEIR OWN HOME (until their bot authors one in the builder).
 *  A deterministic per-seed design generator: seven layout archetypes crossed with varied footprint
 *  proportions, one or two storeys, and window choices — so no two houses on the street look alike.
 *  Valid BY CONSTRUCTION for every seed (rooms in bounds, the front row always reaches the door edge):
 *  layouts are authored in abstract units with door:s and the door side passed through; the compiler
 *  scales the units onto the real house-zone tile count. Pure — no wall-clock, no Math.random. */
export function defaultBlueprint(
  seed: number,
  doorDir: DoorDir,
  zoneW?: number,
): string {
  const h = (salt: number) => designHash(seed >>> 0, salt);
  // Footprint proportions vary the massing silhouette: 5x4 squat, 6x5 classic, 7x5 long, 6x6 deep.
  const FOOTPRINTS: ReadonlyArray<readonly [number, number]> = [
    [5, 4],
    [6, 5],
    [7, 5],
    [6, 6],
  ];
  // Spec 084 S4 — on the estate tiers (zone width >= 14) the archetypes author on FINER footprints,
  // so rooms keep sensible proportions when the compiler stretches the design onto the big zone.
  // Inert at today's 9-wide zones; the S6 estates light it up.
  const FOOTPRINTS_LARGE: ReadonlyArray<readonly [number, number]> = [
    [9, 7],
    [10, 8],
    [12, 8],
    [10, 10],
  ];
  const table =
    zoneW !== undefined && zoneW >= 14 ? FOOTPRINTS_LARGE : FOOTPRINTS;
  const [w, d] = table[h(1) % table.length]!;
  const wallH = 1 + (h(2) % 2); // cosy 1-2 storeys, never towers
  const winA = (h(3) & 1) as 0 | 1; // window character varies per home
  const half = Math.floor(w / 2);
  const backD = Math.max(1, Math.floor(d * 0.4)); // depth of the back band feature
  const frontD = d - backD;
  type R = {
    kind: string;
    x: number;
    y: number;
    w: number;
    d: number;
    win: 0 | 1;
  };
  // Seven archetypes, authored with the FRONT (street/door) on the y:0 edge. Pools, patios and the
  // backyard band sit at the rear; the door wall always lands on an enclosed front room. For a south
  // door the whole layout is mirrored vertically below, so the front stays the front.
  const archetypes: ReadonlyArray<() => R[]> = [
    // 0 the classic cottage — living + bedroom side by side, full depth
    () => [
      { kind: "living", x: 0, y: 0, w: w - 2, d, win: 1 },
      { kind: "bedroom", x: w - 2, y: 0, w: 2, d, win: winA },
    ],
    // 1 the backyard-pool home — full-width front living, bedroom + POOL across the back
    () => [
      { kind: "living", x: 0, y: 0, w, d: frontD, win: 1 },
      { kind: "bedroom", x: 0, y: frontD, w: w - half, d: backD, win: winA },
      { kind: "pool", x: w - half, y: frontD, w: half, d: backD, win: 0 },
    ],
    // 2 the patio corner — L-shaped home with an open back-corner patio
    () => [
      { kind: "living", x: 0, y: 0, w, d: frontD, win: 1 },
      { kind: "bedroom", x: 0, y: frontD, w: w - half, d: backD, win: 1 },
      { kind: "patio", x: w - half, y: frontD, w: half, d: backD, win: 0 },
    ],
    // 3 the motor home — living beside a street-facing GARAGE, bedroom across the back
    () => [
      { kind: "living", x: 0, y: 0, w: w - half, d: frontD, win: 1 },
      { kind: "garage", x: w - half, y: 0, w: half, d: frontD, win: 0 },
      { kind: "bedroom", x: 0, y: frontD, w, d: backD, win: winA },
    ],
    // 4 the long house — three rooms in a row, windows alternating
    () => [
      { kind: "bedroom", x: 0, y: 0, w: 2, d, win: winA },
      { kind: "living", x: 2, y: 0, w: w - 4, d, win: 1 },
      { kind: "bedroom", x: w - 2, y: 0, w: 2, d, win: 1 },
    ],
    // 5 the courtyard — a full home with an open patio heart (carved by overlap, the massing rules)
    () => [
      { kind: "living", x: 0, y: 0, w, d, win: 1 },
      {
        kind: "patio",
        x: 1,
        y: Math.max(1, frontD - 1),
        w: Math.max(2, w - 3),
        d: Math.min(2, backD),
        win: 0,
      },
    ],
    // 6 the poolside villa — living front-left, garage front-right, pool the whole back band
    () => [
      { kind: "living", x: 0, y: 0, w: w - 2, d: frontD, win: 1 },
      { kind: "garage", x: w - 2, y: 0, w: 2, d: frontD, win: 0 },
      { kind: "pool", x: 0, y: frontD, w, d: backD, win: 0 },
    ],
  ];
  let rooms = archetypes[h(4) % archetypes.length]!();
  // South door: mirror vertically so the enclosed front faces the street and the yard stays out back.
  // (East/west doors are not produced by the homestead layout; the validator reach rule still holds.)
  if (doorDir === "s") rooms = rooms.map((r) => ({ ...r, y: d - (r.y + r.d) }));
  const roomStr = rooms.map(
    (r) =>
      `room{kind:${r.kind} x:${r.x} y:${r.y} w:${r.w} d:${r.d} win:${r.win}}`,
  );
  return `house{w:${w} d:${d} wallH:${wallH} door:${doorDir}} ${roomStr.join(" ")}`;
}
