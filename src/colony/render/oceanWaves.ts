// QA hardening — GPU ocean waves (spec 116). The R3F ocean previously displaced ~3,750
// RingGeometry vertices on the CPU every frame. This module is the single source of truth
// for the wave field: the SAME three sine waves the CPU loop used, expressed as GLSL and
// injected into MeshStandardMaterial via onBeforeCompile. The frame loop advances ONE
// uniform; the GPU does the rest. Analytic normals come free from the wave derivatives —
// the CPU path had stopped computing normals entirely because it was too slow.
//
// Pure string construction, no three.js import — unit-testable in the node environment.

/** One directional sine component of the wave field: z += amp * sin(axisExpr * freq + t * speed). */
export interface OceanWave {
  /** Which geometry-local axis drives the phase: x, y, or the x+y diagonal. */
  axis: "x" | "y" | "xy";
  freq: number;
  speed: number;
  amp: number;
}

/** The legacy CPU wave field, verbatim (R3FOcean useFrame loop before spec 116):
 *    sin(x * 0.05  + t * 0.85) * 0.18
 *  + sin(y * 0.063 - t * 0.7 ) * 0.14
 *  + sin((x+y) * 0.028 + t * 1.25) * 0.09
 *  Changing these numbers changes the look of the sea — they are pinned by tests. */
export const OCEAN_WAVES: readonly OceanWave[] = [
  { axis: "x", freq: 0.05, speed: 0.85, amp: 0.18 },
  { axis: "y", freq: 0.063, speed: -0.7, amp: 0.14 },
  { axis: "xy", freq: 0.028, speed: 1.25, amp: 0.09 },
];

/** The legacy loop ran on t = elapsedTime * 0.5 for calm swells; the uniform keeps that. */
export const OCEAN_TIME_SCALE = 0.5;

export const OCEAN_TIME_UNIFORM = "uOceanTime";

/** Format a JS number as a GLSL float literal (2 -> 2.0, 0.05 -> 0.05, -0.7 -> -0.7). */
export function glslFloat(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : `${n}`;
}

function axisExpr(axis: OceanWave["axis"]): string {
  if (axis === "x") return "position.x";
  if (axis === "y") return "position.y";
  return "(position.x + position.y)";
}

function phase(w: OceanWave): string {
  return `${axisExpr(w.axis)} * ${glslFloat(w.freq)} + ${OCEAN_TIME_UNIFORM} * ${glslFloat(w.speed)}`;
}

/** GLSL expression for the wave height z(x, y, t) — geometry-local Z (the ring lies in XY). */
export function oceanHeightGlsl(): string {
  return OCEAN_WAVES.map((w) => `sin(${phase(w)}) * ${glslFloat(w.amp)}`).join(
    " + ",
  );
}

/** GLSL expression for dz/dx — the x-phased and diagonal waves contribute. */
export function oceanDzDxGlsl(): string {
  return OCEAN_WAVES.filter((w) => w.axis !== "y")
    .map((w) => `cos(${phase(w)}) * ${glslFloat(w.amp)} * ${glslFloat(w.freq)}`)
    .join(" + ");
}

/** GLSL expression for dz/dy — the y-phased and diagonal waves contribute. */
export function oceanDzDyGlsl(): string {
  return OCEAN_WAVES.filter((w) => w.axis !== "x")
    .map((w) => `cos(${phase(w)}) * ${glslFloat(w.amp)} * ${glslFloat(w.freq)}`)
    .join(" + ");
}

/** The structural slice of three's onBeforeCompile shader argument this patch touches —
 *  kept structural so tests can pass a plain object. */
export interface PatchableShader {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
}

/** Inject the wave field into a MeshStandardMaterial vertex shader:
 *  - registers the time uniform,
 *  - displaces transformed.z after begin_vertex (geometry-local: the ring lies flat in XY
 *    and the mesh is rotated -PI/2, exactly like the old CPU displacement of pos.z),
 *  - replaces objectNormal after beginnormal_vertex with the analytic surface normal
 *    normalize(vec3(-dz/dx, -dz/dy, 1)) so lighting follows the swells. */
export function patchOceanShader(shader: PatchableShader): void {
  shader.uniforms[OCEAN_TIME_UNIFORM] = { value: 0 };
  shader.vertexShader =
    `uniform float ${OCEAN_TIME_UNIFORM};\n` +
    shader.vertexShader
      .replace(
        "#include <beginnormal_vertex>",
        `#include <beginnormal_vertex>\n  objectNormal = normalize(vec3(-(${oceanDzDxGlsl()}), -(${oceanDzDyGlsl()}), 1.0));`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>\n  transformed.z += ${oceanHeightGlsl()};`,
      );
}
