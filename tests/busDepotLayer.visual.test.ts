import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildBusDepotLayer } from "../src/colony/render/busDepotLayer";
import { depotLayout, type DepotSite } from "../src/colony/transit/busDepot";

// Spec 149 visual contract: the cut-and-fill slab reaches below the lowest natural edge,
// remains proud of the graded drive plane, and five owned coaches get five separated bays.

describe("bus depot cut-and-fill foundation", () => {
  const site: DepotSite = {
    x: 20,
    y: 30,
    w: 12,
    h: 7,
    gate: { x: 26, y: 30 },
    roadCell: { x: 26, y: 28 },
    inward: { x: 0, y: 1 },
  };
  const layout = depotLayout(site, {
    baysTotal: 5,
    laneDepth: 2,
    bayDepth: 4.8,
  });
  const padTopY = 10.82;
  const foundationBottomY = 9.1;
  const layer = buildBusDepotLayer({
    site,
    layout,
    wx: (x) => x * 4,
    wz: (y) => y * 4,
    padTopY,
    foundationBottomY,
    roadTopY: 10.74,
  });

  it("keeps the apron on the exact drive plane and foundation below the lowest edge", () => {
    const apron = layer.getObjectByName("Depot_Apron") as THREE.Mesh;
    const foundation = layer.getObjectByName("Depot_Foundation") as THREE.Mesh;
    expect(apron).toBeTruthy();
    expect(foundation).toBeTruthy();
    const apronBox = new THREE.Box3().setFromObject(apron);
    const foundationBox = new THREE.Box3().setFromObject(foundation);
    expect(apronBox.max.y).toBeCloseTo(padTopY, 6);
    expect(foundationBox.max.y).toBeGreaterThan(apronBox.min.y);
    expect(foundationBox.min.y).toBeLessThanOrEqual(foundationBottomY + 1e-6);
    expect(apron.userData.padTopY).toBe(padTopY);
    expect(foundation.userData.foundationBottomY).toBeLessThanOrEqual(
      foundationBottomY,
    );
  });

  it("renders only the five owned-fleet bays at visibly separated centres", () => {
    const bays = layer.children
      .filter((o) => /^Depot_Bay_\d{2}$/.test(o.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    expect(bays).toHaveLength(5);
    for (let i = 1; i < bays.length; i++) {
      expect(
        bays[i]!.position.distanceTo(bays[i - 1]!.position),
      ).toBeGreaterThanOrEqual(6);
    }
  });

  it("bridges the apron gate to the public road with one named flared driveway throat", () => {
    const driveway = layer.getObjectByName("Depot_Driveway") as THREE.Mesh;
    expect(driveway).toBeTruthy();
    const box = new THREE.Box3().setFromObject(driveway);
    expect(
      box.containsPoint(
        new THREE.Vector3(site.gate.x * 4, padTopY, site.gate.y * 4),
      ),
    ).toBe(true);
    expect(
      box.containsPoint(
        new THREE.Vector3(
          site.roadCell.x * 4,
          (box.min.y + box.max.y) / 2,
          site.roadCell.y * 4,
        ),
      ),
    ).toBe(true);
    expect(box.min.y).toBeCloseTo(10.765, 4);
    expect(driveway.userData.padMouthWidthM).toBeGreaterThan(
      driveway.userData.roadMouthWidthM,
    );
  });
});
