import { describe, expect, it } from "vitest";
import {
  CAR_PARTS,
  partFits,
  validCarParts,
  deriveStats,
} from "../src/colony/car/carParts";
import { buildCarMesh } from "../src/colony/car/carMesh";
import { defaultCarSpec } from "../src/colony/car/carSpec";

// Spec 096 H — body ops. A roof chop is a part on the new "body" socket: instead of bolting on a child
// mesh it RESHAPES the car (the cabin drops to a hot-rod silhouette, like the wheels socket reshapes the
// tyres), and it sheds weight for a little more acceleration and grip. Pure + deterministic.
describe("body mod — roof chop (096 H)", () => {
  it("fits the body socket and folds its handling deltas into derived stats", () => {
    expect(CAR_PARTS.roof_chop.socket).toBe("body");
    expect(partFits("body", "roof_chop")).toBe(true);
    expect(partFits("engine", "roof_chop")).toBe(false);
    // the body socket is independent — a chop can coexist with an engine + wheels part
    expect(validCarParts(["roof_chop", "blower", "slicks"])).toEqual([
      "roof_chop",
      "blower",
      "slicks",
    ]);
    const stock = defaultCarSpec("p1");
    const chopped = { ...stock, parts: ["roof_chop"] };
    const s0 = deriveStats(stock);
    const s1 = deriveStats(chopped);
    expect(s1.acceleration).toBeGreaterThan(s0.acceleration);
    expect(s1.grip).toBeGreaterThan(s0.grip);
    expect(s1.topSpeed).toBe(s0.topSpeed); // the chop only touches accel + grip
  });

  it("lowers the cabin in the mesh without adding a child mesh", () => {
    type MeshLike = {
      isMesh?: boolean;
      geometry?: {
        parameters?: { width?: number; depth?: number; height?: number };
      };
      position: { y: number };
    };
    const countMeshes = (g: ReturnType<typeof buildCarMesh>) => {
      let n = 0;
      g.traverse((o) => {
        if ((o as unknown as MeshLike).isMesh) n++;
      });
      return n;
    };
    const cabinOf = (g: ReturnType<typeof buildCarMesh>): MeshLike | null => {
      let cabin: MeshLike | null = null;
      g.traverse((o) => {
        const m = o as unknown as MeshLike;
        if (
          m.isMesh &&
          m.geometry?.parameters?.width === 0.5 &&
          m.geometry?.parameters?.depth === 0.4
        )
          cabin = m;
      });
      return cabin;
    };

    const stock = defaultCarSpec("p1");
    const chopped = { ...stock, parts: ["roof_chop"] };
    const gStock = buildCarMesh(stock);
    const gChop = buildCarMesh(chopped);

    // a reshape, not a bolt-on: no extra mesh appears
    expect(countMeshes(gChop)).toBe(countMeshes(gStock));
    const c0 = cabinOf(gStock)!;
    const c1 = cabinOf(gChop)!;
    expect(c0).toBeTruthy();
    expect(c1).toBeTruthy();
    // the chopped cabin is shorter and sits lower
    expect(c1.geometry!.parameters!.height!).toBeLessThan(
      c0.geometry!.parameters!.height!,
    );
    expect(c1.position.y).toBeLessThan(c0.position.y);
  });
});
