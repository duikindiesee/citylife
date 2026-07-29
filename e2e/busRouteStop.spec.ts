import { test, expect } from "@playwright/test";

// BUS.BOARD.1 — the operator could not board a bus standing at an ORDINARY ROUTE STOP. e2e/busDepot
// covers boarding at the DEPOT gate shelter; this covers the case that was broken: walk to a route
// stop's sign, wait for a bus to dwell there, press E, ride away.
//
// The cause was geometric, and it is measured in tests/busStopBoarding.test.ts: the sign was placed
// on the verge of the AUTHORED stop cell while the bus halts on the SMOOTHED driven loop, up to
// 3.40 cells away — composing to a 5.34-cell (21.4 m) gap at one stop against a 3-cell Board gate.
// The fix anchors both to one point, so this spec walks the player to `busStopAnchors()[i].furniture`
// — exactly where the rendered pole stands — and requires the prompt to be there.
//
// WebGL suite — judge with --workers=1 (parallel specs crash the 4 GB GPU).

declare global {
  interface Window {
    __colony: any;
  }
}

/** Step the shared sol clock forward by `delta` in-sol minutes (the fleet replays sol time). */
const STEP_SOL_MINUTES = `(delta) => {
  const rt = window.__colony;
  const c = rt.getUiState().clock;
  const next = (((c.hour * 60 + c.minute + delta) % 1440) + 1440) % 1440;
  rt.debugSetSolTimeOfDay(Math.floor(next / 60), next % 60);
}`;

test.describe("BUS.BOARD.1 — boarding at an ordinary route stop", () => {
  test("the player boards a bus dwelling at a route stop sign and rides it away", async ({
    page,
  }, testInfo) => {
    test.setTimeout(420000);
    await page.goto("/?skipauth=1");
    await page.waitForSelector("canvas", { timeout: 30000 });
    await page.waitForFunction(() => !!window.__colony, undefined, {
      timeout: 30000,
    });

    const ready = await page.evaluate(() => {
      const rt = window.__colony;
      if (!rt.busDepot || !rt.busFleet) return null;
      rt.setPlayerView(false); // skipauth boots restricted; step-in needs the operator view
      const ids = rt.getUiState().firstPerson.stepInCitizenIds;
      if (!ids.length || !rt.enterFirstPerson(ids[0])) return null;
      rt.debugSetSolTimeOfDay(12, 0); // midday: buses are out on the route, not at the depot
      return {
        anchors: rt.busStopAnchors().length,
        gate: rt.busDepot.layout.gate,
      };
    });
    expect(
      ready,
      "live seed must have a depot, a fleet and stop anchors",
    ).not.toBeNull();
    expect(ready!.anchors).toBeGreaterThan(0);

    // Walk the sol clock forward. The moment ANY bus dwells in `service` (a route stop — the depot
    // dwells are modes depot-stop-out/in), stand the player at that stop's rendered sign and press E.
    await page.waitForFunction(
      (stepSrc: string) => {
        const step = new Function(`return (${stepSrc})`)() as (
          d: number,
        ) => void;
        const rt = window.__colony;
        if (rt.fpRidingBusId !== null) return true;
        const anchors = rt.busStopAnchors();
        for (const b of rt.busFleet.buses) {
          if (b.mode !== "service" || !(b.dwell > 0)) continue;
          const pose = rt.busPoseOf(b.id);
          if (!pose || !pose.doorsOpen) continue;
          let best: any = null;
          for (const a of anchors) {
            const d = Math.hypot(pose.x - a.at.x, pose.y - a.at.y);
            if (!best || d < best.d) best = { a, d };
          }
          if (!best || best.d > 0.5) continue;
          // Stand exactly where the rendered pole stands, facing the bus.
          rt.debugPlaceFirstPerson(
            best.a.furniture.x,
            best.a.furniture.y,
            best.a.at.x,
            best.a.at.y,
          );
          const p = rt.getUiState().firstPerson.view?.interactionPrompt;
          (window as any).__promptAtSign = p ? `${p.kind}:${p.label}` : null;
          (window as any).__boardedStop = {
            cell: best.a.cell,
            busId: b.id,
            mode: b.mode,
            gap: Math.hypot(
              best.a.furniture.x - pose.x,
              best.a.furniture.y - pose.y,
            ),
          };
          if (p && p.kind === "bus" && String(p.label).startsWith("Board"))
            rt.activateFirstPersonInteraction();
          if (rt.fpRidingBusId !== null) return true;
        }
        step(1);
        return false;
      },
      STEP_SOL_MINUTES,
      { timeout: 300000, polling: 100 },
    );

    const boarded = await page.evaluate(() => {
      const rt = window.__colony;
      const v = rt.getUiState().firstPerson.view;
      return {
        bus: rt.fpRidingBusId,
        prompt: (window as any).__promptAtSign,
        stop: (window as any).__boardedStop,
        at: { x: v.citizen.positionXY.x, y: v.citizen.positionXY.y },
        gate: rt.busDepot.layout.gate,
        narration: v.narration ?? null,
      };
    });
    expect(boarded.bus).not.toBeNull();
    // It was a ROUTE stop, not the depot gate shelter.
    expect(boarded.stop.mode).toBe("service");
    expect(
      Math.hypot(
        boarded.stop.cell.x - boarded.gate.x,
        boarded.stop.cell.y - boarded.gate.y,
      ),
      "the boarding stop must not be the depot gate",
    ).toBeGreaterThan(10);
    // The prompt really was on screen at the sign, and the sign really was beside the doors.
    expect(boarded.prompt).toMatch(/^bus:Board bus \d+$/);
    expect(boarded.stop.gap).toBeLessThanOrEqual(3); // COLONY.transit.boardMaxDistanceCells
    await page.screenshot({
      path: testInfo.outputPath("boarded-at-route-stop.png"),
    });

    // Riding: the bus pulls away from the stop and the player's citizen goes with it.
    const start = boarded.at;
    await page.waitForFunction(
      ([from, stepSrc]: [{ x: number; y: number }, string]) => {
        const step = new Function(`return (${stepSrc})`)() as (
          d: number,
        ) => void;
        const rt = window.__colony;
        if (rt.fpRidingBusId === null) return false;
        step(1);
        const pose = rt.busPoseOf(rt.fpRidingBusId);
        return Math.hypot(pose.x - from.x, pose.y - from.y) > 4;
      },
      [start, STEP_SOL_MINUTES] as [{ x: number; y: number }, string],
      { timeout: 180000, polling: 100 },
    );
    const riding = await page.evaluate(() => {
      const rt = window.__colony;
      const pose = rt.busPoseOf(rt.fpRidingBusId);
      const v = rt.getUiState().firstPerson.view;
      return Math.hypot(
        pose.x - v.citizen.positionXY.x,
        pose.y - v.citizen.positionXY.y,
      );
    });
    expect(riding).toBeLessThan(0.5); // the player's citizen IS on the bus
    await page.screenshot({
      path: testInfo.outputPath("riding-from-route-stop.png"),
    });
  });
});
