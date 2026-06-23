import type { Terrain } from "./terrain";

export type ArtifactKind = "bench" | "lamppost" | "planter" | "fountain";
export type ArtifactCategory =
  | "furniture"
  | "lighting"
  | "greenery"
  | "civic-art";

export interface ArtifactFootprint {
  w: number;
  h: number;
}

export interface VisualArtifact {
  id: string;
  kind: ArtifactKind;
  x: number;
  y: number;
  rot: number;
  footprint: ArtifactFootprint;
  category: ArtifactCategory;
}

interface CatalogSeed {
  kind: ArtifactKind;
  category: ArtifactCategory;
  offset: { x: number; y: number };
  rot: number;
  footprint: ArtifactFootprint;
}

const CATALOG: CatalogSeed[] = [
  {
    kind: "bench",
    category: "furniture",
    offset: { x: -2, y: 4 },
    rot: Math.PI * 0.5,
    footprint: { w: 1.4, h: 0.55 },
  },
  {
    kind: "lamppost",
    category: "lighting",
    offset: { x: 3, y: 4 },
    rot: 0,
    footprint: { w: 0.35, h: 0.35 },
  },
  {
    kind: "planter",
    category: "greenery",
    offset: { x: -4, y: -2 },
    rot: Math.PI * 0.25,
    footprint: { w: 1.0, h: 1.0 },
  },
  {
    kind: "fountain",
    category: "civic-art",
    offset: { x: 4, y: -2 },
    rot: Math.PI * 0.75,
    footprint: { w: 1.6, h: 1.6 },
  },
];

function dry(terrain: Terrain, x: number, y: number): boolean {
  return terrain.inBounds(x, y) && !terrain.isWater(x, y);
}

function nearestDryCell(
  terrain: Terrain,
  x: number,
  y: number,
  used: Set<string>,
): { x: number; y: number } {
  if (dry(terrain, x, y) && !used.has(`${x},${y}`)) return { x, y };
  for (let r = 1; r <= 8; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (dry(terrain, nx, ny) && !used.has(`${nx},${ny}`))
          return { x: nx, y: ny };
      }
    }
  }
  return terrain.landing;
}

export function createVisualArtifacts(terrain: Terrain): VisualArtifact[] {
  const used = new Set<string>();
  return CATALOG.map((seed, index) => {
    const targetX = Math.round(terrain.landing.x + seed.offset.x);
    const targetY = Math.round(terrain.landing.y + seed.offset.y);
    const pos = nearestDryCell(terrain, targetX, targetY, used);
    used.add(`${pos.x},${pos.y}`);
    return {
      id: `artifact-${index}-${seed.kind}`,
      kind: seed.kind,
      x: pos.x,
      y: pos.y,
      rot: seed.rot,
      footprint: { ...seed.footprint },
      category: seed.category,
    };
  });
}
