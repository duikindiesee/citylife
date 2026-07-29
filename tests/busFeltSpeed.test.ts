import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { COLONY } from "../src/colony/config";
import { PLAYER_WALK_SPEED_MPS } from "../src/colony/scale";
import { playerTopSpeedMps } from "../src/colony/playerSpeed";
import { REAL_SECONDS_PER_SOL_MINUTE } from "../src/colony/sol";
import {
  busCruiseSpeedMps,
  busLegSpeedMps,
  shiftMinutes,
  type FleetGeometry,
} from "../src/colony/transit/busFleet";

// Spec 165 — "the bus is slower than I can walk", re-decided against a CORRECTED player.
//
// The fleet is tuned in cells per IN-SOL minute (15 real seconds each, 4 m each); the player is
// tuned in metres per REAL second. Nothing converted between them, so the two numbers were never
// comparable. The original reading of that report (spec 164, BUS.SPEED.1) blamed the bus alone and would have raised it to
// 84 cells/min (22.4 m/s = 80 km/h). But the player was the bigger defect: the capsule ran at
// 10 m/s (36 km/h) and the roster twin at 13.6 m/s, both wrong. With the player corrected to a
// human 3.4 m/s the bus needs a far smaller, and physically honest, raise.
//
// The bound that matters is the player's TOP speed — full ramp, on a road, sprinting — not their
// walk. A rider who could have sprinted there faster has no reason to board.

const PRE_FIX_CELLS_PER_MIN = 28; // what shipped

const WALK_MPS = PLAYER_WALK_SPEED_MPS;

/** The REAL route the live world builds — not a hand-written fixture that can drift from it. */
function liveGeometry(): FleetGeometry {
  const rt = new ColonyRuntime();
  const geom = (rt as unknown as { fleetGeom: FleetGeometry | null }).fleetGeom;
  expect(geom).not.toBeNull();
  return geom!;
}

/** Stop-to-stop leg lengths (cells) around one lap — the distances a rider actually travels. */
function legCells(geom: FleetGeometry): number[] {
  const stops = geom.stopsFromJoin;
  expect(stops.length).toBeGreaterThan(1);
  const legs: number[] = [];
  for (let i = 0; i < stops.length; i++) {
    const a = stops[i]!;
    const b = i + 1 < stops.length ? stops[i + 1]! : geom.loopLen;
    legs.push(b - a);
  }
  return legs;
}

describe("spec 165 — the bus is meaningfully faster than the player at their best", () => {
  it("cruises comfortably faster than the player's absolute top speed", () => {
    const top = playerTopSpeedMps();
    const cruise = busCruiseSpeedMps(COLONY.transit);
    expect(cruise).toBeGreaterThan(top * 1.75);
    expect(cruise).toBeGreaterThan(WALK_MPS * 3);

    // DISCRIMINATION: the shipped value fails this. It was only 1.21x the player's top speed —
    // and against the OLD 10 m/s capsule it lost outright, which is the original report.
    const preFix = busCruiseSpeedMps({
      busSpeedCellsPerMin: PRE_FIX_CELLS_PER_MIN,
    });
    expect(preFix).toBeLessThan(top * 1.75);
    expect(preFix).toBeLessThan(10); // the pre-fix capsule speed — the bus lost to a WALK
  });

  it("beats a road-sprinting player door-to-door on EVERY real leg, dwell included", () => {
    // The honest comparison: the rider pays the doors-open dwell, the runner does not. Measured
    // against the player's TOP speed, so boarding is never the slower choice even at a sprint.
    const top = playerTopSpeedMps();
    const legs = legCells(liveGeometry());
    for (const cells of legs) {
      const ride = busLegSpeedMps(COLONY.transit, cells);
      expect(ride).toBeGreaterThan(top * 1.35);
      expect(ride).toBeGreaterThan(WALK_MPS * 2);

      // DISCRIMINATION: at the shipped cruise the worst leg only TIED a sprinting player (1.01x),
      // so riding bought nothing on it.
      const preFix = busLegSpeedMps(
        {
          busSpeedCellsPerMin: PRE_FIX_CELLS_PER_MIN,
          stopDwellMin: COLONY.transit.stopDwellMin,
        },
        cells,
      );
      expect(preFix).toBeLessThan(top * 1.35);
    }
  });

  it("stays a city bus and not a missile", () => {
    // The raise is bounded ABOVE too: spec 164 (BUS.SPEED.1) would have gone to 84
    // cells/min (80 km/h) because it was sized against a 10 m/s player. Against a human player the
    // honest answer is a realistic urban cruise.
    const cruise = busCruiseSpeedMps(COLONY.transit);
    expect(cruise * 3.6).toBeLessThan(50); // km/h
    expect(cruise).toBeLessThan(playerTopSpeedMps() * 2.5);
  });

  it("still fits a whole shift before lastServiceMin on the real geometry", () => {
    // The invariant the speed change must not break: dispatch stops once a shift no longer fits
    // before close, so an overrunning shift strands the fleet in its bays.
    const geom = liveGeometry();
    const shift = shiftMinutes(geom, COLONY.transit);
    expect(shift).toBeGreaterThan(0);
    expect(COLONY.transit.firstDepartureMin + shift).toBeLessThan(
      COLONY.transit.lastServiceMin,
    );
    // ...and the dispatch window still staggers every owned bus with its bay break.
    const dispatchWindow =
      COLONY.transit.lastServiceMin - shift - COLONY.transit.firstDepartureMin;
    expect(dispatchWindow).toBeGreaterThan(
      COLONY.transit.busesOwned * COLONY.transit.breakMin,
    );

    // INVARIANT GUARD, NOT PROOF: raising cruise speed only SHORTENS a shift, so this also passes
    // at the pre-fix value. It is here to catch a future LOWERING, and it is stated plainly that it
    // does not discriminate the fix.
    const preFixShift = shiftMinutes(geom, {
      ...COLONY.transit,
      busSpeedCellsPerMin: PRE_FIX_CELLS_PER_MIN,
    });
    expect(shift).toBeLessThan(preFixShift);
  });

  it("keeps a 60 Hz frame's travel sub-cell — the upper bound on any future raise", () => {
    // busSolContinuousMotion.test.ts locks "< 0.1 cells per 16 ms frame" as the no-coarse-jump
    // contract. That is the ceiling on cruise speed; asserting it here states the bound explicitly
    // instead of leaving a later tuner to trip over it in an unrelated file.
    const perFrameCells =
      (COLONY.transit.busSpeedCellsPerMin * (16 / 1000)) /
      REAL_SECONDS_PER_SOL_MINUTE;
    expect(perFrameCells).toBeLessThan(0.1);

    // INVARIANT GUARD, NOT PROOF: the slower pre-fix value also satisfied this bound. Stated so
    // nobody reads it as evidence the fix works.
    const preFixPerFrame =
      (PRE_FIX_CELLS_PER_MIN * (16 / 1000)) / REAL_SECONDS_PER_SOL_MINUTE;
    expect(preFixPerFrame).toBeLessThan(0.1);
  });

  it("still parks the whole fleet overnight and runs it at midday at the new speed", () => {
    // A faster bus finishes its shift sooner; it must not therefore be caught out on the route
    // after close, nor stop appearing during service hours.
    type TransitDriver = { transitTick: () => void };
    const modesAt = (hour: number): string[] => {
      const rt = new ColonyRuntime();
      rt.debugSetSolTimeOfDay(hour, 0);
      (rt as unknown as TransitDriver).transitTick();
      return rt.busFleet!.buses.map((b) => b.mode);
    };
    expect(modesAt(1).every((m) => m === "parked")).toBe(true);
    expect(modesAt(12).some((m) => m !== "parked")).toBe(true);
  });
});
