import { describe, it, expect, beforeEach } from "vitest";
import {
  parseBlueprint,
  blueprintToScript,
  validateBlueprint,
  FURNITURE_ITEM_CAP,
  type ParsedBlueprint,
} from "../src/colony/blueprintScript";
import {
  defaultDesign,
  placeItemAt,
  freeItemCell,
} from "../src/colony/builder/blueprintEdit";
import { ColonyRuntime } from "../src/colony/runtime";
import {
  recordOwnedLocal,
  loadInventoryLocal,
  ownedBy,
} from "../src/colony/bot/furnitureStore";

// Spec 088 Slice E — place owned furniture from inventory into a player's house.

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v);
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
}

describe("placeItemAt — the inventory→DSL primitive (pure)", () => {
  it("places a piece at the exact cell, rotation and storey", () => {
    const p = { ...defaultDesign(6, 6), wallH: 3 };
    const next = placeItemAt(p, "sofa", 2, 3, 1, 1);
    expect(next.items.at(-1)).toEqual({
      kind: "sofa",
      x: 2,
      y: 3,
      rot: 1,
      z: 1,
    });
    // the script round-trips and validates
    expect(validateBlueprint(blueprintToScript(next)).ok).toBe(true);
  });

  it("clamps the cell into the footprint and the storey into the design", () => {
    const p = { ...defaultDesign(6, 5), wallH: 2 }; // storeys 0..1
    const next = placeItemAt(p, "lamp", 99, -4, 0, 9);
    expect(next.items.at(-1)).toMatchObject({ x: 5, y: 0 }); // clamped to w-1, 0
    expect(next.items.at(-1)!.z).toBe(1); // storey clamped to the top floor (wallH 2 -> 1)
  });

  it("normalises rotation to 0..3 and omits z on the ground", () => {
    const p = defaultDesign(6, 6); // wallH 2
    expect(placeItemAt(p, "chair", 1, 1, 5).items.at(-1)!.rot).toBe(1); // 5 % 4
    expect(placeItemAt(p, "chair", 1, 1, -1).items.at(-1)!.rot).toBe(3); // -1 -> 3
    expect(placeItemAt(p, "rug", 1, 1, 0, 0).items.at(-1)!.z).toBeUndefined();
  });

  it("respects the furniture cap (a no-op when the design is full) and never mutates input", () => {
    const full: ParsedBlueprint = {
      ...defaultDesign(6, 6),
      items: Array.from({ length: FURNITURE_ITEM_CAP }, () => ({
        kind: "lamp" as const,
        x: 0,
        y: 0,
        rot: 0,
      })),
    };
    const snap = JSON.stringify(full);
    const next = placeItemAt(full, "bed", 1, 1);
    expect(next.items.length).toBe(FURNITURE_ITEM_CAP); // unchanged — no room
    expect(JSON.stringify(full)).toBe(snap); // input untouched
  });
});

describe("freeItemCell — auto placement spot (pure)", () => {
  it("returns the first unoccupied cell row-major on the storey", () => {
    const p: ParsedBlueprint = {
      ...defaultDesign(3, 3),
      items: [
        { kind: "lamp", x: 0, y: 0, rot: 0 },
        { kind: "lamp", x: 1, y: 0, rot: 0 },
      ],
    };
    expect(freeItemCell(p)).toEqual({ x: 2, y: 0 });
  });

  it("is storey-aware — a cell taken on the ground is free upstairs", () => {
    const p: ParsedBlueprint = {
      ...defaultDesign(3, 3),
      wallH: 2,
      items: [{ kind: "lamp", x: 0, y: 0, rot: 0 }], // ground only
    };
    expect(freeItemCell(p, 1)).toEqual({ x: 0, y: 0 }); // free on floor 1
  });

  it("defaults to the plot centre when every cell on the storey is taken", () => {
    const items = [];
    for (let y = 0; y < 3; y++)
      for (let x = 0; x < 3; x++) items.push({ kind: "lamp" as const, x, y, rot: 0 });
    const p: ParsedBlueprint = { ...defaultDesign(3, 3), items };
    expect(freeItemCell(p)).toEqual({ x: 1, y: 1 });
  });
});

describe("runtime.placeFurnitureFromInventory (spec 088 Slice E)", () => {
  beforeEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = new MemStorage();
  });

  /** A citizen who owns a built, blueprinted lot (the founders are crafted on boot). */
  function ownerAndLot(rt: ColonyRuntime): { citizenId: string; lotId: string } {
    const lot = rt.lots().find(
      (l) => l.ownerCitizenId && l.blueprint,
    )!;
    return { citizenId: lot.ownerCitizenId!, lotId: lot.id };
  }

  it("drops an owned piece into the lot's blueprint and consumes it from inventory", () => {
    const rt = new ColonyRuntime(42);
    const { citizenId, lotId } = ownerAndLot(rt);
    recordOwnedLocal(citizenId, "lamp", "Reading Lamp", 1);

    expect(
      rt.placeFurnitureFromInventory(citizenId, lotId, "lamp:reading-lamp", 1, 1),
    ).toBe(true);

    // the blueprint now carries the item, and it compiles
    const lot = rt.lots().find((l) => l.id === lotId)!;
    const items = parseBlueprint(lot.blueprint!).items;
    expect(items.some((f) => f.kind === "lamp")).toBe(true);
    // inventory consumed (qty 1 -> stack gone)
    expect(loadInventoryLocal()[citizenId]).toBeUndefined();
  });

  it("decrements a multi-stack rather than removing it, leaving the rest owned", () => {
    const rt = new ColonyRuntime(42);
    const { citizenId, lotId } = ownerAndLot(rt);
    recordOwnedLocal(citizenId, "chair", "Stool", 3);
    expect(
      rt.placeFurnitureFromInventory(citizenId, lotId, "chair:stool", 2, 2),
    ).toBe(true);
    expect(ownedBy(loadInventoryLocal(), citizenId)[0]).toMatchObject({
      id: "chair:stool",
      qty: 2,
    });
  });

  it("refuses to place a piece the player does not own — no blueprint change", () => {
    const rt = new ColonyRuntime(42);
    const { citizenId, lotId } = ownerAndLot(rt);
    const before = rt.lots().find((l) => l.id === lotId)!.blueprint;
    expect(
      rt.placeFurnitureFromInventory(citizenId, lotId, "sofa:nope", 1, 1),
    ).toBe(false);
    expect(rt.lots().find((l) => l.id === lotId)!.blueprint).toBe(
      before,
    );
  });

  it("lotForCitizen returns the citizen's home lot, null for a lotless citizen", () => {
    const rt = new ColonyRuntime(42);
    const { citizenId, lotId } = ownerAndLot(rt);
    expect(rt.lotForCitizen(citizenId)?.id).toBe(lotId);
    expect(rt.lotForCitizen("citizen_nobody")).toBeNull();
  });

  it("placeFurnitureAuto drops an owned piece into the player's house and consumes it", () => {
    const rt = new ColonyRuntime(42);
    const { citizenId } = ownerAndLot(rt);
    recordOwnedLocal(citizenId, "lamp", "Desk Lamp", 1);
    expect(rt.placeFurnitureAuto(citizenId, "lamp:desk-lamp")).toBe(true);
    const lot = rt.lotForCitizen(citizenId)!;
    expect(parseBlueprint(lot.blueprint!).items.some((f) => f.kind === "lamp")).toBe(
      true,
    );
    expect(loadInventoryLocal()[citizenId]).toBeUndefined(); // consumed
  });

  it("placeFurnitureAuto refuses when the citizen owns no home or no such piece", () => {
    const rt = new ColonyRuntime(42);
    const { citizenId } = ownerAndLot(rt);
    recordOwnedLocal(citizenId, "rug", "Mat", 1);
    expect(rt.placeFurnitureAuto("citizen_nobody", "rug:mat")).toBe(false); // no home
    expect(rt.placeFurnitureAuto(citizenId, "sofa:ghost")).toBe(false); // not owned
    expect(ownedBy(loadInventoryLocal(), citizenId)[0]).toMatchObject({
      id: "rug:mat",
      qty: 1,
    }); // untouched
  });

  it("refuses to furnish a lot the citizen does not own", () => {
    const rt = new ColonyRuntime(42);
    const { citizenId } = ownerAndLot(rt);
    // a different owner's lot
    const otherLot = rt.lots().find(
      (l) => l.ownerCitizenId && l.ownerCitizenId !== citizenId,
    )!;
    recordOwnedLocal(citizenId, "plant", "Fern", 1);
    expect(
      rt.placeFurnitureFromInventory(citizenId, otherLot.id, "plant:fern", 1, 1),
    ).toBe(false);
    // the piece is NOT consumed on a refused placement
    expect(ownedBy(loadInventoryLocal(), citizenId)[0]).toMatchObject({
      id: "plant:fern",
      qty: 1,
    });
  });
});
