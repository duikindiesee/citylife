import { ColonyRuntime } from "../runtime";
import type { Parcel } from "../neighborhood";
import { gradePlot, type PlotGrading, type SlopeBand } from "../slope/plotGrading";
import type { GroundAt } from "../render/kitGround";
import type { Cell } from "../pathfind";

export type SlopeFixtureKind = "downhill" | "uphill" | "gentle" | "flat";
export interface SlopeFixture {
  kind: SlopeFixtureKind;
  seed: number;
  parcel: Parcel;
  neighbours: Parcel[];
  grading: PlotGrading;
  groundAt: GroundAt;
  carriage: Cell[];
  mapSize: number;
  runtime: ColonyRuntime;
}

const FIXTURE: Record<Exclude<SlopeFixtureKind, "flat">, { seed: number; band: SlopeBand }> = {
  downhill: { seed: 42, band: "steep-downhill" },
  uphill: { seed: 4242, band: "steep-uphill" },
  gentle: { seed: 180, band: "gentle" },
};

/** Construct the real seeded world and select the requested graded parcel deterministically. */
export function pickSlopeFixture(kind: SlopeFixtureKind): SlopeFixture {
  const seed = kind === "flat" ? 180 : FIXTURE[kind].seed;
  const runtime = new ColonyRuntime(seed, { surveyOnly: true });
  const terrain = runtime.sim.state.terrain;
  const groundAt: GroundAt = (gx, gy) => terrain.worldYAt(gx, gy);
  const lots = runtime.lots();
  const candidates = lots.map((parcel) => ({ parcel, grading: gradePlot(parcel, groundAt) }));
  const desired = kind === "flat" ? null : FIXTURE[kind].band;
  const eligible = candidates.filter((candidate) => candidate.grading.band === desired && candidate.grading.ok);
  const minFenceGround = (parcel: Parcel) => Math.min(...[...parcel.fence, parcel.gate].map((cell) => groundAt(cell.x, cell.y)));
  const aboveGroundThreshold = eligible.filter(({ parcel }) => minFenceGround(parcel) > 1.0);
  const matching = kind === "gentle" ? aboveGroundThreshold : (aboveGroundThreshold.length > 0 ? aboveGroundThreshold : eligible);
  const drivewayGrade = (candidate: (typeof candidates)[number]) => {
    const path = candidate.parcel.driveway;
    if (path.length < 2) return 0;
    const start = groundAt(path[0]!.x, path[0]!.y);
    const end = groundAt(path[path.length - 1]!.x, path[path.length - 1]!.y);
    return Math.abs(end - start) / ((path.length - 1) * 4);
  };
  if (desired && matching.length === 0) throw new Error(`No valid ${desired} parcel found above the ground threshold for fixture seed ${seed}`);
  const knownDownhill = kind === "downhill" ? matching.find(({ parcel }) => /(?:wood|hill|vale)5_lot_3$/.test(parcel.id)) : undefined;
  const parcel = (kind === "downhill"
    ? knownDownhill ?? matching.sort((a, b) => drivewayGrade(b) - drivewayGrade(a))[0]
    : matching[0])?.parcel ?? candidates[0]?.parcel;
  if (!parcel) throw new Error(`No parcel found for slope fixture ${kind}`);
  const grading = gradePlot(parcel, groundAt);
  const toMetres = (cell: Cell) => Math.hypot(cell.x - parcel.gate.x, cell.y - parcel.gate.y) * 4;
  const neighbours = lots.filter((lot) => toMetres(lot.gate) <= 110);
  const neighborhood = runtime.sim.state.neighborhood!;
  return { kind, seed, parcel, neighbours, grading, groundAt, carriage: neighborhood.carriage, mapSize: terrain.size, runtime };
}
