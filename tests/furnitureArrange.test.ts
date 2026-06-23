import { describe, it, expect, beforeEach } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import {
  recordOwnedLocal,
  loadInventoryLocal,
  ownedBy,
} from "../src/colony/bot/furnitureStore";

// Spec 089 — furniture ARRANGEMENT. Rearrange the pieces already placed in a built house, any time:
// move / rotate / restack a piece freely (no inventory churn), and remove it back to inventory.

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

describe("runtime furniture arrangement (spec 089)", () => {
  beforeEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = new MemStorage();
  });

  function owner(rt: ColonyRuntime): { citizenId: string; lotId: string } {
    const lot = rt.lots().find((l) => l.ownerCitizenId && l.blueprint)!;
    return { citizenId: lot.ownerCitizenId!, lotId: lot.id };
  }

  /** Place one fresh piece into the house and return its placedFurniture index. */
  function placeOne(
    rt: ColonyRuntime,
    citizenId: string,
    lotId: string,
    kind: string,
    name: string,
    x: number,
    y: number,
  ): number {
    recordOwnedLocal(citizenId, kind as never, name, 1);
    const id = `${kind}:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    rt.placeFurnitureFromInventory(citizenId, lotId, id, x, y);
    return rt.placedFurniture(lotId).findIndex((f) => f.kind === kind);
  }

  it("placedFurniture lists each placed piece with a handle, cell, rotation and storey", () => {
    const rt = new ColonyRuntime(42);
    const { citizenId, lotId } = owner(rt);
    const before = rt.placedFurniture(lotId).length;
    placeOne(rt, citizenId, lotId, "sofa", "Couch", 2, 2);
    const placed = rt.placedFurniture(lotId);
    expect(placed.length).toBe(before + 1);
    const couch = placed.find((f) => f.kind === "sofa")!;
    expect(couch).toMatchObject({ kind: "sofa", x: 2, y: 2, rot: 0, z: 0 });
    expect(typeof couch.index).toBe("number");
  });

  it("moveArrangedFurniture slides a placed piece, and refuses on a lot you do not own", () => {
    const rt = new ColonyRuntime(42);
    const { citizenId, lotId } = owner(rt);
    const i = placeOne(rt, citizenId, lotId, "lamp", "Lamp", 2, 2);
    expect(rt.moveArrangedFurniture(citizenId, lotId, i, 1, 0)).toBe(true);
    expect(rt.placedFurniture(lotId)[i]).toMatchObject({ x: 3, y: 2 });
    // not your house -> no-op
    expect(rt.moveArrangedFurniture("citizen_nobody", lotId, i, 1, 0)).toBe(
      false,
    );
    expect(rt.placedFurniture(lotId)[i]).toMatchObject({ x: 3, y: 2 });
  });

  it("rotateArrangedFurniture cycles the rotation", () => {
    const rt = new ColonyRuntime(42);
    const { citizenId, lotId } = owner(rt);
    const i = placeOne(rt, citizenId, lotId, "chair", "Stool", 1, 1);
    expect(rt.rotateArrangedFurniture(citizenId, lotId, i)).toBe(true);
    expect(rt.placedFurniture(lotId)[i]!.rot).toBe(1);
  });

  it("restackArrangedFurniture moves a piece between floors, clamped to the design", () => {
    const rt = new ColonyRuntime(42);
    const { citizenId, lotId } = owner(rt);
    // a two-storey house so a piece can actually move up
    rt.applyBlueprint(
      lotId,
      "house{w:6 d:6 wallH:2 door:s} room{kind:living x:0 y:0 w:6 d:6 win:1}",
      "setup",
    );
    const i = placeOne(rt, citizenId, lotId, "plant", "Fern", 2, 2);
    expect(rt.placedFurniture(lotId)[i]!.z).toBe(0);
    expect(rt.restackArrangedFurniture(citizenId, lotId, i, 1)).toBe(true);
    expect(rt.placedFurniture(lotId)[i]!.z).toBe(1); // up a floor
    rt.restackArrangedFurniture(citizenId, lotId, i, 9); // clamps to the top floor
    expect(rt.placedFurniture(lotId)[i]!.z).toBe(1);
  });

  it("removeArrangedFurniture takes a piece out of the house and returns it to inventory", () => {
    const rt = new ColonyRuntime(42);
    const { citizenId, lotId } = owner(rt);
    const i = placeOne(rt, citizenId, lotId, "rug", "Mat", 1, 1);
    // placing consumed it from inventory
    expect(
      ownedBy(loadInventoryLocal(), citizenId).find((s) => s.id === "rug:mat"),
    ).toBeUndefined();

    expect(rt.removeArrangedFurniture(citizenId, lotId, i)).toBe(true);
    // gone from the house...
    expect(rt.placedFurniture(lotId).some((f) => f.kind === "rug")).toBe(false);
    // ...and back in inventory as the catalog kind (the blueprint does not keep the custom name)
    expect(
      ownedBy(loadInventoryLocal(), citizenId).find((s) => s.id === "rug:rug"),
    ).toMatchObject({ kind: "rug", qty: 1 });
    // an out-of-range handle is a no-op
    expect(rt.removeArrangedFurniture(citizenId, lotId, 99)).toBe(false);
  });

  it("removeArrangedFurniture refuses on a lot you do not own (nothing returned)", () => {
    const rt = new ColonyRuntime(42);
    const { citizenId, lotId } = owner(rt);
    const i = placeOne(rt, citizenId, lotId, "desk", "Workbench", 1, 1);
    expect(rt.removeArrangedFurniture("citizen_nobody", lotId, i)).toBe(false);
    expect(rt.placedFurniture(lotId).some((f) => f.kind === "desk")).toBe(true);
    expect(ownedBy(loadInventoryLocal(), "citizen_nobody").length).toBe(0);
  });
});
