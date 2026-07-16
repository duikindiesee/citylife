// Spec 116 — GPU ocean waves. Pins the wave field to the legacy CPU look and proves the
// shader patch wires the field into a standard-material vertex shader correctly, all in
// the node environment (the module is pure string construction, no GPU needed).
import { describe, it, expect } from "vitest";
import {
  OCEAN_WAVES,
  OCEAN_TIME_SCALE,
  OCEAN_TIME_UNIFORM,
  glslFloat,
  oceanHeightGlsl,
  oceanDzDxGlsl,
  oceanDzDyGlsl,
  patchOceanShader,
} from "../src/colony/render/oceanWaves";

function fakeShader() {
  return {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: [
      "uniform mat4 modelMatrix;",
      "void main() {",
      "#include <beginnormal_vertex>",
      "#include <begin_vertex>",
      "}",
    ].join("\n"),
  };
}

describe("spec 116 — the wave field is pinned to the legacy CPU look", () => {
  it("keeps the exact legacy wave constants and time scale", () => {
    expect(OCEAN_WAVES).toEqual([
      { axis: "x", freq: 0.05, speed: 0.85, amp: 0.18 },
      { axis: "y", freq: 0.063, speed: -0.7, amp: 0.14 },
      { axis: "xy", freq: 0.028, speed: 1.25, amp: 0.09 },
    ]);
    expect(OCEAN_TIME_SCALE).toBe(0.5);
  });

  it("height expression carries every wave term", () => {
    const glsl = oceanHeightGlsl();
    for (const w of OCEAN_WAVES) {
      expect(glsl).toContain(glslFloat(w.freq));
      expect(glsl).toContain(glslFloat(w.amp));
      expect(glsl).toContain(glslFloat(w.speed));
    }
    expect(glsl.match(/sin\(/g)).toHaveLength(3);
  });

  it("derivatives split by axis: x-slope excludes the y wave, y-slope excludes the x wave", () => {
    expect(oceanDzDxGlsl()).not.toContain("0.063"); // the pure-y wave
    expect(oceanDzDxGlsl()).toContain("0.05");
    expect(oceanDzDyGlsl()).not.toContain("0.05 "); // the pure-x wave freq (trailing space avoids 0.05 in 0.063... none, but be safe)
    expect(oceanDzDyGlsl()).toContain("0.063");
    // the diagonal wave contributes to both slopes
    expect(oceanDzDxGlsl()).toContain("0.028");
    expect(oceanDzDyGlsl()).toContain("0.028");
  });
});

describe("spec 116 — patchOceanShader wires the field into a standard material", () => {
  it("registers the time uniform at zero", () => {
    const shader = fakeShader();
    patchOceanShader(shader);
    expect(shader.uniforms[OCEAN_TIME_UNIFORM]).toEqual({ value: 0 });
  });

  it("declares the uniform before the shader body", () => {
    const shader = fakeShader();
    patchOceanShader(shader);
    expect(shader.vertexShader.startsWith(`uniform float ${OCEAN_TIME_UNIFORM};`)).toBe(true);
  });

  it("displaces transformed.z after begin_vertex", () => {
    const shader = fakeShader();
    patchOceanShader(shader);
    const idx = shader.vertexShader.indexOf("#include <begin_vertex>");
    const after = shader.vertexShader.slice(idx);
    expect(after).toContain("transformed.z +=");
    expect(after).toContain(OCEAN_TIME_UNIFORM);
  });

  it("replaces objectNormal with the analytic surface normal after beginnormal_vertex", () => {
    const shader = fakeShader();
    patchOceanShader(shader);
    const normalIdx = shader.vertexShader.indexOf("#include <beginnormal_vertex>");
    const beginIdx = shader.vertexShader.indexOf("#include <begin_vertex>");
    const between = shader.vertexShader.slice(normalIdx, beginIdx);
    expect(between).toContain("objectNormal = normalize(vec3(-(");
    expect(between).toContain("cos(");
  });

  it("generates balanced parentheses (guards the template against typos)", () => {
    const shader = fakeShader();
    patchOceanShader(shader);
    const open = (shader.vertexShader.match(/\(/g) ?? []).length;
    const close = (shader.vertexShader.match(/\)/g) ?? []).length;
    expect(open).toBe(close);
  });
});
