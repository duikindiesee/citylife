// Spec 096 Slice C — the SOCKET / PART model (mesh-composition path). The car (carSpec/carMesh) is a
// THREE group; a part mounts on a SOCKET at a fixed anchor and is BOTH visible AND a deterministic stat
// change. This file is the PURE data model + fitment + stat derivation (no THREE, no rng), so it is
// fully node-testable; carMesh reads the geom/anchor to render mounted parts (a following slice).
//
// Street Rod flavour: bolt a four-barrel or a blower onto the engine, headers on the exhaust, slicks on
// the wheels, a ducktail on the tail — each shifts topSpeed / acceleration / grip / braking, or is a
// pure cosmetic (empty deltas, same socket + render path). The race reads deriveStats() for handling.
import type { CarSpec, CarStatVector } from "./carSpec";
import { STOCK_STATS } from "./carSpec";

/** A mount point on the car. One part per socket. ("body" is a whole-car body mod, e.g. a roof chop —
 *  it reshapes the car instead of bolting on a child mesh, like the wheels socket reshapes the tyres.) */
export type CarSocket =
  | "engine"
  | "exhaust"
  | "wheels"
  | "spoiler"
  | "hood"
  | "body";

/** The catalog of bolt-on parts. */
export type CarPartKind =
  | "street_tyres"
  | "slicks"
  | "fourbarrel_carb"
  | "blower"
  | "headers"
  | "chrome_pipes"
  | "ducktail_spoiler"
  | "hood_scoop"
  | "roof_chop";

export interface CarPartDef {
  kind: CarPartKind;
  label: string;
  socket: CarSocket;
  category: "performance" | "cosmetic";
  /** Additive 0..1 stat deltas (clamped after summing). {} for a pure cosmetic. */
  statDeltas: Partial<CarStatVector>;
  /** Where the part mesh attaches on the car (car-local units); read by carMesh in a following slice. */
  anchor: { x: number; y: number; z: number };
  /** A THREE-free mesh descriptor so carParts stays pure and node-testable. */
  geom: { shape: "box" | "cyl"; size: [number, number, number]; color: number };
  /** Price in city coin (KCO) for the shop slice (D). */
  cost: number;
}

export const CAR_PARTS: Record<CarPartKind, CarPartDef> = {
  street_tyres: { kind: "street_tyres", label: "Street tyres", socket: "wheels", category: "cosmetic", statDeltas: {}, anchor: { x: 0, y: 0.12, z: 0 }, geom: { shape: "cyl", size: [0.12, 0.12, 0.09], color: 0x1a1c20 }, cost: 0 },
  slicks: { kind: "slicks", label: "Drag slicks", socket: "wheels", category: "performance", statDeltas: { grip: 0.25, acceleration: 0.1, topSpeed: -0.05 }, anchor: { x: 0, y: 0.13, z: 0 }, geom: { shape: "cyl", size: [0.15, 0.15, 0.12], color: 0x111317 }, cost: 180 },
  fourbarrel_carb: { kind: "fourbarrel_carb", label: "Four-barrel carb", socket: "engine", category: "performance", statDeltas: { acceleration: 0.15, topSpeed: 0.1 }, anchor: { x: 0.18, y: 0.42, z: 0 }, geom: { shape: "box", size: [0.12, 0.1, 0.12], color: 0x8a8f98 }, cost: 240 },
  blower: { kind: "blower", label: "Supercharger blower", socket: "engine", category: "performance", statDeltas: { topSpeed: 0.2, acceleration: 0.15, grip: -0.1 }, anchor: { x: 0.18, y: 0.5, z: 0 }, geom: { shape: "box", size: [0.18, 0.16, 0.2], color: 0x3a3f47 }, cost: 460 },
  headers: { kind: "headers", label: "Tuned headers", socket: "exhaust", category: "performance", statDeltas: { topSpeed: 0.1, acceleration: 0.05 }, anchor: { x: -0.45, y: 0.16, z: 0.18 }, geom: { shape: "cyl", size: [0.04, 0.04, 0.3], color: 0xb8702f }, cost: 200 },
  chrome_pipes: { kind: "chrome_pipes", label: "Chrome side pipes", socket: "exhaust", category: "cosmetic", statDeltas: {}, anchor: { x: 0, y: 0.16, z: 0.24 }, geom: { shape: "cyl", size: [0.04, 0.04, 0.6], color: 0xd6d9de }, cost: 120 },
  ducktail_spoiler: { kind: "ducktail_spoiler", label: "Ducktail spoiler", socket: "spoiler", category: "performance", statDeltas: { grip: 0.12 }, anchor: { x: -0.46, y: 0.42, z: 0 }, geom: { shape: "box", size: [0.12, 0.05, 0.42], color: 0x202329 }, cost: 160 },
  hood_scoop: { kind: "hood_scoop", label: "Hood scoop", socket: "hood", category: "cosmetic", statDeltas: { topSpeed: 0.03 }, anchor: { x: 0.18, y: 0.39, z: 0 }, geom: { shape: "box", size: [0.18, 0.08, 0.18], color: 0x14161a }, cost: 90 },
  // a "body" mod reshapes the car (carMesh lowers the cabin) rather than bolting on a child mesh; the
  // chop sheds weight + drag for a little more accel and grip. anchor/geom are nominal (never rendered).
  roof_chop: { kind: "roof_chop", label: "Roof chop", socket: "body", category: "performance", statDeltas: { acceleration: 0.06, grip: 0.04 }, anchor: { x: -0.02, y: 0.4, z: 0 }, geom: { shape: "box", size: [0.5, 0.16, 0.4], color: 0x000000 }, cost: 280 },
};

/** Does a part kind fit a given socket? Pure, total. */
export function partFits(socket: CarSocket, kind: string): boolean {
  const def = CAR_PARTS[kind as CarPartKind];
  return !!def && def.socket === socket;
}

/** Screen a raw part list to known kinds, ONE per socket (first wins). Deterministic, order-preserving. */
export function validCarParts(parts: readonly string[] | undefined): CarPartKind[] {
  const out: CarPartKind[] = [];
  const usedSocket = new Set<CarSocket>();
  for (const p of parts ?? []) {
    const def = CAR_PARTS[p as CarPartKind];
    if (!def || usedSocket.has(def.socket)) continue;
    usedSocket.add(def.socket);
    out.push(def.kind);
  }
  return out;
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);
// Round to 6 dp so the result is genuinely order-independent (float addition is not associative) and
// the stored/compared values stay clean and deterministic.
const r6 = (n: number): number => Math.round(n * 1e6) / 1e6;

/** The car's EFFECTIVE stats: the base (spec.stats, stock = 0.5) plus every mounted part's deltas,
 *  clamped to 0..1. Order-independent (a sum) and deterministic — the race reads this for handling. */
export function deriveStats(spec: CarSpec): CarStatVector {
  const base = spec?.stats ?? STOCK_STATS;
  const out: CarStatVector = {
    topSpeed: base.topSpeed,
    acceleration: base.acceleration,
    grip: base.grip,
    braking: base.braking,
  };
  for (const kind of validCarParts(spec?.parts)) {
    const d = CAR_PARTS[kind].statDeltas;
    out.topSpeed += d.topSpeed ?? 0;
    out.acceleration += d.acceleration ?? 0;
    out.grip += d.grip ?? 0;
    out.braking += d.braking ?? 0;
  }
  return {
    topSpeed: r6(clamp01(out.topSpeed)),
    acceleration: r6(clamp01(out.acceleration)),
    grip: r6(clamp01(out.grip)),
    braking: r6(clamp01(out.braking)),
  };
}
