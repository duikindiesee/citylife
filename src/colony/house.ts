// A unique, AI-designed house per settler. Deterministic from the settler's KOOKER id, so the
// same card always regenerates the same home ("regenerate & continue"). The procedural spec is
// the plan; the renderer turns it into a one-off 3D house. (Generative meshes can swap in later.)
import { RNG } from "../engine/rng";

export type RoofType = "gable" | "hip" | "flat" | "pyramid";

export interface HouseSpec {
  seed: number;
  w: number;
  d: number;
  floors: number;
  storeyH: number;
  roof: RoofType;
  roofPitch: number;
  wallColor: number;
  roofColor: number;
  trimColor: number;
  chimney: boolean;
  porch: boolean;
  wing: boolean;
  garden: number;
  character: string;
}

const WALLS = [
  0xe6cda2, 0xd8b48a, 0xcdbf9e, 0xc8d0b0, 0xd9c2a3, 0xe0d4c0, 0xb9c4cf,
  0xd6b8a0,
];
const ROOFS = [
  0xb24a3a, 0x8a5a3c, 0x5a6b7a, 0x3f5a4a, 0x7a4a5a, 0x44444c, 0x9a6b3b,
];
const CHARS = [
  "cosy",
  "grand",
  "quirky",
  "modern",
  "rustic",
  "tidy",
  "sprawling",
  "compact",
  "whimsical",
  "stately",
];

export function designHouse(seed: number): HouseSpec {
  const rng = new RNG((seed * 2654435761 + 12345) >>> 0);
  const floors = rng.pick([1, 1, 1, 2, 2, 3]);
  const roof = rng.pick<RoofType>(["gable", "gable", "hip", "pyramid", "flat"]);
  return {
    seed,
    w: rng.range(0.72, 1.12),
    d: rng.range(0.72, 1.12),
    floors,
    storeyH: rng.range(0.5, 0.78),
    roof,
    roofPitch: roof === "flat" ? 0 : rng.range(0.35, 0.85),
    wallColor: rng.pick(WALLS),
    roofColor: rng.pick(ROOFS),
    trimColor: 0xf2efe6,
    chimney: rng.chance(0.55),
    porch: rng.chance(0.4),
    wing: rng.chance(0.4),
    garden: rng.range(0.2, 1),
    character: rng.pick(CHARS),
  };
}
