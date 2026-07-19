// Structural contract for the spec-153 HQ boardroom (Gate Room) pack.
// @ts-ignore - Vitest runs in Node; project tsconfig intentionally omits Node globals.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-ignore - Vite raw import lets this contract inspect the committed GLB container.
import packGlbRaw from "../public/assets/citylife/props/hq-boardroom-pack.glb?raw";
// @ts-ignore - source contract guards deterministic regeneration.
import generatorSource from "../scripts/generate_hq_boardroom_pack.mjs?raw";
import placement from "../public/assets/citylife/props/hq-boardroom-pack.placement.json";

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
  meshes: Array<{ primitives: Array<{ attributes: { POSITION: number } }> }>;
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

const PARTS: Record<string, { w: number; h: number; d: number; pivot: string }> = {
  Board_Table: { w: 3.6, h: 0.78, d: 1.4, pivot: "floor-center" },
  Board_Chair: { w: 0.55, h: 1.0, d: 0.55, pivot: "floor-center" },
  Board_EpicWall: { w: 6.0, h: 2.4, d: 0.14, pivot: "floor-center-back" },
  Board_GatePuck: { w: 0.18, h: 0.06, d: 0.18, pivot: "floor-center" },
  Board_MergeTicker: { w: 2.4, h: 0.3, d: 0.12, pivot: "floor-center-back" },
  Board_HoloEpic: { w: 0.6, h: 1.1, d: 0.6, pivot: "floor-center" },
  Board_Sideboard: { w: 1.8, h: 0.9, d: 0.45, pivot: "floor-center-back" },
};
const EPSILON = 0.001;

function childTranslation(child: GltfNode): number[] {
  expect(child.rotation, `${child.name} rotation`).toBeUndefined();
  expect(child.scale, `${child.name} scale`).toBeUndefined();
  if (child.matrix) {
    expect(child.matrix.slice(0, 12), `${child.name} matrix must be translation-only`)
      .toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
    return [child.matrix[12], child.matrix[13], child.matrix[14]];
  }
  return child.translation ?? [0, 0, 0];
}

function partBounds(json: GltfJson, partName: string) {
  const part = json.nodes.find((node) => node.name === partName);
  expect(part, `${partName} node`).toBeDefined();
  expect(part!.rotation).toBeUndefined();
  expect(part!.matrix).toBeUndefined();
  expect(part!.children?.length ?? 0).toBeGreaterThan(0);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const childIndex of part!.children!) {
    const child = json.nodes[childIndex];
    expect(child.mesh, `${child.name} mesh`).toBeTypeOf("number");
    const positions = json.accessors[json.meshes[child.mesh!].primitives[0].attributes.POSITION];
    const translation = childTranslation(child);
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], positions.min![axis] + translation[axis]);
      max[axis] = Math.max(max[axis], positions.max![axis] + translation[axis]);
    }
  }
  return { min, max };
}

const packBytes = readFileSync(
  new URL("../public/assets/citylife/props/hq-boardroom-pack.glb", import.meta.url),
);

describe("hq-boardroom-pack.glb", () => {
  const json = parseGltfJson(packGlbRaw);

  it("exposes the pack root with exactly the seven parts and no cameras or textures", () => {
    const root = json.nodes.find((node) => node.name === "HqBoardroomPack_Root");
    expect(root).toBeDefined();
    const partNames = root!.children!.map((index) => json.nodes[index].name);
    expect(partNames?.sort()).toEqual(Object.keys(PARTS).sort());
    expect(json.cameras ?? []).toHaveLength(0);
    expect(json.images ?? []).toHaveLength(0);
    expect(json.textures ?? []).toHaveLength(0);
    expect(json.samplers ?? []).toHaveLength(0);
    expect(packBytes.byteLength).toBeLessThanOrEqual(300 * 1024);
  });

  for (const [partName, contract] of Object.entries(PARTS)) {
    it(`${partName} matches its documented dimensions and ${contract.pivot} pivot`, () => {
      const { min, max } = partBounds(json, partName);
      expect(max[0] - min[0], "width").toBeCloseTo(contract.w, 2);
      expect(max[1] - min[1], "height").toBeCloseTo(contract.h, 2);
      expect(max[2] - min[2], "depth").toBeCloseTo(contract.d, 2);
      expect(min[1], "floor pivot").toBeGreaterThanOrEqual(-EPSILON);
      expect(min[1], "floor pivot").toBeLessThanOrEqual(EPSILON);
      expect(min[0] + max[0], "x-centre").toBeCloseTo(0, 2);
      if (contract.pivot === "floor-center-back") {
        expect(min[2], "back plane").toBeGreaterThanOrEqual(-EPSILON);
        expect(min[2], "back plane").toBeLessThanOrEqual(EPSILON);
      } else {
        expect(min[2] + max[2], "z-centre").toBeCloseTo(0, 2);
      }
    });
  }

  it("uses only named Board materials", () => {
    expect(json.materials?.length ?? 0).toBeGreaterThan(0);
    for (const material of json.materials!) expect(material.name).toMatch(/^Board_/);
  });
});

describe("hq-boardroom-pack.placement.json", () => {
  it("furnishes the 10x8 Gate Room with in-bounds contract nodes and ten chairs", () => {
    expect(placement.schema).toBe("citylife-prop-placement/v1");
    expect(placement.frame.gridWidthCells).toBe(10);
    expect(placement.frame.gridDepthCells).toBe(8);
    for (const entry of placement.placements) {
      expect(Object.keys(PARTS)).toContain(entry.node);
      const [x, y, z] = entry.position;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(10);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(z).toBeGreaterThanOrEqual(0);
      expect(z).toBeLessThanOrEqual(8);
      expect(Number.isFinite(entry.yawRadians)).toBe(true);
    }
    const counts = new Map<string, number>();
    for (const entry of placement.placements)
      counts.set(entry.node, (counts.get(entry.node) ?? 0) + 1);
    expect(counts.get("Board_Chair")).toBe(10);
    expect(counts.get("Board_GatePuck")).toBe(3);
    expect(counts.get("Board_Table")).toBe(1);
    expect(counts.get("Board_EpicWall")).toBe(1);
    expect(placement.integration.owner).toBe("opus");
  });
});

describe("generate_hq_boardroom_pack.mjs determinism contract", () => {
  it("stays free of nondeterministic sources", () => {
    expect(generatorSource).not.toMatch(/Math\.random|Date\.now|new Date\(/);
    expect(generatorSource).toContain("hq-boardroom-pack.glb");
    expect(generatorSource).toContain("HqBoardroomPack_Root");
  });
});
