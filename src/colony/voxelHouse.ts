// A minecraft-style VOXEL house — a little cottage built from 1x1x1 blocks on a lot. Deterministic
// from a seed so each citizen's home is distinct: a floor slab, perimeter walls with a doorway facing
// the street and a window or two, a roof, and a bed + table inside. Pure geometry + a block KIND; the
// renderer colours each kind. We do not model walkable interiors yet (the operator said not that far
// ahead) — but the walls, bed and the inside things are all here as real blocks.
import { RNG } from "../engine/rng";

export type BlockKind =
  | "floor"
  | "wall"
  | "window"
  | "roof"
  | "door"
  | "bed"
  | "table"
  // Homestead surroundings (spec 076) — the renderer draws these as 1-cell blocks too.
  | "soil"
  | "crop"
  | "cropAlt"
  | "grass"
  | "fence"
  | "hedge"
  | "stone"
  | "path"
  | "trunk"
  | "leaf"
  | "well"
  // Fancy-brick house builder (spec 077) — masonry courses plus micro-architecture the compiler emits.
  | "brick"
  | "brickAlt"
  | "step"
  | "beam"
  | "glassRail"
  | "water"
  | "tile"
  | "trim"
  | "chimney"
  // Authored furniture (spec 088) — pieces the blueprint can place inside a house via item{...}.
  | "sofa"
  | "rug"
  | "lamp"
  | "plant"
  | "desk"
  | "shelf"
  | "counter"
  | "stove";
export type DoorDir = "n" | "s" | "e" | "w";

export interface Block {
  x: number; // 0..w-1, east
  y: number; // 0..d-1, south
  z: number; // 0 floor, up
  kind: BlockKind;
}

export interface VoxelHouse {
  w: number;
  d: number;
  wallH: number;
  doorDir: DoorDir;
  blocks: Block[];
}

/** The centre cell of the door edge for a given facing. */
function doorCell(
  w: number,
  d: number,
  dir: DoorDir,
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

/** Build the block list for a house, deterministically from the seed, with the door facing doorDir.
 *  `opts.maxW`/`maxD` grow the house to fill its homestead house-zone (spec 076) — a big plot raises a
 *  big house — while never exceeding the zone. With no opts it keeps the original cottage size. */
export function buildVoxelHouse(
  seed: number,
  doorDir: DoorDir = "s",
  opts: { maxW?: number; maxD?: number } = {},
): VoxelHouse {
  const rng = new RNG(((seed >>> 0) ^ 0x9e3779b9) >>> 0);
  const maxW = Math.max(3, opts.maxW ?? 4);
  const maxD = Math.max(3, opts.maxD ?? 4);
  const w = clamp(rng.pick([maxW - 1, maxW, maxW]), 3, maxW);
  const d = clamp(rng.pick([maxD - 1, maxD, maxD]), 3, maxD);
  const wallH = rng.pick(maxW >= 6 ? [2, 3, 3] : [2, 2, 3]); // bigger plots get taller homes
  const blocks: Block[] = [];
  const door = doorCell(w, d, doorDir);

  // floor slab
  for (let y = 0; y < d; y++)
    for (let x = 0; x < w; x++) blocks.push({ x, y, z: 0, kind: "floor" });

  // perimeter walls; the door cell is an opening (a single recessed door block at z=1, open above)
  for (let z = 1; z <= wallH; z++) {
    for (let y = 0; y < d; y++) {
      for (let x = 0; x < w; x++) {
        const edge = x === 0 || x === w - 1 || y === 0 || y === d - 1;
        if (!edge) continue;
        if (x === door.x && y === door.y) {
          if (z === 1) blocks.push({ x, y, z, kind: "door" }); // doorway: a door block at the base, open above
          continue;
        }
        const corner = (x === 0 || x === w - 1) && (y === 0 || y === d - 1);
        const win = z === 1 && !corner && rng.chance(0.22);
        blocks.push({ x, y, z, kind: win ? "window" : "wall" });
      }
    }
  }

  // roof slab one level above the walls
  for (let y = 0; y < d; y++)
    for (let x = 0; x < w; x++)
      blocks.push({ x, y, z: wallH + 1, kind: "roof" });

  // inside things: a bed in a back corner (away from the door) and a table near the middle
  const bedX = door.x <= 1 ? w - 2 : 1;
  const bedY = door.y <= 1 ? d - 2 : 1;
  blocks.push({
    x: clamp(bedX, 1, w - 2),
    y: clamp(bedY, 1, d - 2),
    z: 1,
    kind: "bed",
  });
  blocks.push({
    x: clamp(Math.floor(w / 2), 1, w - 2),
    y: clamp(Math.floor(d / 2), 1, d - 2),
    z: 1,
    kind: "table",
  });

  return { w, d, wallH, doorDir, blocks };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Colours per block kind (renderer reads these). */
export const BLOCK_COLOR: Record<BlockKind, number> = {
  floor: 0x6b5a44,
  wall: 0xd9c2a0,
  window: 0x8fd0e6,
  roof: 0x4a4640,
  door: 0x5a3a22,
  bed: 0x4d8fe0,
  table: 0x8a6a3a,
  // Homestead surroundings (spec 076): tilled field, garden, fences, driveway, trees, a well.
  soil: 0x6e4a30,
  crop: 0x8bbf4d,
  cropAlt: 0xc9b24a,
  grass: 0x5a7a3a,
  fence: 0x7a5a36,
  hedge: 0x3f6b39,
  stone: 0x9a958c,
  path: 0xb6a079,
  trunk: 0x5a3f28,
  leaf: 0x3d7a3f,
  well: 0x8a8580,
  // Fancy-brick house builder (spec 077): two brick tints for the bond, plus micro-architecture.
  brick: 0xa8543a,
  brickAlt: 0x97462f,
  step: 0x8a857c,
  beam: 0x6b4a2e,
  glassRail: 0xa9dceb,
  water: 0x3f7fb0,
  tile: 0xc2b59b,
  trim: 0xe8e0d0,
  chimney: 0x7a4030,
  // Authored furniture (spec 088): warm, distinct tints so a furnished interior reads at a glance.
  sofa: 0x4a6d9e,
  rug: 0xb24a52,
  lamp: 0xffe1a6,
  plant: 0x47a14e,
  desk: 0x7c5a34,
  shelf: 0x6a4a2c,
  counter: 0xcdbfa3,
  stove: 0x44464d,
};
