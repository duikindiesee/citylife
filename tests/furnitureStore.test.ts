import { describe, it, expect, beforeEach } from "vitest";
import {
  ownedFurnitureId,
  addOwned,
  removeOwned,
  ownedBy,
  mergeInventories,
  loadInventoryLocal,
  saveInventoryLocal,
  recordOwnedLocal,
  clearInventoryLocal,
  FURNITURE_STACK_CAP,
  FURNITURE_STACKS_CAP,
  type FurnitureInventory,
} from "../src/colony/bot/furnitureStore";

// Spec 088 Slice C — furniture inventory. Pure model ops plus a two-layer store (local + best-effort
// backend). A stored stack must round-trip localStorage, dedupe by design, and refuse anything unsafe
// so a corrupt or brand-word-bearing entry can never reach the builder or the marketplace.

// node has no localStorage — a tiny in-memory shim with the same surface (matches blueprintStore.test)
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

beforeEach(() => {
  (globalThis as { localStorage?: unknown }).localStorage = new MemStorage();
});

describe("furnitureStore — pure model ops (spec 088 Slice C)", () => {
  it("ownedFurnitureId is deterministic and dedupes by kind + name slug", () => {
    expect(ownedFurnitureId("sofa", "Cozy Couch")).toBe("sofa:cozy-couch");
    expect(ownedFurnitureId("sofa", "  cozy   couch ")).toBe("sofa:cozy-couch");
    expect(ownedFurnitureId("bed", "")).toBe("bed:piece"); // blank slug falls back
    // a different kind never collides with the same name
    expect(ownedFurnitureId("lamp", "Cozy Couch")).not.toBe(
      ownedFurnitureId("sofa", "Cozy Couch"),
    );
  });

  it("addOwned appends a new stack and increments an existing one (same design)", () => {
    let inv: FurnitureInventory = {};
    inv = addOwned(inv, "citizen_joe", "sofa", "Cozy Couch");
    inv = addOwned(inv, "citizen_joe", "sofa", "Cozy Couch", 2);
    inv = addOwned(inv, "citizen_joe", "lamp", "Reading Lamp");
    const joe = ownedBy(inv, "citizen_joe");
    expect(joe).toEqual([
      { id: "lamp:reading-lamp", kind: "lamp", name: "Reading Lamp", qty: 1 },
      { id: "sofa:cozy-couch", kind: "sofa", name: "Cozy Couch", qty: 3 },
    ]); // sorted by id, the sofa stack accumulated to 3
  });

  it("addOwned defaults a blank name to the kind and keeps players separate", () => {
    let inv: FurnitureInventory = {};
    inv = addOwned(inv, "citizen_a", "bed");
    inv = addOwned(inv, "citizen_b", "bed");
    expect(ownedBy(inv, "citizen_a")).toEqual([
      { id: "bed:bed", kind: "bed", name: "bed", qty: 1 },
    ]);
    expect(ownedBy(inv, "citizen_b")[0]!.qty).toBe(1);
  });

  it("addOwned REFUSES an unsafe name (public-safety denylist) and an unknown kind", () => {
    let inv: FurnitureInventory = {};
    inv = addOwned(inv, "citizen_a", "sofa", "kooker throne"); // brand word
    inv = addOwned(inv, "citizen_a", "sofa", "secret token couch"); // denied words
    inv = addOwned(inv, "citizen_a", "throne" as never, "Throne"); // not a real kind
    expect(ownedBy(inv, "citizen_a")).toEqual([]);
  });

  it("addOwned caps a stack quantity and the number of distinct designs", () => {
    let inv: FurnitureInventory = {};
    inv = addOwned(inv, "citizen_a", "rug", "Big Rug", FURNITURE_STACK_CAP + 50);
    expect(ownedBy(inv, "citizen_a")[0]!.qty).toBe(FURNITURE_STACK_CAP);
    // fill past the distinct-design cap — the overflow design is dropped
    let inv2: FurnitureInventory = {};
    for (let i = 0; i < FURNITURE_STACKS_CAP + 5; i++) {
      inv2 = addOwned(inv2, "citizen_a", "plant", `Plant ${i}`);
    }
    expect(ownedBy(inv2, "citizen_a").length).toBe(FURNITURE_STACKS_CAP);
  });

  it("removeOwned decrements, drops the stack at zero, and drops the citizen when empty", () => {
    let inv: FurnitureInventory = {};
    inv = addOwned(inv, "citizen_a", "chair", "Stool", 3);
    inv = removeOwned(inv, "citizen_a", "chair:stool", 1);
    expect(ownedBy(inv, "citizen_a")[0]!.qty).toBe(2);
    inv = removeOwned(inv, "citizen_a", "chair:stool", 5); // over-remove clears the stack
    expect(inv["citizen_a"]).toBeUndefined(); // the now-empty citizen key is gone
    expect(removeOwned(inv, "citizen_a", "nope", 1)).toBe(inv); // missing is a no-op
  });

  it("pure ops never mutate their input", () => {
    const inv: FurnitureInventory = {};
    const snap = JSON.stringify(inv);
    addOwned(inv, "citizen_a", "sofa", "Couch");
    expect(JSON.stringify(inv)).toBe(snap);
    const one = addOwned(inv, "citizen_a", "sofa", "Couch");
    const oneSnap = JSON.stringify(one);
    removeOwned(one, "citizen_a", "sofa:couch");
    addOwned(one, "citizen_a", "lamp", "Lamp");
    expect(JSON.stringify(one)).toBe(oneSnap);
  });

  it("mergeInventories — backend wins per citizen, local fills the gaps, null is a no-op", () => {
    const local: FurnitureInventory = {
      a: [{ id: "bed:bed", kind: "bed", name: "bed", qty: 1 }],
      b: [{ id: "rug:rug", kind: "rug", name: "rug", qty: 1 }],
    };
    const backend: FurnitureInventory = {
      b: [{ id: "sofa:sofa", kind: "sofa", name: "sofa", qty: 5 }],
    };
    const merged = mergeInventories(local, backend);
    expect(merged["a"]).toEqual(local["a"]); // local-only player kept
    expect(merged["b"]).toEqual(backend["b"]); // backend wins for the shared player
    expect(mergeInventories(local, null)).toEqual(local);
  });
});

describe("furnitureStore — local persistence + safety", () => {
  it("round-trips an inventory through localStorage", () => {
    const inv = recordOwnedLocal("citizen_joe", "sofa", "Cozy Couch", 2);
    expect(ownedBy(inv, "citizen_joe")[0]).toMatchObject({
      kind: "sofa",
      name: "Cozy Couch",
      qty: 2,
    });
    expect(loadInventoryLocal()).toEqual(inv);
    clearInventoryLocal();
    expect(loadInventoryLocal()).toEqual({});
  });

  it("recordOwnedLocal accumulates across calls (persisted between loads)", () => {
    recordOwnedLocal("citizen_joe", "lamp", "Lamp");
    recordOwnedLocal("citizen_joe", "lamp", "Lamp");
    expect(loadInventoryLocal()["citizen_joe"]![0]!.qty).toBe(2);
  });

  it("drops corrupt and unsafe stacks on LOAD — tampering cannot reach the builder", () => {
    (globalThis as unknown as { localStorage: MemStorage }).localStorage.setItem(
      "citylife.furniture.v1",
      JSON.stringify({
        citizen_a: [
          { id: "x", kind: "throne", name: "Throne", qty: 1 }, // bad kind
          { id: "y", kind: "sofa", name: "kooker couch", qty: 1 }, // unsafe name
          { id: "z", kind: "bed", name: "Real Bed", qty: 2 }, // good
        ],
        citizen_b: "not an array",
      }),
    );
    const inv = loadInventoryLocal();
    expect(inv["citizen_a"]).toEqual([
      { id: "bed:real-bed", kind: "bed", name: "Real Bed", qty: 2 },
    ]);
    expect(inv["citizen_b"]).toBeUndefined();
  });

  it("merges duplicate-id stacks on load and rejects non-positive quantities", () => {
    (globalThis as unknown as { localStorage: MemStorage }).localStorage.setItem(
      "citylife.furniture.v1",
      JSON.stringify({
        citizen_a: [
          { kind: "sofa", name: "Cozy Couch", qty: 2 },
          { kind: "sofa", name: "  cozy   couch ", qty: 3 }, // same slug -> qty merges
          { kind: "rug", name: "Ghost Rug", qty: 0 }, // non-positive -> dropped
          { kind: "lamp", name: "Lamp", qty: -4 }, // negative -> dropped
        ],
      }),
    );
    expect(loadInventoryLocal()["citizen_a"]).toEqual([
      { id: "sofa:cozy-couch", kind: "sofa", name: "Cozy Couch", qty: 5 },
    ]);
  });

  it("saveInventoryLocal screens the inventory before it lands in storage", () => {
    saveInventoryLocal({
      citizen_a: [
        { id: "spoofed", kind: "sofa", name: "Couch", qty: 1 }, // id recomputed on the way in
        { id: "bad", kind: "bogus" as never, name: "X", qty: 1 }, // dropped
      ],
    });
    const back = loadInventoryLocal();
    expect(back["citizen_a"]).toEqual([
      { id: "sofa:couch", kind: "sofa", name: "Couch", qty: 1 },
    ]);
  });
});
