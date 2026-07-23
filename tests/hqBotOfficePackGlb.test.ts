// Structural contract for the spec-153 HQ bot-office pack, including the §5
// slot formula recorded in the placement JSON (PR-352 pattern).
// @ts-ignore - Vitest runs in Node; project tsconfig intentionally omits Node globals.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-ignore - Vite raw import lets this contract inspect the committed GLB container.
import packGlbRaw from "../public/assets/citylife/props/hq-bot-office-pack.glb?raw";
// @ts-ignore - source contract guards deterministic regeneration.
import generatorSource from "../scripts/generate_hq_bot_office_pack.mjs?raw";
import placement from "../public/assets/citylife/props/hq-bot-office-pack.placement.json";

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
  Office_Desk: { w: 1.6, h: 0.75, d: 0.8, pivot: "floor-center" },
  Office_TaskChair: { w: 0.5, h: 0.95, d: 0.55, pivot: "floor-center" },
  Office_WorklistBoard: { w: 3.0, h: 1.8, d: 0.12, pivot: "floor-center-back" },
  Office_TaskCard: { w: 0.6, h: 0.4, d: 0.04, pivot: "floor-center-back" },
  Office_StatusTotem: { w: 0.4, h: 2.2, d: 0.4, pivot: "floor-center" },
  Office_DoorLight: { w: 0.35, h: 0.14, d: 0.1, pivot: "floor-center-back" },
  Office_Shelf: { w: 1.2, h: 1.8, d: 0.35, pivot: "floor-center-back" },
  Office_DeskLamp: { w: 0.22, h: 0.48, d: 0.15, pivot: "floor-center" },
  Office_Plant: { w: 0.34, h: 0.85, d: 0.34, pivot: "floor-center" },
  Office_LiaisonDesk: { w: 1.2, h: 0.75, d: 0.6, pivot: "floor-center" },
  Office_RoutingBoard: { w: 1.6, h: 1.2, d: 0.1, pivot: "floor-center-back" },
  Office_LibrarySign: { w: 1.6, h: 0.5, d: 0.08, pivot: "floor-center-back" },
  Office_Workbench: { w: 1.8, h: 1.05, d: 0.7, pivot: "floor-center" },
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
  new URL("../public/assets/citylife/props/hq-bot-office-pack.glb", import.meta.url),
);

describe("hq-bot-office-pack.glb", () => {
  const json = parseGltfJson(packGlbRaw);

  it("exposes the pack root with exactly the thirteen parts and no cameras or textures", () => {
    const root = json.nodes.find((node) => node.name === "HqBotOfficePack_Root");
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

  it("uses only named Office materials", () => {
    expect(json.materials?.length ?? 0).toBeGreaterThan(0);
    for (const material of json.materials!) expect(material.name).toMatch(/^Office_/);
  });
});

describe("hq-bot-office-pack.placement.json", () => {
  it("keeps the standard kit inside the 4x5 office grid with contract nodes", () => {
    expect(placement.schema).toBe("citylife-prop-placement/v1");
    expect(placement.frame.gridWidthCells).toBe(4);
    expect(placement.frame.gridDepthCells).toBe(5);
    for (const entry of placement.kits.standard) {
      expect(Object.keys(PARTS)).toContain(entry.node);
      const [x, , z] = entry.position;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(4);
      expect(z).toBeGreaterThanOrEqual(0);
      expect(z).toBeLessThanOrEqual(5);
      expect(Number.isFinite(entry.yawRadians)).toBe(true);
    }
  });

  it("records exactly the spec-153 §5 slot formula for twelve slots with immutable slotIndex", () => {
    const entries = placement.slots.entries;
    expect(entries).toHaveLength(12);
    expect(new Set(entries.map((e: { slotIndex: number }) => e.slotIndex)).size).toBe(12);
    const expectSlot = (
      index: number,
      framePosition: number[],
      yaw: number,
      door: number[],
    ) => {
      const entry = entries[index];
      expect(entry.slotIndex).toBe(index);
      expect(entry.localId).toBe(`office-slot-${String(index).padStart(2, "0")}`);
      expect(entry.framePosition).toEqual(framePosition);
      expect(entry.yawRadians).toBeCloseTo(yaw, 12);
      expect(entry.door).toEqual(door);
    };
    // east wing m=1: x0 = 8; north j=0..2 then south j=0..2
    for (let j = 0; j < 3; j += 1)
      expectSlot(j, [8 + 4 * j, 0, 18], 0, [10 + 4 * j, 0, 18]);
    for (let j = 0; j < 3; j += 1)
      expectSlot(3 + j, [12 + 4 * j, 0, 14], Math.PI, [10 + 4 * j, 0, 14]);
    // west wing m=1: x0 = -20
    for (let j = 0; j < 3; j += 1)
      expectSlot(6 + j, [-20 + 4 * j, 0, 18], 0, [-18 + 4 * j, 0, 18]);
    for (let j = 0; j < 3; j += 1)
      expectSlot(9 + j, [-16 + 4 * j, 0, 14], Math.PI, [-18 + 4 * j, 0, 14]);
    for (const entry of entries) {
      if (entry.binding !== null)
        expect(entry.binding).toMatch(/^principal:bot:[A-Za-z0-9._:-]+$/);
      else expect(entry.kit).toBe("dark-shell");
    }
    expect(entries.filter((e: { binding: string | null }) => e.binding === null)).toHaveLength(3);
    expect(placement.integration.owner).toBe("opus");
  });
});

describe("generate_hq_bot_office_pack.mjs determinism contract", () => {
  it("stays free of nondeterministic sources", () => {
    expect(generatorSource).not.toMatch(/Math\.random|Date\.now|new Date\(/);
    expect(generatorSource).toContain("hq-bot-office-pack.glb");
    expect(generatorSource).toContain("HqBotOfficePack_Root");
  });
});
