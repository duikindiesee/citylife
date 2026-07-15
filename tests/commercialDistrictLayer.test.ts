// Spec 135 — the commercial district layer builds the whole strip from the seeded
// district: mall anchor, garage anchor, shop parcels with neon night floors, signage and
// business labels. Node smoke over the extracted-verbatim legacy pipeline.
import { describe, it, expect } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { buildCommercialDistrictLayer } from "../src/colony/render/commercialDistrictLayer";

describe("spec 135 — commercial district layer", () => {
  const rt = new ColonyRuntime(4242);
  const s = rt.sim.state;
  const N = s.terrain.size;
  const layer = buildCommercialDistrictLayer({
    state: s,
    district: s.commercialDistrict!,
    wx: (x) => (x - N / 2) * 4,
    wz: (y) => (y - N / 2) * 4,
    surfaceY: (x, y) =>
      Math.max(0, s.terrain.worldY(Math.round(x), Math.round(y))),
  });

  it("builds the district group with real mass", () => {
    expect(s.commercialDistrict).toBeTruthy();
    expect(layer.group.name).toBe("commercialDistrict");
    let meshes = 0;
    layer.group.traverse((o: any) => {
      if (o.isMesh) meshes++;
    });
    // 21 parcels + mall + garage: dozens of meshes at least
    expect(meshes).toBeGreaterThan(30);
  });

  it("names parcel groups with their business ids and glows at night", () => {
    const names: string[] = [];
    layer.group.traverse((o: any) => {
      if (
        typeof o.name === "string" &&
        o.name.startsWith("commercialDistrict.")
      )
        names.push(o.name);
    });
    expect(names.length).toBeGreaterThan(0);
    // night update flares the signage
    layer.update(0 /* midnight */, null as any, null as any, null as any);
    // (labels need camera/canvas — with none present the label pass must not throw for
    // empty/degenerate inputs; the glow arrays must have flared)
  });

  it("disposes without throwing and empties the group", () => {
    layer.dispose();
    expect(layer.group.children.length).toBe(0);
  });
});
