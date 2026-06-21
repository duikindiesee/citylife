// Spec 077 — the house BLUEPRINT DSL. A compact single-line text format a Hermes bot can write, edit
// and self-inspect, parsed to a typed ParsedBlueprint and serialised back losslessly. Pure and fully
// deterministic (no wall-clock, no randomness): the same script always describes the same house. This
// is P0 — parse, serialise, validate. The compiler (P1, houseBuilder.ts) turns a ParsedBlueprint into
// the 4x4x4 micro-occupancy grid.
//
// Grammar v1 (a single line, whitespace-separated tokens):
//   house{w:<int> d:<int> wallH:<int> door:<n|s|e|w>} room{kind:<living|bedroom|garage|patio|pool> x:<int> y:<int> w:<int> d:<int> win:<0|1>} ...
// Example (a 6x5 home: living, bedroom and patio, door facing the street to the south):
//   house{w:6 d:5 wallH:2 door:s} room{kind:living x:0 y:0 w:4 d:3 win:1} room{kind:bedroom x:4 y:0 w:2 d:3 win:1} room{kind:patio x:0 y:3 w:6 d:2 win:0}
import type { DoorDir } from "./voxelHouse";
import { FURNITURE_KINDS, type FurnitureKind } from "./furniture";

export type BlueprintScript = string;
export type RoomKind = "living" | "bedroom" | "garage" | "patio" | "pool";
export const ROOM_KINDS: readonly RoomKind[] = [
  "living",
  "bedroom",
  "garage",
  "patio",
  "pool",
];
const DOOR_DIRS: readonly DoorDir[] = ["n", "s", "e", "w"];

export interface Room {
  kind: RoomKind;
  x: number;
  y: number;
  w: number;
  d: number;
  win: boolean;
}
/** A piece of authored furniture placed inside the house (spec 088). x/y is the blueprint cell it sits
 *  in (scaled onto the plot like rooms); rot is a quarter-turn clockwise (0..3). Ground floor for now. */
export interface FurnitureItem {
  kind: FurnitureKind;
  x: number;
  y: number;
  rot: number;
}
/** The most furniture a single house may carry — bounds a bot-authored script and keeps the editor sane. */
export const FURNITURE_ITEM_CAP = 48;
export interface ParsedBlueprint {
  w: number;
  d: number;
  wallH: number;
  doorDir: DoorDir;
  rooms: Room[];
  items: FurnitureItem[];
}
export interface ValidationResult {
  ok: boolean;
  errors: string[];
  estMaterials: number;
}

/** Parse "key:value key:value" inside a brace group into a field map. */
function parseFields(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tok of body.trim().split(/\s+/).filter(Boolean)) {
    const i = tok.indexOf(":");
    if (i <= 0)
      throw new Error(
        `blueprint: bad field ${JSON.stringify(tok)} (expected key:value)`,
      );
    out[tok.slice(0, i)] = tok.slice(i + 1);
  }
  return out;
}

function intField(
  fields: Record<string, string>,
  key: string,
  ctx: string,
): number {
  const raw = fields[key];
  if (raw === undefined) throw new Error(`blueprint: ${ctx} is missing ${key}`);
  const n = Number(raw);
  if (!Number.isInteger(n))
    throw new Error(
      `blueprint: ${ctx} ${key} must be an integer, got ${JSON.stringify(raw)}`,
    );
  return n;
}

/** Like intField but returns a default when the key is absent (the value, if present, must be an int). */
function optIntField(
  fields: Record<string, string>,
  key: string,
  ctx: string,
  fallback: number,
): number {
  return fields[key] === undefined ? fallback : intField(fields, key, ctx);
}

/** Parse a blueprint script into a typed ParsedBlueprint. Throws a descriptive Error on malformed input. */
export function parseBlueprint(script: BlueprintScript): ParsedBlueprint {
  if (typeof script !== "string")
    throw new Error("blueprint: script must be a string");
  const houseM = script.match(/house\{([^}]*)\}/);
  if (!houseM) throw new Error("blueprint: missing house header");
  const hf = parseFields(houseM[1]!);
  const doorDir = hf["door"] as DoorDir;
  if (!DOOR_DIRS.includes(doorDir))
    throw new Error(
      `blueprint: house door must be one of n s e w, got ${JSON.stringify(hf["door"])}`,
    );
  const w = intField(hf, "w", "house");
  const d = intField(hf, "d", "house");
  const wallH = intField(hf, "wallH", "house");
  const rooms: Room[] = [];
  const roomRe = /room\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = roomRe.exec(script)) !== null) {
    const rf = parseFields(m[1]!);
    const kind = rf["kind"] as RoomKind;
    if (!ROOM_KINDS.includes(kind))
      throw new Error(
        `blueprint: room kind must be one of ${ROOM_KINDS.join(" ")}, got ${JSON.stringify(rf["kind"])}`,
      );
    rooms.push({
      kind,
      x: intField(rf, "x", "room"),
      y: intField(rf, "y", "room"),
      w: intField(rf, "w", "room"),
      d: intField(rf, "d", "room"),
      win: intField(rf, "win", "room") !== 0,
    });
  }
  const items: FurnitureItem[] = [];
  const itemRe = /item\{([^}]*)\}/g;
  while ((m = itemRe.exec(script)) !== null) {
    const f = parseFields(m[1]!);
    const kind = f["kind"] as FurnitureKind;
    if (!FURNITURE_KINDS.includes(kind))
      throw new Error(
        `blueprint: furniture kind must be one of ${FURNITURE_KINDS.join(" ")}, got ${JSON.stringify(f["kind"])}`,
      );
    items.push({
      kind,
      x: intField(f, "x", "item"),
      y: intField(f, "y", "item"),
      rot: optIntField(f, "rot", "item", 0),
    });
  }
  return { w, d, wallH, doorDir, rooms, items };
}

/** Serialise a ParsedBlueprint back to the canonical single-line script (lossless round-trip). */
export function blueprintToScript(p: ParsedBlueprint): BlueprintScript {
  const head = `house{w:${p.w} d:${p.d} wallH:${p.wallH} door:${p.doorDir}}`;
  const rooms = p.rooms.map(
    (r) =>
      `room{kind:${r.kind} x:${r.x} y:${r.y} w:${r.w} d:${r.d} win:${r.win ? 1 : 0}}`,
  );
  const items = (p.items ?? []).map(
    (f) => `item{kind:${f.kind} x:${f.x} y:${f.y} rot:${f.rot}}`,
  );
  return [head, ...rooms, ...items].join(" ");
}

/** Does any room touch the house edge the door faces, so the house can actually be entered? */
function roomTouchesDoorEdge(p: ParsedBlueprint): boolean {
  return p.rooms.some((r) => {
    switch (p.doorDir) {
      case "n":
        return r.y === 0;
      case "s":
        return r.y + r.d === p.d;
      case "w":
        return r.x === 0;
      case "e":
        return r.x + r.w === p.w;
    }
  });
}

/** A deterministic abstract material estimate for the design: floor plus roof plus the outer wall ring
 *  plus interior dividers, all scaled by wall height. The per-voxel cost is refined at build (P5); this
 *  is the gate the builder uses to refuse a design the colony cannot afford. */
function estimateMaterials(p: ParsedBlueprint): number {
  const floorAndRoof = p.w * p.d * 2;
  const outerWalls = 2 * (p.w + p.d) * p.wallH;
  let dividers = 0;
  for (const r of p.rooms) dividers += (r.w + r.d) * p.wallH;
  return Math.ceil(floorAndRoof + outerWalls + dividers);
}

/** Validate a blueprint without throwing: parse errors, out-of-bounds rooms (nothing escapes the plot),
 *  non-positive dimensions, a missing room, and an unreachable door. Returns ok plus the error list plus
 *  the deterministic material estimate. */
export function validateBlueprint(script: BlueprintScript): ValidationResult {
  let p: ParsedBlueprint;
  try {
    p = parseBlueprint(script);
  } catch (e) {
    return {
      ok: false,
      errors: [e instanceof Error ? e.message : String(e)],
      estMaterials: 0,
    };
  }
  const errors: string[] = [];
  if (p.w <= 0 || p.d <= 0) errors.push("house w and d must be positive");
  if (p.wallH <= 0) errors.push("house wallH must be positive");
  // Spec 084 S4 — upper caps. The compiler scales the design onto the house zone and allocates a
  // micro-grid from these numbers, so an uncapped script from a bot's inference loop could request
  // an arbitrarily large allocation. 24 cells / 3 storeys / 16 rooms comfortably covers the GRAND
  // estate tier while keeping the grid bounded.
  if (p.w > 24 || p.d > 24) errors.push("house w and d are capped at 24 cells");
  if (p.wallH > 3) errors.push("house wallH is capped at 3 storeys");
  if (p.rooms.length > 16) errors.push("a house is capped at 16 rooms");
  p.rooms.forEach((r, i) => {
    if (r.w <= 0 || r.d <= 0)
      errors.push(`room ${i} (${r.kind}) must have positive w and d`);
    if (r.x < 0 || r.y < 0 || r.x + r.w > p.w || r.y + r.d > p.d)
      errors.push(`room ${i} (${r.kind}) escapes the house bounds`);
  });
  if (p.items.length > FURNITURE_ITEM_CAP)
    errors.push(`a house is capped at ${FURNITURE_ITEM_CAP} furniture items`);
  p.items.forEach((f, i) => {
    if (f.x < 0 || f.y < 0 || f.x >= p.w || f.y >= p.d)
      errors.push(`furniture ${i} (${f.kind}) sits outside the house`);
    if (f.rot < 0 || f.rot > 3)
      errors.push(`furniture ${i} (${f.kind}) rot must be 0..3`);
  });
  if (p.rooms.length === 0) errors.push("a house needs at least one room");
  else if (!roomTouchesDoorEdge(p))
    errors.push(
      `no room reaches the ${p.doorDir} door edge (door not reachable)`,
    );
  return {
    ok: errors.length === 0,
    errors,
    estMaterials: estimateMaterials(p),
  };
}
