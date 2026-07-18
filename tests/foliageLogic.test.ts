import { describe, expect, it } from "vitest";
import { calculateFoliagePositions } from "../src/colony/render/foliageLogic";
import { ribbonCoverage } from "../src/colony/render/roadRibbon";
import { Biome } from "../src/colony/terrain";

describe("foliage logic", () => {
  it("places trees only on land (elevation >= sea level)", () => {
    // Mock terrain where left half is land, right half is water
    const size = 16;
    const terrain = {
      size,
      elev: new Float32Array(size * size),
      water: new Uint8Array(size * size),
      biome: new Uint8Array(size * size),
      worldY: (x: number, y: number) => (x < 8 ? 0.2 : -0.2),
    };

    // Make left half plains (needs trees), right half ocean
    for (let i = 0; i < size * size; i++) {
      const x = i % size;
      terrain.elev[i] = x < 8 ? 0.4 : 0.1;
      terrain.water[i] = x < 8 ? 0 : 1;
      terrain.biome[i] = x < 8 ? Biome.Plains : Biome.Ocean;
    }

    const { matrices, colors } = calculateFoliagePositions(terrain, [], []);

    // We expect some trees to be generated
    expect(matrices.length).toBeGreaterThan(0);
    expect(matrices.length).toEqual(colors.length);

    // Ensure NO trees were placed on x >= 8
    // A matrix in THREE is a 16-element array, position X is at index 12
    for (let i = 0; i < matrices.length; i++) {
      const xPos = matrices[i][12];
      // The world X is (cellX - size/2) * LOT_SIZE.
      // So if cellX < 8, worldX < 0.
      expect(xPos).toBeLessThan(0);
    }
  });

  it("clears foliage around roads; buildings do not cull (no footprint field on ColonyBuilding)", () => {
    const size = 16;
    const terrain = {
      size,
      elev: new Float32Array(size * size).fill(0.4), // All land
      water: new Uint8Array(size * size).fill(0),
      biome: new Uint8Array(size * size).fill(Biome.Forest), // Dense trees
      worldY: (x: number, y: number) => 0.4,
    };

    const roads = [{ x: 8, y: 8 }];
    // Real sim buildings carry only id/x/y/artifact — no footprint — so they cannot clear trees.
    const buildings = [{ id: 1, x: 4, y: 4 }];

    const { matrices } = calculateFoliagePositions(terrain, roads, buildings);

    let treesNearBuilding = 0;
    for (let i = 0; i < matrices.length; i++) {
      const xPos = matrices[i][12];
      const zPos = matrices[i][14];

      const cellX = xPos / 4 + size / 2;
      const cellY = zPos / 4 + size / 2;

      // Road is at 8,8. We clear a 1-cell radius, so 7..9 is cleared
      const inRoadZone = cellX >= 7 && cellX <= 9 && cellY >= 7 && cellY <= 9;
      expect(inRoadZone).toBe(false);

      // Building is at 4,4 — trees there are EXPECTED (buildings have no clearance yet).
      if (cellX >= 3 && cellX <= 6 && cellY >= 3 && cellY <= 6)
        treesNearBuilding++;
    }
    expect(treesNearBuilding).toBeGreaterThan(0);
  });

  it("clears foliage from the actual widened ribbon footprint on curved roads", () => {
    const size = 24;
    const terrain = {
      size,
      elev: new Float32Array(size * size).fill(0.4),
      water: new Uint8Array(size * size).fill(0),
      biome: new Uint8Array(size * size).fill(Biome.Forest),
      idx: (x: number, y: number) => y * size + x,
      inBounds: (x: number, y: number) => x >= 0 && y >= 0 && x < size && y < size,
      worldY: () => 0.4,
    };
    const roadWays = [
      {
        kind: "avenue" as const,
        width: 4,
        path: [
          { x: 5, y: 5 },
          { x: 12, y: 8 },
          { x: 18, y: 16 },
        ],
      },
    ];
    const covered = ribbonCoverage(roadWays, terrain as any, () => 0.4);

    const { matrices } = calculateFoliagePositions(
      terrain,
      [],
      [],
      [],
      roadWays,
    );

    expect(covered.size).toBeGreaterThan(0);
    for (const matrix of matrices) {
      const cellX = Math.round(matrix[12] / 4 + size / 2);
      const cellY = Math.round(matrix[14] / 4 + size / 2);
      expect(covered.has(`${cellX},${cellY}`)).toBe(false);
    }
  });
});
