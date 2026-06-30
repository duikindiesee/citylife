import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { Biome } from "../src/colony/terrain";
import type { Parcel } from "../src/colony/neighborhood";

const SEEDS = [4242, 42, 7, 99, 3, 11];
const KOOKERBOS_RESERVED = ["citizen_irwin", "citizen_gerhard"];

function footprintBox(p: Parcel) {
  const xs = p.fence.map((c) => c.x);
  const ys = p.fence.map((c) => c.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function namedPlaces(runtime: ColonyRuntime): { name: string; x: number; y: number; radius: number }[] {
  return (runtime as unknown as { neighbourhoodPlaces: { name: string; x: number; y: number; radius: number }[] }).neighbourhoodPlaces;
}

function kookerbosWoods(runtime: ColonyRuntime): { name: string; x: number; y: number; radius: number } {
  const place = namedPlaces(runtime).find((p) => p.name === "Kookerbos Woods");
  expect(place).toBeTruthy();
  return place!;
}

function sortedKookerbosLots(runtime: ColonyRuntime): Parcel[] {
  const place = kookerbosWoods(runtime);
  return runtime
    .lots()
    .filter((lot) => Math.hypot(lot.x - place.x, lot.y - place.y) <= place.radius)
    .sort((a, b) => a.id.localeCompare(b.id));
}

describe("Kookerbos clean reserved plots", () => {
  it("names the actual lagoon-side woods settlement Kookerbos Woods", () => {
    const runtime = new ColonyRuntime(4242);
    const place = kookerbosWoods(runtime);
    expect(place.x, "seed 4242 Kookerbos Woods is on the island/lagoon woods side, not the opposite road cluster").toBeGreaterThan(380);
    expect(place.y, "seed 4242 Kookerbos Woods is on the island/lagoon woods side, not the opposite road cluster").toBeLessThan(180);
    expect(namedPlaces(runtime).some((p) => p.name === "Kookerbos")).toBe(false);
  });

  it("reserves two small woods plots for the founder and Gerhard, unowned for signup purchase", () => {
    for (const seed of SEEDS) {
      const runtime = new ColonyRuntime(seed);
      const lots = sortedKookerbosLots(runtime);
      const reserved = lots.filter((lot) => lot.reservedFor);
      expect(lots.length, `seed ${seed} has two Kookerbos houses`).toBeGreaterThanOrEqual(2);
      expect(
        reserved.map((lot) => lot.reservedFor).sort(),
        `seed ${seed} Kookerbos reservations`,
      ).toEqual([...KOOKERBOS_RESERVED].sort());
      for (const lot of reserved) {
        expect(lot.w, `seed ${seed} ${lot.id} stays a small woods plot`).toBeLessThanOrEqual(11);
        expect(lot.h, `seed ${seed} ${lot.id} stays a small woods plot`).toBeLessThanOrEqual(14);
        expect(lot.ownerCitizenId, `seed ${seed} ${lot.id} can still be bought by its reserved citizen`).toBeUndefined();
        expect(lot.built, `seed ${seed} ${lot.id} remains unbuilt until bought`).toBe(false);
      }
    }
  });

  it("keeps every Kookerbos plot footprint road-clear, road-adjacent-clear, beach-clear, sea-clear and buildable", () => {
    for (const seed of SEEDS) {
      const runtime = new ColonyRuntime(seed);
      const terrain = runtime.sim.state.terrain;
      const roads = new Set(runtime.sim.state.roads.map((c) => `${c.x},${c.y}`));
      const offenders: string[] = [];
      for (const lot of sortedKookerbosLots(runtime)) {
        const b = footprintBox(lot);
        for (let y = b.minY; y <= b.maxY; y++) {
          for (let x = b.minX; x <= b.maxX; x++) {
            const i = terrain.idx(x, y);
            const biome = terrain.biome[i];
            for (const [dx, dy] of [
              [0, 0],
              [1, 0],
              [-1, 0],
              [0, 1],
              [0, -1],
            ] as const) {
              if (roads.has(`${x + dx},${y + dy}`))
                offenders.push(`seed ${seed} ${lot.id} road-clearance ${x},${y} touches road ${x + dx},${y + dy}`);
            }
            if (terrain.buildable[i] === 0) offenders.push(`seed ${seed} ${lot.id} unbuildable ${x},${y}`);
            if (terrain.isWater(x, y)) offenders.push(`seed ${seed} ${lot.id} water ${x},${y}`);
            if ([Biome.Beach, Biome.Ocean, Biome.Shallows].includes(biome))
              offenders.push(`seed ${seed} ${lot.id} ${Biome[biome]} ${x},${y}`);
          }
        }
      }
      expect(offenders).toEqual([]);
    }
  });

  it("extends the Kookerbos lane beyond the reserved houses so both front the woods road", () => {
    for (const seed of SEEDS) {
      const runtime = new ColonyRuntime(seed);
      const roads = new Set(runtime.sim.state.roads.map((c) => `${c.x},${c.y}`));
      const reserved = sortedKookerbosLots(runtime).filter((lot) => lot.reservedFor);
      expect(reserved).toHaveLength(2);
      for (const lot of reserved) {
        const drivewayRoadFrontage = lot.driveway.some((c) =>
          [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ].some(([dx, dy]) => roads.has(`${c.x + dx},${c.y + dy}`)),
        );
        expect(drivewayRoadFrontage, `seed ${seed} ${lot.id} road frontage`).toBe(true);
      }
    }
  });
});
