import { beforeAll, describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { createWorldLayoutDocument } from "../src/colony/spatial/worldLayoutDocument";

describe("player parcel isolation from the legacy citizen economy", () => {
  let baseline: ReturnType<ColonyRuntime["captureWorldLayout"]>;
  beforeAll(() => {
    baseline = new ColonyRuntime(4242, { surveyOnly: true }).captureWorldLayout();
  });
  const plotId = "wood1_lot_1";
  function boot(plotIds = [plotId], revision = baseline.revision.contentHash) {
    return new ColonyRuntime(4242, { surveyOnly: true, playerInventory: {
      worldId: baseline.worldId, layoutRevision: revision, plotIds,
    } });
  }

  it("rejects a different layout, missing plots, duplicates and founder territory", () => {
    expect(() => boot([plotId], "0".repeat(64))).toThrow(/layout/);
    expect(() => boot(["missing"])).toThrow(/unavailable/);
    expect(() => boot([plotId, plotId])).toThrow(/Duplicate/);
    const coastal = new ColonyRuntime(4242, { surveyOnly: true }).lots().find(l => !l.neighborhoodKey)!;
    expect(() => boot([coastal.id])).toThrow(/unavailable/);
  });

  it("blocks legacy construction and demolition even with a stale local owner", () => {
    const runtime = boot();
    const lot = runtime.lots().find(l => l.id === plotId)!;
    // Fixture setup only: actions under test use the public runtime mutation methods.
    const citizen = runtime["citizens"].seedFounder({ id: "stale-citizen", householdId: "test-household",
      displayName: "Test Resident", plotId: "wood1_lot_2", plotName: "Garden Home",
      home: { x: lot.x, y: lot.y }, kind: "human", nowMs: 0 });
    expect(citizen).not.toBeNull();
    expect(runtime.assignLot("stale-citizen", plotId)).toBe(false);
    expect(lot.ownerCitizenId).toBeUndefined();
    lot.ownerCitizenId = "stale-citizen";
    const before = JSON.stringify(lot);
    const materials = runtime.sim.state.materials;
    const ledger = JSON.stringify(runtime.sim.state.ledger);
    expect(runtime.isPlayerParcel(plotId)).toBe(true);
    expect(runtime.plotPriceK(lot)).toBe(Infinity);
    expect(runtime.purchaseLot("stale-citizen", plotId)).toBe(false);
    expect(runtime.assignLot("stale-citizen", plotId)).toBe(false);
    expect(runtime.builderUrl(plotId)).toBeNull();
    expect(runtime.applyBlueprint(plotId, "house{w:5 d:5 wallH:2 door:s}")).toBe(false);
    expect(runtime.selfDesignLot(plotId)).toBeNull();
    expect(runtime.commissionLot(plotId)).toBeNull();
    expect(runtime.buildHouse(plotId)).toBe(false);
    expect(runtime.demolishLot(plotId)).toBeNull();
    expect(JSON.stringify(lot)).toBe(before);
    expect(runtime.sim.state.materials).toBe(materials);
    expect(JSON.stringify(runtime.sim.state.ledger)).toBe(ledger);
    expect(runtime.removeCitizen("stale-citizen")).toBe(true);
    expect(JSON.stringify(lot)).toBe(before);
  });

  it("does not disable building on ordinary citizen parcels", () => {
    const runtime = boot();
    const ordinary = runtime.lots().find(l => l.id === "wood1_lot_2")!;
    expect(runtime.isPlayerParcel(ordinary.id)).toBe(false);
    expect(runtime.buildHouse(ordinary.id)).toBe(true);
    expect(ordinary.built).toBe(true);
  });

  it("allows persistence metadata changes but refuses geometry replacement before mutation", () => {
    const runtime = boot();
    const next = createWorldLayoutDocument({ ...baseline, revision: {
      number: baseline.revision.number + 1, parentHash: baseline.revision.contentHash,
    } });
    // Initial persistence can advance the revision while preserving the published geometry.
    expect(() => runtime.hydrateWorldLayout(next)).not.toThrow();
    expect(() => runtime.adoptWorldLayoutRevision(next)).not.toThrow();
    const surface = next.frames.find(f => f.layer === "surface" && f.grid)!;
    const changed = createWorldLayoutDocument({ ...next, terrainEdits: [{
      frameId: surface.id, cell: { x: 3, y: 4 }, elevation: 7,
    }], revision: { number: next.revision.number + 1, parentHash: next.revision.contentHash } });
    const before = runtime.captureWorldLayout();
    const roads = JSON.stringify(runtime.sim.state.roads);
    const elevation = new Float32Array(runtime.sim.state.terrain.elev);
    expect(() => runtime.preflightWorldLayout(changed)).toThrow(/player parcel geometry/);
    expect(() => runtime.hydrateWorldLayout(changed)).toThrow(/player parcel geometry/);
    expect(() => runtime.adoptWorldLayoutRevision(changed)).toThrow(/player parcel geometry/);
    expect(runtime.captureWorldLayout()).toEqual(before);
    expect(JSON.stringify(runtime.sim.state.roads)).toBe(roads);
    expect(runtime.sim.state.terrain.elev).toEqual(elevation);
  });
});
