import { getAuthClient } from "../authClient";
import { parseWorldLayoutDocument, type WorldLayoutDocument } from "../spatial/worldLayoutDocument";
import type { StarterParcelGeometry } from "../starterParcelSurvey";

export interface PublishedPlayerInventory {
  worldId: string;
  layoutRevision: string;
  plotIds: readonly string[];
  plotFrames: ReadonlyMap<string, string>;
  plotGeometry: ReadonlyMap<string, StarterParcelGeometry>;
  layout: WorldLayoutDocument;
}
export const STARTER_CATALOGUE_TIMEOUT_MS = 10_000;
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid world catalogue");
  return value as Record<string, unknown>;
};

export function parsePublishedStarterWorld(raw: unknown, worldId: string): PublishedPlayerInventory {
  const response = object(raw), manifest = object(response.manifest);
  if (response.published !== true || manifest.schemaVersion !== "citylife.starter-parcel-manifest/v1" ||
      manifest.worldId !== worldId || !Array.isArray(manifest.plots) || !manifest.plots.length)
    throw new Error("World catalogue is not published");
  const layout = parseWorldLayoutDocument(JSON.stringify(manifest.layout));
  if (layout.worldId !== worldId || layout.revision.contentHash !== manifest.layoutRevision ||
      layout.revision.parentHash !== manifest.sourceLayoutRevision)
    throw new Error("World catalogue revision does not match its layout");
  const plotIds = new Set<string>(), frameIds = new Set<string>(), plotFrames = new Map<string, string>();
  const plotGeometry = new Map<string, StarterParcelGeometry>();
  for (const entry of manifest.plots) {
    const plot = object(entry), geometry = object(plot.geometry);
    if (typeof plot.plotId !== "string" || !/^[A-Za-z0-9_.:-]{1,120}$/.test(plot.plotId) ||
        typeof plot.frameId !== "string" || plotIds.has(plot.plotId) || frameIds.has(plot.frameId) ||
        geometry.plotId !== plot.plotId || geometry.worldId !== worldId ||
        geometry.layoutRevision !== layout.revision.contentHash ||
        !layout.frames.some(f => f.id === plot.frameId && f.kind === "region" && f.layer === "surface"))
      throw new Error("World catalogue has inconsistent plot bindings");
    plotIds.add(plot.plotId); frameIds.add(plot.frameId);
    plotFrames.set(plot.plotId, plot.frameId);
    plotGeometry.set(plot.plotId, geometry as unknown as StarterParcelGeometry);
  }
  return { worldId, layoutRevision: layout.revision.contentHash, plotIds: [...plotIds], plotFrames, plotGeometry, layout };
}

export async function fetchPublishedStarterWorld(worldId: string, signal?: AbortSignal): Promise<PublishedPlayerInventory> {
  const auth = getAuthClient(), userId = auth.operator?.userId;
  if (!userId) throw new Error("Sign in to load your world");
  const token = await auth.getValidToken();
  if (!token || auth.operator?.userId !== userId || signal?.aborted) throw new Error("Your session changed. Please retry.");
  const response = await fetch(`/kooker/api/v1/citylife/worlds/${encodeURIComponent(worldId)}/starter-catalogue`,
    { headers: { Authorization: `Bearer ${token}` },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(STARTER_CATALOGUE_TIMEOUT_MS)])
        : AbortSignal.timeout(STARTER_CATALOGUE_TIMEOUT_MS), cache: "no-store" });
  if (!response.ok) throw new Error(response.status === 404
    ? "The world catalogue has not been published yet. Please try again later."
    : "The world catalogue could not be loaded. Please retry.");
  const raw: unknown = await response.json();
  if (auth.operator?.userId !== userId || signal?.aborted) throw new Error("Your session changed. Please retry.");
  return parsePublishedStarterWorld(raw, worldId);
}
