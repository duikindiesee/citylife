// WORLD.KOKERBOOM.2 — the quiver tree grows on the dunes, and never inside a building.
//
// TWO changes, and each fails independently:
//
// 1. DRY COUNTRY, not just rocky. Highland/Mountain only was too narrow to see: the town stands on
//    Plains, so the world's signature tree grew exclusively where the player never looks. Measured on
//    booted worlds with the old rule — 37 trees on seed 4242, 14 on seed 7, 12 on seed 314, across a
//    whole 608-cell world, none near the colony. With the dunes: 82, 65, 10 (314 has no Plains at all,
//    so it gains nothing and correctly loses two that stood in footprints).
//
// 2. CLEAR RECTS ARE HONOURED. R3FQuiverTrees passed `[]` — it cleared NOTHING. That was survivable
//    only while the trees were confined to the hills. Measured on booted worlds, 7 trees on seed 4242
//    and 9 on seeds 1234/42 were ALREADY being sited inside lots, parcels, junctions or pads before
//    the dunes were opened up. A placed kokerboom is never removed by later construction — that is
//    what "protected" means here — so each of those stays inside a house forever.
import { describe, expect, it } from "vitest";
import { calculateQuiverTrees } from "../src/colony/render/quiverTreeLogic";
import { Biome } from "../src/colony/terrain";

const N = 220;
const SEA = 0;

/** A flat dry world of one biome, big enough that the 1-in-900 rarity yields a real stand. */
function worldOf(biome: Biome) {
  const size = N * N;
  return {
    size: N,
    biome: new Uint8Array(size).fill(biome),
    elev: new Float32Array(size).fill(SEA + 1),
    water: new Uint8Array(size),
    worldY: () => 0,
  };
}

describe("WORLD.KOKERBOOM.2 — where the kokerboom grows", () => {
  it("grows on the open dunes", () => {
    const trees = calculateQuiverTrees(worldOf(Biome.Plains), SEA, []);
    // On the old rule this was exactly zero — Plains was in the reject list.
    expect(
      trees.length,
      "a whole world of dune must carry a stand of kokerbome",
    ).toBeGreaterThan(20);
  });

  it("still grows on the rocky ground it always did", () => {
    expect(
      calculateQuiverTrees(worldOf(Biome.Highland), SEA, []).length,
    ).toBeGreaterThan(20);
    expect(
      calculateQuiverTrees(worldOf(Biome.Mountain), SEA, []).length,
    ).toBeGreaterThan(20);
  });

  it("never grows on the tideline or in the damp hollow", () => {
    // Beach would be wrong for the species; Forest is where the neon flora lives, and keeping the two
    // layers on different ground is what stops them reading as one mixed thicket.
    expect(calculateQuiverTrees(worldOf(Biome.Beach), SEA, []).length).toBe(0);
    expect(calculateQuiverTrees(worldOf(Biome.Forest), SEA, []).length).toBe(0);
    expect(calculateQuiverTrees(worldOf(Biome.Ocean), SEA, []).length).toBe(0);
  });

  it("is never sited inside a cleared footprint", () => {
    const rect = { x0: 60, y0: 60, x1: 120, y1: 120 };
    const open = calculateQuiverTrees(worldOf(Biome.Plains), SEA, []);
    const cleared = calculateQuiverTrees(worldOf(Biome.Plains), SEA, [rect]);

    // QuiverTree carries BOTH the source cell (x, y) and the jittered world point. The clear test is
    // about the cell it was sited from, which is what calculateQuiverTrees actually screens.
    const inside = (t: { x: number; y: number }) =>
      t.x >= rect.x0 && t.x <= rect.x1 && t.y >= rect.y0 && t.y <= rect.y1;

    // Non-vacuity: the rect must actually have contained trees, or "none inside" proves nothing.
    expect(
      open.filter(inside).length,
      "the fixture rect must contain trees when uncleared",
    ).toBeGreaterThan(0);

    expect(cleared.filter(inside).length, "trees inside a cleared rect").toBe(
      0,
    );
    // And clearing must not disturb the rest of the world.
    expect(cleared.length).toBe(open.length - open.filter(inside).length);
  });

  it("keeps a range of ages, so some are giants and most are young", () => {
    const trees = calculateQuiverTrees(worldOf(Biome.Plains), SEA, []);
    const ages = trees.map((t) => t.age);
    expect(Math.max(...ages)).toBeGreaterThan(0.6);
    expect(Math.min(...ages)).toBeLessThan(0.2);
    // Biased young: an old giant must stay genuinely uncommon.
    expect(ages.filter((a) => a > 0.7).length / ages.length).toBeLessThan(0.25);
  });
});
