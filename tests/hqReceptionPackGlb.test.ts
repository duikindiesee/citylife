// Structural contract for the authored Kooker HQ reception asset pack.
//
// Guards the committed GLB (deterministic output of
// scripts/generate_hq_reception_pack.mjs) and its placement metadata so the
// runtime-integration slice can trust names, pivots, dimensions and
// reception-local coordinates without loading three.js.
// @ts-ignore - Vitest runs in Node; project tsconfig intentionally omits Node globals.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-ignore - Vite raw import lets this contract inspect the committed GLB container.
import packGlbRaw from "../public/assets/citylife/props/hq-reception-pack.glb?raw";
// @ts-ignore - source contract guards deterministic regeneration.
import generatorSource from "../scripts/generate_hq_reception_pack.mjs?raw";
import placement from "../public/assets/citylife/props/hq-reception-pack.placement.json";

interface GltfNode {
  name?: string;
  mesh?: number;
  children?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  matrix?: number[];
}

interface GltfJson {
  nodes: GltfNode[];
  meshes: Array<{
    name?: string;
    primitives: Array<{
      attributes: { POSITION: number };
      material?: number;
    }>;
  }>;
  accessors: Array<{ count: number; min?: number[]; max?: number[] }>;
  materials?: Array<{ name?: string }>;
  images?: unknown[];
  textures?: unknown[];
  samplers?: unknown[];
  cameras?: unknown[];
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

const PARTS: Record<string, { w: number; h: number; d: number; pivot: string }> =
  {
    HqReception_Desk: { w: 2.4, h: 0.96, d: 0.8, pivot: "floor-center" },
    HqReception_ManifestoWall: {
      w: 3.6,
      h: 2.36,
      d: 0.14,
      pivot: "floor-center-back",
    },
    HqReception_ArchiveShelf: {
      w: 1.8,
      h: 2.2,
      d: 0.45,
      pivot: "floor-center-back",
    },
  };

const EPSILON = 0.001;

/**
 * A child node's local translation. GLTFExporter emits either a `translation`
 * triple or a `matrix`; the pack authors no rotations or scales, so any matrix
 * must be a pure translation (identity linear part) — asserted here so a
 * future generator change cannot silently rotate a part past this contract.
 */
function childTranslation(child: GltfNode): number[] {
  expect(child.rotation, `${child.name} rotation`).toBeUndefined();
  expect(child.scale, `${child.name} scale`).toBeUndefined();
  if (child.matrix) {
    const m = child.matrix;
    expect(
      m.slice(0, 12),
      `${child.name} matrix must be translation-only`,
    ).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
    return [m[12], m[13], m[14]];
  }
  return child.translation ?? [0, 0, 0];
}

/** Aggregate a part group's bounds from its child leaf meshes (no rotations are authored). */
function partBounds(json: GltfJson, partName: string) {
  const part = json.nodes.find((node) => node.name === partName);
  expect(part, `${partName} node`).toBeDefined();
  expect(part!.rotation, `${partName} rotation`).toBeUndefined();
  expect(part!.scale, `${partName} scale`).toBeUndefined();
  expect(part!.matrix, `${partName} matrix`).toBeUndefined();
  expect(part!.children?.length ?? 0, `${partName} children`).toBeGreaterThan(0);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const childIndex of part!.children!) {
    const child = json.nodes[childIndex];
    expect(child.mesh, `${child.name} mesh`).toBeTypeOf("number");
    const positions =
      json.accessors[json.meshes[child.mesh!].primitives[0].attributes.POSITION];
    expect(positions.min).toHaveLength(3);
    expect(positions.max).toHaveLength(3);
    const translation = childTranslation(child);
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], positions.min![axis] + translation[axis]);
      max[axis] = Math.max(max[axis], positions.max![axis] + translation[axis]);
    }
  }
  return { min, max };
}

const packBytes = readFileSync(
  new URL("../public/assets/citylife/props/hq-reception-pack.glb", import.meta.url),
);

describe("hq-reception-pack.glb", () => {
  const json = parseGltfJson(packGlbRaw);

  it("exposes the pack root with exactly the three contract parts and no cameras or textures", () => {
    const root = json.nodes.find((node) => node.name === "HqReceptionPack_Root");
    expect(root).toBeDefined();
    expect(root!.mesh).toBeUndefined();
    expect(root!.rotation).toBeUndefined();
    expect(root!.translation).toBeUndefined();
    const partNames = root!.children!.map((index) => json.nodes[index].name);
    expect(partNames?.sort()).toEqual(Object.keys(PARTS).sort());
    expect(json.cameras ?? []).toHaveLength(0);
    expect(json.images ?? []).toHaveLength(0);
    expect(json.textures ?? []).toHaveLength(0);
    expect(json.samplers ?? []).toHaveLength(0);
    expect(packBytes.byteLength).toBeLessThanOrEqual(400 * 1024);
  });

  for (const [partName, contract] of Object.entries(PARTS)) {
    it(`${partName} matches its documented dimensions and ${contract.pivot} pivot`, () => {
      const { min, max } = partBounds(json, partName);
      expect(max[0] - min[0], "width").toBeCloseTo(contract.w, 2);
      expect(max[1] - min[1], "height").toBeCloseTo(contract.h, 2);
      expect(max[2] - min[2], "depth").toBeCloseTo(contract.d, 2);
      // Every part stands on its local floor plane.
      expect(min[1], "floor pivot").toBeGreaterThanOrEqual(-EPSILON);
      expect(min[1], "floor pivot").toBeLessThanOrEqual(EPSILON);
      // Centred on X for all pivots.
      expect(min[0] + max[0], "x-centre").toBeCloseTo(0, 2);
      if (contract.pivot === "floor-center-back") {
        // Back plane sits on local z=0 so the part mounts flush against a wall.
        expect(min[2], "back plane").toBeGreaterThanOrEqual(-EPSILON);
        expect(min[2], "back plane").toBeLessThanOrEqual(EPSILON);
      } else {
        expect(min[2] + max[2], "z-centre").toBeCloseTo(0, 2);
      }
    });
  }

  it("uses only named HqReception materials", () => {
    expect(json.materials?.length ?? 0).toBeGreaterThan(0);
    for (const material of json.materials!) {
      expect(material.name).toMatch(/^HqReception_/);
    }
  });
});

describe("hq-reception-pack.placement.json", () => {
  it("targets the spec-152 reception frame with in-bounds, contract-node placements", () => {
    expect(placement.schema).toBe("citylife-prop-placement/v1");
    expect(placement.asset.id).toBe("hq-reception-pack");
    expect(placement.asset.url).toBe(
      "/assets/citylife/props/hq-reception-pack.glb",
    );
    expect(placement.frame.gridWidthCells).toBe(12);
    expect(placement.frame.gridDepthCells).toBe(10);
    expect(placement.integration.owner).toBe("opus");
    expect(placement.placements.length).toBeGreaterThanOrEqual(3);
    for (const entry of placement.placements) {
      expect(Object.keys(PARTS), `${entry.node} is a contract node`).toContain(
        entry.node,
      );
      const [x, y, z] = entry.position;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(12);
      expect(y).toBe(0);
      expect(z).toBeGreaterThanOrEqual(0);
      expect(z).toBeLessThanOrEqual(10);
      expect(Number.isFinite(entry.yawRadians)).toBe(true);
    }
    const placedNodes = new Set(placement.placements.map((entry) => entry.node));
    expect(placedNodes).toEqual(new Set(Object.keys(PARTS)));
  });
});

describe("generate_hq_reception_pack.mjs determinism contract", () => {
  it("stays free of nondeterministic sources", () => {
    expect(generatorSource).not.toMatch(/Math\.random|Date\.now|new Date\(/);
    expect(generatorSource).toContain("hq-reception-pack.glb");
    expect(generatorSource).toContain("HqReceptionPack_Root");
  });
});
