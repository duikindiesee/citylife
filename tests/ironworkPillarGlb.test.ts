// @ts-ignore - Vitest runs in Node; project tsconfig intentionally omits Node globals.
import { createHash } from "node:crypto";
// @ts-ignore - Vitest runs in Node; project tsconfig intentionally omits Node globals.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-ignore - Vite raw import lets this contract inspect the committed GLB container.
import pillarGlbRaw from "../public/assets/citylife/props/ironwork-pillar.glb?raw";
// @ts-ignore - source contract guards deterministic regeneration.
import generatorSource from "../scripts/generate_ironwork_pillar.mjs?raw";
import { IRONWORK_PILLAR_ASSET_URL } from "../src/colony/ironworkPillar";

interface GltfJson {
  nodes: Array<{
    name?: string;
    mesh?: number;
    children?: number[];
    translation?: number[];
    matrix?: number[];
    extras?: Record<string, unknown>;
  }>;
  meshes: unknown[];
  materials?: Array<{ name?: string; emissiveFactor?: number[] }>;
  images?: unknown[];
  textures?: unknown[];
  cameras?: unknown[];
}

function parseGltfJson(raw: string): GltfJson {
  const jsonMarker = raw.indexOf("JSON");
  if (jsonMarker < 0) throw new Error("invalid GLB JSON chunk");
  const start = raw.indexOf("{", jsonMarker + 4);
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < raw.length; index++) {
    const char = raw[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0)
      return JSON.parse(raw.slice(start, index + 1));
  }
  throw new Error("unterminated GLB JSON chunk");
}

const REQUIRED_NODES = [
  "Ironwork_Pillar_Root",
  "Pillar_Stage_1",
  "Pillar_Stage_2",
  "Pillar_Stage_3",
  "Pillar_Summit_Apron",
  "Pillar_Obsidian_Table",
  "Pillar_Dais_Rune_01",
  "Pillar_Sentinel_01",
  "Pillar_Buried_Dais",
  "Pillar_Outcrop_3",
  "Pillar_Lower_Monolith",
  "Pillar_Upper_Monolith",
  "Pillar_Distant_Monolith",
  "Pillar_Sky_Glyph_01",
  "Pillar_Sky_Needle",
  "Pillar_Retune_Ring",
  "Pillar_Retune_Ring_Inner",
  "Pillar_Crown_Iris",
  "Pillar_Crown_Halo",
  "Pillar_Crown_Core",
  "Pillar_Iris_Left",
  "Pillar_Iris_Right",
];

const pillarBytes = readFileSync(
  new URL("../public/assets/citylife/props/ironwork-pillar.glb", import.meta.url),
);

describe("ironwork-pillar.glb", () => {
  const json = parseGltfJson(pillarGlbRaw);

  it("commits a compact three-stage GLB with the dynamic retune contract", () => {
    const names = json.nodes.map((node) => node.name);
    for (const required of REQUIRED_NODES) expect(names).toContain(required);
    expect(json.meshes).toHaveLength(86);
    expect(json.images ?? []).toHaveLength(0);
    expect(json.textures ?? []).toHaveLength(0);
    expect(json.cameras ?? []).toHaveLength(0);
    expect(pillarBytes.byteLength).toBeLessThan(300 * 1024);
    expect(createHash("sha256").update(pillarBytes).digest("hex")).toBe(
      "553fb05c242e6a1463a95bf0053769a2a9dffbde4f59cc0805cf42dfd9b9d6d0",
    );
  });

  it("keeps the skyline needle above six hundred metres and the crown emissive", () => {
    const needle = json.nodes.find((node) => node.name === "Pillar_Sky_Needle")!;
    const needleY = needle.translation?.[1] ?? needle.matrix?.[13];
    expect(needleY).toBeGreaterThan(600);
    const root = json.nodes.find((node) => node.name === "Ironwork_Pillar_Root")!;
    expect(root.extras?.heightMeters).toBe(622);
    const emissiveNames = (json.materials ?? [])
      .filter((material) => material.emissiveFactor?.some((channel) => channel > 0))
      .map((material) => material.name);
    expect(emissiveNames).toContain("Pillar_Core_Emissive");
    expect(emissiveNames).toContain("Pillar_Seam_Emissive");
    expect(emissiveNames).toContain("Pillar_Sky_Glyph_Emissive");
  });

  it("keeps generation deterministic and the runtime on the committed asset URL", () => {
    expect(generatorSource).not.toMatch(/Math\.random|Date\.now|performance\.now/);
    expect(generatorSource).toContain('root.name = "Ironwork_Pillar_Root"');
    expect(generatorSource).toContain('"ironwork-pillar.glb"');
    expect(IRONWORK_PILLAR_ASSET_URL).toBe(
      "/assets/citylife/props/ironwork-pillar.glb",
    );
  });
});
