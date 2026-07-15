import { beforeAll, describe, expect, it } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { RNG } from "../src/engine/rng";
import { Terrain } from "../src/colony/terrain";
import {
  computeColliderHeights,
  colliderScale,
  COLLIDER_CENTER,
} from "../src/colony/render/terrainCollider";

// Regression (2026-07-10): rapier heightfields read `heights` COLUMN-MAJOR (j*(nrows+1)+i,
// columns along X, rows along Z), but R3FTerrain filled the array row-major — the physics
// island was the visual island MIRRORED across the X/Z diagonal. 85% of land cells carried
// >1 m of collider/ground mismatch (worst ~20 m): the walker fell through every asymmetric
// hill and bounced on the spec-134 guardrail. This test stands rapier up for real, mounts
// the collider EXACTLY as the component does (same heights array, same args, same body
// centre), and raycasts straight down: the physics ground must equal the rendered ground.

const wx = (cell: number, N: number) => (cell - N / 2) * 4;

let terrain: Terrain;
let world: RAPIER.World;

function mountCollider(heights: Float32Array, N: number): RAPIER.World {
  const w = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const body = w.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(...COLLIDER_CENTER),
  );
  w.createCollider(
    RAPIER.ColliderDesc.heightfield(N - 1, N - 1, heights, colliderScale(N)),
    body,
  );
  w.step(); // build broad-phase so castRay sees the collider
  return w;
}

/** Physics ground height at a CELL's mesh position, via a straight-down raycast. */
function physicsGroundAt(
  w: RAPIER.World,
  x: number,
  y: number,
  N: number,
): number | null {
  const ray = new RAPIER.Ray(
    { x: wx(x, N), y: 500, z: wx(y, N) },
    { x: 0, y: -1, z: 0 },
  );
  const hit = w.castRay(ray, 1000, true);
  if (!hit) return null;
  const toi = (hit as any).timeOfImpact ?? (hit as any).toi;
  return 500 - toi;
}

beforeAll(async () => {
  await RAPIER.init();
  terrain = new Terrain(new RNG(4242));
  world = mountCollider(computeColliderHeights(terrain, null), terrain.size);
});

describe("terrain heightfield collider parity (physics ground == rendered ground)", () => {
  it("fills the rapier array column-major (h[x*N + y] carries cell (x, y))", () => {
    const N = terrain.size;
    const h = computeColliderHeights(terrain, null);
    // Probe a handful of strongly asymmetric cells — under the old row-major fill these
    // slots carried the MIRRORED cell's height.
    for (const [x, y] of [
      [10, 300],
      [300, 10],
      [238, 478],
      [478, 238],
    ] as const) {
      expect(h[x * N + y]).toBeCloseTo(terrain.worldY(x, y), 5);
    }
  });

  it("raycasts hit the rendered height on the most transpose-sensitive cells", () => {
    const N = terrain.size;
    // Find the worst |worldY(x,y) - worldY(y,x)| land cells — exactly where the old
    // transposed collider dropped the walker through the mesh.
    const probes: Array<{ x: number; y: number; d: number }> = [];
    for (let y = 2; y < N - 2; y += 3) {
      for (let x = 2; x < N - 2; x += 3) {
        const g = terrain.worldY(x, y);
        if (g <= 0.2) continue;
        const d = Math.abs(g - terrain.worldY(y, x));
        probes.push({ x, y, d });
      }
    }
    probes.sort((a, b) => b.d - a.d);
    const worst = probes.slice(0, 12);
    expect(worst[0]!.d).toBeGreaterThan(3); // the island IS asymmetric — probes are real
    for (const { x, y } of worst) {
      const hit = physicsGroundAt(world, x, y, N);
      expect(hit).not.toBeNull();
      // Sample points land exactly on mesh vertices, so vertex-perfect within float noise.
      expect(Math.abs(hit! - terrain.worldY(x, y))).toBeLessThan(0.11);
    }
  });

  it("raycasts match across an even grid sweep of the whole island", () => {
    const N = terrain.size;
    for (let y = 10; y < N - 10; y += 61) {
      for (let x = 10; x < N - 10; x += 61) {
        const hit = physicsGroundAt(world, x, y, N);
        expect(hit).not.toBeNull();
        expect(Math.abs(hit! - terrain.worldY(x, y))).toBeLessThan(0.11);
      }
    }
  });

  it("carries terrainLevel overrides at the overridden cell", () => {
    const N = terrain.size;
    const x = 238,
      y = 478;
    const raised = terrain.worldY(x, y) + 7.5;
    const level = new Map<number, number>([[y * N + x, raised]]);
    const w = mountCollider(computeColliderHeights(terrain, level), N);
    const hit = physicsGroundAt(w, x, y, N);
    expect(hit).not.toBeNull();
    expect(Math.abs(hit! - raised)).toBeLessThan(0.11);
  });
});
