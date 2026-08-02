// Structural contract for the civic-art & landmark pack (PR-352 pattern).
// @ts-ignore - Vitest runs in Node; project tsconfig intentionally omits Node globals.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-ignore - Vite raw import lets this contract inspect the committed GLB container.
import packGlbRaw from "../public/assets/citylife/props/hq-civic-art-pack.glb?raw";
// @ts-ignore - source contract guards deterministic regeneration.
import generatorSource from "../scripts/generate_hq_civic_art_pack.mjs?raw";
import placement from "../public/assets/citylife/props/hq-civic-art-pack.placement.json";

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

// Measured contract dimensions (from the deterministic generator output).
const PARTS: Record<
  string,
  { w: number; h: number; d: number; pivot: "floor-center" | "floor-pole-base" }
> = {
  CivicArt_Fountain: { w: 2.6, h: 2.57, d: 2.6, pivot: "floor-center" },
  CivicArt_Statue: { w: 1.2, h: 3.2, d: 1.2, pivot: "floor-center" },
  CivicArt_Obelisk: { w: 0.8, h: 5.0, d: 0.8, pivot: "floor-center" },
  CivicArt_BannerPole: { w: 1.04, h: 3.9, d: 0.4, pivot: "floor-pole-base" },
  CivicArt_PlanterBench: { w: 1.95, h: 1.18, d: 0.6, pivot: "floor-center" },
};
const EPSILON = 0.001;

function childTranslation(child: GltfNode): number[] {
  expect(child.rotation, `${child.name} rotation`).toBeUndefined();
  expect(child.scale, `${child.name} scale`).toBeUndefined();
  if (child.matrix) {
    expect(
      child.matrix.slice(0, 12),
      `${child.name} matrix must be translation-only`,
    ).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
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
    const positions =
      json.accessors[
        json.meshes[child.mesh!].primitives[0].attributes.POSITION
      ];
    const translation = childTranslation(child);
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], positions.min![axis] + translation[axis]);
      max[axis] = Math.max(max[axis], positions.max![axis] + translation[axis]);
    }
  }
  return { min, max };
}

const packBytes = readFileSync(
  new URL(
    "../public/assets/citylife/props/hq-civic-art-pack.glb",
    import.meta.url,
  ),
);

describe("hq-civic-art-pack.glb", () => {
  const json = parseGltfJson(packGlbRaw);

  it("exposes the pack root with exactly the five parts and no cameras or textures", () => {
    const root = json.nodes.find((node) => node.name === "HqCivicArtPack_Root");
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
      // Every part stands on its local floor plane.
      expect(min[1], "floor pivot").toBeGreaterThanOrEqual(-EPSILON);
      expect(min[1], "floor pivot").toBeLessThanOrEqual(EPSILON);
      if (contract.pivot === "floor-center") {
        expect(min[0] + max[0], "x-centre").toBeCloseTo(0, 1);
        expect(min[2] + max[2], "z-centre").toBeCloseTo(0, 1);
      } else {
        // floor-pole-base: the mounting point (x=0,z=0) lies within the footprint.
        expect(min[0]).toBeLessThanOrEqual(EPSILON);
        expect(max[0]).toBeGreaterThanOrEqual(-EPSILON);
        expect(min[2]).toBeLessThanOrEqual(EPSILON);
        expect(max[2]).toBeGreaterThanOrEqual(-EPSILON);
      }
    });
  }

  it("uses only named CivicArt materials", () => {
    expect(json.materials?.length ?? 0).toBeGreaterThan(0);
    for (const material of json.materials!)
      expect(material.name).toMatch(/^CivicArt_/);
  });
});

describe("hq-civic-art-pack.placement.json", () => {
  it("references only contract nodes with finite yaw", () => {
    expect(placement.schema).toBe("citylife-prop-placement/v1");
    expect(placement.asset.id).toBe("hq-civic-art-pack");
    expect(Object.keys(placement.nodes).sort()).toEqual(
      Object.keys(PARTS).sort(),
    );
    for (const entry of placement.examplePlacements) {
      expect(Object.keys(PARTS), `${entry.node} is a contract node`).toContain(
        entry.node,
      );
      expect(Number.isFinite(entry.position[0])).toBe(true);
      expect(Number.isFinite(entry.position[1])).toBe(true);
      expect(Number.isFinite(entry.position[2])).toBe(true);
      expect(Number.isFinite(entry.yawRadians)).toBe(true);
    }
    expect(placement.integration.owner).toBe("opus");
  });
});

describe("generate_hq_civic_art_pack.mjs determinism contract", () => {
  it("pins asset.generator, so a three.js upgrade cannot change the bytes", () => {
    // ASSET.GLB.DETERMINISM.1 — GLTFExporter writes `asset.generator = "THREE.GLTFExporter r<NNN>"`,
    // baking the INSTALLED LIBRARY REVISION into the binary. That silently breaks this pack's
    // provenance contract: the same script on the same source emits different bytes on a checkout
    // that resolved a different three version.
    //
    // MEASURED — this is what blocked PR 365 for twelve days. On the authoring machine (three r185)
    // the generator reproduced the committed
    //   0b2dedf237a00d07c3057026c83442ff600eb28351ddcbbe50c6b479322bb1ef
    // twice. Independent review on another checkout got
    //   4541b104683043c30ff443e47797ecf64dc14794ffdb1e174ce93bee2ab319cc
    // — internally stable there, but different. Refreshing the committed binary would NOT have fixed
    // it; it would have moved the failure to the next environment and to every three upgrade after.
    //
    // The source screen below cannot see this: the entropy is contributed by a DEPENDENCY, not by the
    // script. So this asserts the BINARY.
    const head = new TextDecoder().decode(
      new Uint8Array(packBytes).subarray(0, 4096),
    );
    const generator = head.match(/"generator"\s*:\s*"([^"]+)"/)?.[1];
    expect(generator, "the GLB must declare a generator").toBeTruthy();
    expect(generator).toBe("citylife-hq-civic-art-pack v1");
    // And no library revision may survive anywhere in the JSON chunk.
    expect(head).not.toMatch(/THREE\.GLTFExporter/);
    expect(head).not.toMatch(/r1[0-9]{2}/);
  });

  it("stays free of nondeterministic sources", () => {
    expect(generatorSource).not.toMatch(/Math\.random|Date\.now|new Date\(/);
    expect(generatorSource).toContain("hq-civic-art-pack.glb");
    expect(generatorSource).toContain("HqCivicArtPack_Root");
  });
});
