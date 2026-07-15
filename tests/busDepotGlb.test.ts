// @ts-ignore - Vitest runs in Node; project tsconfig intentionally omits Node globals.
import { createHash } from "node:crypto";
// @ts-ignore - Vitest runs in Node; project tsconfig intentionally omits Node globals.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-ignore - Vite raw import lets this contract inspect the committed GLB container.
import depotGlbRaw from "../public/assets/citylife/props/bus-depot.glb?raw";
// @ts-ignore - source contract guards deterministic regeneration.
import generatorSource from "../scripts/generate_bus_depot.py?raw";

interface GltfNode {
  name?: string;
  mesh?: number;
  children?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  matrix?: number[];
}

interface GltfMaterial {
  name?: string;
  emissiveFactor?: number[];
  extensions?: {
    KHR_materials_emissive_strength?: { emissiveStrength?: number };
  };
}

interface GltfJson {
  nodes: GltfNode[];
  meshes: Array<{
    name?: string;
    primitives: Array<{
      attributes: { POSITION: number };
      indices?: number;
      material?: number;
      mode?: number;
    }>;
  }>;
  accessors: Array<{ count: number; min?: number[]; max?: number[] }>;
  materials?: GltfMaterial[];
  images?: unknown[];
  textures?: unknown[];
  samplers?: unknown[];
  cameras?: unknown[];
  extensions?: Record<string, unknown>;
}

function parseGltfJson(raw: string): GltfJson {
  const jsonMarker = raw.indexOf("JSON");
  if (jsonMarker < 0) throw new Error("invalid GLB JSON chunk");
  const start = raw.indexOf("{", jsonMarker + 4);
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0)
      return JSON.parse(raw.slice(start, index + 1));
  }
  throw new Error("unterminated GLB JSON chunk");
}

function nodeMesh(json: GltfJson, nodeName: string) {
  const node = json.nodes.find((candidate) => candidate.name === nodeName);
  expect(node, `${nodeName} node`).toBeDefined();
  expect(node?.mesh, `${nodeName} mesh`).toBeTypeOf("number");
  return json.meshes[node!.mesh!];
}

function meshBounds(json: GltfJson, nodeName: string) {
  const mesh = nodeMesh(json, nodeName);
  const positions = json.accessors[mesh.primitives[0].attributes.POSITION];
  expect(positions.min).toHaveLength(3);
  expect(positions.max).toHaveLength(3);
  return positions.max!.map((value, axis) => value - positions.min![axis]);
}

function nodeBounds(json: GltfJson, nodeName: string) {
  const node = json.nodes.find((candidate) => candidate.name === nodeName)!;
  const dimensions = meshBounds(json, nodeName);
  const mesh = nodeMesh(json, nodeName);
  const positions = json.accessors[mesh.primitives[0].attributes.POSITION];
  expect(node.rotation, `${nodeName} rotation`).toBeUndefined();
  expect(node.scale, `${nodeName} scale`).toBeUndefined();
  expect(node.matrix, `${nodeName} matrix`).toBeUndefined();
  const translation = node.translation ?? [0, 0, 0];
  const min = positions.min!.map((value, axis) => value + translation[axis]);
  const max = positions.max!.map((value, axis) => value + translation[axis]);
  return { dimensions, min, max };
}

const REQUIRED_NODES = [
  "Bus_Depot",
  "Depot_Apron",
  ...Array.from(
    { length: 10 },
    (_, index) => `Depot_Bay_${String(index).padStart(2, "0")}`,
  ),
  "Depot_Office",
  "Depot_Shelter",
  "Depot_Sign",
];

const depotGlbBytes = readFileSync(
  new URL("../public/assets/citylife/props/bus-depot.glb", import.meta.url),
);

describe("bus-depot.glb", () => {
  const json = parseGltfJson(depotGlbRaw);

  it("parses and exposes exactly the 15 contract nodes without cameras, lights or textures", () => {
    expect(json.nodes.map((node) => node.name).sort()).toEqual(
      [...REQUIRED_NODES].sort(),
    );
    expect(json.nodes).toHaveLength(15);
    expect(json.meshes).toHaveLength(14);
    const root = json.nodes.find((node) => node.name === "Bus_Depot")!;
    expect(root.mesh).toBeUndefined();
    expect(root.translation).toBeUndefined();
    expect(root.rotation).toBeUndefined();
    expect(root.scale).toBeUndefined();
    expect(root.matrix).toBeUndefined();
    expect(root.children?.sort((a, b) => a - b)).toEqual(
      Array.from({ length: 14 }, (_, index) => index),
    );
    expect(json.cameras ?? []).toHaveLength(0);
    expect(json.images ?? []).toHaveLength(0);
    expect(json.textures ?? []).toHaveLength(0);
    expect(json.samplers ?? []).toHaveLength(0);
    expect(depotGlbBytes.byteLength).toBeLessThanOrEqual(800 * 1024);
    expect(createHash("sha256").update(depotGlbBytes).digest("hex")).toBe(
      "458049e4a1144c4a903a9df21b8c85dc91c8d385b5bed4ded7a0846e8d5d93af",
    );
    expect(json.extensions?.KHR_lights_punctual).toBeUndefined();
  });

  it("keeps the committed generator deterministic and export-only", () => {
    expect(generatorSource).not.toMatch(
      /\brandom\b|Math\.random|Date\.now|time\.time/,
    );
    expect(generatorSource).toContain('export_format="GLB"');
    expect(generatorSource).toContain("export_apply=True");
    expect(generatorSource).toContain("export_cameras=False");
    expect(generatorSource).toContain("export_lights=False");
  });

  it("pins the Y-up 48 by 28 metre pad, +X gate furniture and exact open 4 by 13 metre bays", () => {
    const apron = nodeBounds(json, "Depot_Apron");
    expect(apron.dimensions[0]).toBeCloseTo(48, 1);
    expect(apron.dimensions[1]).toBeLessThanOrEqual(0.05);
    expect(apron.dimensions[2]).toBeCloseTo(28, 1);
    expect(apron.min[0]).toBeCloseTo(-24, 1);
    expect(apron.max[0]).toBeCloseTo(24, 1);
    expect(apron.min[1]).toBeCloseTo(0, 2);
    expect(apron.max[1]).toBeLessThanOrEqual(0.05);
    expect(apron.min[2]).toBeCloseTo(-14, 1);
    expect(apron.max[2]).toBeCloseTo(14, 1);

    for (let index = 0; index < 10; index += 1) {
      const bay = nodeBounds(
        json,
        `Depot_Bay_${String(index).padStart(2, "0")}`,
      );
      expect(bay.dimensions[0]).toBeCloseTo(4, 2);
      expect(bay.dimensions[1]).toBeLessThanOrEqual(0.05);
      expect(bay.dimensions[2]).toBeCloseTo(13, 2);
      expect(bay.min[1]).toBeGreaterThanOrEqual(0);
      expect(bay.max[1]).toBeLessThanOrEqual(0.05001);
    }

    for (const name of ["Depot_Office", "Depot_Shelter", "Depot_Sign"]) {
      const gateFurniture = nodeBounds(json, name);
      expect(
        gateFurniture.min[0],
        `${name} gate-side minimum X`,
      ).toBeGreaterThan(16);
      expect(
        gateFurniture.max[0],
        `${name} within +X gate edge`,
      ).toBeLessThanOrEqual(24);
    }
  });

  it("uses the emissive sign material slot and stays under 25k triangles", () => {
    const signMesh = nodeMesh(json, "Depot_Sign");
    const signMaterials = signMesh.primitives.map(
      (primitive) => json.materials?.[primitive.material ?? -1],
    );
    const signMaterial = signMaterials.find(
      (material) => material?.name === "sign",
    );
    expect(signMaterial).toBeDefined();
    expect(signMaterial?.emissiveFactor).toEqual([
      0.10000000149011612, 0.75, 1,
    ]);
    expect(
      signMaterial?.extensions?.KHR_materials_emissive_strength
        ?.emissiveStrength,
    ).toBe(4);

    const triangles = json.meshes.reduce(
      (sum, mesh) =>
        sum +
        mesh.primitives.reduce((meshSum, primitive) => {
          const count =
            primitive.indices === undefined
              ? json.accessors[primitive.attributes.POSITION].count
              : json.accessors[primitive.indices].count;
          return (
            meshSum +
            (primitive.mode === undefined || primitive.mode === 4
              ? count / 3
              : 0)
          );
        }, 0),
      0,
    );
    expect(triangles).toBeLessThanOrEqual(25_000);
  });
});
