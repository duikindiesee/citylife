// Structural contract for the spec-153 HQ commons/arcade pack.
// @ts-ignore - Vitest runs in Node; project tsconfig intentionally omits Node globals.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-ignore - Vite raw import lets this contract inspect the committed GLB container.
import packGlbRaw from "../public/assets/citylife/props/hq-commons-pack.glb?raw";
// @ts-ignore - source contract guards deterministic regeneration.
import generatorSource from "../scripts/generate_hq_commons_pack.mjs?raw";
import placement from "../public/assets/citylife/props/hq-commons-pack.placement.json";

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
  Commons_Watercooler: { w: 0.5, h: 1.4, d: 0.5, pivot: "floor-center" },
  Commons_Foosball: { w: 1.6, h: 0.9, d: 0.8, pivot: "floor-center" },
  Commons_Arcade: { w: 0.7, h: 1.8, d: 0.8, pivot: "floor-center" },
  Commons_Couch: { w: 2.2, h: 0.85, d: 0.95, pivot: "floor-center" },
  Commons_BeanBag: { w: 0.9, h: 0.55, d: 0.9, pivot: "floor-center" },
  Commons_FleetBoard: { w: 3.6, h: 2.0, d: 0.14, pivot: "floor-center-back" },
  Commons_SnackShelf: { w: 1.2, h: 1.6, d: 0.4, pivot: "floor-center-back" },
  Commons_Rug: { w: 3.0, h: 0.025, d: 2.0, pivot: "floor-center" },
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
  new URL("../public/assets/citylife/props/hq-commons-pack.glb", import.meta.url),
);

describe("hq-commons-pack.glb", () => {
  const json = parseGltfJson(packGlbRaw);

  it("exposes the pack root with exactly the eight parts and no cameras or textures", () => {
    const root = json.nodes.find((node) => node.name === "HqCommonsPack_Root");
    expect(root).toBeDefined();
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

  it("uses only named Commons materials", () => {
    expect(json.materials?.length ?? 0).toBeGreaterThan(0);
    for (const material of json.materials!) expect(material.name).toMatch(/^Commons_/);
  });
});

describe("hq-commons-pack.placement.json", () => {
  it("keeps every placement inside its named room and resolves cross-pack nodes", () => {
    expect(placement.schema).toBe("citylife-prop-placement/v1");
    const rooms = placement.rooms as Record<string, { gridWidthCells: number; gridDepthCells: number }>;
    expect(rooms.commons.gridWidthCells).toBe(16);
    expect(rooms.commons.gridDepthCells).toBe(12);
    expect(rooms.arcade.gridWidthCells).toBe(10);
    expect(rooms.arcade.gridDepthCells).toBe(8);
    const crossPack = Object.keys(placement.crossPackNodes);
    for (const entry of placement.placements) {
      const known =
        Object.keys(PARTS).includes(entry.node) || crossPack.includes(entry.node);
      expect(known, `${entry.node} is a known node`).toBe(true);
      const room = rooms[entry.room];
      expect(room, `${entry.room} is a declared room`).toBeDefined();
      const [x, y, z] = entry.position;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(room.gridWidthCells);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(z).toBeGreaterThanOrEqual(0);
      expect(z).toBeLessThanOrEqual(room.gridDepthCells);
      expect(Number.isFinite(entry.yawRadians)).toBe(true);
    }
    // Suzi's liaison corner lives in the commons, honouring spec 153 §5.
    const liaison = placement.placements.filter(
      (entry: { node: string }) => entry.node === "Office_LiaisonDesk",
    );
    expect(liaison).toHaveLength(1);
    expect(liaison[0].room).toBe("commons");
    expect(placement.integration.owner).toBe("opus");
  });
});

describe("generate_hq_commons_pack.mjs determinism contract", () => {
  it("stays free of nondeterministic sources", () => {
    expect(generatorSource).not.toMatch(/Math\.random|Date\.now|new Date\(/);
    expect(generatorSource).toContain("hq-commons-pack.glb");
    expect(generatorSource).toContain("HqCommonsPack_Root");
  });
});
