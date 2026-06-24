import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  defaultCarSpec,
  safeCarSpec,
  STOCK_STATS,
  type CarSpec,
} from "../src/colony/car/carSpec";
import { buildCarMesh } from "../src/colony/car/carMesh";
import { loadCar, saveCar } from "../src/colony/car/garageStore";

describe("car spec (096 Slice A)", () => {
  it("builds a deterministic, valid default car per player id", () => {
    const a1 = defaultCarSpec("citizen_joe");
    const a2 = defaultCarSpec("citizen_joe");
    expect(a1).toEqual(a2); // deterministic, no rng
    expect(a1.stats).toEqual(STOCK_STATS);
    expect(a1.id).toBe("car:citizen-joe");
    // two players differ in paint at a glance
    const b = defaultCarSpec("citizen_viw");
    expect(a1.paint).not.toEqual(b.paint);
    // a default is always a safe spec
    expect(safeCarSpec(a1)).toEqual(a1);
  });

  it("clamps stats, validates colours, and screens an unsafe name", () => {
    const dirty = {
      id: "car:x",
      name: "my kooker rod", // brand word -> rejected by isPublicSafe
      stats: { topSpeed: 9, acceleration: -3, grip: NaN, braking: 0.7 },
      paint: { body: -5, cabin: 0x1000000, accent: 1.9 },
    };
    const safe = safeCarSpec(dirty)!;
    expect(safe).toBeTruthy();
    expect(safe.name).toBe("Stock Rod"); // unsafe name replaced
    expect(safe.stats.topSpeed).toBe(1);
    expect(safe.stats.acceleration).toBe(0);
    expect(safe.stats.grip).toBe(0.5); // NaN -> default
    expect(safe.stats.braking).toBeCloseTo(0.7, 5);
    expect(safe.paint.body).toBeGreaterThanOrEqual(0);
    expect(safe.paint.cabin).toBeLessThanOrEqual(0xffffff);
    expect(safe.paint.accent).toBe(1); // floored
  });

  it("rejects an unusable spec and serializes round-trip", () => {
    expect(safeCarSpec(null)).toBeNull();
    expect(safeCarSpec({})).toBeNull(); // no id
    const spec = defaultCarSpec("p1");
    const round = safeCarSpec(JSON.parse(JSON.stringify(spec)));
    expect(round).toEqual(spec);
  });

  it("buildCarMesh renders parts with night-safe emissive (< 0.9 bloom)", () => {
    const g = buildCarMesh(defaultCarSpec("p1"));
    let meshes = 0;
    let emissiveParts = 0;
    g.traverse((o) => {
      const m = o as unknown as {
        isMesh?: boolean;
        material?: {
          emissive?: { getHex: () => number };
          emissiveIntensity?: number;
        };
      };
      if (!m.isMesh || !m.material) return;
      meshes++;
      const mat = m.material;
      if (mat.emissive && mat.emissive.getHex() !== 0) {
        emissiveParts++;
        expect(mat.emissiveIntensity ?? 0).toBeLessThan(0.9);
      }
    });
    expect(meshes).toBeGreaterThanOrEqual(8); // body, cabin, stripe, 4 wheels, 2 lights
    expect(emissiveParts).toBeGreaterThanOrEqual(2); // stripe + headlights glow
  });

  it("mounts bolt-on parts on the car and reshapes the wheels", () => {
    const countMeshes = (g: ReturnType<typeof buildCarMesh>) => {
      let n = 0;
      g.traverse((o) => {
        if ((o as { isMesh?: boolean }).isMesh) n++;
      });
      return n;
    };
    const stock = defaultCarSpec("p1");
    const stockMeshes = countMeshes(buildCarMesh(stock));
    const tuned = { ...stock, parts: ["blower", "ducktail_spoiler", "slicks"] };
    const tunedMeshes = countMeshes(buildCarMesh(tuned));
    // slicks reshape the existing four wheels (no new mesh); blower + ducktail each add one
    expect(tunedMeshes).toBe(stockMeshes + 2);
  });
});

describe("garage store (096 Slice A)", () => {
  const realLS = (globalThis as { localStorage?: Storage }).localStorage;
  beforeEach(() => {
    const map = new Map<string, string>();
    (globalThis as { localStorage?: Storage }).localStorage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
      clear: () => map.clear(),
      key: () => null,
      length: 0,
    } as Storage;
  });
  afterEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage = realLS;
  });

  it("returns a default car for an empty garage and round-trips a saved one", () => {
    expect(loadCar("citizen_joe")).toEqual(defaultCarSpec("citizen_joe"));
    const mine: CarSpec = {
      id: "car:citizen-joe",
      name: "Night Owl",
      stats: { topSpeed: 0.8, acceleration: 0.6, grip: 0.4, braking: 0.5 },
      paint: { body: 0x123456, cabin: 0x222222, accent: 0xffd25a },
      parts: [],
    };
    saveCar("citizen_joe", mine);
    expect(loadCar("citizen_joe")).toEqual(mine);
    // a different player is untouched
    expect(loadCar("citizen_viw")).toEqual(defaultCarSpec("citizen_viw"));
  });
});
