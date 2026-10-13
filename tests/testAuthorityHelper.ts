import type { ColonyRuntime } from "../src/colony/runtime";
import type { RemoteStarterCatalogueManifest } from "../src/colony/worldLayoutBoot";

/**
 * Supplies authoritative published world layout and catalogue manifest to a ColonyRuntime instance.
 * Required for Server 421 / Spec 149 multiplayer neighbourhood authority before enableMultiplayer.
 */
export function setupAuthoritativeRuntime(
  runtime: ColonyRuntime,
  options?: { userId?: string; neighbourhoods?: string[] },
): void {
  if (options?.userId) {
    runtime.setOperatorUserId(options.userId);
  }
  const doc = runtime.captureWorldLayout();
  runtime.hydrateWorldLayout(doc);

  const activeDoc = runtime.worldLayoutDocument();
  if (!activeDoc) {
    throw new Error("setupAuthoritativeRuntime: activeDoc is missing after hydration");
  }

  const hoods = options?.neighbourhoods ?? ["wood1", "wood2"];
  const manifest: RemoteStarterCatalogueManifest = {
    schemaVersion: "citylife.starter-parcel-manifest/v1",
    status: "PUBLISHED",
    worldId: activeDoc.worldId,
    sourceLayoutRevision: activeDoc.revision.parentHash ?? undefined,
    layoutRevision: activeDoc.revision.contentHash,
    layout: {
      schemaVersion: "citylife.world-layout/v1",
      layoutId: activeDoc.worldId,
      seed: activeDoc.seed,
      generator: activeDoc.generator,
      revision: {
        number: activeDoc.revision.number,
        parentHash: activeDoc.revision.parentHash,
        contentHash: activeDoc.revision.contentHash,
      },
      frames: activeDoc.frames as any,
      zones: [],
      reservations: [],
      placements: activeDoc.placements as any,
    } as any,
    plots: hoods.map((key, idx) => ({
      plotId: `${key}_lot_${idx + 1}`,
      geometry: { neighbourhoodKey: key },
    })),
  };

  runtime.setStarterCatalogueManifest(manifest);
}

/**
 * Binds a mock session_joined / session_reconnected response to the actual worldId, layoutRevision,
 * and neighbourhoodKey sent by the client in its join_session request.
 */
export function makeSessionJoinedAck(
  socket: { sent: any[] },
  payload: Record<string, any>,
): Record<string, any> {
  const joinMsg = [...socket.sent]
    .reverse()
    .find(
      (m: any) =>
        m.type === "join_session" ||
        m.type === "create_session" ||
        m.type === "reconnect_session",
    );
  if (!joinMsg) {
    throw new Error("MISSING_JOIN_REQUEST_FIXTURE");
  }
  return {
    worldId: joinMsg.worldId,
    layoutRevision: joinMsg.layoutRevision,
    neighbourhoodKey: joinMsg.neighbourhoodKey,
    ...payload,
  };
}
