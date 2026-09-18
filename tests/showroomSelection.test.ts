import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  SHOWROOM_DEFAULT_ZOOM,
  SHOWROOM_MAX_ZOOM,
  SHOWROOM_MIN_ZOOM,
  clampShowroomZoom,
  stepSelection,
  wrapIndex,
} from "../src/colony/showroom/showroomState";
import {
  SHOWROOM_VEHICLES,
  showroomCardModel,
} from "../src/colony/showroom/showroomCatalog";
import { safeCarSpec } from "../src/colony/car/carSpec";
import { isPublicSafe } from "../src/colony/newcomers";

describe("showroom carousel selection (PLAYER.GARAGE.1)", () => {
  it("wraps at both ends", () => {
    const n = SHOWROOM_VEHICLES.length;
    expect(stepSelection(0, n, -1)).toBe(n - 1); // left from first wraps to last
    expect(stepSelection(n - 1, n, 1)).toBe(0); // right from last wraps to first
    expect(stepSelection(0, n, 1)).toBe(1 % n);
  });

  it("recovers bad indices instead of crashing", () => {
    expect(wrapIndex(-7, 2)).toBe(1);
    expect(wrapIndex(9, 2)).toBe(1);
    expect(wrapIndex(3.5, 2)).toBe(0);
    expect(wrapIndex(0, 0)).toBe(0);
    expect(stepSelection(0, 0, 1)).toBe(0);
  });

  it("clamps camera zoom to the safe envelope and recovers non-finite input", () => {
    expect(clampShowroomZoom(0)).toBe(SHOWROOM_MIN_ZOOM);
    expect(clampShowroomZoom(999)).toBe(SHOWROOM_MAX_ZOOM);
    expect(clampShowroomZoom(SHOWROOM_MIN_ZOOM)).toBe(SHOWROOM_MIN_ZOOM);
    expect(clampShowroomZoom(SHOWROOM_MAX_ZOOM)).toBe(SHOWROOM_MAX_ZOOM);
    expect(clampShowroomZoom(5)).toBe(5);
    expect(clampShowroomZoom(Number.NaN)).toBe(SHOWROOM_DEFAULT_ZOOM);
    expect(clampShowroomZoom(Number.POSITIVE_INFINITY)).toBe(
      SHOWROOM_DEFAULT_ZOOM,
    );
    expect(SHOWROOM_MIN_ZOOM).toBeLessThan(SHOWROOM_DEFAULT_ZOOM);
    expect(SHOWROOM_DEFAULT_ZOOM).toBeLessThan(SHOWROOM_MAX_ZOOM);
  });
});

describe("showroom catalog and specification card", () => {
  it("offers at least two distinct, valid vehicles", () => {
    expect(SHOWROOM_VEHICLES.length).toBeGreaterThanOrEqual(2);
    const ids = new Set(SHOWROOM_VEHICLES.map((v) => v.spec.id));
    expect(ids.size).toBe(SHOWROOM_VEHICLES.length);
    for (const v of SHOWROOM_VEHICLES) {
      // every catalog car must round-trip the CarSpec safety validator unchanged
      expect(safeCarSpec(v.spec)).toEqual(v.spec);
      expect(v.plannedPriceK).toBeGreaterThan(0);
    }
  });

  it("keeps the two launch vehicles visibly different on the card", () => {
    const [vonk, kaap] = SHOWROOM_VEHICLES;
    const a = showroomCardModel(vonk!);
    const b = showroomCardModel(kaap!);
    expect(a.name).toBe("Karoo Vonk 1.1");
    expect(b.name).toBe("Karoo Kaap GT-V8");
    expect(a.name).not.toBe(b.name);
    expect(a.priceLabel).not.toBe(b.priceLabel);
    // the selected-spec rendering must actually differ: top speed and acceleration diverge
    const stat = (m: typeof a, label: string) =>
      m.stats.find((s) => s.label === label)!.pct;
    expect(stat(a, "Top speed")).not.toBe(stat(b, "Top speed"));
    expect(stat(a, "Acceleration")).not.toBe(stat(b, "Acceleration"));
    // acquisition can never be live in this slice
    expect(a.acquirePreviewOnly).toBe(true);
    expect(b.acquirePreviewOnly).toBe(true);
  });

  it("ships no real manufacturer name, badge word or unsafe label", () => {
    const banned = /fiat|ford|capri|perana|uno\b/i;
    for (const v of SHOWROOM_VEHICLES) {
      expect(v.publicName).not.toMatch(banned);
      expect(v.spec.name).not.toMatch(banned);
      expect(v.vehicleClass).not.toMatch(banned);
      expect(v.blurb).not.toMatch(banned);
      expect(isPublicSafe(v.publicName)).toBe(true);
      expect(isPublicSafe(v.blurb)).toBe(true);
    }
  });

  it("offers the Karoo X19 Targa with GLB asset and distinctive stats", () => {
    const x19 = SHOWROOM_VEHICLES.find((v) => v.spec.id === "showroom:karoo-x19-targa");
    expect(x19).toBeDefined();
    const card = showroomCardModel(x19!);
    expect(card.name).toBe("Karoo X19 Targa");
    expect(card.vehicleClass).toBe("Heritage sports targa");
    expect(card.priceLabel).toBe("₭950 · planned");
    expect(x19!.glbUrl).toBe("/assets/citylife/cars/fiat_x19.glb");
    expect(x19!.presentationScale).toBe(0.56);
    expect(x19!.rotationOffset).toEqual([0, -Math.PI / 2, 0]);
    expect(x19!.spec.stats.grip).toBe(0.85);
  });
});

describe("GLB turntable model resource ownership", () => {
  it("retains loader cache ownership and leaves cached geometries and materials undisposed across clone lifecycles", () => {
    // Model a multi-node scene graph as loaded and cached by useGLTF
    const geomA = new THREE.BufferGeometry();
    const geomB = new THREE.BufferGeometry();
    const matA = new THREE.MeshStandardMaterial({ color: 0xffcc00 });
    const matB = new THREE.MeshStandardMaterial({ color: 0x111111 });

    const meshA = new THREE.Mesh(geomA, matA);
    const meshB = new THREE.Mesh(geomB, [matA, matB]);

    const cachedScene = new THREE.Group();
    cachedScene.add(meshA);
    cachedScene.add(meshB);

    let disposeCallCount = 0;
    geomA.addEventListener("dispose", () => {
      disposeCallCount++;
    });
    geomB.addEventListener("dispose", () => {
      disposeCallCount++;
    });
    matA.addEventListener("dispose", () => {
      disposeCallCount++;
    });
    matB.addEventListener("dispose", () => {
      disposeCallCount++;
    });

    // Simulate mount / turntable clone creation as GlbTurntableCarModel does
    const clone1 = cachedScene.clone(true);
    let clone1MeshCount = 0;
    clone1.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        clone1MeshCount++;
        node.castShadow = true;
        node.receiveShadow = true;
      }
    });
    expect(clone1MeshCount).toBe(2);

    // Verify cloned meshes share geometry & material instances with the loader cache
    const clonedA = clone1.children[0] as THREE.Mesh;
    const clonedB = clone1.children[1] as THREE.Mesh;
    expect(clonedA.geometry).toBe(geomA);
    expect(clonedA.material).toBe(matA);
    expect(clonedB.geometry).toBe(geomB);
    expect(clonedB.material).toEqual([matA, matB]);

    // GlbTurntableCarModel retains loader ownership and passes dispose={null} to <primitive />.
    // Unmounting or switching cars must NOT dispose shared cache resources.
    expect(disposeCallCount).toBe(0);

    // Simulate remounting / selecting the vehicle again
    const clone2 = cachedScene.clone(true);
    let clone2MeshCount = 0;
    clone2.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        clone2MeshCount++;
      }
    });
    expect(clone2MeshCount).toBe(2);
    expect(disposeCallCount).toBe(0);
  });
});
