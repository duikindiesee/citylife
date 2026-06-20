import { describe, it, expect } from "vitest";
import { ColonySim } from "../src/colony/sim";
import {
  makeNeighborhood,
  type Parcel,
  type Neighborhood,
} from "../src/colony/neighborhood";
import { Biome } from "../src/colony/terrain";
import { cellOk } from "../src/colony/pathfind";

// Spec 084 S6 — at the 608 world a fresh terrain costs ~1s; several tests loop the same SEEDS, so
// without memoising, the seed-loop tests crossed vitest's 5s default under full-suite load and
// timed out. Generate each seed's terrain ONCE and reuse it (makeNeighborhood only reads terrain).
const TERRAIN_CACHE = new Map<number, ReturnType<typeof makeTerrain>>();
function makeTerrain(seed: number) {
  return new ColonySim(seed).state.terrain;
}
function terrain(seed: number) {
  let t = TERRAIN_CACHE.get(seed);
  if (!t) {
    t = makeTerrain(seed);
    TERRAIN_CACHE.set(seed, t);
  }
  return t;
}

/** The W x D footprint of a parcel = the bounding box of its fence ring. */
function footprintBox(p: Parcel) {
  const xs = p.fence.map((c) => c.x),
    ys = p.fence.map((c) => c.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function boxesTouch(
  a: ReturnType<typeof footprintBox>,
  b: ReturnType<typeof footprintBox>,
): boolean {
  // True if the boxes overlap or are adjacent (inflate a by 1 then test intersection).
  return (
    a.minX - 1 <= b.maxX &&
    a.maxX + 1 >= b.minX &&
    a.minY - 1 <= b.maxY &&
    a.maxY + 1 >= b.minY
  );
}

// Seeds that produce a populated homestead band (the colony always lands on coastal flatland).
const SEEDS = [42, 7, 99, 3, 11];

describe("the Neighbourhood — large homestead parcels on a terrain-aware street", () => {
  it("lays a spine street with at least two homestead parcels", () => {
    const n = makeNeighborhood(terrain(42));
    expect(n.spine.length).toBeGreaterThan(8);
    expect(n.carriage.length).toBeGreaterThan(n.spine.length); // widened to a real carriageway
    expect(n.parcels.length).toBeGreaterThanOrEqual(2);
    expect(n.lots).toBe(n.parcels); // back-compat alias
  });

  it("every road + verge cell is on dry buildable ground (never over water)", () => {
    for (const s of SEEDS) {
      const t = terrain(s);
      const n = makeNeighborhood(t);
      for (const c of [...n.carriage, ...n.verge]) {
        expect(cellOk(t, c.x, c.y)).toBe(true);
        expect(t.isWater(c.x, c.y)).toBe(false);
      }
    }
  });

  it("every cell of every parcel footprint is buildable, dry and non-rock", () => {
    for (const s of SEEDS) {
      const t = terrain(s);
      const n = makeNeighborhood(t);
      for (const p of n.parcels) {
        const b = footprintBox(p);
        for (let y = b.minY; y <= b.maxY; y++) {
          for (let x = b.minX; x <= b.maxX; x++) {
            const i = t.idx(x, y);
            expect(t.buildable[i]).not.toBe(0);
            expect(t.isWater(x, y)).toBe(false);
            expect([
              Biome.Mountain,
              Biome.Peak,
              Biome.Ocean,
              Biome.Shallows,
            ]).not.toContain(t.biome[i]);
          }
        }
      }
    }
  });

  it("parcels never overlap and keep a real gap between them (no wall-to-wall)", () => {
    for (const s of SEEDS) {
      const n = makeNeighborhood(terrain(s));
      const boxes = n.parcels.map(footprintBox);
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          expect(boxesTouch(boxes[i]!, boxes[j]!)).toBe(false);
        }
      }
    }
  });

  it("each parcel is a homestead: house set back from the street, with a garden and a farm", () => {
    const n = makeNeighborhood(terrain(42));
    for (const p of n.parcels) {
      // A front yard exists: the driveway runs from the verge across the setback to the door.
      expect(p.driveway.length).toBeGreaterThanOrEqual(3);
      // The driveway must actually REACH the door cell (no one-cell gap).
      expect(p.driveway[p.driveway.length - 1]).toEqual({
        x: p.doorX,
        y: p.doorY,
      });
      // House, garden and farm are all real, non-empty zones.
      expect(p.houseZone.w).toBeGreaterThanOrEqual(3);
      expect(p.houseZone.d).toBeGreaterThanOrEqual(3);
      expect(p.garden.w).toBeGreaterThan(0);
      expect(p.garden.d).toBeGreaterThan(0);
      expect(p.farm.w).toBeGreaterThan(0);
      expect(p.farm.d).toBeGreaterThan(0);
      // The house never sits on the road.
      const street = new Set(n.carriage.map((c) => `${c.x},${c.y}`));
      for (let y = p.houseZone.y; y < p.houseZone.y + p.houseZone.d; y++) {
        for (let x = p.houseZone.x; x < p.houseZone.x + p.houseZone.w; x++) {
          expect(street.has(`${x},${y}`)).toBe(false);
        }
      }
    }
  });

  it("every parcel has road frontage — its driveway meets the carriageway", () => {
    const n = makeNeighborhood(terrain(42));
    const carriage = new Set(n.carriage.map((c) => `${c.x},${c.y}`));
    for (const p of n.parcels) {
      const street = p.driveway[0]!; // the verge-most driveway cell
      const adjacent = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].some(([dx, dy]) => carriage.has(`${street.x + dx!},${street.y + dy!}`));
      expect(adjacent).toBe(true);
    }
  });

  it("parcels start unbuilt and unowned with a distinct house seed", () => {
    const n = makeNeighborhood(terrain(7));
    for (const p of n.parcels) {
      expect(p.built).toBe(false);
      expect(p.ownerCitizenId).toBeUndefined();
      expect(p.doorX).toBeTypeOf("number");
      expect(p.doorY).toBeTypeOf("number");
    }
  });

  it("is deterministic by terrain", () => {
    const a = makeNeighborhood(terrain(99)) as Neighborhood;
    const b = makeNeighborhood(terrain(99)) as Neighborhood;
    expect(a).toEqual(b);
  });
});
