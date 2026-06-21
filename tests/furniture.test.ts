import { describe, it, expect } from "vitest";
import {
  FURNITURE_CATALOG,
  FURNITURE_KINDS,
  rotateOffset,
  stampFurniture,
  type FurnitureKind,
} from "../src/colony/furniture";
import {
  parseBlueprint,
  blueprintToScript,
  validateBlueprint,
  FURNITURE_ITEM_CAP,
} from "../src/colony/blueprintScript";
import { compileBlueprint, HOUSE_VOXEL_N } from "../src/colony/houseBuilder";
import {
  addItem,
  removeItem,
  moveItem,
  rotateItem,
  defaultDesign,
} from "../src/colony/builder/blueprintEdit";

const N = HOUSE_VOXEL_N;
const BASE = "house{w:6 d:5 wallH:2 door:s} room{kind:living x:0 y:0 w:6 d:5 win:1}";

describe("furniture catalog + stamps", () => {
  it("every catalog entry produces at least one block and stays inside the cell", () => {
    for (const kind of FURNITURE_KINDS) {
      const def = FURNITURE_CATALOG[kind];
      expect(def.blocks.length).toBeGreaterThan(0);
      for (const b of def.blocks) {
        expect(b.dx).toBeGreaterThanOrEqual(0);
        expect(b.dy).toBeGreaterThanOrEqual(0);
        expect(b.dx).toBeLessThan(N);
        expect(b.dy).toBeLessThan(N);
        expect(b.dz).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("rotation keeps every offset inside the n x n cell for all quarter-turns", () => {
    for (const kind of FURNITURE_KINDS) {
      for (let rot = 0; rot < 4; rot++) {
        for (const b of stampFurniture(kind, rot, N)) {
          expect(b.dx).toBeGreaterThanOrEqual(0);
          expect(b.dy).toBeGreaterThanOrEqual(0);
          expect(b.dx).toBeLessThan(N);
          expect(b.dy).toBeLessThan(N);
        }
      }
    }
  });

  it("rotation is deterministic and a full turn (rot 4) returns to rot 0", () => {
    const a = stampFurniture("sofa", 0, N);
    const b = stampFurniture("sofa", 4, N);
    expect(b).toEqual(a);
    // same inputs, same output
    expect(stampFurniture("bed", 2, N)).toEqual(stampFurniture("bed", 2, N));
  });

  it("rotateOffset is a clean 90-degree clockwise turn", () => {
    // top-left corner rotates to top-right under one clockwise turn in a 6-cell grid
    expect(rotateOffset(0, 0, N, 1)).toEqual({ dx: N - 1, dy: 0 });
    expect(rotateOffset(0, 0, N, 2)).toEqual({ dx: N - 1, dy: N - 1 });
    expect(rotateOffset(0, 0, N, 4)).toEqual({ dx: 0, dy: 0 });
  });
});

describe("blueprint DSL — furniture items", () => {
  it("parses item{...} tokens and round-trips them losslessly", () => {
    const script = `${BASE} item{kind:bed x:1 y:1 rot:0} item{kind:lamp x:4 y:3 rot:2}`;
    const p = parseBlueprint(script);
    expect(p.items).toEqual([
      { kind: "bed", x: 1, y: 1, rot: 0 },
      { kind: "lamp", x: 4, y: 3, rot: 2 },
    ]);
    // serialise -> parse is identity on the items
    expect(parseBlueprint(blueprintToScript(p)).items).toEqual(p.items);
  });

  it("defaults rot to 0 when omitted", () => {
    const p = parseBlueprint(`${BASE} item{kind:rug x:2 y:2}`);
    expect(p.items[0]!.rot).toBe(0);
  });

  it("an item-free script parses to an empty items array (back-compat)", () => {
    expect(parseBlueprint(BASE).items).toEqual([]);
  });

  it("rejects an unknown furniture kind", () => {
    expect(() => parseBlueprint(`${BASE} item{kind:throne x:1 y:1}`)).toThrow(
      /furniture kind/,
    );
  });

  it("validation flags out-of-bounds, bad rotation and over-cap furniture", () => {
    expect(validateBlueprint(`${BASE} item{kind:bed x:9 y:1 rot:0}`).errors).toContain(
      "furniture 0 (bed) sits outside the house",
    );
    expect(
      validateBlueprint(`${BASE} item{kind:bed x:1 y:1 rot:7}`).errors,
    ).toContain("furniture 0 (bed) rot must be 0..3");
    const many = Array.from(
      { length: FURNITURE_ITEM_CAP + 1 },
      () => `item{kind:lamp x:1 y:1 rot:0}`,
    ).join(" ");
    expect(validateBlueprint(`${BASE} ${many}`).ok).toBe(false);
  });
});

describe("compiler — furniture stamping", () => {
  function kindsOf(script: string): Set<string> {
    return new Set(
      compileBlueprint(script, { w: 6, d: 5, seed: 7 }).blocks.map((b) => b.kind),
    );
  }

  it("a placed sofa adds sofa blocks the bare house never had", () => {
    expect(kindsOf(BASE).has("sofa")).toBe(false);
    expect(kindsOf(`${BASE} item{kind:sofa x:2 y:2 rot:0}`).has("sofa")).toBe(true);
  });

  it("furniture lands above the floor slab (z >= 1), never under it", () => {
    const blocks = compileBlueprint(`${BASE} item{kind:bed x:1 y:1 rot:0}`, {
      w: 6,
      d: 5,
      seed: 7,
    }).blocks;
    const bed = blocks.filter((b) => b.kind === "bed");
    expect(bed.length).toBeGreaterThan(0);
    for (const b of bed) expect(b.z).toBeGreaterThanOrEqual(1);
  });

  it("compiles deterministically with furniture (same script -> same blocks)", () => {
    const s = `${BASE} item{kind:plant x:3 y:1 rot:1} item{kind:table x:2 y:2 rot:0}`;
    const a = compileBlueprint(s, { w: 6, d: 5, seed: 11 }).blocks;
    const b = compileBlueprint(s, { w: 6, d: 5, seed: 11 }).blocks;
    expect(b).toEqual(a);
  });
});

describe("blueprintEdit — furniture ops", () => {
  it("addItem appends and respects the cap; removeItem drops by index", () => {
    let p = defaultDesign(6, 5);
    expect(p.items).toEqual([]);
    p = addItem(p, "sofa");
    p = addItem(p, "lamp");
    expect(p.items.map((f) => f.kind)).toEqual(["sofa", "lamp"]);
    p = removeItem(p, 0);
    expect(p.items.map((f) => f.kind)).toEqual(["lamp"]);
  });

  it("moveItem clamps to the footprint; rotateItem cycles 0->1->2->3->0", () => {
    let p = addItem(defaultDesign(6, 5), "chair");
    p = moveItem(p, 0, 99, 99);
    expect(p.items[0]).toMatchObject({ x: 5, y: 4 }); // clamped to w-1, d-1
    p = moveItem(p, 0, -99, -99);
    expect(p.items[0]).toMatchObject({ x: 0, y: 0 });
    for (const expected of [1, 2, 3, 0]) {
      p = rotateItem(p, 0);
      expect(p.items[0]!.rot).toBe(expected);
    }
  });

  it("addItem past the cap is a no-op", () => {
    let p = defaultDesign(6, 5);
    for (let i = 0; i < FURNITURE_ITEM_CAP + 5; i++) p = addItem(p, "lamp");
    expect(p.items.length).toBe(FURNITURE_ITEM_CAP);
  });
});
