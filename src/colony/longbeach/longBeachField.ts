// Spec 169 §1 — WEST COAST LONG BEACH: the coastal strip, as pure data (WORLD.LONGBEACH.1 slice 1).
//
// This is a NEW REGION, not a rework: the founding island's radial mask has no west, its biome layout
// is pinned by three seed-locked suites, and spec 152 declares its addresses immutable. Long Beach is
// generated beside it, in its own coordinate frame, and NOTHING here imports or touches the island's
// terrain, plan or state. On this slice the field's only consumers are its own tests and the Strand
// Run authoring — renderer/world mounting is slice 1b.
//
// THE SHAPE (spec 169 §1.1): a west coast is a DIRECTION, not a shoreline. The sea owns the west edge,
// the beach runs the whole north–south length, and the land climbs eastward — beach → sand flat →
// scrub hollow → dune shoulder → rock wall. Face west anywhere and you see water.
//
// DETERMINISM AND EXPANSION (spec 169 §1.3): every sample is a pure function of (lbSeed, x, yGlobal),
// noise included, so generating reach k never resamples reach k−1 — building 2 reaches reproduces
// reach 1's rows byte-identically (pinned in tests). LB_WIDTH is CONSTITUTIONAL: idx = y*LB_WIDTH + x
// must stay stable forever, so it never changes.
//
// DELIBERATE SLICE-1 DEVIATION from spec §6 item 1: the rectangular `Terrain` class refactor is NOT
// done here. The field is its own plain data structure, because on this slice nothing downstream
// needs a `Terrain` instance — and the refactor (every n×n loop in terrain.ts) is the widest-blast-
// radius item in the spec, deferred until the renderer mounting slice actually needs it.
//
// THE SEED-314 LESSON (spec 169 §0): the island classifies biome by a moisture split, and one seed in
// five produces a "desert" with NO dune flat at all. Long Beach classifies by COAST DISTANCE BANDS
// plus noise, so Plains — the buildable sand flat — is guaranteed present by construction on every
// seed. The tests assert it on seed 314 specifically.

/** East–west extent in cells. CONSTITUTIONAL — never change (idx = y*LB_WIDTH + x is forever). */
export const LB_WIDTH = 1024;
/** One expansion unit ("reach"), appended at the SOUTHERN end. */
export const LB_REACH = 512;
/** Mean shoreline x and its meander amplitude (±cells), 1-D in y so reaches never shift the coast. */
export const LB_COAST_MEAN_X = 180;
export const LB_COAST_AMP = 48;
/** Beach band depth east of the waterline (cells). Roads are banned on Beach (spec 140). */
export const LB_BEACH_CELLS = 14;
/** Band edges east of the coast (cells from shoreline): sand flat, rising mix, dune shoulder, rock. */
export const LB_PLAINS_END = 250;
export const LB_MIX_END = 700;
/** The dune shoulder and the rock wall are pinned to ABSOLUTE x, not coast distance: the wall is a
 *  MAP feature (the island-mask replacement on the east, spec 169 §1.2) and must span every row.
 *  Measured before this fix: with a coast-relative 880 the wall needed x up to coast+880 ≈ 1108,
 *  beyond LB_WIDTH on far-coast rows, so whole rows had NO Mountain and the backstop had holes. */
export const LB_HIGHLAND_START_X = 820;
export const LB_MOUNTAIN_START_X = 940;
/** Normalised sea level, rhyming with the island's 0.34; worldY treats elev-below-sea as 0. */
export const LB_SEA_LEVEL = 0.34;
/** Height scale, world units per unit of normalised elevation above sea (island uses 54). */
export const LB_HEIGHT_SCALE = 54;
/** Dry-wash arroyos per reach — water-flagged channels running west, so bridges span them (§1.4). */
export const LB_ARROYOS_PER_REACH = 2;

/** Biome ids — the ISLAND'S enum values, reused not renumbered (spec 168: ids are load-bearing). */
export const LB_BIOME = {
  Ocean: 0,
  Shallows: 1,
  Beach: 2,
  Plains: 3,
  Forest: 4,
  Highland: 5,
  Mountain: 6,
} as const;

export interface LongBeachField {
  readonly width: number;
  readonly height: number;
  readonly seed: number;
  readonly reaches: number;
  /** Normalised elevation [0,1]; below LB_SEA_LEVEL is under water. Row-major, idx = y*width + x. */
  readonly elev: Float32Array;
  /** 1 = water (sea AND dry-wash arroyos — the flag is what makes bridges span them). */
  readonly water: Uint8Array;
  readonly biome: Uint8Array;
  /** Shoreline x for a given global row — exported so the Strand Run can follow the coast. */
  readonly coastlineAt: (yGlobal: number) => number;
  readonly worldYAt: (x: number, y: number) => number;
  readonly idx: (x: number, y: number) => number;
  readonly inBounds: (x: number, y: number) => boolean;
}

/** murmur3-style finalizer over (seed, x, y) → [0,1). The trailing >>>0 is load-bearing: JS bitwise
 *  ops return SIGNED int32 (the 18,799-quiver-trees lesson, quiverTreeLogic.ts). */
function hash3(seed: number, x: number, y: number): number {
  let h =
    (Math.imul(seed, 0x9e3779b1) ^
      Math.imul(x, 0x85ebca6b) ^
      Math.imul(y, 0xc2b2ae35)) >>>
    0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Value noise on a lattice of the given wavelength, bilinear with smoothstep. Pure in all args. */
function valueNoise2(
  seed: number,
  x: number,
  y: number,
  wavelength: number,
): number {
  const gx = x / wavelength;
  const gy = y / wavelength;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const tx = smooth(gx - x0);
  const ty = smooth(gy - y0);
  const a = hash3(seed, x0, y0);
  const b = hash3(seed, x0 + 1, y0);
  const c = hash3(seed, x0, y0 + 1);
  const d = hash3(seed, x0 + 1, y0 + 1);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

/** Three octaves, normalised to [0,1]. */
function fbm(seed: number, x: number, y: number, wavelength: number): number {
  const n =
    valueNoise2(seed, x, y, wavelength) * 0.6 +
    valueNoise2(seed ^ 0x51ab, x, y, wavelength / 2.3) * 0.28 +
    valueNoise2(seed ^ 0x9c37, x, y, wavelength / 5.1) * 0.12;
  return n;
}

/** The shoreline's x for a global row. 1-D IN Y ONLY (spec §1.3 rule 3): a later reach can never
 *  move an earlier reach's coast, and the whole west edge stays ocean because
 *  LB_COAST_MEAN_X − LB_COAST_AMP > 0. Long wavelength → class-A sweepers, not wiggle (§3.1). */
export function coastlineX(seed: number, yGlobal: number): number {
  const n = fbm(seed ^ 0xc0a57, 0, yGlobal, 340);
  return LB_COAST_MEAN_X + (n * 2 - 1) * LB_COAST_AMP;
}

/** Dry-wash arroyo centre rows for a reach, seeded and stable. Washes meander ±10 cells in y as they
 *  run west, and stop short of the dune shoulder. */
export function arroyoRows(seed: number, reach: number): number[] {
  const rows: number[] = [];
  for (let i = 0; i < LB_ARROYOS_PER_REACH; i++) {
    // Keep washes away from the reach edges so a route entering/leaving a reach never starts on one.
    const t = hash3(seed ^ 0xa4407, reach, i * 71 + 13);
    rows.push(reach * LB_REACH + 80 + Math.floor(t * (LB_REACH - 160)));
  }
  return rows;
}

/** Build the strip. `reaches` appends south; every cell is a pure function of (seed, x, yGlobal). */
export function buildLongBeachField(seed: number, reaches = 1): LongBeachField {
  const width = LB_WIDTH;
  const height = LB_REACH * reaches;
  const size = width * height;
  const elev = new Float32Array(size);
  const water = new Uint8Array(size);
  const biome = new Uint8Array(size);

  // Precompute wash centres for every reach in range (pure per (seed, reach)).
  const washes: number[] = [];
  for (let r = 0; r < reaches; r++) washes.push(...arroyoRows(seed, r));

  for (let y = 0; y < height; y++) {
    const coast = coastlineX(seed, y);
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const d = x - coast; // cells east of the shoreline (negative = out to sea)
      const rough = fbm(seed ^ 0x7e11, x, y, 96); // local relief, all bands

      let e: number;
      let b: number;
      let w = 0;
      if (d < -24) {
        e = LB_SEA_LEVEL - 0.12 - Math.min(0.15, (-d - 24) * 0.002);
        b = LB_BIOME.Ocean;
        w = 1;
      } else if (d < 0) {
        e = LB_SEA_LEVEL - 0.02 - (-d / 24) * 0.1;
        b = LB_BIOME.Shallows;
        w = 1;
      } else if (d < LB_BEACH_CELLS) {
        e = LB_SEA_LEVEL + 0.005 + (d / LB_BEACH_CELLS) * 0.02;
        b = LB_BIOME.Beach;
      } else if (d < LB_PLAINS_END) {
        // The sand flat — the buildable heart, GUARANTEED (the seed-314 lesson). Scrub hollows
        // (Forest) pocket the flat where moisture noise gathers: kokerboom country's damp cousins.
        e = LB_SEA_LEVEL + 0.03 + (d / LB_PLAINS_END) * 0.05 + rough * 0.02;
        const moist = fbm(seed ^ 0x3f00d, x, y, 150);
        b = moist > 0.74 ? LB_BIOME.Forest : LB_BIOME.Plains;
      } else if (x < LB_HIGHLAND_START_X && d < LB_MIX_END) {
        // Rising ground: Plains/Highland mix by noise (neighbourhood terraces, spec §1.4). Ends at
        // the ABSOLUTE shoulder line or the coast-relative mix limit, whichever comes first.
        const t = (d - LB_PLAINS_END) / (LB_MIX_END - LB_PLAINS_END);
        e = LB_SEA_LEVEL + 0.08 + t * 0.18 + rough * 0.05;
        b =
          fbm(seed ^ 0x510be, x, y, 180) > 0.62 - t * 0.25
            ? LB_BIOME.Highland
            : LB_BIOME.Plains;
      } else if (x < LB_MOUNTAIN_START_X) {
        const t = Math.max(
          0,
          (x - LB_HIGHLAND_START_X) /
            (LB_MOUNTAIN_START_X - LB_HIGHLAND_START_X),
        );
        e = LB_SEA_LEVEL + 0.26 + t * 0.2 + rough * 0.08;
        b = LB_BIOME.Highland;
      } else {
        // The rock wall — the visual backstop and the island-mask replacement on the east (§1.2).
        const t = Math.min(
          1,
          (x - LB_MOUNTAIN_START_X) / (width - LB_MOUNTAIN_START_X),
        );
        e = LB_SEA_LEVEL + 0.46 + t * 0.4 + rough * 0.1;
        b = LB_BIOME.Mountain;
      }

      elev[i] = e;
      water[i] = w;
      biome[i] = b;
    }
  }

  // Dry-wash arroyos: westward channels, water-flagged so bridges span them (§1.4). Carved AFTER the
  // bands so the flag wins; they run from the flat down to the shallows and never into the shoulder.
  for (const washBase of washes) {
    for (let x = 0; x < LB_MIX_END + 60; x++) {
      const meander = (fbm(seed ^ 0xa440, x, washBase, 130) * 2 - 1) * 10;
      const cy = Math.round(washBase + meander);
      for (let dy = -1; dy <= 1; dy++) {
        const y = cy + dy;
        if (y < 0 || y >= height) continue;
        const coast = coastlineX(seed, y);
        if (x <= coast - 24) continue; // open sea already
        const i = y * width + x;
        if (biome[i] === LB_BIOME.Mountain || biome[i] === LB_BIOME.Highland)
          continue;
        water[i] = 1;
        elev[i] = Math.min(elev[i]!, LB_SEA_LEVEL - 0.01);
      }
    }
  }

  return {
    width,
    height,
    seed,
    reaches,
    elev,
    water,
    biome,
    coastlineAt: (yGlobal: number) => coastlineX(seed, yGlobal),
    worldYAt: (x: number, y: number) => {
      const i = y * width + x;
      return Math.max(0, (elev[i]! - LB_SEA_LEVEL) * LB_HEIGHT_SCALE);
    },
    idx: (x: number, y: number) => y * width + x,
    inBounds: (x: number, y: number) =>
      x >= 0 && y >= 0 && x < width && y < height,
  };
}
