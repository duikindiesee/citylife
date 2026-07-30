// WORLD.SURVEY.1 — is a generated world SOUND? Pure verdict logic over a surveyed seed.
//
// Every world in this game is a seed. Most of them have never been looked at, and the ones that get
// looked at are looked at by eye. This turns "does seed N hold together" into a measurement, so a
// seed can be qualified before anyone builds on it — and so a change to road routing or route
// smoothing can be scored across a POPULATION of worlds instead of the boot seed alone.
//
// Two kinds of output, deliberately separated:
//
//   CHECKS   pass/fail soundness. A failing blocking check means the world is broken, not hard.
//   METRICS  what the world is LIKE. Loop length, tightest turn, how much of the network is
//            stranded. These are difficulty dials, not faults — a world with tight corners and a
//            long lap is a harder world, not a worse one.
//
// Pure: no runtime, no three.js, no filesystem, no clock. The caller surveys a world (booting it is
// the expensive part — see scripts/seedQualify.ts) and hands the geometry in as plain arrays.

import {
  largestComponentShare,
  roadComponents,
  type RoadCell,
} from "./roadConnectivity";

export interface Pt {
  x: number;
  y: number;
}

export interface QualifyInput {
  seed: number;
  /** Terrain grid width — road cell indices are y * gridSize + x. */
  gridSize: number;
  /** Every drivable cell, for connectivity and for nearest-road lookups. */
  roads: RoadCell[];
  /** The driven bus loop, sampled along its arc. Null when the seed routes no loop. */
  routeSamples: Pt[] | null;
  /** Each road way's ROUTED centre-line, densified — the line the drivable cells were rasterised
   *  onto, so a gap here means cells the land filter refused to lay. */
  waySamples: Pt[][];
  /** Each road way's RENDERED centre-line — the asphalt a player actually sees. */
  ribbonSamples: Pt[][];
  hasDepot: boolean;
  /** Arc length of the driven loop, in cells. */
  loopCells: number;
  stopCount: number;
}

export interface Thresholds {
  /** Carriageway half-width. A way is 4 cells wide, so 2 is the outer kerb. */
  onRoadCells: number;
  /** Fraction of drivable cells that must live in the single largest component. */
  connectedShare: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  onRoadCells: 2,
  connectedShare: 0.98,
};

export interface Check {
  id: string;
  /** `blocking` decides the verdict. `known` is a defect already understood and tracked — it is
   *  measured and reported but does not condemn a seed, because every seed would fail it and the
   *  harness would say nothing. Promote it the day it is fixed. */
  severity: "blocking" | "known";
  pass: boolean;
  /** What was measured, and what it had to beat. Null when the check is structural (present/absent). */
  value: number | null;
  limit: number | null;
  detail: string;
}

export interface Metrics {
  roadCells: number;
  ways: number;
  components: number;
  largestComponentShare: number;
  strandedCells: number;
  loopCells: number;
  stops: number;
  worstRouteOff: number;
  worstWayOff: number;
  worstRibbonOff: number;
  /** Tightest turn radius on the driven loop, in cells (Infinity when it never turns). A
   *  difficulty dial, not a fault: smaller asks more of a bus.
   *
   *  CAVEAT, measured: across seeds 1-24 this reads ~0.3 cells almost everywhere, because
   *  BUS.ROUTE.TURN.1 caps the corner cut at one cell and every corner therefore rounds over the
   *  same small fillet. Right now it characterises the SMOOTHER, not the world, and does not
   *  discriminate between seeds. `loopCells` and `stops` do. Left in because it becomes meaningful
   *  the moment corner geometry varies — but do not build a difficulty score on it yet. */
  tightestTurnRadiusCells: number;
}

export interface Qualification {
  seed: number;
  sound: boolean;
  checks: Check[];
  metrics: Metrics;
}

/** Nearest drivable cell, in cells, by expanding ring — ring r holds nothing closer than r - 0.5.
 *  Saturates at `limit`, which keeps a pathological sample from scanning the whole grid. */
export function cellsFromRoad(
  isRoad: (x: number, y: number) => boolean,
  px: number,
  py: number,
  limit = 24,
): number {
  let best = Infinity;
  const cx = Math.round(px),
    cy = Math.round(py);
  for (let r = 0; r <= limit && best > r - 0.5; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (!isRoad(cx + dx, cy + dy)) continue;
        best = Math.min(best, Math.hypot(px - (cx + dx), py - (cy + dy)));
      }
  return best;
}

function worstOff(
  isRoad: (x: number, y: number) => boolean,
  groups: Pt[][],
): number {
  let worst = 0;
  for (const g of groups)
    for (const p of g) {
      const d = cellsFromRoad(isRoad, p.x, p.y);
      if (d > worst) worst = d;
    }
  return worst;
}

/** TIGHTEST TURN RADIUS along a sampled path, in cells. Radius rather than a degrees-per-cell rate
 *  for two reasons: it is the quantity a vehicle actually has a limit on, and it does not blow up.
 *
 *  A rate divides by the sample step, so it explodes as the step vanishes — a smoothed path packs
 *  vertices at every corner fillet by construction, and dividing a real heading change by a
 *  0.05-cell step reported 1142 deg/cell on seed 3, an artefact of the sampling rather than a turn
 *  anything takes. Radius = arc / |heading change| degrades the other way: near-coincident samples
 *  carry no heading information, so they are skipped outright.
 *
 *  Returns Infinity for a straight path — no curvature, no limit. Smaller is tighter, so a world
 *  with a 2-cell radius asks more of a bus than one with a 20-cell radius. */
export function tightestTurnRadius(samples: Pt[], minArcCells = 0.5): number {
  if (samples.length < 3) return Infinity;
  let tightest = Infinity;
  for (let i = 1; i < samples.length - 1; i++) {
    const a = samples[i - 1]!,
      b = samples[i]!,
      c = samples[i + 1]!;
    const inArc = Math.hypot(b.x - a.x, b.y - a.y);
    const outArc = Math.hypot(c.x - b.x, c.y - b.y);
    if (inArc < minArcCells || outArc < minArcCells) continue;
    const h1 = Math.atan2(b.y - a.y, b.x - a.x);
    const h2 = Math.atan2(c.y - b.y, c.x - b.x);
    let d = h2 - h1;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    if (Math.abs(d) < 1e-6) continue; // straight here
    tightest = Math.min(tightest, (inArc + outArc) / 2 / Math.abs(d));
  }
  return tightest;
}

export function qualifyWorld(
  input: QualifyInput,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): Qualification {
  const roadKeys = new Set(input.roads.map((r) => `${r.x},${r.y}`));
  const isRoad = (x: number, y: number) => roadKeys.has(`${x},${y}`);

  const comps = roadComponents(input.roads, input.gridSize);
  const share = largestComponentShare(input.roads, input.gridSize);
  const stranded = input.roads.length - (comps[0]?.size ?? 0);

  const worstRouteOff = input.routeSamples
    ? worstOff(isRoad, [input.routeSamples])
    : 0;
  const worstWayOff = worstOff(isRoad, input.waySamples);
  const worstRibbonOff = worstOff(isRoad, input.ribbonSamples);

  const checks: Check[] = [
    {
      id: "transit-complete",
      severity: "blocking",
      pass: input.routeSamples !== null && input.hasDepot,
      value: null,
      limit: null,
      detail: input.routeSamples
        ? input.hasDepot
          ? "route and depot"
          : "routes a loop but sites NO DEPOT — the fleet has nowhere to live"
        : "no bus route at all",
    },
    {
      id: "network-connected",
      severity: "blocking",
      pass: share >= thresholds.connectedShare,
      value: share,
      limit: thresholds.connectedShare,
      detail: `${comps.length} component(s), ${stranded} of ${input.roads.length} cells stranded`,
    },
    {
      id: "route-on-road",
      severity: "blocking",
      // Vacuously true with no route; `transit-complete` is what fails in that case.
      pass:
        input.routeSamples === null || worstRouteOff <= thresholds.onRoadCells,
      value: worstRouteOff,
      limit: thresholds.onRoadCells,
      detail: "driven bus loop against the drivable grid",
    },
    {
      id: "ways-have-cells",
      severity: "blocking",
      pass: worstWayOff <= thresholds.onRoadCells,
      value: worstWayOff,
      limit: thresholds.onRoadCells,
      detail: "routed centre-lines against the cells they were rasterised onto",
    },
    {
      id: "ribbon-on-cells",
      // KNOWN: the rendered ribbon smooths with an uncapped corner cut, so it bows off its own road
      // cells. Fix is written and blocked on depot siting (claude-citylife/road-ribbon-corner-cut).
      // Blocking on it today would condemn essentially every seed and the harness would rank nothing.
      severity: "known",
      pass: worstRibbonOff <= thresholds.onRoadCells,
      value: worstRibbonOff,
      limit: thresholds.onRoadCells,
      detail: "rendered asphalt against the drivable grid",
    },
  ];

  return {
    seed: input.seed,
    sound: checks.every((c) => c.severity !== "blocking" || c.pass),
    checks,
    metrics: {
      roadCells: input.roads.length,
      ways: input.waySamples.length,
      components: comps.length,
      largestComponentShare: share,
      strandedCells: stranded,
      loopCells: input.loopCells,
      stops: input.stopCount,
      worstRouteOff,
      worstWayOff,
      worstRibbonOff,
      tightestTurnRadiusCells: input.routeSamples
        ? tightestTurnRadius(input.routeSamples)
        : Infinity,
    },
  };
}

/** Fixed-width number for a terminal column. Non-finite is a REAL answer here — "no drivable cell
 *  within the scan radius" — and JSON cannot carry it, so it survives a round-trip as null and has
 *  to be rendered rather than crashed on. */
function fmt(n: number | null | undefined, dp: number, width: number): string {
  return (
    n === null || n === undefined || !Number.isFinite(n) ? "inf" : n.toFixed(dp)
  ).padStart(width);
}

/** One line per seed, aligned, for a terminal sweep. */
export function qualifyRow(q: Qualification): string {
  const m = q.metrics;
  const fail = q.checks
    .filter((c) => !c.pass && c.severity === "blocking")
    .map((c) => c.id)
    .join(",");
  return [
    String(q.seed).padStart(6),
    (q.sound ? "SOUND" : "unsound").padEnd(8),
    String(m.roadCells).padStart(6),
    String(m.ways).padStart(4),
    fmt(m.largestComponentShare * 100, 1, 6),
    String(Math.round(m.loopCells)).padStart(6),
    String(m.stops).padStart(4),
    fmt(m.worstRouteOff, 2, 6),
    fmt(m.worstWayOff, 2, 6),
    fmt(m.worstRibbonOff, 2, 6),
    fmt(m.tightestTurnRadiusCells, 1, 6),
    fail ? `  ${fail}` : "",
  ].join(" ");
}

export const QUALIFY_HEADER = [
  "  seed",
  "verdict ",
  " cells",
  "ways",
  "conn%",
  "  loop",
  "stop",
  "route",
  "  ways",
  "ribbon",
  "radius",
  " blocking failures",
].join(" ");
