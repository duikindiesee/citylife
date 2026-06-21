import { describe, it, expect } from "vitest";
import {
  parseBlueprint,
  blueprintToScript,
  validateBlueprint,
} from "../src/colony/blueprintScript";
import { compileBlueprint, HOUSE_VOXEL_N } from "../src/colony/houseBuilder";
import { greedyMesh } from "../src/colony/render/voxelMesh";
import {
  defaultDesign,
  addRoom,
  addItem,
  setRoomStorey,
  moveRoomStorey,
  setItemStorey,
  moveItemStorey,
  setWallH,
  maxStorey,
} from "../src/colony/builder/blueprintEdit";

// Spec 088 Slice B — multi-level floor plans. Rooms and furniture carry an optional storey (z); the
// compiler lays a real floor under upper-storey content and threads a stairwell up from the ground.
const N = HOUSE_VOXEL_N; // 6
const floorSub = 1;

const GROUND_ONLY =
  "house{w:6 d:6 wallH:2 door:s} room{kind:living x:0 y:0 w:6 d:6 win:1}";
const TWO_LEVEL =
  "house{w:6 d:6 wallH:2 door:s} room{kind:living x:0 y:0 w:6 d:6 win:1} room{kind:bedroom x:1 y:1 w:3 d:3 win:1 z:1}";

function compile(script: string) {
  return compileBlueprint(script, { w: 6, d: 6, seed: 7 });
}

describe("DSL — storey (z) on rooms and furniture", () => {
  it("parses z on a room and round-trips it losslessly", () => {
    const p = parseBlueprint(TWO_LEVEL);
    expect(p.rooms[1]!.z).toBe(1);
    expect(parseBlueprint(blueprintToScript(p))).toEqual(p);
  });

  it("parses z on a furniture item and round-trips it", () => {
    const s = `${GROUND_ONLY} item{kind:bed x:2 y:2 rot:0 z:1}`;
    const p = parseBlueprint(s);
    expect(p.items[0]!.z).toBe(1);
    expect(parseBlueprint(blueprintToScript(p)).items[0]!.z).toBe(1);
  });

  it("omits z when on the ground so single-level scripts stay byte-identical", () => {
    // a ground room/item has NO z key and serialises without one
    const p = parseBlueprint(GROUND_ONLY);
    expect(p.rooms[0]!.z).toBeUndefined();
    expect(blueprintToScript(p)).toBe(GROUND_ONLY);
    const withItem = `${GROUND_ONLY} item{kind:bed x:2 y:2 rot:0}`;
    expect(blueprintToScript(parseBlueprint(withItem))).toBe(withItem);
  });

  it("validation rejects a storey above the top floor (room and item)", () => {
    // wallH:2 => storeys 2 => floors 0..1; z:2 is out of range
    expect(
      validateBlueprint(
        "house{w:6 d:6 wallH:2 door:s} room{kind:living x:0 y:0 w:6 d:6 win:1} room{kind:bedroom x:0 y:0 w:2 d:2 win:1 z:2}",
      ).errors.some((e) => /storey 2 is outside 0\.\.1/.test(e)),
    ).toBe(true);
    expect(
      validateBlueprint(
        `${GROUND_ONLY} item{kind:lamp x:1 y:1 rot:0 z:5}`,
      ).errors.some((e) => /storey 5 is outside 0\.\.1/.test(e)),
    ).toBe(true);
  });

  it("validation accepts a storey within range", () => {
    expect(validateBlueprint(TWO_LEVEL).ok).toBe(true);
  });
});

describe("compiler — multi-level structure", () => {
  it("a ground-only house has NO stairs and NO upper floor slab", () => {
    const h = compile(GROUND_ONLY);
    expect(h.blocks.some((b) => b.kind === "stair")).toBe(false);
    // the only floor blocks sit on the ground slab (z 0); nothing floats at an upper storey
    expect(h.blocks.some((b) => b.kind === "floor" && b.z > 0)).toBe(false);
  });

  it("an upper-storey room gets a real floor slab beneath it", () => {
    const h = compile(TWO_LEVEL);
    const slabZ = floorSub + 1 * N - 1; // = 6, the floor of storey 1
    const slab = h.blocks.filter((b) => b.kind === "floor" && b.z === slabZ);
    // the bedroom footprint (plot cells 1..3 -> micro 6..23 = 18x18 cells) is floored at the storey-1
    // slab — bar a few cells where the ground room's ceiling beam shares that level (the slab yields to
    // structure), so coverage is well over 90% rather than exactly 324.
    const inBedroom = (b: { x: number; y: number }) =>
      b.x >= N && b.x < 4 * N && b.y >= N && b.y < 4 * N;
    expect(slab.filter(inBedroom).length).toBeGreaterThan(0.9 * (3 * N) * (3 * N));
    // (the slab may also carry a small landing pad under the stairwell — that's expected, not asserted)
  });

  it("threads a stairwell that climbs from the ground toward the upper floor", () => {
    const h = compile(TWO_LEVEL);
    const stairs = h.blocks.filter((b) => b.kind === "stair");
    expect(stairs.length).toBeGreaterThan(0);
    const lo = Math.min(...stairs.map((b) => b.z));
    const hi = Math.max(...stairs.map((b) => b.z));
    expect(lo).toBe(floorSub); // first tread at the ground stand level
    expect(hi).toBe(floorSub + N - 1); // top tread reaches the storey-1 floor
  });

  it("an upper bedroom's built-in bed lands on the upper floor, not the ground", () => {
    const h = compile(TWO_LEVEL);
    const beds = h.blocks.filter((b) => b.kind === "bed");
    expect(beds.length).toBeGreaterThan(0);
    // storey-1 stand level is floorSub + n = 7; every bed block is at or above it
    expect(beds.every((b) => b.z >= floorSub + N)).toBe(true);
  });

  it("furniture placed on an upper storey stamps above the ground storey", () => {
    const ground = compile(`${GROUND_ONLY} item{kind:sofa x:2 y:2 rot:0}`);
    const upper = compile(`${GROUND_ONLY} item{kind:sofa x:2 y:2 rot:0 z:1}`);
    const gz = Math.min(...ground.blocks.filter((b) => b.kind === "sofa").map((b) => b.z));
    const uz = Math.min(...upper.blocks.filter((b) => b.kind === "sofa").map((b) => b.z));
    expect(gz).toBe(floorSub); // ground sofa rests on the ground slab
    expect(uz).toBe(floorSub + N); // upper sofa rests on the storey-1 floor
  });

  it("every multi-level block stays inside the micro grid", () => {
    const h = compile(TWO_LEVEL);
    for (const b of h.blocks) {
      expect(b.z).toBeGreaterThanOrEqual(0);
      expect(b.z).toBeLessThan(h.gh);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x).toBeLessThan(h.gw);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeLessThan(h.gd);
    }
  });

  it("an upper room over an all-outdoor ground still gets a stairwell (no floating floor)", () => {
    // a bedroom-over-patio (house on stilts) has no enclosed ground cell; the flight falls back to an
    // outdoor cell so the upper floor is reachable, never a disconnected slab.
    const h = compile(
      "house{w:6 d:6 wallH:2 door:s} room{kind:patio x:0 y:0 w:6 d:6 win:0} room{kind:bedroom x:1 y:1 w:3 d:3 win:1 z:1}",
    );
    expect(h.blocks.some((b) => b.kind === "stair")).toBe(true);
    expect(
      h.blocks.some((b) => b.kind === "floor" && b.z === floorSub + N - 1),
    ).toBe(true);
  });

  it("is deterministic — identical multi-level inputs yield byte-identical blocks", () => {
    const a = compile(TWO_LEVEL).blocks;
    const b = compile(TWO_LEVEL).blocks;
    const ser = (bs: typeof a) =>
      bs.map((x) => `${x.x},${x.y},${x.z},${x.kind}`).join("|");
    expect(ser(a)).toBe(ser(b));
  });

  it("the upper storey contributes real geometry to the render mesh", () => {
    const opts = { n: N, cell: 1, voxelY: 1 };
    const ground = greedyMesh(compile(GROUND_ONLY).blocks, opts).quadCount;
    const twoLevel = greedyMesh(compile(TWO_LEVEL).blocks, opts).quadCount;
    expect(twoLevel).toBeGreaterThan(ground);
  });
});

describe("blueprintEdit — storey ops", () => {
  it("maxStorey tracks the clamped wall height", () => {
    expect(maxStorey({ ...defaultDesign(6, 5), wallH: 1 })).toBe(0);
    expect(maxStorey({ ...defaultDesign(6, 5), wallH: 2 })).toBe(1);
    expect(maxStorey({ ...defaultDesign(6, 5), wallH: 3 })).toBe(2);
    expect(maxStorey({ ...defaultDesign(6, 5), wallH: 9 })).toBe(2);
  });

  it("addRoom / addItem place on the requested storey, clamped to the design", () => {
    const p = { ...defaultDesign(6, 6), wallH: 2 };
    const r = addRoom(p, "bedroom", 1).rooms.at(-1)!;
    expect(r.z).toBe(1);
    const f = addItem(p, "lamp", 1).items.at(-1)!;
    expect(f.z).toBe(1);
    // a storey above the top floor clamps down to the top floor (wallH 2 -> max 1)
    expect(addRoom(p, "bedroom", 5).rooms.at(-1)!.z).toBe(1);
    // a ground placement omits z entirely (back-compat)
    expect(addRoom(p, "living", 0).rooms.at(-1)!.z).toBeUndefined();
  });

  it("setRoomStorey clamps and drops z back to undefined on the ground", () => {
    const p = { ...defaultDesign(6, 6), wallH: 3 };
    const up = setRoomStorey(p, 0, 2);
    expect(up.rooms[0]!.z).toBe(2);
    const back = setRoomStorey(up, 0, 0);
    expect(back.rooms[0]!.z).toBeUndefined();
    // clamps above the top floor
    expect(setRoomStorey(p, 0, 9).rooms[0]!.z).toBe(2);
  });

  it("moveRoomStorey / moveItemStorey step by one and clamp at the ends", () => {
    let p = { ...defaultDesign(6, 6), wallH: 2 };
    p = moveRoomStorey(p, 0, 1);
    expect(p.rooms[0]!.z).toBe(1);
    p = moveRoomStorey(p, 0, 1); // already on the top floor -> clamps, stays 1
    expect(p.rooms[0]!.z).toBe(1);
    p = moveRoomStorey(p, 0, -1);
    expect(p.rooms[0]!.z).toBeUndefined(); // back to ground, z dropped

    let q = addItem({ ...defaultDesign(6, 6), wallH: 2 }, "chair");
    q = moveItemStorey(q, 0, 1);
    expect(q.items[0]!.z).toBe(1);
    q = moveItemStorey(q, 0, -1);
    expect(q.items[0]!.z).toBeUndefined();
  });

  it("setWallH lowering re-homes content stranded above the new top floor", () => {
    let p = { ...defaultDesign(6, 6), wallH: 3 };
    p = setRoomStorey(p, 0, 2); // a room on the top floor
    p = addItem(p, "lamp", 2); // and a lamp on the top floor
    const lowered = setWallH(p, 1); // collapse to a single storey
    expect(lowered.wallH).toBe(1);
    // nothing is stranded above the ground — z is dropped back to undefined
    expect(lowered.rooms.every((r) => (r.z ?? 0) === 0)).toBe(true);
    expect(lowered.items.every((f) => (f.z ?? 0) === 0)).toBe(true);
    expect(lowered.rooms[0]!.z).toBeUndefined();
    // and the result is a valid, Acceptable blueprint (no out-of-range storey errors)
    expect(validateBlueprint(blueprintToScript(lowered)).ok).toBe(true);
  });

  it("setWallH dropping by one re-homes only what is now too high", () => {
    let p = { ...defaultDesign(6, 6), wallH: 3 };
    p = setRoomStorey(p, 0, 2);
    p = addRoom(p, "bedroom", 1); // a room on floor 1 (stays valid at wallH 2)
    const lowered = setWallH(p, 2); // top floor is now 1
    expect(lowered.rooms[0]!.z).toBe(1); // the floor-2 room drops to floor 1
    expect(lowered.rooms.at(-1)!.z).toBe(1); // the floor-1 room is untouched
    expect(validateBlueprint(blueprintToScript(lowered)).ok).toBe(true);
  });

  it("storey ops are immutable — the input design is never mutated", () => {
    let p = { ...defaultDesign(6, 6), wallH: 3 };
    p = setRoomStorey(p, 0, 2); // give it upper content so setWallH's re-home path runs
    const snapshot = JSON.stringify(p);
    setRoomStorey(p, 0, 1);
    moveRoomStorey(p, 0, 1);
    addRoom(p, "bedroom", 1);
    addItem(p, "lamp", 2);
    setWallH(p, 1); // must re-home stranded content on a COPY, never mutate p
    expect(JSON.stringify(p)).toBe(snapshot);
  });
});
