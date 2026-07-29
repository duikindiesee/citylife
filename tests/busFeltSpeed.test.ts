import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { COLONY } from "../src/colony/config";
import { PLAYER_WALK_SPEED_MPS } from "../src/colony/scale";
import { REAL_SECONDS_PER_SOL_MINUTE } from "../src/colony/sol";
import {
  busCruiseSpeedMps,
  busLegSpeedMps,
  shiftMinutes,
  type FleetGeometry,
} from "../src/colony/transit/busFleet";

// Spec 164 (BUS.SPEED.1) — "the bus is slower than I can walk".
//
// MEASURED CAUSE: the fleet is tuned in cells per IN-SOL minute and an in-sol minute is 15 REAL
// seconds, so 28 cells/min is 28*4/15 = 7.47 m/s. The walker capsule runs at 10 m/s
// (PLAYER_WALK_SPEED_MPS, set straight onto the Rapier body as a linear velocity) and 14.5 m/s
// sprinting. The bus lost to a WALKING player before a single dwell was paid — the schedule was
// right and the felt speed was wrong, because nothing converted between the two units.
//
// Each lock below carries its OWN discrimination: the same predicate is re-evaluated against the
// pre-fix value (28) and shown to fail, so none of these can pass for a trivial reason.

const PRE_FIX_CELLS_PER_MIN = 28;

const WALK_MPS = PLAYER_WALK_SPEED_MPS;
const SPRINT_MPS =
  PLAYER_WALK_SPEED_MPS * COLONY.firstPerson.sprintWalkSpeedMultiplier;

/** The REAL route the live world builds — not a hand-written fixture that can drift from it. */
function liveGeometry(): FleetGeometry {
  const rt = new ColonyRuntime();
  const geom = (rt as unknown as { fleetGeom: FleetGeometry | null }).fleetGeom;
  expect(geom).not.toBeNull();
  return geom!;
}

/** Stop-to-stop leg lengths (cells) around one lap, the distances a rider actually travels. */
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

describe("spec 164 — the bus is meaningfully faster than the player on foot", () => {
  it("cruises faster than the player can walk AND faster than the player can sprint", () => {
    const cruise = busCruiseSpeedMps(COLONY.transit);
    expect(cruise).toBeGreaterThan(WALK_MPS * 1.5);
    expect(cruise).toBeGreaterThan(SPRINT_MPS);

    // DISCRIMINATION: the shipped value fails this predicate — it did not even beat a walk.
    const preFix = busCruiseSpeedMps({
      busSpeedCellsPerMin: PRE_FIX_CELLS_PER_MIN,
    });
    expect(preFix).toBeLessThan(WALK_MPS);
    expect(preFix).toBeLessThan(SPRINT_MPS);
  });

  it("beats walking door-to-door on EVERY real route leg, dwell included", () => {
    // Two-sided and the honest comparison: a rider pays the doors-open dwell as well as the drive,
    // so the leg speed — not the cruise speed — is what decides whether riding was worth it.
    const legs = legCells(liveGeometry());
    for (const cells of legs) {
      const ride = busLegSpeedMps(COLONY.transit, cells);
      expect(ride).toBeGreaterThan(WALK_MPS * 1.25);

      // DISCRIMINATION: at the pre-fix cruise, walking beat the bus on this same leg.
      const preFix = busLegSpeedMps(
        {
          busSpeedCellsPerMin: PRE_FIX_CELLS_PER_MIN,
          stopDwellMin: COLONY.transit.stopDwellMin,
        },
        cells,
      );
      expect(preFix).toBeLessThan(WALK_MPS);
    }
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

    // INVARIANT GUARD, NOT PROOF: raising cruise speed only SHORTENS a shift, so this assertion
    // also passes at the pre-fix value. It is here to catch a future LOWERING of the speed, and it
    // is stated plainly that it does not discriminate the fix.
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

    // INVARIANT GUARD, NOT PROOF: the pre-fix value also satisfied this bound (it was slower).
    // Stated so nobody reads it as evidence the fix works.
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
