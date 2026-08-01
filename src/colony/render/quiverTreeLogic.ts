/**
 * WORLD.KOKERBOOM.1 — the quiver tree (kokerboom, *Aloe dichotoma*) of Namaqualand.
 *
 * Placement and sizing only; the geometry lives in R3FQuiverTrees.tsx.
 *
 * WHAT THE REAL TREE IS, because it should be right:
 *  - It is the signature tree of Namaqualand and the Namib — the desert this world became.
 *  - It grows on ROCKY GROUND and stony slopes, not on soft sand and not on the shore.
 *  - It forks dichotomously: the trunk splits in two, then each half splits again, which is why
 *    the crown reads as a candelabra rather than a canopy.
 *  - It is SLOW. A tall one is centuries old, so height genuinely means age — hence the operator's
 *    "some bigger, some small".
 *  - The San hollowed its branches to make quivers for arrows. That is the name.
 *  - It is a PROTECTED species in South Africa. Here that is a mechanic, not a decoration: these
 *    are excluded from the clearing that construction does to ordinary foliage.
 *
 * They are deliberately RARE. A quiver tree is a landmark you navigate by, and scattering
 * thousands of them would make it wallpaper.
 */
import type { ClearRect } from "./foliageLogic";

export const LOT_SIZE = 4;

/** One placed tree. `age` in [0,1] drives height, trunk taper and crown count. */
export interface QuiverTree {
  readonly x: number;
  readonly y: number;
  readonly wx: number;
  readonly wy: number;
  readonly wz: number;
  readonly age: number;
  readonly yaw: number;
}

// Biome ids, kept local so this module does not depend on the terrain enum's import shape.
const BIOME_OCEAN = 0;
const BIOME_SHALLOWS = 1;
const BIOME_BEACH = 2;
const BIOME_PLAINS = 3;
const BIOME_HIGHLAND = 5;
const BIOME_MOUNTAIN = 6;

/**
 * One tree per this many cells, on eligible ground. Tuned so a 608-wide world carries a few
 * hundred rather than a few thousand: enough that a ridge line reads as a stand of kokerbome,
 * few enough that each one is still a landmark.
 */
const RARITY = 900;

export function calculateQuiverTrees(
  terrain: {
    size: number;
    biome: ArrayLike<number>;
    elev: ArrayLike<number>;
    water: ArrayLike<number>;
    worldY: (x: number, y: number) => number;
  },
  seaLevel: number,
  clearRects: ClearRect[] = [],
): QuiverTree[] {
  const N = terrain.size;
  /**
   * A murmur3-style finalizer, NOT the plain `(n * 2654435761) >>> 0` used elsewhere in the render
   * layer. That one is fine for "jitter this position a bit", but it correlates badly on strided
   * inputs, and this function samples a rare event (1 in ~900) over cells whose indices are highly
   * structured. Measured: with the weak hash, seed 314 produced ZERO trees from ~10,000 eligible
   * cells, where ~11 were expected — a run of that length has probability around 1e-5, so it was
   * the hash, not luck. A world whose signature tree can vanish entirely is not acceptable.
   */
  const hash = (n: number) => {
    let h = n >>> 0;
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b) >>> 0;
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35) >>> 0;
    // `>>> 0` on the LAST xor too: JS bitwise operators return a SIGNED int32, so without it
    // roughly half of these come back negative. Measured, that produced 18,799 trees on seed 4242
    // instead of ~42 (a negative value trivially passes the rarity gate) and capped every height
    // at 3.9 m because `age = a * a` of a negative is small.
    h = (h ^ (h >>> 16)) >>> 0;
    return h / 4294967296;
  };

  // NOTE: clearRects are honoured for SITING only — a tree is never placed inside a footprint that
  // already exists. Once placed, a quiver tree is not removed by later construction; that is what
  // "protected" means here, and it is why this list is consulted at placement time rather than
  // used to filter the result.
  const blocked = new Set<number>();
  for (const r of clearRects) {
    for (let y = r.y0; y <= r.y1; y++)
      for (let x = r.x0; x <= r.x1; x++)
        if (x >= 0 && y >= 0 && x < N && y < N) blocked.add(y * N + x);
  }

  const out: QuiverTree[] = [];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      if (blocked.has(i)) continue;
      if (terrain.elev[i]! < seaLevel || terrain.water[i]) continue;

      // Rocky ground only. Explicitly NOT beach: a kokerboom on the tideline would be wrong, and
      // spec 140 already treats beach as its own thing.
      const b = terrain.biome[i]!;
      if (
        b === BIOME_OCEAN ||
        b === BIOME_SHALLOWS ||
        b === BIOME_BEACH ||
        b === BIOME_PLAINS
      )
        continue;
      if (b !== BIOME_HIGHLAND && b !== BIOME_MOUNTAIN) continue;

      const h = hash(i * 31 + 7);
      if (h * RARITY >= 1) continue;

      // Age is the whole character of the species: a tall one is centuries old. Biased towards
      // young so an old giant is genuinely uncommon.
      const a = hash(i * 17 + 3);
      const age = a * a;

      const jx = x + (hash(i * 13 + 1) - 0.5) * 0.6;
      const jy = y + (hash(i * 19 + 5) - 0.5) * 0.6;
      if (jx < 0 || jy < 0 || jx >= N - 1 || jy >= N - 1) continue;

      out.push({
        x,
        y,
        wx: (jx - N / 2) * LOT_SIZE,
        wy: terrain.worldY(Math.round(jx), Math.round(jy)),
        wz: (jy - N / 2) * LOT_SIZE,
        age,
        yaw: hash(i * 23 + 11) * Math.PI * 2,
      });
    }
  }
  return out;
}

/** Height in world units for an age in [0,1]. A mature kokerboom is ~7-9 m; young ones are stubs. */
export function quiverTreeHeight(age: number): number {
  return 2.2 + age * 6.8;
}
