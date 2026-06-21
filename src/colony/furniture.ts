// Spec 088 — the FURNITURE catalog. A small, curated set of interior pieces a blueprint can place
// inside a house with the `item{kind:.. x:.. y:.. rot:..}` DSL token (see blueprintScript.ts). Each
// piece compiles to a deterministic little stamp of micro-blocks the house compiler drops onto the
// floor of the cell it sits in. Pure and fully deterministic (no wall-clock, no randomness): the same
// item always produces the same blocks, so a furnished house meshes byte-identically everywhere it is
// drawn. This is the shared vocabulary the furniture shop, the player inventory and the Kookerbook
// marketplace all reuse — author a piece once, place it, sell it, buy it.
import type { BlockKind } from "./voxelHouse";

export type FurnitureKind =
  | "bed"
  | "sofa"
  | "table"
  | "chair"
  | "desk"
  | "bookshelf"
  | "rug"
  | "lamp"
  | "plant"
  | "counter"
  | "stove";

export const FURNITURE_KINDS: readonly FurnitureKind[] = [
  "bed",
  "sofa",
  "table",
  "chair",
  "desk",
  "bookshelf",
  "rug",
  "lamp",
  "plant",
  "counter",
  "stove",
];

/** A single micro-block of a furniture stamp, in cell-local micro coordinates: dx/dy within the plot
 *  cell (0..n-1), dz above the cell floor (0 = resting on the floor). */
export interface StampBlock {
  dx: number;
  dy: number;
  dz: number;
  kind: BlockKind;
}

export interface FurnitureDef {
  /** Human label for the builder palette. */
  label: string;
  /** A glyph for the palette button. */
  icon: string;
  /** The stamp authored for n=6 micro-cells, head/back toward the cell's north (y small). */
  blocks: StampBlock[];
}

/** A solid box of one kind, inclusive bounds, in cell-local micro coordinates. */
function box(
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  kind: BlockKind,
): StampBlock[] {
  const out: StampBlock[] = [];
  for (let z = z0; z <= z1; z++)
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) out.push({ dx: x, dy: y, dz: z, kind });
  return out;
}

// The pieces are authored for a 6x6 micro cell. They read as low-poly furniture: a few stacked tints.
// Reusing existing house block kinds where the colour already suits the piece (bed, table, trim, beam,
// tile) and pulling in the new furniture tints (sofa, rug, lamp, plant, desk, shelf, counter, stove).
export const FURNITURE_CATALOG: Record<FurnitureKind, FurnitureDef> = {
  bed: {
    label: "Bed",
    icon: "🛏️",
    blocks: [
      ...box(1, 1, 0, 3, 4, 0, "bed"), // mattress
      ...box(1, 0, 0, 3, 0, 1, "shelf"), // headboard at the north edge
      ...box(1, 1, 1, 3, 1, 1, "trim"), // pillow
    ],
  },
  sofa: {
    label: "Sofa",
    icon: "🛋️",
    blocks: [
      ...box(1, 3, 0, 4, 4, 0, "sofa"), // seat
      ...box(1, 4, 1, 4, 4, 1, "sofa"), // backrest
      ...box(1, 3, 1, 1, 4, 1, "sofa"), // left arm
      ...box(4, 3, 1, 4, 4, 1, "sofa"), // right arm
    ],
  },
  table: {
    label: "Table",
    icon: "🍽️",
    blocks: [
      ...box(2, 2, 1, 4, 4, 1, "table"), // top
      { dx: 2, dy: 2, dz: 0, kind: "table" }, // legs
      { dx: 4, dy: 2, dz: 0, kind: "table" },
      { dx: 2, dy: 4, dz: 0, kind: "table" },
      { dx: 4, dy: 4, dz: 0, kind: "table" },
    ],
  },
  chair: {
    label: "Chair",
    icon: "🪑",
    blocks: [
      ...box(2, 3, 0, 3, 3, 0, "table"), // seat
      ...box(2, 4, 0, 3, 4, 1, "shelf"), // back
    ],
  },
  desk: {
    label: "Desk",
    icon: "💼",
    blocks: [
      ...box(1, 0, 1, 4, 1, 1, "desk"), // top against the back wall
      { dx: 1, dy: 1, dz: 0, kind: "desk" }, // legs
      { dx: 4, dy: 1, dz: 0, kind: "desk" },
      ...box(2, 2, 0, 3, 2, 0, "table"), // a stool in front
    ],
  },
  bookshelf: {
    label: "Bookshelf",
    icon: "📚",
    blocks: [
      ...box(1, 0, 0, 4, 0, 2, "shelf"), // tall case against the back
      ...box(1, 0, 1, 4, 0, 1, "trim"), // a shelf band of books
    ],
  },
  rug: {
    label: "Rug",
    icon: "🟥",
    blocks: [...box(1, 1, 0, 4, 4, 0, "rug")], // a flat textile on the floor
  },
  lamp: {
    label: "Lamp",
    icon: "💡",
    blocks: [
      ...box(3, 3, 0, 3, 3, 2, "beam"), // pole
      { dx: 3, dy: 3, dz: 3, kind: "lamp" }, // shade (a warm glow)
      { dx: 2, dy: 3, dz: 3, kind: "lamp" },
      { dx: 4, dy: 3, dz: 3, kind: "lamp" },
      { dx: 3, dy: 2, dz: 3, kind: "lamp" },
      { dx: 3, dy: 4, dz: 3, kind: "lamp" },
    ],
  },
  plant: {
    label: "Plant",
    icon: "🪴",
    blocks: [
      { dx: 3, dy: 3, dz: 0, kind: "trim" }, // pot
      ...box(3, 3, 1, 3, 3, 2, "plant"), // trunk of foliage
      { dx: 2, dy: 3, dz: 2, kind: "plant" }, // bushy crown
      { dx: 4, dy: 3, dz: 2, kind: "plant" },
      { dx: 3, dy: 2, dz: 2, kind: "plant" },
      { dx: 3, dy: 4, dz: 2, kind: "plant" },
    ],
  },
  counter: {
    label: "Counter",
    icon: "🧱",
    blocks: [
      ...box(1, 0, 0, 4, 0, 1, "counter"), // back run
      ...box(1, 0, 0, 1, 3, 1, "counter"), // side run (an L)
    ],
  },
  stove: {
    label: "Stove",
    icon: "🔥",
    blocks: [
      ...box(2, 1, 0, 3, 2, 1, "stove"), // body
      { dx: 2, dy: 1, dz: 2, kind: "stove" }, // cooktop
      { dx: 3, dy: 1, dz: 2, kind: "stove" },
      { dx: 3, dy: 2, dz: 2, kind: "lamp" }, // a glowing burner knob
    ],
  },
};

/** Rotate a cell-local (dx,dy) by `rot` quarter-turns clockwise inside an n x n cell. Keeps every
 *  offset within [0, n-1] so a rotated piece never spills out of its cell. Pure. */
export function rotateOffset(
  dx: number,
  dy: number,
  n: number,
  rot: number,
): { dx: number; dy: number } {
  const r = ((Math.round(rot) % 4) + 4) % 4;
  switch (r) {
    case 1:
      return { dx: n - 1 - dy, dy: dx };
    case 2:
      return { dx: n - 1 - dx, dy: n - 1 - dy };
    case 3:
      return { dx: dy, dy: n - 1 - dx };
    default:
      return { dx, dy };
  }
}

/** The micro-block stamp for a furniture piece, rotated, in cell-local coordinates. Deterministic. */
export function stampFurniture(
  kind: FurnitureKind,
  rot: number,
  n: number,
): StampBlock[] {
  const def = FURNITURE_CATALOG[kind];
  return def.blocks.map((b) => {
    const r = rotateOffset(b.dx, b.dy, n, rot);
    return { dx: r.dx, dy: r.dy, dz: b.dz, kind: b.kind };
  });
}
