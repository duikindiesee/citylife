import { describe, expect, it } from "vitest";
// @ts-ignore - Vite raw import used for a renderer contract source-scan test.
import rendererSource from "../src/colony/render/PlanetRenderer.ts?raw";

// Renderer source contract stays as a fast unit gate; e2e/joe-avatar.spec.ts exercises the real
// Vite/WebGL runtime in Chromium and proves the loaded scene plus the remaining instanced crowd.
describe("Joe v3 animated GLB renderer contract", () => {
  it("loads named citizen GLBs and keeps the unnamed crowd instanced", () => {
    expect(rendererSource).toContain("GLTFLoader");
    expect(rendererSource).toContain("named-citizen-glb-avatars");
    expect(rendererSource).toContain("new THREE.AnimationMixer");
    expect(rendererSource).toContain("if (a.glbUrl)");
    expect(rendererSource).toContain("this.updateNamedAvatar(a, wy)");
    expect(rendererSource).toContain("this.crabMesh.setMatrixAt");
    expect(rendererSource).toContain("citizen-avatar-human-bodies");
    expect(rendererSource).toContain("citizen-avatar-instanced-crabs");
    expect(rendererSource).toContain("this.avatarMesh.setMatrixAt");
    expect(rendererSource).toContain(
      "this.updateNamedAvatarMixers(this.clock.getDelta())",
    );
  });

  it("selects Joe_idle and Joe_walk from display-name plus sim movement", () => {
    expect(rendererSource).toContain('`${base}_${moving ? "walk" : "idle"}`');
    expect(rendererSource).toContain("`${first}_idle`");
    expect(rendererSource).toContain("entry.group.userData.currentAction");
  });
});
