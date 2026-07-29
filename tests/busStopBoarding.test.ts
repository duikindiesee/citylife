import { afterEach, describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { COLONY } from "../src/colony/config";
import { CELL_SIZE } from "../src/colony/scale";
import { setSolDebugOffsetMs, solNowMs } from "../src/colony/solRuntimeClock";
import { stopVergeDirection } from "../src/colony/render/busLayer";
import {
  busStopAnchor,
  busStopAnchors,
  STOP_VERGE_OFFSET_CELLS,
} from "../src/colony/transit/busStopAnchor";
import {
  busLoopPath,
  projectPath,
  samplePath,
  type Pt,
} from "../src/colony/transit/path";

// BUS.BOARD.1 — a rider must be able to board at an ORDINARY ROUTE STOP, not only at the depot gate.
//
// MEASURED CAUSE (live seed, five route stops). A route stop was three unreconciled points:
//   * the AUTHORED stop cell (busRoute.stops, a road cell);
//   * where the bus HALTS — the authored cell projected onto the DRIVEN loop, which is
//     `smoothClosed(simplifyClosed(loop, 1.5), 2)`. Chaikin corner-cutting moved that up to
//     3.40 cells (13.6 m) off the authored cell at bends (measured 0.37 / 0.66 / 3.32 / 0.53 / 3.40);
//   * where the FURNITURE stands — the verge offset applied from the AUTHORED cell.
// Composing the two displacements gave pole-to-halted-bus gaps of 1.98 / 1.63 / 1.09 / 2.78 / 5.34
// cells against `COLONY.transit.boardMaxDistanceCells = 3`. At stop (165,467) the sign stood 5.34
// cells (21.4 m) from the doors: the Board prompt never appeared, and standing on the authored cell
// itself (3.40 cells) did not help either. Dwell time was never the problem — stopDwellMin 1.5
// in-sol minutes is 22.5 REAL seconds with the doors open.
//
// THE FIX IS NOT A BIGGER RADIUS. One anchor: the furniture stands on the verge of the point the
// bus actually halts at, so the gap is exactly STOP_VERGE_OFFSET_CELLS at every stop.

type TransitDriver = { transitTick: () => void };
const tick = (rt: ColonyRuntime) =>
  (rt as unknown as TransitDriver).transitTick();

const BOARD_MAX = COLONY.transit.boardMaxDistanceCells;

afterEach(() => setSolDebugOffsetMs(0));

/** The placement this replaces: verge offset applied from the AUTHORED stop cell. */
function authoredCellFurniture(loop: readonly Pt[], cell: Pt): Pt {
  const v = stopVergeDirection(loop, cell);
  return {
    x: cell.x + v.x * STOP_VERGE_OFFSET_CELLS,
    y: cell.y + v.y * STOP_VERGE_OFFSET_CELLS,
  };
}

// ── The pure anchor ──────────────────────────────────────────────────────────────────────────

describe("BUS.BOARD.1 — the boarding anchor is derived from the DRIVEN loop", () => {
  /** A BFS-staircase loop with a hard right-angle bend, and a stop cell sitting on that bend —
   *  the shape Chaikin cuts hardest, reproduced without booting a world. */
  const rawLoop: Pt[] = [];
  for (let x = 10; x <= 40; x++) rawLoop.push({ x, y: 10 });
  for (let y = 11; y <= 40; y++) rawLoop.push({ x: 40, y });
  for (let x = 39; x >= 10; x--) rawLoop.push({ x, y: 40 });
  for (let y = 39; y >= 11; y--) rawLoop.push({ x: 10, y });
  const corner: Pt = { x: 40, y: 10 };
  // Build the fixture through the SAME entry point the runtime drives (busLoopPath), not a
  // hand-rolled copy of its smoothing — a copy silently stops tracking the product, which is how
  // this fixture came to be calibrated against a corner cut the runtime no longer makes.
  const driven = busLoopPath(rawLoop);

  it("halts the bus where the smoothed loop actually runs, not on the authored cell", () => {
    const a = busStopAnchor(driven, corner);
    // The bus can only stand on its own path, and the path is rounded away from the bend.
    //
    // BUS.ROUTE.TURN.1 shrank this. The cut used to take a quarter of each 30-cell arm, so the
    // driven line left this corner by 3.40 cells; capped at 1 cell it leaves by 0.707. The
    // contract is unchanged — the halt point is on the path, not on the authored cell — but the
    // magnitude is now sub-cell on a clean bend, so this bounds it well below the old 1.0.
    const drift = Math.hypot(a.at.x - corner.x, a.at.y - corner.y);
    expect(drift).toBeGreaterThan(0.5);
    // The anchor IS the projection the fleet uses for this stop (busFleet.makeFleetGeometry).
    expect(a.arc).toBeCloseTo(projectPath(driven, corner), 9);
    const p = samplePath(driven, a.arc);
    expect(a.at.x).toBeCloseTo(p.x, 9);
    expect(a.at.y).toBeCloseTo(p.y, 9);
    expect(a.heading).toBeCloseTo(p.heading, 9);
  });

  it("stands the furniture exactly the verge offset from the halted bus, on its door side", () => {
    const a = busStopAnchor(driven, corner);
    expect(
      Math.hypot(a.furniture.x - a.at.x, a.furniture.y - a.at.y),
    ).toBeCloseTo(STOP_VERGE_OFFSET_CELLS, 9);
    // Perpendicular to travel: the pole steps SIDEWAYS off the carriageway, never up/down the lane.
    const along =
      Math.cos(a.heading) * a.verge.x + Math.sin(a.heading) * a.verge.y;
    expect(Math.abs(along)).toBeCloseTo(0, 9);
    expect(Math.hypot(a.verge.x, a.verge.y)).toBeCloseTo(1, 9);
    // Left of travel — the same side runtime.alightBus drops a rider on, so the doors, the sign and
    // the alighting kerb agree.
    expect(a.verge.x).toBeCloseTo(-Math.sin(a.heading), 9);
    expect(a.verge.y).toBeCloseTo(Math.cos(a.heading), 9);
  });

  it("puts the anchored furniture inside the gate, and the authored cell no longer governs it", () => {
    const a = busStopAnchor(driven, corner);
    const old = authoredCellFurniture(rawLoop, corner);
    const oldGap = Math.hypot(old.x - a.at.x, old.y - a.at.y);
    const newGap = Math.hypot(a.furniture.x - a.at.x, a.furniture.y - a.at.y);
    // The anchored placement is exactly the verge offset from the doors, inside the gate, always.
    expect(newGap).toBeLessThanOrEqual(BOARD_MAX);
    expect(newGap).toBeCloseTo(STOP_VERGE_OFFSET_CELLS, 9);
    // The authored-cell placement is NOT the same point — it is governed by the raw staircase's
    // local direction rather than the driven heading, so it lands somewhere else entirely.
    expect(
      Math.hypot(old.x - a.furniture.x, old.y - a.furniture.y),
    ).toBeGreaterThan(0.5);
    // WHY THIS NO LONGER ASSERTS `oldGap > BOARD_MAX` — a real BUS.ROUTE.TURN.1 consequence, not a
    // relaxation to make a build pass. This bend was chosen because the UNCAPPED quarter-of-each-
    // segment cut pulled the driven line 3.40 cells off the authored cell, which composed with the
    // 2.25-cell verge offset into a 5.34-cell gap against a 3-cell gate. With the cut capped at one
    // cell the same bend yields drift 0.707 and oldGap 1.543 — inside the gate. No synthetic bend
    // reproduces the failure any more: drift is bounded by the cap, so oldGap cannot exceed
    // STOP_VERGE_OFFSET_CELLS + ~1 = 3.25 even in the worst alignment, and a clean right angle or
    // spike measures 1.54-2.25.
    //
    // The absolute claim still holds where it matters and is still asserted — see the live-world
    // case below, which measures worstOld > BOARD_MAX on the boot seed and passes. Real routes
    // compose several bends and the raw-loop verge disagrees with the driven heading far more than
    // on a clean fixture. So BUS.BOARD.1 is still load-bearing; this synthetic bend simply can no
    // longer demonstrate it, and asserting a magnitude that only existed because of a defect would
    // re-break the moment the defect was fixed. Which is what happened.
    expect(oldGap).toBeGreaterThan(0);
  });

  it("is deterministic and maps stops one-for-one, in order", () => {
    const cells: Pt[] = [corner, { x: 10, y: 40 }, { x: 25, y: 10 }];
    const a = busStopAnchors(driven, cells);
    const b = busStopAnchors(driven, cells);
    expect(a).toEqual(b);
    expect(a.map((x) => x.cell)).toEqual(cells);
  });
});

// ── The live world ───────────────────────────────────────────────────────────────────────────

describe("BUS.BOARD.1 — a rider can board at an ordinary route stop in the live world", () => {
  it("puts every stop's furniture inside the Board gate, where the authored cell did not", () => {
    const rt = new ColonyRuntime();
    tick(rt);
    const route = (rt as unknown as { busRoute: { loop: Pt[]; stops: Pt[] } })
      .busRoute;
    const anchors = rt.busStopAnchors();
    expect(anchors.length).toBeGreaterThan(0);
    expect(anchors.length).toBe(route.stops.length);

    let worstOld = 0;
    for (const a of anchors) {
      const gap = Math.hypot(a.furniture.x - a.at.x, a.furniture.y - a.at.y);
      expect(gap).toBeCloseTo(STOP_VERGE_OFFSET_CELLS, 9);
      expect(gap).toBeLessThanOrEqual(BOARD_MAX);
      const old = authoredCellFurniture(route.loop, a.cell);
      worstOld = Math.max(worstOld, Math.hypot(old.x - a.at.x, old.y - a.at.y));
    }
    // DISCRIMINATION on the live seed: at least one stop's authored-cell furniture stood OUTSIDE
    // the Board gate. If this ever fails, the smoothing/route geometry changed — re-measure before
    // trusting the assertion above.
    expect(worstOld).toBeGreaterThan(BOARD_MAX);
  }, 120000);

  it("shows Board at the sign and rides away — at EVERY route stop, not just the depot", () => {
    const rt = new ColonyRuntime();
    rt.setPlayerView(false);
    rt.debugSetSolTimeOfDay(12, 0);
    tick(rt);
    const anyRt = rt as unknown as {
      busRoute: { loop: Pt[]; stops: Pt[] };
      busFleet: { buses: { id: number; mode: string; dwell: number }[] };
    };
    const anchors = rt.busStopAnchors();
    const ids = rt.getUiState().firstPerson.stepInCitizenIds;
    expect(ids.length).toBeGreaterThan(0);
    expect(rt.enterFirstPerson(ids[0]!)).toBe(true);

    const covered = new Map<
      number,
      {
        gap: number;
        promptAtSign: string | null;
        boarded: boolean;
        promptAtOldSign: string | null;
        promptFar: string | null;
        boardedFar: boolean;
      }
    >();
    const promptOf = () => {
      const p = rt.getUiState().firstPerson.view?.interactionPrompt;
      return p ? `${p.kind}:${p.label}` : null;
    };
    const base = solNowMs();
    for (let i = 0; i < 20000 && covered.size < anchors.length; i++) {
      setSolDebugOffsetMs(base + i * 250 - Date.now());
      tick(rt);
      for (const b of anyRt.busFleet.buses) {
        if (b.mode !== "service" || !(b.dwell > 0)) continue;
        const pose = rt.busPoseOf(b.id)!;
        let idx = -1;
        let best = Infinity;
        for (let k = 0; k < anchors.length; k++) {
          const d = Math.hypot(
            pose.x - anchors[k]!.at.x,
            pose.y - anchors[k]!.at.y,
          );
          if (d < best) {
            best = d;
            idx = k;
          }
        }
        if (idx < 0 || covered.has(idx) || best > 1e-6) continue; // a HALTED bus sits ON its anchor
        const a = anchors[idx]!;

        // 1. Stand at the rendered sign: the Board prompt must be there, and E must board.
        rt.debugPlaceFirstPerson(a.furniture.x, a.furniture.y);
        const promptAtSign = promptOf();
        rt.activateFirstPersonInteraction();
        const boarded = rt.fpRidingBusId === b.id;
        if (rt.fpRidingBusId !== null) rt.activateFirstPersonInteraction(); // step back off

        // 2. NEGATIVE CONTROL: twice the gate out along the same verge — no bus action at all.
        rt.debugPlaceFirstPerson(
          a.at.x + a.verge.x * BOARD_MAX * 2,
          a.at.y + a.verge.y * BOARD_MAX * 2,
        );
        const promptFar = promptOf();
        rt.activateFirstPersonInteraction();
        const boardedFar = rt.fpRidingBusId !== null;
        rt.fpRidingBusId = null;

        // 3. Where the sign USED to stand, for the record.
        const old = authoredCellFurniture(anyRt.busRoute.loop, a.cell);
        rt.debugPlaceFirstPerson(old.x, old.y);
        const promptAtOldSign = promptOf();

        covered.set(idx, {
          gap: Math.hypot(a.furniture.x - pose.x, a.furniture.y - pose.y),
          promptAtSign,
          boarded,
          promptAtOldSign,
          promptFar,
          boardedFar,
        });
      }
    }

    expect(covered.size).toBe(anchors.length);
    let oldFailures = 0;
    for (const [idx, r] of covered) {
      const where = `stop ${idx} @ ${anchors[idx]!.cell.x},${anchors[idx]!.cell.y}`;
      expect(r.gap, where).toBeCloseTo(STOP_VERGE_OFFSET_CELLS, 6);
      expect(r.promptAtSign, where).toMatch(/^bus:Board bus \d+$/);
      expect(r.boarded, where).toBe(true);
      // Two-sided: far away there is no bus prompt and E cannot board.
      expect(r.promptFar ?? "", where).not.toMatch(/^bus:/);
      expect(r.boardedFar, where).toBe(false);
      if (!/^bus:Board/.test(r.promptAtOldSign ?? "")) oldFailures++;
    }
    // DISCRIMINATION: the sign's OLD position gave no Board prompt at one or more of these very
    // same halted buses — the operator's report, reproduced inside the test.
    expect(oldFailures).toBeGreaterThan(0);
  }, 240000);

  it("leaves the doors open long enough in REAL time to walk up and press E", () => {
    // One in-sol minute is 15 real seconds (spec 150 PR2 — the fleet replays canonical sol time).
    const realSecondsAtStop = COLONY.transit.stopDwellMin * 15;
    expect(realSecondsAtStop).toBeGreaterThan(10);
    // Walking the verge offset at the base walk speed is a small fraction of that window.
    const walkSeconds =
      (STOP_VERGE_OFFSET_CELLS * CELL_SIZE) / COLONY.firstPerson.maxWalkSpeed;
    expect(walkSeconds).toBeLessThan(realSecondsAtStop / 2);
  });

  it("INVARIANT GUARD (passes before and after the fix): the sign stands inside the Board gate", () => {
    // Not proof of the fix — a guard so a future verge bump cannot silently push the pole back out
    // of reach of the doors.
    expect(STOP_VERGE_OFFSET_CELLS).toBeLessThan(BOARD_MAX);
  });
});
