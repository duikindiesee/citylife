import { describe, it, expect } from "vitest";
import { ColonySim, findFoundersLighthouseSite } from "../src/colony/sim";
import { COLONY } from "../src/colony/config";
import { addSettler } from "../src/colony/settlers";
import { autoGrow } from "../src/colony/build";
import type { KookerCard } from "../src/colony/kooker";
import { RNG } from "../src/engine/rng";
import { Biome, Terrain } from "../src/colony/terrain";

describe("Base placement (rocket / solar / battery / caravan)", () => {
  const seeds = [1, 7, 42, 99, 123, 314, 777, 2026];

  for (const seed of seeds) {
    describe(`seed ${seed}`, () => {
      const sim = new ColonySim(seed);
      const s = sim.state;
      const caravan = s.structures.find((x) => x.kind === "caravan")!;
      const B = COLONY.build.block;
      const HALF = B >> 1;
      const onRoadFrame = (px: number, py: number) =>
        (((px - (caravan.x - HALF)) % B) + B) % B === 0 ||
        (((py - (caravan.y - HALF)) % B) + B) % B === 0;

      it("every structure sits on land (no water under the base)", () => {
        for (const st of s.structures) {
          expect(s.terrain.isWater(st.x, st.y)).toBe(false);
        }
      });
      it("rocket / solar / battery sit INSIDE block (0,0) — never on the road frame", () => {
        for (const st of s.structures) {
          if (st.kind === "caravan" || st.kind === "lighthouse") continue;
          expect(onRoadFrame(st.x, st.y)).toBe(false);
        }
      });
      it("structure footprints clear the road frame (wide meshes do not spill onto roads)", () => {
        for (const st of s.structures) {
          if (st.kind === "caravan" || st.kind === "lighthouse") continue;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              expect(onRoadFrame(st.x + dx, st.y + dy)).toBe(false);
            }
          }
        }
      });
      it("no two structures share a cell", () => {
        const seen = new Set<string>();
        for (const st of s.structures) {
          const k = `${st.x},${st.y}`;
          expect(seen.has(k)).toBe(false);
          seen.add(k);
        }
      });
      it("no road cell is laid on top of a structure", () => {
        for (const st of s.structures) {
          expect(s.roadSet.has(`${st.x},${st.y}`)).toBe(false);
        }
      });
      it("seeds a lighthouse on dry buildable shore near the founders coast", () => {
        const lighthouse = s.structures.find((st) => st.kind === "lighthouse");
        expect(lighthouse).toBeTruthy();
        const st = lighthouse!;
        const i = s.terrain.idx(st.x, st.y);
        expect(s.terrain.isWater(st.x, st.y)).toBe(false);
        expect(s.terrain.buildable[i]).not.toBe(0);
        expect(s.terrain.distToWater[i]).toBeGreaterThan(0);
        expect(s.terrain.distToWater[i]).toBeLessThanOrEqual(
          COLONY.world.coastSearch,
        );
        expect(
          s.terrain.biome[i] === Biome.Beach ||
            s.terrain.distToWater[i]! <= COLONY.world.coastSearch,
        ).toBe(true);
      });
      it("lighthouse placement is deterministic", () => {
        const again = new ColonySim(seed);
        expect(
          again.state.structures.find((st) => st.kind === "lighthouse"),
        ).toEqual(s.structures.find((st) => st.kind === "lighthouse"));
      });
    });
  }
});

describe("Founders Lighthouse placement helper", () => {
  it("places the render-seed lighthouse on the north-west Rockery Beach headland", () => {
    const s = new ColonySim(COLONY.render.seed).state;
    const lighthouse = s.structures.find((st) => st.kind === "lighthouse");
    expect(lighthouse).toBeTruthy();
    const target = {
      x: Math.round(s.terrain.landing.x - s.terrain.size * 0.36),
      y: Math.round(s.terrain.landing.y - s.terrain.size * 0.09),
    };
    expect(
      Math.hypot(lighthouse!.x - target.x, lighthouse!.y - target.y),
    ).toBeLessThanOrEqual(18);
    expect(
      Math.hypot(
        lighthouse!.x - s.terrain.landing.x,
        lighthouse!.y - s.terrain.landing.y,
      ),
    ).toBeGreaterThan(180);
  });

  it("degrades gracefully when no dry buildable shore exists", () => {
    const t = new Terrain(new RNG(42));
    t.water.fill(1);
    t.buildable.fill(0);
    t.distToWater.fill(0);
    t.elev.fill(0);
    t.biome.fill(Biome.Ocean);
    expect(findFoundersLighthouseSite(t)).toBeNull();
  });
});

describe("Homes + buildings keep clear of the base structures (no rocket-in-house)", () => {
  for (const seed of [1, 42, 777, 2026]) {
    it(`seed ${seed}: nothing is placed within one cell of rocket / solar / battery`, () => {
      const sim = new ColonySim(seed);
      const s = sim.state;
      const seeds = s.structures.filter((st) => st.kind !== "caravan");
      // Populate the colony: a dozen settler homes + a run of auto-grown buildings.
      for (let i = 0; i < 12; i++)
        addSettler(s, sim.rng, {
          id: 5000 + i,
          name: `T${i}`,
        } as unknown as KookerCard);
      for (let i = 0; i < 30; i++) autoGrow(s, sim.rng);

      const occupants = [
        ...s.settlers.map((h) => ({ x: h.x, y: h.y, what: "home" })),
        ...s.buildings.map((b) => ({ x: b.x, y: b.y, what: "building" })),
        ...s.jobs.map((j) => ({ x: j.x, y: j.y, what: "job" })),
      ];
      expect(occupants.length).toBeGreaterThan(0); // sanity: placement actually happened

      // Chebyshev distance from every occupant to every base structure must exceed 1 (no shared cell,
      // no adjacent cell where the wide rocket/solar meshes would intrude).
      for (const o of occupants) {
        for (const st of seeds) {
          const cheb = Math.max(Math.abs(o.x - st.x), Math.abs(o.y - st.y));
          expect(
            cheb,
            `${o.what} at ${o.x},${o.y} too close to ${st.kind} at ${st.x},${st.y}`,
          ).toBeGreaterThan(1);
        }
      }
      // And no two things (occupant or structure) ever share a cell.
      const cells = new Set<string>();
      for (const o of [...occupants, ...s.structures]) {
        const k = `${o.x},${o.y}`;
        expect(cells.has(k), `cell collision at ${k}`).toBe(false);
        cells.add(k);
      }
    });
  }
});
