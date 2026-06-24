// Spec 096 Slice A — the CAR data model. A player owns one car; its STATS drive race handling (the
// own-car rally, see PLAN-rally-owncar-friend) and its PAINT drives the mesh (carMesh.ts). Pure and
// serializable — no THREE here, no Math.random, no Date.now, so it is fully node-testable and
// deterministic. Later slices add mountable parts that DERIVE these stats; Slice A is the stock car.
import { isPublicSafe } from "../newcomers";

/** Normalised 0..1 performance stats. Race physics reads these (0.5 = stock). Later slices derive them
 *  from mounted parts; here they are a balanced stock car. */
export interface CarStatVector {
  topSpeed: number;
  acceleration: number;
  grip: number;
  braking: number;
}

/** A player's car: a stable id, a player-facing name, its stats, and a paint scheme (hex colours). */
export interface CarSpec {
  id: string;
  name: string;
  stats: CarStatVector;
  paint: { body: number; cabin: number; accent: number };
}

/** A balanced stock car — every stat mid-range. The default before any tuning (Slice C onward). */
export const STOCK_STATS: CarStatVector = {
  topSpeed: 0.5,
  acceleration: 0.5,
  grip: 0.5,
  braking: 0.5,
};

const BODY_PALETTE = [0xd64545, 0xe0a24d, 0x4d8be0, 0x4dbf73, 0xb84de0, 0xe0d24d];
const CABIN_PALETTE = [0x2a2d33, 0x3a3f47, 0x52341f, 0x1f3a52];
const ACCENT_PALETTE = [0xffd25a, 0xff6a55, 0xf4f4f0, 0x39d353];

const clamp01 = (n: unknown): number =>
  typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5;
const clampHex = (n: unknown): number =>
  typeof n === "number" && Number.isFinite(n)
    ? Math.max(0, Math.min(0xffffff, Math.floor(n)))
    : 0xcccccc;

/** Deterministic 32-bit string hash (no Math.random) used to vary the stock paint per player id. */
function hash32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Slugify for a stable id. */
function slug(s: string): string {
  const out = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return out.length > 0 ? out : "rod";
}

/** A deterministic default car for a player id: a stock car with a seeded paint so two players look
 *  different at a glance, with no randomness. */
export function defaultCarSpec(playerId: string): CarSpec {
  const h = hash32(playerId);
  return {
    id: `car:${slug(playerId)}`,
    name: "Stock Rod",
    stats: { ...STOCK_STATS },
    paint: {
      body: BODY_PALETTE[h % BODY_PALETTE.length]!,
      cabin: CABIN_PALETTE[(h >>> 3) % CABIN_PALETTE.length]!,
      accent: ACCENT_PALETTE[(h >>> 6) % ACCENT_PALETTE.length]!,
    },
  };
}

/** Validate + normalise a stored or loaded CarSpec: screen the name with isPublicSafe (so a custom
 *  label can never smuggle a brand word into the world), clamp every stat to 0..1 and every colour to a
 *  valid hex, and require a non-empty id. Returns null only when the object is unusable. Pure. */
export function safeCarSpec(e: unknown): CarSpec | null {
  if (!e || typeof e !== "object") return null;
  const o = e as {
    id?: unknown;
    name?: unknown;
    stats?: Partial<CarStatVector>;
    paint?: { body?: unknown; cabin?: unknown; accent?: unknown };
  };
  if (typeof o.id !== "string" || o.id.length === 0) return null;
  const rawName =
    typeof o.name === "string" ? o.name.replace(/\s+/g, " ").trim() : "";
  const name = rawName.length > 0 && isPublicSafe(rawName) ? rawName : "Stock Rod";
  const s = o.stats ?? {};
  const p = o.paint ?? {};
  return {
    id: o.id,
    name,
    stats: {
      topSpeed: clamp01(s.topSpeed),
      acceleration: clamp01(s.acceleration),
      grip: clamp01(s.grip),
      braking: clamp01(s.braking),
    },
    paint: {
      body: clampHex(p.body),
      cabin: clampHex(p.cabin),
      accent: clampHex(p.accent),
    },
  };
}
