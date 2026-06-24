import type { Terrain } from "./terrain";

export const ARTIFACT_KINDS = [
  "bench",
  "lamppost",
  "planter",
  "fountain",
  "shade_tree",
  "notice_board",
  "wayfinder",
] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];
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
  isPublicSafe: true;
}

export interface ArtifactCatalogEntry {
  kind: ArtifactKind;
  category: ArtifactCategory;
  footprint: ArtifactFootprint;
  isPublicSafe: true;
}

interface CatalogSeed {
  kind: ArtifactKind;
  category: ArtifactCategory;
  footprint: ArtifactFootprint;
  offset: { x: number; y: number };
  rot: number;
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
  {
    kind: "shade_tree",
    category: "greenery",
    offset: { x: 0, y: -5 },
    rot: Math.PI * 1.25,
    footprint: { w: 1.8, h: 1.8 },
  },
  {
    kind: "notice_board",
    category: "civic-art",
    offset: { x: 5, y: 1 },
    rot: Math.PI,
    footprint: { w: 1.2, h: 0.45 },
  },
  {
    kind: "wayfinder",
    category: "civic-art",
    offset: { x: -5, y: 1 },
    rot: Math.PI * 1.5,
    footprint: { w: 0.75, h: 0.5 },
  },
];

export const ARTIFACT_CATALOG_SIZE = CATALOG.length;

export function artifactCatalogEntries(): ArtifactCatalogEntry[] {
  return CATALOG.map(({ kind, category, footprint }) =>
    Object.freeze({
      kind,
      category,
      footprint: Object.freeze({ ...footprint }),
      isPublicSafe: true as const,
    }),
  );
}

const ARTIFACT_KIND_SET = new Set<string>(ARTIFACT_KINDS);

export function isArtifactKind(kind: string): kind is ArtifactKind {
  return ARTIFACT_KIND_SET.has(kind);
}

export type ArtifactCounts = Record<ArtifactKind, number>;

export interface RenderableArtifactSummary<T extends { kind: string }> {
  counts: ArtifactCounts;
  renderable: (T & { kind: ArtifactKind })[];
  unknown: number;
  overflow: number;
}

export function emptyArtifactCounts(): ArtifactCounts {
  return {
    bench: 0,
    lamppost: 0,
    planter: 0,
    fountain: 0,
    shade_tree: 0,
    notice_board: 0,
    wayfinder: 0,
  };
}

export function summarizeRenderableArtifacts<T extends { kind: string }>(
  items: readonly T[],
  capPerKind: number,
): RenderableArtifactSummary<T> {
  const counts = emptyArtifactCounts();
  const renderable: (T & { kind: ArtifactKind })[] = [];
  let unknown = 0;
  let overflow = 0;

  for (const item of items) {
    if (!isArtifactKind(item.kind)) {
      unknown++;
      continue;
    }
    if (counts[item.kind] >= capPerKind) {
      overflow++;
      continue;
    }
    counts[item.kind]++;
    renderable.push(item as T & { kind: ArtifactKind });
  }

  return { counts, renderable, unknown, overflow };
}

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
      isPublicSafe: true,
    };
  });
}
