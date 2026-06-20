// Spec 077 P3 — PURE blueprint edit operations for the House Builder. Every control in the builder UI
// (and later every Playwright/bot action) maps to one of these functions: ParsedBlueprint in, a NEW
// ParsedBlueprint out, always clamped so the design stays inside the plot and never degenerate. Pure +
// deterministic (no DOM, no clock, no randomness), so the whole edit grammar is unit-testable in node
// and a bot driving the UI gets exactly the same semantics as a human clicking it.
import type { ParsedBlueprint, Room, RoomKind } from "../blueprintScript";
import type { DoorDir } from "../voxelHouse";

const DOOR_ORDER: readonly DoorDir[] = ["n", "e", "s", "w"];

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
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
  };
}

/** Add a room of the given kind. It spawns as a small rect in the first spot where it stays in bounds
 *  (scanning row-major), so repeated adds tile predictably; the design may overlap other rooms — the
 *  validator + the human/bot resolve that by moving it. */
export function addRoom(p: ParsedBlueprint, kind: RoomKind): ParsedBlueprint {
  // Spec 084 S4 — on a big estate footprint a fresh 2x2 room reads as a closet; spawn 3x3 there.
  const size = Math.max(p.w, p.d) >= 12 ? 3 : 2;
  const rw = clamp(size, 1, p.w);
  const rd = clamp(size, 1, p.d);
  let x = 0,
    y = 0;
  // prefer a spot not exactly on top of an existing room origin
  outer: for (let yy = 0; yy + rd <= p.d; yy++) {
    for (let xx = 0; xx + rw <= p.w; xx++) {
      if (!p.rooms.some((r) => r.x === xx && r.y === yy)) {
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
  return { ...p, rooms: [...p.rooms, room] };
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

/** Set the wall height (storeys), clamped to the compiler's 1..3 range. */
export function setWallH(p: ParsedBlueprint, h: number): ParsedBlueprint {
  return { ...p, wallH: clamp(Math.round(h), 1, 3) };
}
