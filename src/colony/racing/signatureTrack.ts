// Spec 169 §3.5 — signature routes as a SECOND track constructor, additive beside the Road Rally.
//
// `makeRaceTrack`'s farthest-point BFS stays exactly as it is for improvised rallies anywhere on the
// island. An AUTHORED route becomes the same `RaceTrack` shape through this
// constructor instead, so `stepRace`, `driveCar`, checkpoints, car stats, the garage and the Rally UI
// consume it without knowing the difference. The one addition is the optional `racingProfile`, which
// is what activates spec §3.2's grip cap and the width-aware off-track threshold in `driveCar` —
// absent on every BFS track, so the founding island drives digit-for-digit as it always did.
import type { RaceTrack, RacingProfile } from "./track";

export interface SignatureRoute {
  readonly name: string;
  readonly path: { x: number; y: number }[];
  readonly lengthCells: number;
  readonly profile: RacingProfile;
}

/** Spec §3.4 table: 4–7 checkpoints. One roughly every this many cells of arc, capped to the range. */
const CHECKPOINT_EVERY_CELLS = 140;

/**
 * Build a drivable RaceTrack from an authored route.
 *
 * `roadKinds` marks every rounded path cell "avenue" as a CARRIER value only — the actual ceiling
 * comes from the profile, and slice 1 deliberately defers the `highway` RoadKind union member to the
 * slice that lays real highway roads (the union ripples through the persistence codec and builder
 * surfaces for zero benefit while no highway cell exists in any world).
 */
export function makeSignatureTrack(route: SignatureRoute): RaceTrack {
  const path = route.path.map((p) => ({ x: p.x, y: p.y }));
  if (path.length < 2) throw new Error("signature route needs a path");

  // Checkpoints by arc length: start, one every ~140 cells, and the finish — clamped to spec's 4–7.
  const arcs: number[] = [0];
  for (let i = 1; i < path.length; i++)
    arcs.push(
      arcs[i - 1]! +
        Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y),
    );
  const total = arcs[arcs.length - 1]!;
  const interior = Math.max(
    2,
    Math.min(5, Math.floor(total / CHECKPOINT_EVERY_CELLS) - 1),
  );
  const checkpoints: { x: number; y: number }[] = [path[0]!];
  for (let k = 1; k <= interior; k++) {
    const target = (total * k) / (interior + 1);
    let i = arcs.findIndex((a) => a >= target);
    if (i < 1) i = 1;
    checkpoints.push(path[i]!);
  }
  checkpoints.push(path[path.length - 1]!);

  const roadKinds: RaceTrack["roadKinds"] = {};
  for (const p of path)
    roadKinds[`${Math.round(p.x)},${Math.round(p.y)}`] = "avenue";

  return {
    checkpoints: checkpoints.map((p) => ({ x: p.x, y: p.y })),
    path,
    length: total,
    loop: false,
    seed: 0,
    roadsVersion: 0,
    roadKinds,
    racingProfile: { ...route.profile },
  };
}
