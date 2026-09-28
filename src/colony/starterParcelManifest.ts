import type { Parcel } from "./neighborhood";
import type { Cell } from "./pathfind";
import { surveyStarterDrivewayClearance, surveyStarterParcels } from "./starterParcelSurvey";
import { createWorldLayoutDocument, parseWorldLayoutDocument, serializeWorldLayoutDocument,
  type WorldLayoutDocument, type WorldLayoutFrame } from "./spatial/worldLayoutDocument";

/** Operator-generated review artifact. Neither this function nor its output grants ownership,
 * sets prices, publishes land, or proves rendered slope/turning clearance. */
export function createStarterParcelManifest(input: {
  layout: WorldLayoutDocument;
  parcels: readonly Parcel[];
  groundClear: (cell: Cell) => boolean;
}) {
  const base = parseWorldLayoutDocument(serializeWorldLayoutDocument(input.layout));
  const surfaces = base.frames.filter(f => f.kind === "region" && f.layer === "surface" && f.grid);
  if (surfaces.length !== 1) throw new Error("Expected one canonical surface grid before parcel publication");
  const surface = surfaces[0];
  const grid = surface.grid!;
  const roads = base.roads.filter(r => r.frameId === surface.id).flatMap(r => r.cells);
  const survey = surveyStarterParcels({ worldId: base.worldId,
    layoutRevision: base.revision.contentHash, parcels: input.parcels, roads,
    groundClear: input.groundClear });
  const rejected = [...survey.rejected];
  const accepted = survey.candidates.flatMap(geometry => {
    const lot = input.parcels.find(p => p.id === geometry.plotId)!;
    const clearance = surveyStarterDrivewayClearance(geometry, lot, roads, input.groundClear);
    if (!clearance.clear) {
      rejected.push({ plotId: geometry.plotId, reason: clearance.reason! });
      return [];
    }
    return [{ geometry, heading: clearance.heading }];
  }).sort((a, b) => a.geometry.plotId < b.geometry.plotId ? -1 : a.geometry.plotId > b.geometry.plotId ? 1 : 0);
  if (!accepted.length) throw new Error("No qualified starter parcels");
  const frames: WorldLayoutFrame[] = accepted.map(({ geometry }) => {
    const p = geometry.parcel;
    const id = `${surface.id}:region:player-parcel-${geometry.plotId}`;
    if (id.length > 120 || base.frames.some(f => f.id === id))
      throw new Error("Parcel frame identity is unavailable");
    if (p.x < 0 || p.y < 0 || p.x + p.width > grid.width || p.y + p.depth > grid.height)
      throw new Error("Parcel lies outside the canonical surface grid");
    return { id, address: `${surface.address}/region/player-parcel-${geometry.plotId}`,
      kind: "region", layer: "surface", parentId: surface.id,
      // Frame zero is the first parcel cell centre, not a fabricated building foundation.
      transform: { position: { x: grid.origin.x + p.x * grid.cellSize,
        y: grid.origin.y, z: grid.origin.z + p.y * grid.cellSize },
        rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      grid: { width: p.width, height: p.depth, cellSize: grid.cellSize,
        origin: { x: 0, y: 0, z: 0 } },
    };
  });
  const layout = createWorldLayoutDocument({ ...base, frames: [...base.frames, ...frames],
    revision: { number: base.revision.number + 1, parentHash: base.revision.contentHash } });
  return {
    schemaVersion: "citylife.starter-parcel-manifest/v1" as const,
    status: "REVIEW_REQUIRED_NOT_PUBLISHED" as const,
    worldId: base.worldId, sourceLayoutRevision: base.revision.contentHash,
    layoutRevision: layout.revision.contentHash, layout,
    plots: accepted.map(({ geometry, heading }, index) => ({
      plotId: geometry.plotId, frameId: frames[index].id, spawnHeading: heading,
      geometry: { ...geometry, layoutRevision: layout.revision.contentHash },
    })),
    rejected: rejected.sort((a, b) => a.plotId < b.plotId ? -1 : a.plotId > b.plotId ? 1 : 0),
  };
}
