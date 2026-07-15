import { describe, expect, it, vi } from "vitest";
import type { Terrain } from "../src/colony/terrain";
import { commercialBlockSeatY } from "../src/colony/render/commercialBlockSeat";
import type { CommercialCluster } from "../src/colony/render/commercialClusters";
// @ts-ignore - Vite raw import pins the ZoneManager wiring contract.
import rendererSource from "../src/colony/render/R3FPlanetRenderer.tsx?raw";

const cluster: CommercialCluster = {
  id: "painted-run",
  x: 99,
  y: 77,
  count: 3,
  footprint: { x: 10, y: 18, w: 9, d: 7 },
};

describe("spec 139 CommercialBlock pad seat", () => {
  it("samples the shared padSeatY formula over the cluster footprint with house epsilon", () => {
    const worldYAt = vi.fn(() => 7.5);
    const terrain = { worldYAt } as unknown as Terrain;

    expect(commercialBlockSeatY(terrain, cluster)).toBeCloseTo(7.52, 8);
    expect(worldYAt).toHaveBeenCalledWith(14, 21);
  });

  it("wires ZoneManager to the shared cluster seat instead of absolute y zero", () => {
    expect(rendererSource).toContain("commercialBlockSeatY(state.terrain, c)");
    expect(rendererSource).not.toContain("position={[(c.x - size / 2) * 4, 0, (c.y - size / 2) * 4]}");
  });
});
