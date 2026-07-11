// Spec 140 — the bus FLEET state machine: operating hours, staggered dispatch, breaks, and the
// depot round-trip, stepped in SIM-MINUTES over abstract arc-length geometry. Pure and
// deterministic: no three.js, no wall clock, no randomness — the runtime feeds it dt + the sim
// clock and reads back per-bus poses; tests drive it minute by minute in node.
//
// A bus's day: parked -> bay-out (reverses out of its bay) -> depot-stop (doors open at the gate
// shelter: the depot IS a boarding stop) -> spur-out (rides the spur road onto the loop) ->
// service (laps the route, dwelling at every stop) -> spur-in -> depot-stop (alighting) ->
// bay-in -> parked (break). ONE global dispatch gate enforces the stagger: a dispatched bus holds
// it until it reaches its FIRST route stop; nobody else may leave a bay while it is held.

import { type PathData, samplePath, projectPath, type Pt } from "./path";

export interface FleetConfig {
  /** Buses the colony owns (parked in bays 0..n-1); baysTotal - busesOwned bays stay empty. */
  busesOwned: number;
  baysTotal: number;
  /** Operating hours as minute-of-day: first departures at 08:00, streets drain by 23:00. */
  firstDepartureMin: number;
  lastServiceMin: number;
  /** Cruise speed in loop cells per sim-minute. */
  busSpeedCellsPerMin: number;
  /** Doors-open dwell at a route stop / at the depot shelter (sim-minutes). */
  stopDwellMin: number;
  depotBoardMin: number;
  /** Bay break between shifts (sim-minutes) and laps per shift before the break. */
  breakMin: number;
  lapsPerShift: number;
  /** Length (cells) of the straight bay leg a bus REVERSES along when pulling out. */
  bayPullOutCells: number;
}

/** Arc-length geometry of the transit world, computed once at boot from the real paths. */
export interface FleetGeometry {
  loopLen: number;
  /** Loop arc length where the depot spur joins it. */
  joinT: number;
  spurLen: number;
  /** Per-bay drive path length (gate -> lane -> bay nose). */
  bayLen: number[];
  /** Route stop positions as distances AFTER the join point, ascending, in (0, loopLen]. */
  stopsFromJoin: number[];
}

export type BusMode =
  | "parked"
  | "bay-out"
  | "depot-stop-out"
  | "spur-out"
  | "service"
  | "spur-in"
  | "depot-stop-in"
  | "bay-in";

export interface BusState {
  id: number;
  mode: BusMode;
  /** Distance along the current path (bay path or spur), in cells. */
  t: number;
  /** Total loop distance travelled since joining at joinT (spans laps). */
  lapT: number;
  /** Completed full laps this shift. */
  laps: number;
  /** Index into stopsFromJoin of the next stop on the current lap. */
  nextStopIdx: number;
  /** Sim-minutes of doors-open dwell remaining (at a stop or the depot gate). */
  dwell: number;
  /** Absolute sim-minute the bay break ends; dispatch-ineligible before it. */
  breakUntil: number;
  /** True once this bus reached its first stop this dispatch (releases the gate). */
  reachedFirstStop: boolean;
}

export interface BusFleet {
  buses: BusState[];
  /** Bus id holding the staggered-dispatch gate, or null when the depot may release the next bus. */
  gateHeldBy: number | null;
}

export function makeFleet(cfg: FleetConfig): BusFleet {
  const buses: BusState[] = [];
  for (let i = 0; i < cfg.busesOwned; i++)
    buses.push({
      id: i,
      mode: "parked",
      t: 0,
      lapT: 0,
      laps: 0,
      nextStopIdx: 0,
      dwell: 0,
      breakUntil: 0,
      reachedFirstStop: false,
    });
  return { buses, gateHeldBy: null };
}

/** Build the arc-length geometry from the real polylines. Stops that project onto the join point
 *  itself are dropped (the depot gate stop already covers boarding there). */
export function makeFleetGeometry(
  loop: PathData,
  spur: PathData,
  bays: PathData[],
  stopCells: readonly Pt[],
): FleetGeometry {
  const joinT = projectPath(loop, spur.pts[spur.pts.length - 1] ?? { x: 0, y: 0 });
  const loopLen = loop.total;
  const stopsFromJoin = stopCells
    .map((c) => projectPath(loop, c))
    .map((s) => (((s - joinT) % loopLen) + loopLen) % loopLen)
    .filter((d) => d > 1e-6)
    .sort((a, b) => a - b);
  return {
    loopLen,
    joinT,
    spurLen: spur.total,
    bayLen: bays.map((b) => b.total),
    stopsFromJoin,
  };
}

/** Sim-minutes a full shift needs (bay exit + boarding + spur out, laps with dwells, spur home).
 *  Dispatches stop when a shift no longer fits before lastServiceMin, so the streets drain BY the
 *  closing hour instead of a bus starting a lap at 22:59. */
export function shiftMinutes(geom: FleetGeometry, cfg: FleetConfig): number {
  const v = Math.max(1e-6, cfg.busSpeedCellsPerMin);
  const maxBay = geom.bayLen.length ? Math.max(...geom.bayLen) : 0;
  const drive =
    (2 * maxBay + 2 * geom.spurLen + cfg.lapsPerShift * geom.loopLen) / v;
  const dwell =
    cfg.lapsPerShift * geom.stopsFromJoin.length * cfg.stopDwellMin +
    2 * cfg.depotBoardMin;
  return drive + dwell;
}

const inHours = (tod: number, cfg: FleetConfig): boolean =>
  tod >= cfg.firstDepartureMin && tod < cfg.lastServiceMin;

/** Advance the whole fleet by dtMin sim-minutes at absolute sim-minute nowMin (clock.totalMinutes).
 *  Mutates the fleet in place. Step it in small increments (the runtime steps per frame; tests step
 *  a minute at a time) — dispatch decisions are made once per call. */
export function stepFleet(
  fleet: BusFleet,
  dtMin: number,
  nowMin: number,
  geom: FleetGeometry,
  cfg: FleetConfig,
): void {
  if (!(dtMin > 0)) return;
  const tod = ((nowMin % 1440) + 1440) % 1440;
  const v = Math.max(1e-6, cfg.busSpeedCellsPerMin);

  // Dispatch: when the gate is free and the depot is open, release the lowest-id eligible bus.
  // The last dispatch of the day leaves early enough for its whole shift to fit before close
  // (never later than 23:00 minus a shift, but the morning departures are never starved).
  const lastDispatch = Math.max(
    cfg.firstDepartureMin + 1,
    cfg.lastServiceMin - shiftMinutes(geom, cfg),
  );
  if (
    fleet.gateHeldBy === null &&
    tod >= cfg.firstDepartureMin &&
    tod <= lastDispatch
  ) {
    const next = fleet.buses.find(
      (b) => b.mode === "parked" && nowMin >= b.breakUntil,
    );
    if (next) {
      next.mode = "bay-out";
      next.t = 0;
      next.lapT = 0;
      next.laps = 0;
      next.nextStopIdx = 0;
      next.reachedFirstStop = false;
      fleet.gateHeldBy = next.id;
    }
  }

  const releaseGate = (b: BusState) => {
    if (fleet.gateHeldBy === b.id) fleet.gateHeldBy = null;
  };

  for (const b of fleet.buses) {
    let rem = dtMin;
    let guard = 0;
    while (rem > 1e-9 && ++guard < 64) {
      switch (b.mode) {
        case "parked":
          rem = 0;
          break;
        case "bay-out": {
          const len = geom.bayLen[b.id] ?? 0;
          const need = (len - b.t) / v;
          if (rem < need) {
            b.t += rem * v;
            rem = 0;
          } else {
            rem -= need;
            b.t = 0;
            b.mode = "depot-stop-out";
            b.dwell = cfg.depotBoardMin;
          }
          break;
        }
        case "depot-stop-out": {
          if (b.dwell > rem) {
            b.dwell -= rem;
            rem = 0;
          } else {
            rem -= b.dwell;
            b.dwell = 0;
            if (inHours(tod, cfg)) {
              b.mode = "spur-out";
              b.t = 0;
            } else {
              // The clock struck closing while boarding — abort the run and back into the bay.
              releaseGate(b);
              b.mode = "bay-in";
              b.t = 0;
            }
          }
          break;
        }
        case "spur-out": {
          const need = (geom.spurLen - b.t) / v;
          if (rem < need) {
            b.t += rem * v;
            rem = 0;
          } else {
            rem -= need;
            b.mode = "service";
            b.t = 0;
            b.lapT = 0;
            b.laps = 0;
            b.nextStopIdx = 0;
            if (geom.stopsFromJoin.length === 0) releaseGate(b); // no stops -> nothing to stagger on
          }
          break;
        }
        case "service": {
          if (b.dwell > 0) {
            if (b.dwell > rem) {
              b.dwell -= rem;
              rem = 0;
            } else {
              rem -= b.dwell;
              b.dwell = 0;
            }
            break;
          }
          const stops = geom.stopsFromJoin;
          const atStop = b.nextStopIdx < stops.length;
          const nextEvent = atStop
            ? b.laps * geom.loopLen + stops[b.nextStopIdx]!
            : (b.laps + 1) * geom.loopLen;
          const need = (nextEvent - b.lapT) / v;
          if (rem < need) {
            b.lapT += rem * v;
            rem = 0;
          } else {
            rem -= Math.max(0, need);
            b.lapT = nextEvent;
            if (atStop) {
              b.dwell = cfg.stopDwellMin;
              if (!b.reachedFirstStop) {
                b.reachedFirstStop = true; // the stagger rule: the NEXT bus may leave now
                releaseGate(b);
              }
              b.nextStopIdx++;
            } else {
              b.laps++;
              b.nextStopIdx = 0;
              if (b.laps >= cfg.lapsPerShift || !inHours(tod, cfg)) {
                b.mode = "spur-in";
                b.t = 0;
              }
            }
          }
          break;
        }
        case "spur-in": {
          const need = (geom.spurLen - b.t) / v;
          if (rem < need) {
            b.t += rem * v;
            rem = 0;
          } else {
            rem -= need;
            b.mode = "depot-stop-in";
            b.dwell = cfg.depotBoardMin;
          }
          break;
        }
        case "depot-stop-in": {
          if (b.dwell > rem) {
            b.dwell -= rem;
            rem = 0;
          } else {
            rem -= b.dwell;
            b.dwell = 0;
            b.mode = "bay-in";
            b.t = 0;
          }
          break;
        }
        case "bay-in": {
          const len = geom.bayLen[b.id] ?? 0;
          const need = (len - b.t) / v;
          if (rem < need) {
            b.t += rem * v;
            rem = 0;
          } else {
            rem -= need;
            b.mode = "parked";
            b.t = 0;
            b.breakUntil = nowMin + cfg.breakMin;
            releaseGate(b); // safety net: a parked bus can never hold the gate
          }
          break;
        }
      }
    }
  }
}

// ── Poses ────────────────────────────────────────────────────────────────────────────────

/** The real polylines the arc lengths refer to. `spur` runs GATE -> loop junction. */
export interface FleetPaths {
  loop: PathData;
  spur: PathData;
  bays: PathData[];
  /** Grid heading a bus faces standing at the gate pointing OUT of the pad (toward the road). */
  gateHeading: number;
}

export interface BusPose {
  x: number;
  y: number;
  /** Grid-space travel heading of the NOSE (radians, atan2(dy, dx)). */
  heading: number;
  /** Doors open — dwelling at a route stop or the depot gate; the boarding window. */
  doorsOpen: boolean;
  moving: boolean;
  /** Backing out of the bay: position runs gate-ward while the nose still points at the bay. */
  reversing: boolean;
}

/** Where bus b physically is right now, in grid coords. Pure in (state, paths, geometry). */
export function busPose(
  b: BusState,
  paths: FleetPaths,
  geom: FleetGeometry,
  cfg: FleetConfig,
): BusPose {
  const bay = paths.bays[b.id] ?? paths.bays[0]!;
  switch (b.mode) {
    case "parked": {
      const p = samplePath(bay, bay.total);
      return { x: p.x, y: p.y, heading: p.heading, doorsOpen: false, moving: false, reversing: false };
    }
    case "bay-out": {
      const s = bay.total - b.t;
      const p = samplePath(bay, s);
      const reversing = s > bay.total - cfg.bayPullOutCells + 1e-6;
      return {
        x: p.x,
        y: p.y,
        heading: reversing ? p.heading : p.heading + Math.PI,
        doorsOpen: false,
        moving: true,
        reversing,
      };
    }
    case "depot-stop-out":
    case "depot-stop-in": {
      const p = samplePath(bay, 0); // the gate cell — the depot's boarding stop
      const out = b.mode === "depot-stop-out";
      return {
        x: p.x,
        y: p.y,
        heading: out ? paths.gateHeading : paths.gateHeading + Math.PI,
        doorsOpen: true,
        moving: false,
        reversing: false,
      };
    }
    case "spur-out": {
      const p = samplePath(paths.spur, b.t);
      return { x: p.x, y: p.y, heading: p.heading, doorsOpen: false, moving: true, reversing: false };
    }
    case "service": {
      const p = samplePath(paths.loop, geom.joinT + (b.lapT % geom.loopLen));
      return {
        x: p.x,
        y: p.y,
        heading: p.heading,
        doorsOpen: b.dwell > 0,
        moving: b.dwell <= 0,
        reversing: false,
      };
    }
    case "spur-in": {
      const p = samplePath(paths.spur, paths.spur.total - b.t);
      return { x: p.x, y: p.y, heading: p.heading + Math.PI, doorsOpen: false, moving: true, reversing: false };
    }
    case "bay-in": {
      const p = samplePath(bay, b.t);
      return { x: p.x, y: p.y, heading: p.heading, doorsOpen: false, moving: true, reversing: false };
    }
  }
}
