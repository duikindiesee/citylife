// Spec 077 P3 — PURE blueprint edit operations for the House Builder. Every control in the builder UI
// (and later every Playwright/bot action) maps to one of these functions: ParsedBlueprint in, a NEW
// ParsedBlueprint out, always clamped so the design stays inside the plot and never degenerate. Pure +
// deterministic (no DOM, no clock, no randomness), so the whole edit grammar is unit-testable in node
// and a bot driving the UI gets exactly the same semantics as a human clicking it.
import {
  FURNITURE_ITEM_CAP,
  type FurnitureItem,
  type ParsedBlueprint,
  type Room,
  type RoomKind,
} from "../blueprintScript";
import type { FurnitureKind } from "../furniture";
import type { DoorDir } from "../voxelHouse";

const DOOR_ORDER: readonly DoorDir[] = ["n", "e", "s", "w"];

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** The top storey index a design may use — the compiler clamps wallH to 1..3 storeys (spec 088 B). */
export function maxStorey(p: ParsedBlueprint): number {
  return clamp(Math.round(p.wallH), 1, 3) - 1;
}

/** A fresh starter design for a w x d plot: a living room across the front two-thirds and a bedroom
 *  beside it, door to the south — always valid, always fills the footprint. */
export function defaultDesign(w: number, d: number): ParsedBlueprint {
  const W = Math.max(3, Math.floor(w));
  const D = Math.max(3, Math.floor(d));
  const livingW = Math.max(2, Math.round(W * 0.65));
  return {
    w: W,
    d: D,
    wallH: 2,
    doorDir: "s",
    rooms: [
      { kind: "living", x: 0, y: 0, w: livingW, d: D, win: true },
      { kind: "bedroom", x: livingW, y: 0, w: W - livingW, d: D, win: true },
    ],
    items: [],
  };
}

/** Add a room of the given kind. It spawns as a small rect in the first spot where it stays in bounds
 *  (scanning row-major), so repeated adds tile predictably; the design may overlap other rooms — the
 *  validator + the human/bot resolve that by moving it. */
export function addRoom(
  p: ParsedBlueprint,
  kind: RoomKind,
  storey = 0,
): ParsedBlueprint {
  // Spec 084 S4 — on a big estate footprint a fresh 2x2 room reads as a closet; spawn 3x3 there.
  const size = Math.max(p.w, p.d) >= 12 ? 3 : 2;
  const rw = clamp(size, 1, p.w);
  const rd = clamp(size, 1, p.d);
  const z = clamp(Math.round(storey), 0, maxStorey(p));
  let x = 0,
    y = 0;
  // prefer a spot not on top of an existing room origin ON THE SAME STOREY (rooms stack across storeys)
  outer: for (let yy = 0; yy + rd <= p.d; yy++) {
    for (let xx = 0; xx + rw <= p.w; xx++) {
      if (!p.rooms.some((r) => r.x === xx && r.y === yy && (r.z ?? 0) === z)) {
        x = xx;
        y = yy;
        break outer;
      }
    }
  }
  const room: Room = {
    kind,
    x,
    y,
    w: rw,
    d: rd,
    win: kind !== "pool" && kind !== "patio",
  };
  if (z > 0) room.z = z;
  return { ...p, rooms: [...p.rooms, room] };
}

/** Move room i to a different storey, clamped to 0..maxStorey. z is dropped when it lands on the ground
 *  so the room serialises back to its bare single-level form. */
export function setRoomStorey(
  p: ParsedBlueprint,
  i: number,
  z: number,
): ParsedBlueprint {
  const r = p.rooms[i];
  if (!r) return p;
  const nz = clamp(Math.round(z), 0, maxStorey(p));
  const moved: Room = { ...r };
  if (nz > 0) moved.z = nz;
  else delete moved.z;
  return { ...p, rooms: p.rooms.map((q, k) => (k === i ? moved : q)) };
}

/** Raise/lower room i by one storey (dz = +1 up, -1 down), clamped to the design's storey range. */
export function moveRoomStorey(
  p: ParsedBlueprint,
  i: number,
  dz: number,
): ParsedBlueprint {
  const r = p.rooms[i];
  if (!r) return p;
  return setRoomStorey(p, i, (r.z ?? 0) + dz);
}

/** Remove room i (no-op when out of range). */
export function removeRoom(p: ParsedBlueprint, i: number): ParsedBlueprint {
  if (i < 0 || i >= p.rooms.length) return p;
  return { ...p, rooms: p.rooms.filter((_, k) => k !== i) };
}

/** Move room i by (dx, dy) cells, clamped so it never escapes the house bounds. */
export function moveRoom(
  p: ParsedBlueprint,
  i: number,
  dx: number,
  dy: number,
): ParsedBlueprint {
  const r = p.rooms[i];
  if (!r) return p;
  const moved: Room = {
    ...r,
    x: clamp(r.x + dx, 0, p.w - r.w),
    y: clamp(r.y + dy, 0, p.d - r.d),
  };
  return { ...p, rooms: p.rooms.map((q, k) => (k === i ? moved : q)) };
}

/** Resize room i by (dw, dd) cells, clamped to at least 1x1 and to the house bounds. */
export function resizeRoom(
  p: ParsedBlueprint,
  i: number,
  dw: number,
  dd: number,
): ParsedBlueprint {
  const r = p.rooms[i];
  if (!r) return p;
  const resized: Room = {
    ...r,
    w: clamp(r.w + dw, 1, p.w - r.x),
    d: clamp(r.d + dd, 1, p.d - r.y),
  };
  return { ...p, rooms: p.rooms.map((q, k) => (k === i ? resized : q)) };
}

/** Toggle windows on room i. */
export function toggleWin(p: ParsedBlueprint, i: number): ParsedBlueprint {
  const r = p.rooms[i];
  if (!r) return p;
  return {
    ...p,
    rooms: p.rooms.map((q, k) => (k === i ? { ...q, win: !q.win } : q)),
  };
}

/** Change room i's kind. */
export function setRoomKind(
  p: ParsedBlueprint,
  i: number,
  kind: RoomKind,
): ParsedBlueprint {
  const r = p.rooms[i];
  if (!r) return p;
  return { ...p, rooms: p.rooms.map((q, k) => (k === i ? { ...q, kind } : q)) };
}

/** Cycle the door to the next compass direction (n -> e -> s -> w -> n). */
export function cycleDoor(p: ParsedBlueprint): ParsedBlueprint {
  const i = DOOR_ORDER.indexOf(p.doorDir);
  return { ...p, doorDir: DOOR_ORDER[(i + 1) % DOOR_ORDER.length]! };
}

/** Set the wall height (storeys), clamped to the compiler's 1..3 range. Lowering the wall RE-HOMES any
 *  room or furniture stranded above the new top floor down onto it (dropping z on the ground), so the
 *  design always stays valid and Acceptable — a clamp-to-valid op a bot or a human can call blindly. */
export function setWallH(p: ParsedBlueprint, h: number): ParsedBlueprint {
  const wallH = clamp(Math.round(h), 1, 3);
  const top = wallH - 1; // the new top storey index
  const rehome = <T extends { z?: number }>(o: T): T => {
    if ((o.z ?? 0) <= top) return o;
    const c: T = { ...o };
    if (top > 0) c.z = top;
    else delete c.z;
    return c;
  };
  return {
    ...p,
    wallH,
    rooms: p.rooms.map(rehome),
    items: (p.items ?? []).map(rehome),
  };
}

// ── Furniture (spec 088) ──────────────────────────────────────────────────────
// Pure ops for placing authored furniture in the floor plan. Items live in blueprint-cell coordinates
// (the same grid as rooms), default rotation 0; the compiler scales and stamps them onto the plot.

/** Place a piece of furniture, centred-ish in the plot in the first reasonably free cell. Capped so a
 *  runaway placement loop can never blow past the validator's furniture cap. */
export function addItem(
  p: ParsedBlueprint,
  kind: FurnitureKind,
  storey = 0,
): ParsedBlueprint {
  const items = p.items ?? [];
  if (items.length >= FURNITURE_ITEM_CAP) return p;
  const z = clamp(Math.round(storey), 0, maxStorey(p));
  // Prefer a cell no other piece already occupies ON THE SAME STOREY, scanning row-major.
  let x = Math.floor(p.w / 2);
  let y = Math.floor(p.d / 2);
  outer: for (let yy = 0; yy < p.d; yy++) {
    for (let xx = 0; xx < p.w; xx++) {
      if (!items.some((f) => f.x === xx && f.y === yy && (f.z ?? 0) === z)) {
        x = xx;
        y = yy;
        break outer;
      }
    }
  }
  const item: FurnitureItem = { kind, x, y, rot: 0 };
  if (z > 0) item.z = z;
  return { ...p, items: [...items, item] };
}

/** Move furniture item i to a different storey, clamped to 0..maxStorey; z is dropped on the ground. */
export function setItemStorey(
  p: ParsedBlueprint,
  i: number,
  z: number,
): ParsedBlueprint {
  const items = p.items ?? [];
  const f = items[i];
  if (!f) return p;
  const nz = clamp(Math.round(z), 0, maxStorey(p));
  const moved: FurnitureItem = { ...f };
  if (nz > 0) moved.z = nz;
  else delete moved.z;
  return { ...p, items: items.map((q, k) => (k === i ? moved : q)) };
}

/** Raise/lower furniture item i by one storey (dz = +1 up, -1 down), clamped to the storey range. */
export function moveItemStorey(
  p: ParsedBlueprint,
  i: number,
  dz: number,
): ParsedBlueprint {
  const items = p.items ?? [];
  const f = items[i];
  if (!f) return p;
  return setItemStorey(p, i, (f.z ?? 0) + dz);
}

/** Remove furniture item i (no-op when out of range). */
export function removeItem(p: ParsedBlueprint, i: number): ParsedBlueprint {
  const items = p.items ?? [];
  if (i < 0 || i >= items.length) return p;
  return { ...p, items: items.filter((_, k) => k !== i) };
}

/** Move furniture item i by (dx, dy) cells, clamped to the house footprint. */
export function moveItem(
  p: ParsedBlueprint,
  i: number,
  dx: number,
  dy: number,
): ParsedBlueprint {
  const items = p.items ?? [];
  const f = items[i];
  if (!f) return p;
  const moved: FurnitureItem = {
    ...f,
    x: clamp(f.x + dx, 0, p.w - 1),
    y: clamp(f.y + dy, 0, p.d - 1),
  };
  return { ...p, items: items.map((q, k) => (k === i ? moved : q)) };
}

/** Rotate furniture item i a quarter-turn clockwise (0 -> 1 -> 2 -> 3 -> 0). */
export function rotateItem(p: ParsedBlueprint, i: number): ParsedBlueprint {
  const items = p.items ?? [];
  const f = items[i];
  if (!f) return p;
  const turned: FurnitureItem = { ...f, rot: (f.rot + 1) % 4 };
  return { ...p, items: items.map((q, k) => (k === i ? turned : q)) };
}
