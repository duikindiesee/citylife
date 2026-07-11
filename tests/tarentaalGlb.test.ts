import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { disposeTarentaalGltfTemplate } from "../src/colony/render/tarentaalGltfLayer";
import generatorSource from "../scripts/generate_tarentaal_flocks.mjs?raw";
import layerSource from "../src/colony/render/tarentaalGltfLayer.ts?raw";
import rendererSource from "../src/colony/render/PlanetRenderer.ts?raw";

describe("animated tarentaal GLB flock", () => {
  it("authors deterministic adult and chick assets with idle walk and chase clips", () => {
    expect(generatorSource).toContain('"tarentaal-adult.glb"');
    expect(generatorSource).toContain('"tarentaal-chick.glb"');
    expect(generatorSource).toContain(
      'const prefix = age === "adult" ? "Tarentaal" : "TarentaalChick"',
    );
    for (const suffix of ["idle", "walk", "chase"])
      expect(generatorSource).toContain(`\`${"${prefix}"}_${suffix}\``);
    expect(generatorSource).not.toMatch(/Math\.random|Date\.now/);
  });

  it("loads individual animated birds while retaining primitive fallback", () => {
    expect(layerSource).toContain("tarentaal-glb-flock");
    expect(layerSource).toContain("new THREE.AnimationMixer(group)");
    expect(layerSource).toContain("tarentaal-glb:${bird.id}");
    expect(layerSource).toContain("retaining primitive fallback");
    expect(layerSource).toContain("Promise.allSettled");
    expect(layerSource).toContain('adultResult.status === "fulfilled"');
    expect(layerSource).toContain('chickResult.status === "fulfilled"');
    expect(rendererSource).toContain("new TarentaalGltfLayer(this.scene)");
    expect(rendererSource).toContain("this.tarentaalAdultMesh.count = 0");
    expect(rendererSource).toContain("this.tarentaalChickMesh.count = 0");
  });

  it("deduplicates and disposes shared GLB GPU resources", () => {
    const texture = new THREE.Texture();
    const material = new THREE.MeshStandardMaterial({ map: texture });
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const scene = new THREE.Group();
    scene.add(
      new THREE.Mesh(geometry, material),
      new THREE.Mesh(geometry, material),
    );
    const textureDispose = vi.spyOn(texture, "dispose");
    const materialDispose = vi.spyOn(material, "dispose");
    const geometryDispose = vi.spyOn(geometry, "dispose");

    disposeTarentaalGltfTemplate({ scene, clips: [] });

    expect(textureDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(geometryDispose).toHaveBeenCalledTimes(1);
  });
});
