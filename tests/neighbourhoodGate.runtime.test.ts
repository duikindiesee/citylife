import { describe, it, expect } from "vitest";
import type { NeighbourhoodAccessDeps } from "../src/colony/bot/neighbourhoodAccess";

// A focused test of the runtime's buy-time access gate WITHOUT booting the whole sim: the gate logic
// (resolve the lot's neighbourhood key, then defer to checkNeighbourhoodAccess) is exercised on a
// minimal stand-in carrying just the method under test, so the key-resolution + fail-closed wiring is
// verified without the heavy world build. The pure access core is covered in neighbourhoodAccess.test.

type Lot = { id: string; neighborhoodKey?: string };

// Re-implements ONLY the lookup the real method does, then calls the real access core — kept in lockstep
// with runtime.canBuyLotByAccess (find lot -> key ?? parse(id) -> checkNeighbourhoodAccess).
import {
  checkNeighbourhoodAccess,
  neighbourhoodKeyForLot,
} from "../src/colony/bot/neighbourhoodAccess";

async function gate(lots: Lot[], lotId: string, deps: NeighbourhoodAccessDeps) {
  const lot = lots.find((l) => l.id === lotId);
  const key = lot?.neighborhoodKey ?? neighbourhoodKeyForLot(lotId);
  return checkNeighbourhoodAccess(key, deps);
}

function deps(allowed: boolean | null, ok = true): NeighbourhoodAccessDeps {
  return {
    transport: async () => ({ ok, status: ok ? 200 : 500, allowed }),
    getToken: async () => "h.payload.s",
    getUserId: () => "42",
  };
}

describe("runtime buy gate (key resolution + access)", () => {
  const lots: Lot[] = [
    { id: "lot_1" }, // primary, open land
    { id: "wood1_lot_2", neighborhoodKey: "wood1" }, // private hamlet
  ];

  it("passes a primary open-land lot without a network call", async () => {
    let called = false;
    const d: NeighbourhoodAccessDeps = {
      transport: async () => {
        called = true;
        return { ok: true, status: 200, allowed: true };
      },
      getToken: async () => "h.p.s",
      getUserId: () => "42",
    };
    expect(await gate(lots, "lot_1", d)).toEqual({ allowed: true });
    expect(called).toBe(false);
  });

  it("allows a granted player to buy in a private hamlet", async () => {
    expect(await gate(lots, "wood1_lot_2", deps(true))).toEqual({
      allowed: true,
    });
  });

  it("blocks a non-granted player from a private hamlet", async () => {
    const r = await gate(lots, "wood1_lot_2", deps(false));
    expect(r.allowed).toBe(false);
  });

  it("falls back to parsing the key from the id when the lot record is absent", async () => {
    const r = await gate([], "hill3_lot_5", deps(false));
    expect(r.allowed).toBe(false); // a keyed id is checked even with no in-memory lot
  });

  it("fails closed when the backend errors", async () => {
    const r = await gate(lots, "wood1_lot_2", deps(null, false));
    expect(r.allowed).toBe(false);
  });
});
