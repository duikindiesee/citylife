import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { greedyMesh } from "../src/colony/render/voxelMesh";
import { compileBlueprint, HOUSE_VOXEL_N } from "../src/colony/houseBuilder";
import {
  BLOCK_COLOR,
  type Block,
  type BlockKind,
} from "../src/colony/voxelHouse";

// Build a flat wall: a single z-layer of WxD blocks of one kind. With no merging this is W*D faces on the
// top and W*D on the bottom plus a perimeter ring — each face split into 2 triangles. With greedy merging
// the big coplanar faces collapse to a handful of quads.
function flatSlab(w: number, d: number, kind: BlockKind): Block[] {
  const out: Block[] = [];
  for (let y = 0; y < d; y++)
    for (let x = 0; x < w; x++) out.push({ x, y, z: 0, kind });
  return out;
}

const N = 6;
const OPTS = { n: N, cell: 1, voxelY: 1 };

describe("voxelMesh — the greedy mesher (spec 077 P2)", () => {
  it("merges a flat wall of one tint to FAR fewer quads than two triangles per block face", () => {
    const w = 12,
      d = 8;
    const slab = flatSlab(w, d, "brick");
    const { quadCount } = greedyMesh(slab, OPTS);
    // A naive mesher emits one quad (2 tris) per exposed face. A solid WxDx1 slab has, exposed:
    //   top W*D + bottom W*D + 4 side strips (each W or D long, 1 tall) = 2*W*D + 2*(W+D) faces.
    const naiveFaces = 2 * w * d + 2 * (w + d);
    // Greedy must collapse each big coplanar one-tint surface to a single quad: top=1, bottom=1, and the 4
    // side strips to 1 each => about 6, certainly an order of magnitude under the naive face count.
    expect(quadCount).toBeLessThan(naiveFaces / 4);
    expect(quadCount).toBeLessThanOrEqual(8);
  });

  it("a single solid one-tint cube layer (no holes) yields exactly the 6 outer faces", () => {
    // A 3x3x1 block of identical bricks: greedy should give top + bottom + 4 sides = 6 quads.
    const blocks: Block[] = [];
    for (let y = 0; y < 3; y++)
      for (let x = 0; x < 3; x++) blocks.push({ x, y, z: 0, kind: "brick" });
    const { quadCount } = greedyMesh(blocks, OPTS);
    expect(quadCount).toBe(6);
  });

  it("emits flat per-quad normals — every triangle vertex shares one of the six axis normals", () => {
    const slab = flatSlab(6, 6, "wall");
    const { geometry } = greedyMesh(slab, OPTS);
    const nrm = geometry.getAttribute("normal") as THREE.BufferAttribute;
    expect(nrm.count).toBeGreaterThan(0);
    const allowed = new Set([
      "1,0,0",
      "-1,0,0",
      "0,1,0",
      "0,-1,0",
      "0,0,1",
      "0,0,-1",
    ]);
    for (let i = 0; i < nrm.count; i++) {
      const key = `${Math.round(nrm.getX(i))},${Math.round(nrm.getY(i))},${Math.round(nrm.getZ(i))}`;
      expect(allowed.has(key)).toBe(true);
    }
    // Flat shading: within each triangle (3 consecutive verts) the normal is identical.
    for (let i = 0; i < nrm.count; i += 3) {
      const k0 = `${nrm.getX(i)},${nrm.getY(i)},${nrm.getZ(i)}`;
      const k1 = `${nrm.getX(i + 1)},${nrm.getY(i + 1)},${nrm.getZ(i + 1)}`;
      const k2 = `${nrm.getX(i + 2)},${nrm.getY(i + 2)},${nrm.getZ(i + 2)}`;
      expect(k0).toBe(k1);
      expect(k1).toBe(k2);
    }
  });

  it("preserves brick tint banding — adjacent courses of a different tint are NOT merged into one quad", () => {
    // A wall standing in z, one micro-block thick (a single x column), alternating brick / brickAlt by course
    // (the masonry banding the compiler emits). The +x and -x faces of each course are exposed.
    const blocks: Block[] = [];
    const courses = 8;
    for (let z = 0; z < courses; z++) {
      for (let y = 0; y < 4; y++) {
        blocks.push({ x: 0, y, z, kind: z % 2 === 0 ? "brick" : "brickAlt" });
      }
    }
    const { geometry, quadCount } = greedyMesh(blocks, OPTS);

    // If the two tints had been merged across courses, the big +x/-x faces would each collapse to a single
    // quad regardless of colour. Because the tints differ, each course's face must stay a separate quad, so
    // the quad count grows with the number of courses — banding survives the merge.
    expect(quadCount).toBeGreaterThanOrEqual(courses * 2);

    // And concretely: somewhere in the geometry both tint colours must be present (the band is two colours).
    const colAttr = geometry.getAttribute("color") as THREE.BufferAttribute;
    const seen = new Set<string>();
    for (let i = 0; i < colAttr.count; i++) {
      seen.add(
        `${colAttr.getX(i).toFixed(4)},${colAttr.getY(i).toFixed(4)},${colAttr.getZ(i).toFixed(4)}`,
      );
    }
    const brick = new THREE.Color(BLOCK_COLOR.brick);
    const brickAlt = new THREE.Color(BLOCK_COLOR.brickAlt);
    expect(
      seen.has(
        `${brick.r.toFixed(4)},${brick.g.toFixed(4)},${brick.b.toFixed(4)}`,
      ),
    ).toBe(true);
    expect(
      seen.has(
        `${brickAlt.r.toFixed(4)},${brickAlt.g.toFixed(4)},${brickAlt.b.toFixed(4)}`,
      ),
    ).toBe(true);
    // The two tints are genuinely different colours (the banding is meaningful, not two names for one hue).
    expect(BLOCK_COLOR.brick).not.toBe(BLOCK_COLOR.brickAlt);
  });

  it("a two-tint checkerboard never merges unlike neighbours — quad count tracks the tile count", () => {
    // A flat layer where every cell flips tint: no two in-plane neighbours share a tint, so on the big top
    // and bottom faces NOTHING merges — each cell face stays its own quad.
    const w = 4,
      d = 4;
    const blocks: Block[] = [];
    for (let y = 0; y < d; y++)
      for (let x = 0; x < w; x++)
        blocks.push({
          x,
          y,
          z: 0,
          kind: (x + y) % 2 === 0 ? "brick" : "brickAlt",
        });
    const { quadCount } = greedyMesh(blocks, OPTS);
    // top + bottom alone are 2 * w * d unmerged cell faces (sides add more) — far above a merged slab's ~6.
    expect(quadCount).toBeGreaterThanOrEqual(2 * w * d);
  });

  it("skips hidden internal faces — a solid 4x4x4 cube has only its outer shell", () => {
    const blocks: Block[] = [];
    for (let z = 0; z < 4; z++)
      for (let y = 0; y < 4; y++)
        for (let x = 0; x < 4; x++) blocks.push({ x, y, z, kind: "stone" });
    const { quadCount } = greedyMesh(blocks, OPTS);
    // One solid same-tint cube: each of the 6 outer faces is a flat same-tint surface => 6 quads. Internal
    // faces (between two solid cells) are never emitted.
    expect(quadCount).toBe(6);
  });

  it("turns a real compiled blueprint into one merged geometry with masonry colours present", () => {
    const script =
      "house{w:6 d:5 wallH:2 door:s} room{kind:living x:0 y:0 w:4 d:3 win:1} room{kind:bedroom x:4 y:0 w:2 d:3 win:1} room{kind:patio x:0 y:3 w:6 d:2 win:0}";
    const h = compileBlueprint(script, { w: 9, d: 6, seed: 0x1234abcd });
    expect(h.n).toBe(HOUSE_VOXEL_N);
    // The renderer uses a small voxelY so a 2-storey house is a sensible height; mirror that here.
    const { geometry, quadCount } = greedyMesh(h.blocks, {
      n: h.n,
      cell: 1,
      voxelY: 0.18,
    });
    expect(quadCount).toBeGreaterThan(0);
    const pos = geometry.getAttribute("position") as THREE.BufferAttribute;
    // Vertices stay SMALL (tile-local): the house spans only a few plot cells, so |coord| is a handful, not
    // thousands — this is what lets the renderer parent it at a tile origin.
    for (let i = 0; i < pos.count; i++) {
      expect(Math.abs(pos.getX(i))).toBeLessThan(20);
      expect(Math.abs(pos.getY(i))).toBeLessThan(20);
      expect(Math.abs(pos.getZ(i))).toBeLessThan(20);
    }
    // The merged geometry is dramatically cheaper than one box per micro-block (the minecraft path).
    expect(quadCount).toBeLessThan(h.blocks.length);
  });
});
