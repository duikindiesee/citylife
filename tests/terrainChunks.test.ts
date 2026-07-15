import { describe, expect, it } from "vitest";
import { buildChunkedTerrain } from "../src/colony/render/terrainChunks";
import * as THREE from "three";

describe("terrainChunks", () => {
  it("builds correct number of chunks based on grid size", () => {
    const size = 17; // 16 cells across
    const terrain = {
      size,
      worldY: (x: number, y: number) => 0,
    } as any;

    const wx = (x: number) => x;
    const wz = (y: number) => y;
    const colorFor = (i: number, out: THREE.Color) => out.setHex(0xffffff);
    const material = new THREE.MeshBasicMaterial();

    // 2x2 grid for a 17x17 terrain = 4 chunks
    const chunked = buildChunkedTerrain(terrain, wx, wz, colorFor, material, 2);

    expect(chunked.chunks.length).toBe(4);
    expect(chunked.group.children.length).toBe(4);

    // Each chunk should cover an 8x8 cell area (9x9 vertices)
    const firstChunk = chunked.chunks[0];
    expect(firstChunk.x0).toBe(0);
    expect(firstChunk.y0).toBe(0);
    expect(firstChunk.x1).toBe(8);
    expect(firstChunk.y1).toBe(8);
  });
});
