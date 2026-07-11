// Spec 149 — the bus FLEET state machine: operating hours, staggered dispatch, breaks, and the
// depot round-trip, stepped in SIM-MINUTES over abstract arc-length geometry. Pure and
// deterministic: no three.js, no wall clock, no Math.random — the runtime feeds it dt + the sim
// clock (+ the world seed for the tie-broken bay lottery) and reads back per-bus poses; tests drive
// it minute by minute in node.
//
// A bus's day: parked -> bay-out (reverses out of its bay) -> depot-stop-out (doors open at the gate
// shelter: the depot IS a boarding stop) -> spur-out (rides the spur road onto the loop) ->
// service (laps the route, dwelling at every stop) -> spur-in -> depot-stop-in (alighting) ->
// bay-in -> parked (break).
//
// TWO gates keep it collision-free and evenly spaced (spec 149 / operator hardening):
//   1. The DEPOT CORRIDOR is single-occupancy. The spur + gate + apron is one shared lane, so at most
//      ONE bus may be inside the depot approach at a time — a departing bus and a returning bus can
//      never meet head-on on the spur. A bus grabs the corridor to leave (bay-out) or to come home
//      (spur-in) and releases it once it is on the loop (service) or parked. A bus that wants home
//      while the corridor is busy simply keeps lapping and retries at the next join crossing.
//   2. The DISPATCH gate spaces departures on the ROUTE: a dispatched bus holds it until it reaches
//      its SECOND route stop, and the depot keeps releasing the next parked bus while any remain in
//      hours — so the fleet trickles out, evenly spaced, until the depot is empty.
//
// Bays are NOT owned by bus id: a returning bus parks in a random FREE bay (a seeded lottery, so it
// is deterministic yet varied), and dispatch pulls whichever parked bus is ready. `BusState.bay` is
// the bay a bus currently holds (parked / pulling out of / backing into), or -1 while out on the loop.

import { type PathData, samplePath, projectPath, type Pt } from "./path";

export interface FleetConfig {
  /** Buses the colony owns; they start parked in bays 0..n-1. baysTotal - busesOwned bays start free. */
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
  /** Per-bay drive path length (gate -> lane -> bay nose), indexed by BAY (not bus id). */
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

/** True while the bus is physically inside the single-lane depot approach (spur + gate + apron). */
export function inCorridor(mode: BusMode): boolean {
  return (
    mode === "bay-out" ||
    mode === "depot-stop-out" ||
    mode === "spur-out" ||
    mode === "spur-in" ||
    mode === "depot-stop-in" ||
    mode === "bay-in"
  );
}

export interface BusState {
  id: number;
  mode: BusMode;
  /** Bay this bus currently holds (parked / pulling out of / backing into), or -1 while on the loop. */
  bay: number;
  /** Distance along the current path (bay path or spur), in cells. */
  t: number;
  /** Total loop distance travelled since joining at joinT (spans laps). */
  lapT: number;
  /** Completed full laps this shift. */
  laps: number;
  /** Index into stopsFromJoin of the next stop on the current lap. */
  nextStopIdx: number;
  /** Count of route stops reached this dispatch — the dispatch gate releases at 2. */
  stopsReached: number;
  /** Sim-minutes of doors-open dwell remaining (at a stop or the depot gate). */
  dwell: number;
  /** Absolute sim-minute the bay break ends; dispatch-ineligible before it. */
  breakUntil: number;
}

export interface BusFleet {
  buses: BusState[];
  /** Bus id holding the route-spacing dispatch gate, or null when the depot may release the next. */
  gateHeldBy: number | null;
  /** Bus id physically occupying the depot approach corridor, or null when it is clear. */
  corridorBusyBy: number | null;
  /** Deterministic LCG state for the free-bay lottery (seeded from the world seed at boot). */
  rng: number;
}

export function makeFleet(cfg: FleetConfig, seed = 1): BusFleet {
  const buses: BusState[] = [];
  for (let i = 0; i < cfg.busesOwned; i++)
    buses.push({
      id: i,
      mode: "parked",
      bay: i, // deterministic starting bays; a returning bus later parks in a random free one
      t: 0,
      lapT: 0,
      laps: 0,
      nextStopIdx: 0,
      stopsReached: 0,
      dwell: 0,
      breakUntil: 0,
    });
  return {
    buses,
    gateHeldBy: null,
    corridorBusyBy: null,
    rng: (seed >>> 0) || 1,
  };
}

/** The bays no bus currently holds — candidates for a returning bus to park in. */
function freeBays(fleet: BusFleet, cfg: FleetConfig): number[] {
  const held = new Set<number>();
  for (const b of fleet.buses) if (b.bay >= 0) held.add(b.bay);
  const out: number[] = [];
  for (let k = 0; k < cfg.baysTotal; k++) if (!held.has(k)) out.push(k);
  return out;
}

/** Pick a free bay via the seeded LCG (deterministic yet varied). Falls back to the lowest free bay
 *  if the lottery ever came up empty (can't happen while busesOwned <= baysTotal). */
function pickFreeBay(fleet: BusFleet, cfg: FleetConfig): number {
  const free = freeBays(fleet, cfg);
  if (free.length === 0) return 0;
  fleet.rng = (Math.imul(fleet.rng, 1664525) + 1013904223) >>> 0;
  return free[fleet.rng % free.length]!;
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

/** The 2nd stop reached this dispatch releases the gate (route spacing). Fleets with a single stop
 *  release on that one stop; with none, release immediately on reaching service. */
const GATE_RELEASE_STOP = 2;

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

  // DISPATCH — release the next parked, rested bus when BOTH gates are free (route-spacing gate free
  // AND the depot corridor clear) and the depot is open. Continuous: the gate reopens at the holder's
  // 2nd stop, so buses keep trickling out until the depot is empty. The last dispatch of the day
  // leaves early enough for its whole shift to finish before close.
  const lastDispatch = Math.max(
    cfg.firstDepartureMin + 1,
    cfg.lastServiceMin - shiftMinutes(geom, cfg),
  );
  if (
    fleet.gateHeldBy === null &&
    fleet.corridorBusyBy === null &&
    tod >= cfg.firstDepartureMin &&
    tod <= lastDispatch
  ) {
    // Fair rotation: dispatch the LONGEST-rested eligible bus (smallest breakUntil), tie-broken by id.
    // A freshly-returned bus has a high breakUntil, so it waits behind buses that have been parked
    // longer — every bus gets a turn instead of the lowest id monopolising the gate.
    const next = fleet.buses
      .filter((b) => b.mode === "parked" && nowMin >= b.breakUntil)
      .sort((a, b) => a.breakUntil - b.breakUntil || a.id - b.id)[0];
    if (next) {
      next.mode = "bay-out";
      next.t = 0;
      next.lapT = 0;
      next.laps = 0;
      next.nextStopIdx = 0;
      next.stopsReached = 0;
      fleet.gateHeldBy = next.id;
      fleet.corridorBusyBy = next.id; // it now owns the depot approach
    }
  }

  const releaseGate = (b: BusState) => {
    if (fleet.gateHeldBy === b.id) fleet.gateHeldBy = null;
  };
  const releaseCorridor = (b: BusState) => {
    if (fleet.corridorBusyBy === b.id) fleet.corridorBusyBy = null;
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
          const len = geom.bayLen[b.bay] ?? 0;
          const need = (len - b.t) / v;
          if (rem < need) {
            b.t += rem * v;
            rem = 0;
          } else {
            rem -= need;
            b.t = 0;
            b.bay = -1; // out of the bay — it is now free for a returning bus
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
              // The clock struck closing while boarding — abort the run and back into a free bay.
              releaseGate(b);
              b.bay = pickFreeBay(fleet, cfg);
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
            releaseCorridor(b); // on the loop now — the depot approach is clear for the next bus
            if (geom.stopsFromJoin.length === 0) releaseGate(b); // no stops -> nothing to space on
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
              b.stopsReached++;
              // Route spacing: the NEXT bus may leave once this one clears its 2nd stop (or its only
              // stop on a single-stop loop).
              if (
                b.stopsReached >= Math.min(GATE_RELEASE_STOP, stops.length)
              )
                releaseGate(b);
              b.nextStopIdx++;
            } else {
              b.laps++;
              b.nextStopIdx = 0;
              // End of shift (or past hours): head home, but ONLY if the depot approach is clear;
              // otherwise keep lapping and try again next time round (no head-on on the single spur).
              const wantHome = b.laps >= cfg.lapsPerShift || !inHours(tod, cfg);
              if (wantHome && fleet.corridorBusyBy === null) {
                fleet.corridorBusyBy = b.id;
                releaseGate(b); // a bus going home can't keep spacing departures
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
            b.bay = pickFreeBay(fleet, cfg); // park in a random FREE bay, not a fixed one
            b.mode = "bay-in";
            b.t = 0;
          }
          break;
        }
        case "bay-in": {
          const len = geom.bayLen[b.bay] ?? 0;
          const need = (len - b.t) / v;
          if (rem < need) {
            b.t += rem * v;
            rem = 0;
          } else {
            rem -= need;
            b.mode = "parked";
            b.t = 0;
            b.breakUntil = nowMin + cfg.breakMin;
            releaseGate(b); // safety net: a parked bus can never hold a gate
            releaseCorridor(b); // parked — the depot approach is clear again
          }
          break;
        }
      }
    }
  }
}

// ── Poses ────────────────────────────────────────────────────────────────────────────────

/** The real polylines the arc lengths refer to. `spur` runs GATE -> loop junction. `bays` is indexed
 *  by BAY (not bus id) — a bus samples paths.bays[b.bay]. */
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
  // The gate cell is bays[k].pts[0] for every k, so it works even while b.bay === -1 (out on the loop).
  const gatePath = paths.bays[0]!;
  const bay = paths.bays[b.bay] ?? gatePath;
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
      const p = samplePath(gatePath, 0); // the gate cell — the depot's boarding stop
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
