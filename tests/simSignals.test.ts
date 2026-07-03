// QA hardening — the "dead memo" fix. The R3F components re-render off primitive signatures
// of the mutable sim.state (simSignals.ts) delivered through the runtime's subscribe/emit loop
// (useSimSignal.ts). These tests pin the two halves the render depends on:
//   1. every signature changes when the state it covers mutates — and ONLY then (stability),
//   2. the runtime attaches neighborhood + commercialDistrict onto sim.state (the severed data
//      path that left the R3F world a still photo) and notifies subscribers on mutation.
import { describe, it, expect } from "vitest";
import { ColonySim } from "../src/colony/sim";
import { ColonyRuntime } from "../src/colony/runtime";
import { makeNeighborhood, type Parcel } from "../src/colony/neighborhood";
import type { ColonyBuilding } from "../src/colony/build";
import type { CommercialDistrict } from "../src/colony/commerce/district";
import {
  foliageSignature,
  zoneSignature,
  levelingSignature,
  spawnSignature,
} from "../src/colony/render/simSignals";

describe("simSignals — signatures over the mutable sim", () => {
  it("signatures are stable while nothing mutates (useSyncExternalStore contract)", () => {
    const sim = new ColonySim(4242);
    sim.state.neighborhood = makeNeighborhood(sim.state.terrain);
    expect(foliageSignature(sim.state)).toBe(foliageSignature(sim.state));
    expect(zoneSignature(sim.state)).toBe(zoneSignature(sim.state));
    expect(levelingSignature(sim.state)).toBe(levelingSignature(sim.state));
    expect(spawnSignature(sim.state)).toBe(spawnSignature(sim.state));
  });

  it("foliageSignature changes when roads or buildings mutate", () => {
    const sim = new ColonySim(4242);
    const before = foliageSignature(sim.state);
    sim.state.roadsVersion++;
    const afterRoads = foliageSignature(sim.state);
    expect(afterRoads).not.toBe(before);
    sim.state.buildings.push({} as ColonyBuilding);
    expect(foliageSignature(sim.state)).not.toBe(afterRoads);
  });

  it("zoneSignature changes when a lot is placed, built, or removed", () => {
    const sim = new ColonySim(4242);
    const bare = zoneSignature(sim.state);
    sim.state.neighborhood = makeNeighborhood(sim.state.terrain);
    const withHood = zoneSignature(sim.state);
    const lots = sim.state.neighborhood.lots;
    expect(lots.length).toBeGreaterThan(0);
    expect(withHood).not.toBe(bare);

    const placed = { id: "test-plot", built: false } as Parcel;
    lots.push(placed);
    const withPlot = zoneSignature(sim.state);
    expect(withPlot).not.toBe(withHood);

    placed.built = true; // the settler finished the house
    const withHouse = zoneSignature(sim.state);
    expect(withHouse).not.toBe(withPlot);

    lots.pop(); // bulldozed
    expect(zoneSignature(sim.state)).not.toBe(withHouse);
  });

  it("levelingSignature changes on road mutations, built parcels and the shop district", () => {
    const sim = new ColonySim(4242);
    sim.state.neighborhood = makeNeighborhood(sim.state.terrain);
    const before = levelingSignature(sim.state);

    sim.state.roadsVersion++;
    const afterRoads = levelingSignature(sim.state);
    expect(afterRoads).not.toBe(before);

    const parcel = sim.state.neighborhood.parcels[0];
    expect(parcel).toBeTruthy();
    parcel.built = true;
    const afterBuild = levelingSignature(sim.state);
    expect(afterBuild).not.toBe(afterRoads);

    sim.state.commercialDistrict = {
      street: [],
      parcels: [],
      crossStreet: [],
      mallPad: { x: 0, y: 0, w: 1, h: 1 },
      reserve: { x: 0, y: 0, w: 1, h: 1 },
    } as CommercialDistrict;
    expect(levelingSignature(sim.state)).not.toBe(afterBuild);
  });

  it("spawnSignature changes when the road network changes", () => {
    const sim = new ColonySim(4242);
    const before = spawnSignature(sim.state);
    sim.state.roadsVersion++;
    expect(spawnSignature(sim.state)).not.toBe(before);
  });
});

describe("runtime — the renderer data path (dead-memo regression)", () => {
  // Booting the real runtime is expensive; share one across the cases below.
  const rt = new ColonyRuntime(4242);

  it("attaches neighborhood and commercialDistrict to sim.state for the R3F renderer", () => {
    expect(rt.sim.state.neighborhood).toBeTruthy();
    expect(rt.sim.state.neighborhood!.lots.length).toBeGreaterThan(0);
    // Attached even when null — undefined would mean the assignment never ran.
    expect(rt.sim.state.commercialDistrict).not.toBe(undefined);
  });

  it("a lot mutation notifies subscribers and moves the zone signature", () => {
    // Mutate through the PUBLIC api and observe it through sim.state — this also proves the
    // state carries the runtime's live neighborhood, not a copy.
    const lot = rt.sim.state.neighborhood!.lots[0];
    expect(lot).toBeTruthy();

    const before = zoneSignature(rt.sim.state);
    let fired = 0;
    const unsub = rt.subscribe(() => fired++);
    const removed = rt.demolishPlot(lot.x, lot.y);
    unsub();

    expect(removed).toBe(true);
    expect(fired).toBeGreaterThan(0); // the emit the render bridge re-snapshots on
    expect(zoneSignature(rt.sim.state)).not.toBe(before);
  });
});
