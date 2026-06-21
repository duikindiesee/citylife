// Spec 077 — the house COMPILER (P1). Turns a blueprint script into a fine micro-occupancy grid and
// then a back-compatible Block[] the existing instanced renderer can draw unchanged (the greedy mesher
// is the next slice, P2). Walls read as MASONRY by alternating two brick tints per course, and a wall
// can carry one to three storeys.
//
// DETERMINISM is mandatory: compileBlueprint is a pure function of (script, w, d, seed) with NO
// wall-clock and NO randomness anywhere. The seed is mixed with a strong integer hash so two citizens
// with nearby seeds never collide — but the mix is a fixed function, so identical inputs always yield
// byte-identical blocks.
import {
  parseBlueprint,
  type FurnitureItem,
  type ParsedBlueprint,
  type Room,
} from "./blueprintScript";
import { stampFurniture } from "./furniture";
import type { Block, BlockKind, DoorDir } from "./voxelHouse";

/** Sub-blocks per plot cell along each axis. 6 => 6x6 micro-cells per plot cell in plan, fine enough
 *  that a single brick is small and a wall is several courses tall. Tunable (the spec allows up to 8). */
export const HOUSE_VOXEL_N = 6;

/** The compile-cost budget a compiled house must stay under (occupancy memory + mesh-gen time). With
 *  greedy meshing a house draws as ONE merged geometry regardless of block count, so this is not a
 *  draw-call cap — it bounds how large a single house may get. Spec 084 S4 raised it for the estate
 *  tiers (a 3-storey GRAND-zone home lands near 45k micro-blocks) and compileBlueprint now ENFORCES
 *  it: it used to be exported-but-never-checked, an open door for a bot script to stall the tab. */
export const HOUSE_VOXEL_BUDGET = 60000;

/** Micro-block height in world units — gives each storey real presence so a home is never squat.
 *  THE single source: the game renderer, the builder preview and the Kookerbook house card all mesh
 *  with this, so a house looks identical everywhere it is drawn (spec 084 S1 killed 3 duplicates). */
export const VOXEL_Y = 0.22;

export interface CompileOpts {
  /** houseZone width in plot cells (tiles along the street). */
  w: number;
  /** houseZone depth in plot cells (tiles away from the street). */
  d: number;
  /** citizen houseSeed — mixed with a strong hash so homes never collide yet stay deterministic. */
  seed: number;
}

export interface CompiledHouse {
  /** Micro-grid extents (in sub-blocks). */
  gw: number;
  gd: number;
  gh: number;
  /** Sub-blocks per plot cell (== HOUSE_VOXEL_N). */
  n: number;
  /** Storeys the walls carry (1..3). */
  storeys: number;
  /** The compiled, renderable blocks at micro resolution. */
  blocks: Block[];
}

// ── Deterministic hashing ──────────────────────────────────────────────────────
// A strong 32-bit integer hash (a fixed permutation of the classic finalisers). Pure: no randomness,
// no wall-clock — every bit of the output depends only on the input, so seeds never collide but the
// same seed always hashes the same.
function hash32(x: number): number {
  let h = x >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Mix the seed with two field tags into one deterministic 32-bit value. */
function mix(seed: number, a: number, b: number): number {
  return hash32(
    (hash32(seed) ^
      Math.imul(a + 1, 0x9e3779b1) ^
      Math.imul(b + 131, 0x85ebca77)) >>>
      0,
  );
}

// ── Compact occupancy grid ──────────────────────────────────────────────────────
// air = 0; every other kind gets a small integer code. The grid is a flat Uint8Array indexed
// (z*gd + y)*gw + x, so the whole house is one contiguous, cache-friendly buffer.
const KIND_CODE: Record<BlockKind, number> = {
  floor: 1,
  wall: 2,
  window: 3,
  roof: 4,
  door: 5,
  bed: 6,
  table: 7,
  soil: 8,
  crop: 9,
  cropAlt: 10,
  grass: 11,
  fence: 12,
  hedge: 13,
  stone: 14,
  path: 15,
  trunk: 16,
  leaf: 17,
  well: 18,
  brick: 19,
  brickAlt: 20,
  step: 21,
  beam: 22,
  glassRail: 23,
  water: 24,
  tile: 25,
  trim: 26,
  chimney: 27,
  sofa: 28,
  rug: 29,
  lamp: 30,
  plant: 31,
  desk: 32,
  shelf: 33,
  counter: 34,
  stove: 35,
  stair: 36,
};
const CODE_KIND: BlockKind[] = (() => {
  const arr: BlockKind[] = ["floor"]; // index 0 unused as a sentinel but filled to keep lookups total
  arr[0] = "floor";
  for (const k of Object.keys(KIND_CODE) as BlockKind[]) arr[KIND_CODE[k]] = k;
  return arr;
})();

class Grid {
  readonly cells: Uint8Array;
  constructor(
    readonly gw: number,
    readonly gd: number,
    readonly gh: number,
  ) {
    this.cells = new Uint8Array(gw * gd * gh);
  }
  private idx(x: number, y: number, z: number): number {
    return (z * this.gd + y) * this.gw + x;
  }
  inB(x: number, y: number, z: number): boolean {
    return (
      x >= 0 && y >= 0 && z >= 0 && x < this.gw && y < this.gd && z < this.gh
    );
  }
  /** Place a kind, never overwriting an already-solid cell unless `force`. */
  set(x: number, y: number, z: number, kind: BlockKind, force = false): void {
    if (!this.inB(x, y, z)) return;
    const i = this.idx(x, y, z);
    if (!force && this.cells[i] !== 0) return;
    this.cells[i] = KIND_CODE[kind];
  }
  get(x: number, y: number, z: number): number {
    if (!this.inB(x, y, z)) return 0;
    return this.cells[this.idx(x, y, z)]!;
  }
  toBlocks(): Block[] {
    const out: Block[] = [];
    for (let z = 0; z < this.gh; z++) {
      for (let y = 0; y < this.gd; y++) {
        for (let x = 0; x < this.gw; x++) {
          const c = this.cells[this.idx(x, y, z)]!;
          if (c !== 0) out.push({ x, y, z, kind: CODE_KIND[c]! });
        }
      }
    }
    return out;
  }
}

// ── Scaling: blueprint units -> plot cells ──────────────────────────────────────
/** Scale a blueprint coordinate from its own w/d grid onto the houseZone w/d tile count. Deterministic
 *  integer mapping (floor of a rational), so the scaled rooms tile the plot with no gaps or wall-clock. */
function scaleSpan(v: number, from: number, to: number): number {
  if (from <= 0) return 0;
  return Math.round((v * to) / from);
}

interface ScaledRoom extends Room {
  // scaled to plot-cell coordinates
  px: number;
  py: number;
  pw: number;
  pd: number;
}

function scaleRooms(p: ParsedBlueprint, w: number, d: number): ScaledRoom[] {
  return p.rooms.map((r) => {
    const px = scaleSpan(r.x, p.w, w);
    const py = scaleSpan(r.y, p.d, d);
    let pw = scaleSpan(r.x + r.w, p.w, w) - px;
    let pd = scaleSpan(r.y + r.d, p.d, d) - py;
    pw = Math.max(1, Math.min(pw, w - px));
    pd = Math.max(1, Math.min(pd, d - py));
    return { ...r, px, py, pw, pd };
  });
}

// ── Brick coursing ──────────────────────────────────────────────────────────────
/** Pick the brick tint for a wall sub-block. Alternating by COURSE (the micro z row) gives a masonry
 *  banding; a per-position bond offset breaks the seams so it does not look like flat stripes. Pure: a
 *  fixed function of position and seed, no randomness. */
function brickAt(gx: number, gz: number, seed: number): BlockKind {
  const bond = gz & 1; // running-bond: every other course shifts half a brick
  const t = (gz + ((gx + bond) >> 1) + (mix(seed, gx, gz) & 1)) & 1;
  return t === 0 ? "brick" : "brickAlt";
}

// ── The compiler ──────────────────────────────────────────────────────────────
/** Compile a blueprint script to a renderable micro-block house, deterministically from (w, d, seed).
 *  Builds: a floor slab, brick outer walls (1..3 storeys), inner room dividers, a street-facing door,
 *  framed windows, a roof, plus per-room flourishes (pool water + tile rim, patio tile + glassRail). */
export function compileBlueprint(
  script: string,
  opts: CompileOpts,
): CompiledHouse {
  const p = parseBlueprint(script);
  const w = Math.max(1, Math.floor(opts.w));
  const d = Math.max(1, Math.floor(opts.d));
  const seed = opts.seed >>> 0;
  const n = HOUSE_VOXEL_N;

  // Storeys: wallH carries 1..3 floors. Clamp so a runaway wallH can never blow the budget.
  const storeys = Math.max(1, Math.min(3, p.wallH));
  const wallSub = storeys * n; // wall height in sub-blocks
  const floorSub = 1; // a one-sub-block floor slab
  const roofSub = 1;
  const chimneySub = n; // headroom above the roof for a chimney / peak
  const gw = w * n;
  const gd = d * n;
  const gh = floorSub + wallSub + roofSub + chimneySub;
  // Spec 084 S4 — the budget is ENFORCED, not advisory: the floor slab alone occupies gw*gd cells,
  // so a zone whose slab already busts the budget can never compile (it used to allocate and mesh
  // anyway — an open door for a bot-authored script to stall the tab on a huge plot).
  if (gw * gd > HOUSE_VOXEL_BUDGET) {
    throw new Error(
      `house exceeds the voxel budget: ${gw}x${gd} floor slab alone is ${gw * gd} > ${HOUSE_VOXEL_BUDGET} micro-blocks`,
    );
  }
  const g = new Grid(gw, gd, gh);

  const rooms = scaleRooms(p, w, d);
  // SLICE B — multi-level. Rooms and furniture carry an optional storey (z, default 0). The GROUND
  // storey runs the original single-level pipeline byte-for-byte; upper storeys get their own dividers,
  // flourishes and furniture, plus a shared inter-storey floor slab and a stairwell. A script with no z
  // anywhere compiles identically to before (the upper passes are empty, the slabs/stairs are gated on
  // a wall height above one).
  const groundRooms = rooms.filter((r) => (r.z ?? 0) === 0);
  // Upper-storey CONTENT drives the multi-level build: a storey gets a real floor (and the house a
  // stairwell) only where a room or furniture actually sits above the ground. A bare tall shell with
  // everything on the ground stays byte-identical to the single-level compile — and stays under budget,
  // since a full-footprint slab on a big estate would otherwise blow it.
  const upperRooms = rooms.filter(
    (r) => (r.z ?? 0) >= 1 && (r.z ?? 0) < storeys,
  );
  const upperItems = p.items.filter(
    (f) => (f.z ?? 0) >= 1 && (f.z ?? 0) < storeys,
  );
  const hasUpper = upperRooms.length > 0 || upperItems.length > 0;
  // When rooms STACK, ground partitions are one storey tall so an upper room is never bisected by a wall
  // rising from the floor below it. With no stacking the ground dividers keep their original full height.
  const perStorey = hasUpper;

  // OVERLAP SEMANTICS: the LAST room placed OWNS its cells — adding a pool over a bedroom CARVES the
  // bedroom (its dividers and roof retreat), so outdoor rooms read as backyard amenities cut into the
  // mass, never brick shafts punched through it. Deterministic: pure list order, no randomness. The
  // owner map and the outdoor test are GROUND-storey concerns (the shell, roof and yard read off them).
  const owner = roomOwners(groundRooms, w, d);
  const outdoor = (cx: number, cy: number): boolean => {
    if (cx < 0 || cy < 0 || cx >= w || cy >= d) return false;
    const i = owner[cy * w + cx]!;
    if (i < 0) return false;
    const k = groundRooms[i]!.kind;
    return k === "patio" || k === "pool";
  };

  // The street-facing door cell on the relevant edge (in plot cells), centred deterministically.
  const door = doorCellPlot(w, d, p.doorDir, seed);
  const doorGx = door.x * n + Math.floor(n / 2); // micro column at the door centre

  // 1. FLOOR slab — covers the whole footprint at z 0.
  for (let gy = 0; gy < gd; gy++)
    for (let gx = 0; gx < gw; gx++) g.set(gx, gy, 0, "floor");

  // 2. OUTER WALLS — brick masonry around the footprint; outdoor cells on the edge get a LOW GARDEN
  //    WALL instead of full-height brick, so an edge pool/patio reads as a walled backyard, not a shaft.
  //    The door edge gets an opening; windows are punched into long wall runs.
  buildOuterWalls(g, w, d, n, storeys, p.doorDir, door, outdoor, seed);

  // 3. GROUND DIVIDERS — brick walls along room boundaries, only on cells the room still OWNS (a later
  //    overlapping room carves them away). One storey tall when rooms stack above, else full shell height.
  buildDividers(g, groundRooms, owner, w, d, n, floorSub, perStorey ? n : wallSub, seed);

  // 4. ROOF slab one micro-level above the walls, over enclosed rooms only (outdoor cells stay open).
  buildRoof(g, groundRooms, owner, w, d, n, floorSub + wallSub, seed, outdoor);

  // 5. GROUND FLOURISHES — pool water + tile rim, patio tile + glassRail, plus a chimney for a living room.
  buildRoomDetails(
    g,
    groundRooms,
    owner,
    w,
    n,
    floorSub,
    (perStorey ? floorSub + n : floorSub + wallSub) - 1,
    seed,
  );

  // 5b. GROUND FURNITURE (spec 088) — drop each ground-floor item{...} piece onto the floor of its cell.
  //     Furniture yields to structure (force=false): it fills interior air but never punches a wall.
  buildFurnitureItems(
    g,
    p.items.filter((f) => (f.z ?? 0) === 0),
    p,
    w,
    d,
    n,
    floorSub,
  );

  // 5c. UPPER STOREYS (Slice B) — under each upper-storey room/furniture a real floor slab, a stacked
  //     stairwell up from the ground, then that storey's own dividers, flourishes and furniture.
  if (hasUpper) {
    let topUsed = 1;
    for (const r of upperRooms) topUsed = Math.max(topUsed, r.z ?? 0);
    for (const f of upperItems) topUsed = Math.max(topUsed, f.z ?? 0);
    const stair = pickStairCell(w, d, door, outdoor, seed);
    buildUpperFloors(g, upperRooms, upperItems, p, w, d, n, floorSub, stair, topUsed);
    if (stair) placeStairs(g, n, floorSub, topUsed, stair);
    for (let s = 1; s <= topUsed; s++) {
      const baseZ = floorSub + s * n; // the stand level (and furniture floor) of storey s
      const sRooms = upperRooms.filter((r) => (r.z ?? 0) === s);
      if (sRooms.length > 0) {
        const sOwner = roomOwners(sRooms, w, d);
        buildDividers(g, sRooms, sOwner, w, d, n, baseZ, n, seed);
        buildRoomDetails(g, sRooms, sOwner, w, n, baseZ, baseZ + n - 1, seed);
      }
      const sItems = upperItems.filter((f) => (f.z ?? 0) === s);
      if (sItems.length > 0) buildFurnitureItems(g, sItems, p, w, d, n, baseZ);
    }
  }

  // 6. DOOR LAST — carve the opening and seat a panelled door, overriding any wall/rail in the column so
  //    the entrance is always clear even when a patio rail or a room divider lands on the door edge.
  placeDoor(g, doorGx, door, p.doorDir, n, floorSub);

  const blocks = g.toBlocks();
  if (blocks.length > HOUSE_VOXEL_BUDGET) {
    throw new Error(
      `house exceeds the voxel budget: ${blocks.length} > ${HOUSE_VOXEL_BUDGET} micro-blocks (spec 084 S4)`,
    );
  }
  return { gw, gd, gh, n, storeys, blocks };
}

// The plot-cell door cell for a facing; the column is centred (deterministically) on the door edge.
function doorCellPlot(
  w: number,
  d: number,
  dir: DoorDir,
  _seed: number,
): { x: number; y: number } {
  switch (dir) {
    case "n":
      return { x: Math.floor(w / 2), y: 0 };
    case "s":
      return { x: Math.floor(w / 2), y: d - 1 };
    case "e":
      return { x: w - 1, y: Math.floor(d / 2) };
    case "w":
      return { x: 0, y: Math.floor(d / 2) };
  }
}

/** Carve the door opening through the outer wall on the door edge and seat a panelled door at the base.
 *  The opening is a few sub-blocks wide and a bit over one course tall, so the wall is open above it. */
function placeDoor(
  g: Grid,
  doorGx: number,
  door: { x: number; y: number },
  dir: DoorDir,
  n: number,
  floorSub: number,
): void {
  const half = Math.max(1, Math.floor(n / 3)); // door is ~a third of a cell wide
  const doorH = Math.min(2 * n - 1, n + Math.floor(n / 2)); // a door taller than one course
  if (dir === "n" || dir === "s") {
    const cy = dir === "n" ? 0 : door.y * n + n - 1;
    for (let dx = -half; dx <= half; dx++) {
      const gx = doorGx + dx;
      for (let z = floorSub; z < floorSub + doorH; z++) clear(g, gx, cy, z);
      g.set(gx, cy, floorSub, "door", true);
    }
  } else {
    const cx = dir === "w" ? 0 : door.x * n + n - 1;
    const cyc = door.y * n + Math.floor(n / 2);
    for (let dy = -half; dy <= half; dy++) {
      const gy = cyc + dy;
      for (let z = floorSub; z < floorSub + doorH; z++) clear(g, cx, gy, z);
      g.set(cx, gy, floorSub, "door", true);
    }
  }
}

function clear(g: Grid, x: number, y: number, z: number): void {
  if (g.inB(x, y, z)) g.cells[(z * g.gd + y) * g.gw + x] = 0;
}

/** Cell ownership: the LAST room in the list covering a cell owns it (-1 = unowned). This is the
 *  carve rule that makes overlapping designs sane — a pool dropped onto a bedroom takes those cells. */
function roomOwners(rooms: ScaledRoom[], w: number, d: number): Int16Array {
  const owner = new Int16Array(w * d).fill(-1);
  rooms.forEach((r, i) => {
    for (let cy = Math.max(0, r.py); cy < Math.min(d, r.py + r.pd); cy++) {
      for (let cx = Math.max(0, r.px); cx < Math.min(w, r.px + r.pw); cx++) {
        owner[cy * w + cx] = i;
      }
    }
  });
  return owner;
}

function buildOuterWalls(
  g: Grid,
  w: number,
  d: number,
  n: number,
  storeys: number,
  dir: DoorDir,
  door: { x: number; y: number },
  outdoor: (cx: number, cy: number) => boolean,
  seed: number,
): void {
  const floorSub = 1;
  const wallSub = storeys * n;
  const gardenH = Math.max(2, Math.floor(n / 3)); // a low garden wall around edge patios/pools
  for (let cy = 0; cy < d; cy++) {
    for (let cx = 0; cx < w; cx++) {
      const onEdge = cx === 0 || cx === w - 1 || cy === 0 || cy === d - 1;
      if (!onEdge) continue;
      const out = outdoor(cx, cy);
      const top = out ? floorSub + gardenH : floorSub + wallSub;
      // The micro rows/cols of this cell that lie on the outer face.
      for (let sy = 0; sy < n; sy++) {
        for (let sx = 0; sx < n; sx++) {
          const gx = cx * n + sx,
            gy = cy * n + sy;
          const faceX =
            (cx === 0 && sx === 0) || (cx === w - 1 && sx === n - 1);
          const faceY =
            (cy === 0 && sy === 0) || (cy === d - 1 && sy === n - 1);
          if (!faceX && !faceY) continue;
          for (let z = floorSub; z < top; z++) {
            // Window band: one course-high opening near eye level on each storey, away from corners.
            if (
              !out &&
              isWindow(gx, gy, z, w, d, n, floorSub, storeys, dir, door, seed)
            ) {
              g.set(gx, gy, z, "window");
              continue;
            }
            g.set(gx, gy, z, brickAt(gx, z, seed));
          }
        }
      }
    }
  }
}

/** Window predicate: a small framed opening, deterministic, set into long wall runs at each storey's
 *  mid-height, never on a corner column and never on the door column. The run axis is chosen from the
 *  edge the sub-block sits on (top/bottom walls run along x, left/right walls run along y). */
function isWindow(
  gx: number,
  gy: number,
  z: number,
  w: number,
  d: number,
  n: number,
  floorSub: number,
  storeys: number,
  dir: DoorDir,
  door: { x: number; y: number },
  seed: number,
): boolean {
  const within = z - floorSub;
  const storey = Math.floor(within / n);
  if (storey >= storeys) return false;
  const inStorey = within - storey * n;
  if (inStorey !== Math.floor(n / 2)) return false; // one course high, at the storey's mid-height
  const gwM = w * n,
    gdM = d * n;
  // Which wall is this sub-block on? Pick the run axis accordingly.
  const onTopBottom = gy === 0 || gy === gdM - 1;
  const onLeftRight = gx === 0 || gx === gwM - 1;
  const along = onTopBottom ? gx : onLeftRight ? gy : -1;
  if (along < 0) return false;
  const runLen = onTopBottom ? gwM : gdM;
  // skip the two end sub-blocks of the run so windows never sit on a corner
  if (along <= 1 || along >= runLen - 2) return false;
  // skip the door column on the door wall so a window never lands over the door
  const doorGx = door.x * n + Math.floor(n / 2);
  if (onTopBottom && (dir === "n" || dir === "s") && Math.abs(gx - doorGx) <= 1)
    return false;
  // a regular window rhythm along the run, phase-shifted per storey by the seed
  const period = n + 1; // 7 with N=6 — windows spaced a bit over a cell apart
  const phase = mix(seed, storey, 0) % period;
  return (along + phase) % period === Math.floor(period / 2);
}

/** Build the interior partitions for a set of rooms, with walls rising from `baseZ` for `dividerH`
 *  micro-courses. Slice B calls this once per storey (the ground storey at floorSub, uppers at their own
 *  floor level) so a partition only spans the storey it belongs to. Pure + deterministic. */
function buildDividers(
  g: Grid,
  rooms: ScaledRoom[],
  owner: Int16Array,
  w: number,
  d: number,
  n: number,
  baseZ: number,
  dividerH: number,
  seed: number,
): void {
  rooms.forEach((r, ri) => {
    if (r.kind === "patio" || r.kind === "pool") return; // outdoor rooms have no interior walls
    // Build the room's own perimeter walls (interior dividers); skip a doorway gap so rooms connect,
    // leave garages without interior walls (a wide opening), and skip any micro column whose CELL has
    // been carved away by a later room — a pool dropped onto this room takes its walls with it.
    if (r.kind === "garage") return;
    const x0 = r.px * n,
      x1 = (r.px + r.pw) * n - 1;
    const y0 = r.py * n,
      y1 = (r.py + r.pd) * n - 1;
    // a deterministic interior doorway centre on the wall facing the house interior
    const gapAlong = (mix(seed, r.px, r.py) % Math.max(1, x1 - x0)) + x0;
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        const onRoomEdge = gx === x0 || gx === x1 || gy === y0 || gy === y1;
        if (!onRoomEdge) continue;
        // leave a gap (an interior doorway) on the top wall so rooms are connected
        if (gy === y0 && Math.abs(gx - gapAlong) <= 1) continue;
        const cellX = Math.floor(gx / n),
          cellY = Math.floor(gy / n);
        if (cellX < 0 || cellY < 0 || cellX >= w || cellY >= d) continue;
        if (owner[cellY * w + cellX] !== ri) continue; // carved by a later room
        for (let z = baseZ; z < baseZ + dividerH; z++)
          g.set(gx, gy, z, brickAt(gx, z, seed));
      }
    }
  });
}

function buildRoof(
  g: Grid,
  rooms: ScaledRoom[],
  owner: Int16Array,
  w: number,
  d: number,
  n: number,
  roofZ: number,
  seed: number,
  outdoor: (cx: number, cy: number) => boolean,
): void {
  // Enclosed footprint micro-bounds (outdoor cells stay open to the sky).
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (let cy = 0; cy < d; cy++) {
    for (let cx = 0; cx < w; cx++) {
      if (outdoor(cx, cy)) continue;
      minX = Math.min(minX, cx * n);
      maxX = Math.max(maxX, (cx + 1) * n - 1);
      minY = Math.min(minY, cy * n);
      maxY = Math.max(maxY, (cy + 1) * n - 1);
    }
  }
  if (!Number.isFinite(maxX)) return;
  // A PEAKED (hipped) roof: each column rises toward the ridge by its distance to the nearest eave,
  // capped to a gentle pitch (~0.8 cell) so the roof crowns the walls without dominating them. A 2-thick
  // shell keeps the 45-degree slopes free of see-through gaps. This makes a home read as a house, not a box.
  const peakCap = Math.max(2, Math.round(0.8 * n));
  for (let gy = minY; gy <= maxY; gy++) {
    for (let gx = minX; gx <= maxX; gx++) {
      if (outdoor(Math.floor(gx / n), Math.floor(gy / n))) continue;
      const rise = Math.min(
        gx - minX,
        maxX - gx,
        gy - minY,
        maxY - gy,
        peakCap,
      );
      const top = roofZ + rise;
      g.set(gx, gy, top, "roof");
      if (rise > 0) g.set(gx, gy, top - 1, "roof");
    }
  }
  // A short chimney rising just above the ridge from one back corner of a room that still OWNS its
  // anchor cell (an enclosed room fully carved away gets no chimney).
  const enclosed: { r: ScaledRoom; i: number }[] = [];
  rooms.forEach((r, i) => {
    if (r.kind === "living" || r.kind === "bedroom") enclosed.push({ r, i });
  });
  const anchored = enclosed.filter(({ r, i }) => {
    const cx = r.px + r.pw - 1,
      cy = r.py;
    return cx >= 0 && cy >= 0 && cx < w && cy < d && owner[cy * w + cx] === i;
  });
  if (anchored.length > 0) {
    const idx = mix(seed, anchored.length, 7) % anchored.length;
    const { r } = anchored[idx]!;
    const cgx = (r.px + r.pw - 1) * n + Math.floor(n / 2);
    const cgy = r.py * n + Math.floor(n / 2);
    const chimneyTop = roofZ + peakCap + Math.floor(n / 2);
    for (let z = roofZ; z <= chimneyTop; z++)
      g.set(cgx, cgy, z, "chimney", true);
  }
}

/** Paint each room's built-in flourishes. `baseZ` is the storey's floor (furniture/amenity level) and
 *  `bandTopZ` the top course of the storey (where ceiling beams and the garage header ride). Slice B
 *  calls this per storey so an upper living room gets its own beam and an upper bedroom its own bed. */
function buildRoomDetails(
  g: Grid,
  rooms: ScaledRoom[],
  owner: Int16Array,
  w: number,
  n: number,
  baseZ: number,
  bandTopZ: number,
  seed: number,
): void {
  const surfaceZ = baseZ - 1 >= 0 ? baseZ - 1 : 0; // the slab a pool/patio sinks its surface into
  rooms.forEach((r, ri) => {
    const x0 = r.px * n,
      x1 = (r.px + r.pw) * n - 1;
    const y0 = r.py * n,
      y1 = (r.py + r.pd) * n - 1;
    // amenity surfaces only paint cells the room still OWNS (a later room carves them away)
    const owns = (gx: number, gy: number) =>
      owner[Math.floor(gy / n) * w + Math.floor(gx / n)] === ri;
    if (r.kind === "pool") {
      // Water fill with a tile rim one block in.
      for (let gy = y0; gy <= y1; gy++) {
        for (let gx = x0; gx <= x1; gx++) {
          if (!owns(gx, gy)) continue;
          const rim = gx === x0 || gx === x1 || gy === y0 || gy === y1;
          g.set(gx, gy, surfaceZ, rim ? "tile" : "water", true);
          if (rim) g.set(gx, gy, baseZ, "tile", true);
        }
      }
    } else if (r.kind === "patio") {
      // Tile floor plus a low glassRail around the open edge.
      for (let gy = y0; gy <= y1; gy++) {
        for (let gx = x0; gx <= x1; gx++) {
          if (!owns(gx, gy)) continue;
          g.set(gx, gy, surfaceZ, "tile", true);
          const rim = gx === x0 || gx === x1 || gy === y0 || gy === y1;
          if (rim) g.set(gx, gy, baseZ, "glassRail", true);
        }
      }
    } else if (r.kind === "living") {
      // a table near the middle and an exposed ceiling BEAM under the roof line for character
      const tx = Math.floor((x0 + x1) / 2),
        ty = Math.floor((y0 + y1) / 2);
      g.set(tx, ty, baseZ, "table", true);
      const phase = mix(seed, r.px, r.py) % 2;
      for (let gx = x0 + 1; gx <= x1 - 1; gx++)
        if (((gx + phase) & 1) === 0) g.set(gx, ty, bandTopZ, "beam", true);
    } else if (r.kind === "bedroom") {
      // a bed in the back corner away from the door edge
      g.set(x0 + 1, y0 + 1, baseZ, "bed", true);
    } else if (r.kind === "garage") {
      // a wide opening on its street edge — a step threshold and a beam header above it
      for (let gx = x0; gx <= x1; gx++) {
        g.set(gx, y1, baseZ, "step", true);
        g.set(gx, y1, bandTopZ, "beam", true);
      }
    }
  });
}

/** Stamp authored furniture (spec 088) onto a storey. Each item{...} names a piece, the cell it sits in
 *  (blueprint coordinates, scaled onto the plot like rooms), a quarter-turn rotation and (Slice B) a
 *  storey. The piece's micro-block stamp lands at `baseZ` — the storey's floor; force=false so furniture
 *  fills interior air but never overwrites a wall, the floor slab or a built-in flourish. Pure. */
function buildFurnitureItems(
  g: Grid,
  items: FurnitureItem[],
  p: ParsedBlueprint,
  w: number,
  d: number,
  n: number,
  baseZ: number,
): void {
  for (const f of items) {
    // Scale the item's blueprint cell onto the plot, exactly as rooms scale, then clamp into bounds.
    const ix = Math.max(0, Math.min(w - 1, scaleSpan(f.x, p.w, w)));
    const iy = Math.max(0, Math.min(d - 1, scaleSpan(f.y, p.d, d)));
    const gx0 = ix * n;
    const gy0 = iy * n;
    for (const b of stampFurniture(f.kind, f.rot, n)) {
      g.set(gx0 + b.dx, gy0 + b.dy, baseZ + b.dz, b.kind, false);
    }
  }
}

/** SLICE B — lay floor slabs under the upper-storey content only: each upper room's footprint, a pad
 *  under each upper furniture cell, and a landing at the stairwell cell on every used storey. Sizing the
 *  floors to the rooms (not the whole footprint) keeps an estate-scale multi-level home under the voxel
 *  budget. The slab for storey s sits at floorSub + s*n - 1 (it caps storey s-1 and floors storey s).
 *  force=false: the slab fills interior air and yields to brick walls already passing through it. */
function buildUpperFloors(
  g: Grid,
  upperRooms: ScaledRoom[],
  upperItems: FurnitureItem[],
  p: ParsedBlueprint,
  w: number,
  d: number,
  n: number,
  floorSub: number,
  stair: { cx: number; cy: number } | null,
  topUsed: number,
): void {
  const slabZ = (s: number) => floorSub + s * n - 1;
  const fillCell = (cx: number, cy: number, z: number) => {
    if (cx < 0 || cy < 0 || cx >= w || cy >= d) return;
    const gx0 = cx * n,
      gy0 = cy * n;
    for (let sy = 0; sy < n; sy++)
      for (let sx = 0; sx < n; sx++) g.set(gx0 + sx, gy0 + sy, z, "floor");
  };
  for (const r of upperRooms) {
    const z = slabZ(r.z ?? 0);
    for (let cy = r.py; cy < r.py + r.pd; cy++)
      for (let cx = r.px; cx < r.px + r.pw; cx++) fillCell(cx, cy, z);
  }
  for (const f of upperItems) {
    const ix = Math.max(0, Math.min(w - 1, scaleSpan(f.x, p.w, w)));
    const iy = Math.max(0, Math.min(d - 1, scaleSpan(f.y, p.d, d)));
    fillCell(ix, iy, slabZ(f.z ?? 0));
  }
  // A landing under the stairwell on every used storey so a flight always arrives on solid floor even
  // when no room sits directly above the stairs.
  if (stair) for (let s = 1; s <= topUsed; s++) fillCell(stair.cx, stair.cy, slabZ(s));
}

/** SLICE B — choose the enclosed interior cell that hosts the stairwell: farthest from the door (so it
 *  never blocks the entrance), ties broken by a fixed seed mix so the choice is deterministic yet varies
 *  between homes. Returns null when a design has no enclosed interior cell (e.g. all-outdoor). */
function pickStairCell(
  w: number,
  d: number,
  door: { x: number; y: number },
  outdoor: (cx: number, cy: number) => boolean,
  seed: number,
): { cx: number; cy: number } | null {
  let best = -1;
  let bestScore = -1;
  for (let cy = 0; cy < d; cy++) {
    for (let cx = 0; cx < w; cx++) {
      if (cx === door.x && cy === door.y) continue;
      const dist = Math.abs(cx - door.x) + Math.abs(cy - door.y);
      // Strongly prefer an enclosed interior cell; fall back to an outdoor cell only when the whole
      // ground is open (a house-on-stilts over a patio still needs a flight up to its upper floor). The
      // bonus is uniform across enclosed cells, so the choice among them is unchanged from before.
      const enclosedBonus = outdoor(cx, cy) ? 0 : 1000;
      const score = enclosedBonus + dist * 8 + (mix(seed, cx, cy) & 7);
      if (score > bestScore) {
        bestScore = score;
        best = cy * w + cx;
      }
    }
  }
  if (best < 0) return null; // a degenerate plot with no cell but the door — no stairwell
  const cx = best % w;
  return { cx, cy: (best - cx) / w };
}

/** SLICE B — a single stacked stairwell threading the ground up to the top used storey, in the chosen
 *  host cell. Each flight is a 2-wide diagonal run rising one micro-course per step; the floor slab above
 *  the run's head is punched open FIRST so the top tread (which sits at the slab level) survives, and the
 *  flights actually connect. Pure + deterministic — no wall-clock, no randomness. */
function placeStairs(
  g: Grid,
  n: number,
  floorSub: number,
  topUsed: number,
  stair: { cx: number; cy: number },
): void {
  const sx0 = stair.cx * n + Math.max(1, Math.floor(n / 2) - 1); // a 2-wide run, centred in the cell
  const sx1 = sx0 + 1;
  for (let s = 0; s < topUsed; s++) {
    const startZ = floorSub + s * n; // stand level of the lower storey
    const slabZ = floorSub + (s + 1) * n - 1; // the floor slab this flight climbs up to
    for (let ox = -1; ox <= 2; ox++)
      for (let oy = n - 2; oy <= n - 1; oy++)
        clear(g, sx0 + ox, stair.cy * n + oy, slabZ);
    for (let i = 0; i < n; i++) {
      const gy = stair.cy * n + i;
      const z = startZ + i; // rise one micro-course per step of depth
      g.set(sx0, gy, z, "stair", true);
      g.set(sx1, gy, z, "stair", true);
    }
  }
}
