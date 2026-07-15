import type { Terrain } from "../terrain";
import type { CommercialCluster } from "./commercialClusters";
import { padSeatY } from "./useTerrainLeveling";

/** Spec 139 follow-up: seat the builder-painted block on the same graded footprint as its lots. */
export function commercialBlockSeatY(
  terrain: Terrain,
  cluster: Pick<CommercialCluster, "footprint">,
): number {
  const { x, y, w, d } = cluster.footprint;
  return padSeatY(terrain, x, y, w, d) + 0.02;
}
