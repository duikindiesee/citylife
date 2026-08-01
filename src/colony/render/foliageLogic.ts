import * as THREE from "three";
import { Biome } from "../terrain";
import { COLONY } from "../config";
import { ribbonCoverage, type RoadWay } from "./roadRibbon";
import { getSmoothRoadY } from "./roadSurface";

// WORLD.DESERT.1 — bioluminescent desert flora.
//
// The old palette was six temperate greens, which is what dotted the new sand with dark conifers.
// An arid world has few plants, and the ones that survive cluster in the damp hollows — so the
// survivors are worth making the opposite of drab: cyan, magenta, lime, violet and amber, the
// alien glow the operator asked for. Saturated on purpose; against pale sand these read as light
// sources rather than shrubs.
const TREE_COLORS = [
  0x2ff0d0, 0xff4fd8, 0xa8ff3e, 0x9b5cff, 0xffc23e, 0x3ec6ff,
];
const LOT_SIZE = 4;

/** A cell-space rectangle to clear of trees (inclusive corners). */
export interface ClearRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function calculateFoliagePositions(
  terrain: any,
  roads: any[],
  _buildings: any[],
  clearRects: ClearRect[] = [],
  roadWays: RoadWay[] = [],
): { matrices: number[][]; colors: number[] } {
  const N = terrain.size;
  // WORLD.FOLIAGE.SCATTER.1 — a murmur3-style finalizer, NOT the plain `(n * 2654435761) >>> 0` this
  // file used to carry. quiverTreeLogic.ts already documented that hash as unfit and said so in as many
  // words ("NOT the plain (n * 2654435761) >>> 0 used elsewhere in the render layer") — this is the
  // "elsewhere", left behind when the quiver trees were fixed.
  //
  // WHY IT SHOWS. A multiplicative hash of CONSECUTIVE integers is an arithmetic progression mod 2^32,
  // and the cell index `i = y*N + x` is consecutive along every row. Thresholding it therefore selects
  // a periodic set of columns — the trees line up. Measured over 40 rows of a 608-wide grid at the
  // Forest threshold, the gap between neighbouring trees took only THREE values in the entire world:
  //
  //   weak hash    gap 3 = 57.1%,  gap 2 = 30.6%,  gap 5 = 12.3%   (100% — nothing else occurs)
  //   this hash    gap 1 = 34.9%,  gap 2 = 22.7%,  gap 3 = 14.4%,  ... a proper geometric tail
  //
  // Three spacings for every tree on the planet is a lattice, and it read on screen as rows of cones
  // marching across the dunes. The finalizer's avalanche breaks the progression, so neighbouring cells
  // decide independently and the stand scatters.
  //
  // The trailing `>>> 0` on the LAST xor is load-bearing: JS bitwise operators return a SIGNED int32,
  // so without it a negative value divided by 2^32 yields a NEGATIVE "probability", every threshold
  // test fails, and the affected cells silently grow nothing. That exact omission once produced 18,799
  // quiver trees with their heights capped — see the note in quiverTreeLogic.ts.
  const hash = (n: number) => {
    let h = n >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    h = Math.imul(h, 0x85ebca6b) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 0xc2b2ae35) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    return h / 4294967296;
  };

  const cleared = new Set<number>();
  const mark = (cx: number, cy: number, rad: number) => {
    const ix = Math.round(cx);
    const iy = Math.round(cy);
    for (let yy = iy - rad; yy <= iy + rad; yy++) {
      for (let xx = ix - rad; xx <= ix + rad; xx++) {
        if (xx >= 0 && yy >= 0 && xx < N && yy < N) cleared.add(yy * N + xx);
      }
    }
  };

  // Clear roads
  for (const r of roads) mark(r.x, r.y, 1);

  // Spec 127 — road cells are a topology hint; rendered roads are smoothed,
  // widened ribbons. Cull foliage from the same conservative ribbon coverage the renderer
  // paints, so curved/wide avenues and builder-plotted ways do not leave trees standing on
  // asphalt while preserving trees outside the actual carriageway footprint.
  if (roadWays.length) {
    const roadY =
      typeof terrain.worldYAt === "function"
        ? (x: number, y: number) => getSmoothRoadY(terrain, x, y)
        : (x: number, y: number) =>
            terrain.worldY(Math.round(x), Math.round(y));
    for (const key of ribbonCoverage(roadWays, terrain, roadY).keys()) {
      const [x, y] = key.split(",").map(Number);
      if (Number.isFinite(x) && Number.isFinite(y)) mark(x!, y!, 0);
    }
  }

  // Spec 128 — clear lot/parcel footprints ("trees on houses is a big no"): each rect is a
  // zoned or built lot, cleared with a 1-cell margin so canopies don't overhang the fence.
  for (const rc of clearRects) {
    for (let yy = rc.y0 - 1; yy <= rc.y1 + 1; yy++) {
      for (let xx = rc.x0 - 1; xx <= rc.x1 + 1; xx++) {
        if (xx >= 0 && yy >= 0 && xx < N && yy < N) cleared.add(yy * N + xx);
      }
    }
  }

  // Buildings currently do NOT cull foliage: ColonyBuilding has no footprint field (only id/x/y/artifact).

  const matrices: number[][] = [];
  const colors: number[] = [];
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      if (cleared.has(i)) continue;
      if (terrain.elev[i] < COLONY.world.seaLevel || terrain.water[i]) continue;

      const b = terrain.biome[i] as Biome;
      if (b === Biome.Ocean || b === Biome.Shallows || b === Biome.Beach)
        continue;

      // Deterministic pseudo-randomness
      const h1 = hash(i);
      const h2 = hash(i + 1);

      // Trees per cell based on biome
      // WORLD.DESERT.1 — density, re-tuned for an arid world. This is where aridity lives, ON
      // PURPOSE: the biome classification is unchanged, because Forest/Plains are load-bearing for
      // city siting and hamlet naming (see the note in terrain.ts classify). Changing what GROWS
      // is safe; changing what a cell IS moves the town.
      //
      // Measured on the unchanged classification, Forest is 6.5% of the map on seed 4242 and
      // 15.9% on seed 314. At the old `2 + h1*3` that is 2-4 plants on every one of those cells —
      // roughly 72,000 on seed 4242 alone — which is a forest, not a desert. Plains adds ~15,000
      // more at `h1 > 0.8` (a plant on a fifth of all open ground), and those were the dark trees
      // scattered over the new sand.
      //
      // Forest now reads as the DAMP HOLLOW: still the densest thing in the world, still where the
      // glow gathers, but a scattering rather than a canopy. Plains and Mountain become genuinely
      // occasional so the dunes read as empty, which is the whole point of a desert.
      let count = 0;
      if (b === Biome.Forest) count = h1 > 0.66 ? 1 : 0;
      else if (b === Biome.Plains) count = h1 > 0.97 ? 1 : 0;
      else if (b === Biome.Mountain) count = h1 > 0.98 ? 1 : 0;

      for (let j = 0; j < count; j++) {
        const trX = x + (hash(i + j * 7) - 0.5) * 0.8;
        const trY = y + (hash(i + j * 11) - 0.5) * 0.8;

        // Clamp to edges
        if (trX < 0 || trX >= N - 1 || trY < 0 || trY >= N - 1) continue;

        const wX = (trX - N / 2) * LOT_SIZE;
        const wZ = (trY - N / 2) * LOT_SIZE;
        const wY = terrain.worldY(Math.round(trX), Math.round(trY));

        const scale = 0.6 + hash(i + j * 13) * 0.8;
        dummy.position.set(wX, wY, wZ);
        dummy.rotation.set(
          (hash(i + j * 17) - 0.5) * 0.2,
          hash(i + j * 19) * Math.PI * 2,
          (hash(i + j * 23) - 0.5) * 0.2,
        );
        dummy.scale.setScalar(scale);
        dummy.updateMatrix();

        matrices.push(dummy.matrix.toArray());

        const baseC =
          TREE_COLORS[Math.floor(hash(i + j * 29) * TREE_COLORS.length)];
        col.setHex(baseC);
        // Keep the jitter for variety but raise the floor: dimming a neon hue to 0.7 turns it
        // muddy, which is exactly what we are moving away from.
        col.multiplyScalar(0.9 + hash(i + j * 31) * 0.35);
        colors.push(col.getHex());
      }
    }
  }

  return { matrices, colors };
}
