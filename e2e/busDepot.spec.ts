import { test, expect } from "@playwright/test";

// Spec 149 + spec 150 PR2 — the bus depot + fleet, asserted against the LIVE world through the
// __colony runtime probe. The fleet now rides CANONICAL SOL time and ignores sim speed, so this
// suite drives it with debugSetSolTimeOfDay (stepping the sol clock) instead of setSpeed:
// buses park at the depot overnight, the first departure lands at 05:00 on the sol clock,
// the next bus holds its bay until the running one clears its second stop (the spacing gate) with a
// single-occupancy depot corridor (no two buses maneuvering at once — the collision fix), and the
// player boards a dwelling bus at the depot shelter, rides it onto the route, and steps off.
// WebGL suite — judge with --workers=1 (parallel specs crash the 4 GB GPU).

declare global {
  interface Window {
    __colony: any;
    __staggerViolated?: boolean;
    __dispatchLeader?: number | null;
  }
}

async function bootWithDepot(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.goto("/?skipauth=1");
  await page.waitForSelector("canvas", { timeout: 30000 });
  await page.waitForFunction(() => !!window.__colony, undefined, {
    timeout: 30000,
  });
  // The live seed sites a depot (tests/busDepotBoot.test.ts guards this in node); require it here
  // so a silent fall-back to the legacy coach fails loudly.
  const hasDepot = await page.evaluate(
    () => !!window.__colony.busDepot && !!window.__colony.busFleet,
  );
  expect(hasDepot).toBe(true);
}

/** Spec 150 PR2 — step the shared sol clock forward by `delta` in-sol minutes. The fleet is a
 *  deterministic replay of sol time, so this (not setSpeed) is how the suite advances the day. */
const STEP_SOL_MINUTES = `(delta) => {
  const rt = window.__colony;
  const c = rt.getUiState().clock;
  const next = (((c.hour * 60 + c.minute + delta) % 1440) + 1440) % 1440;
  rt.debugSetSolTimeOfDay(Math.floor(next / 60), next % 60);
}`;

/** All owned buses parked, re-pinning the sol clock to deep night until the last one gets home. */
async function waitAllParkedAtNight(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.evaluate(() => {
    window.__colony.debugSetSolTimeOfDay(1, 0);
  });
  await page.waitForFunction(
    () => {
      const rt = window.__colony;
      // In-flight buses finish their run home; keep it night so nobody re-dispatches meanwhile.
      // Service now opens at 05:00, so re-pin before the window reopens.
      if (rt.getUiState().clock.hour >= 4) rt.debugSetSolTimeOfDay(1, 0);
      return rt.busFleet.buses.every((b: any) => b.mode === "parked");
    },
    undefined,
    { timeout: 120000, polling: 500 },
  );
}

test.describe("spec 149 — bus depot fleet", () => {
  test("buses park at the depot overnight; first departure lands at 08:00; dispatch is staggered", async ({
    page,
  }, testInfo) => {
    test.setTimeout(420000);
    await bootWithDepot(page);

    // 1. Night: every owned bus parked, physically inside the pad.
    await waitAllParkedAtNight(page);
    const night = await page.evaluate(() => {
      const rt = window.__colony;
      const site = rt.busDepot.site;
      const poses = rt.busPoses();
      return {
        modes: rt.busFleet.buses.map((b: any) => b.mode),
        inPad: poses.every(
          (p: any) =>
            p.x >= site.x - 0.6 &&
            p.x <= site.x + site.w - 0.4 &&
            p.y >= site.y - 0.6 &&
            p.y <= site.y + site.h - 0.4,
        ),
        count: poses.length,
      };
    });
    expect(night.modes).toEqual([
      "parked",
      "parked",
      "parked",
      "parked",
      "parked",
    ]);
    expect(night.inPad).toBe(true);
    expect(night.count).toBe(5);
    await page.screenshot({
      path: testInfo.outputPath("depot-night-parked.png"),
    });

    // 2. First departure: set 04:58 and catch bus 0 leaving — at or just past 05:00 sol time.
    //    An in-sol minute is 15 real seconds, so the two-minute run-up elapses on its own.
    await page.evaluate(() => {
      window.__colony.debugSetSolTimeOfDay(4, 58);
    });
    await page.waitForFunction(
      () =>
        window.__colony.busFleet.buses.some((b: any) => b.mode !== "parked"),
      undefined,
      { timeout: 60000, polling: 100 },
    );
    const departure = await page.evaluate(() => {
      const c = window.__colony.getUiState().clock;
      return c.hour * 60 + c.minute;
    });
    expect(departure).toBeGreaterThanOrEqual(300);
    expect(departure).toBeLessThan(315); // 100 ms polling ≈ a few sol minutes of slack

    // 3. The stagger gate (spec 149 §9): bus 1 must not leave its bay until bus 0 has cleared its
    //    SECOND route stop. Also assert the depot corridor is single-occupancy the whole time — no
    //    two buses ever maneuvering in the depot approach at once (the collision fix).
    const inCorridor = (m: string) =>
      m === "bay-out" ||
      m === "depot-stop-out" ||
      m === "spur-out" ||
      m === "spur-in" ||
      m === "depot-stop-in" ||
      m === "bay-in";
    await page.evaluate(() => {
      const f = window.__colony.busFleet;
      window.__dispatchLeader =
        f.gateHeldBy ??
        f.buses.find((b: any) => b.mode !== "parked")?.id ??
        null;
      window.__staggerViolated = false;
      (window as any).__corridorViolated = false;
      // Spec 150 PR2: the fleet ignores sim speed, so the stagger phase is driven by STEPPING the
      // sol clock one in-sol minute per poll. The driver replays in whole minutes, so this observes
      // every fleet step the old 9x run did — the gate and single-occupancy corridor are still
      // sim-enforced, this only bounds how soon the leader reaches its second stop by wall clock.
    });
    await page.waitForFunction(
      ([inCorridorSrc, stepSrc]: [string, string]) => {
        const isCorridor = new Function(
          "m",
          `return (${inCorridorSrc})(m)`,
        ) as (m: string) => boolean;
        const step = new Function(`return (${stepSrc})`)() as (
          delta: number,
        ) => void;
        step(1); // advance one in-sol minute per poll
        const f = window.__colony.busFleet;
        const leaderId = (window as any).__dispatchLeader;
        const leader = f.buses.find((b: any) => b.id === leaderId);
        if (leader && leader.stopsReached < 2) {
          const earlyFollower = f.buses.some(
            (b: any) => b.id !== leaderId && b.mode !== "parked",
          );
          if (earlyFollower) window.__staggerViolated = true;
        }
        if (f.buses.filter((b: any) => isCorridor(b.mode)).length > 1)
          (window as any).__corridorViolated = true;
        return (
          leader &&
          leader.stopsReached >= 2 &&
          f.buses.some((b: any) => b.id !== leaderId && b.mode !== "parked")
        );
      },
      [inCorridor.toString(), STEP_SOL_MINUTES] as [string, string],
      { timeout: 300000, polling: 100 },
    );
    const stagger = await page.evaluate(() => {
      const leader = window.__colony.busFleet.buses.find(
        (b: any) => b.id === (window as any).__dispatchLeader,
      );
      return {
        violated: window.__staggerViolated,
        corridorViolated: (window as any).__corridorViolated,
        secondReached: !!leader && leader.stopsReached >= 2,
      };
    });
    expect(stagger.violated).toBe(false);
    expect(stagger.corridorViolated).toBe(false);
    expect(stagger.secondReached).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("depot-morning-dispatch.png"),
    });
  });

  test("the player boards a dwelling bus at the depot shelter, rides it, and steps off at a stop", async ({
    page,
  }, testInfo) => {
    test.setTimeout(420000);
    await bootWithDepot(page);
    await waitAllParkedAtNight(page);

    // Step into a citizen and stand them at the depot boarding shelter just before opening.
    const entered = await page.evaluate(() => {
      const rt = window.__colony;
      rt.debugSetSolTimeOfDay(4, 56);
      rt.setPlayerView(false); // skipauth boots as a restricted player; step-in needs the operator view
      const ids = rt.getUiState().firstPerson.stepInCitizenIds;
      if (!ids.length) return false;
      if (!rt.enterFirstPerson(ids[0])) return false;
      const shelter = rt.busDepot.layout.shelter;
      return rt.debugPlaceFirstPerson(shelter.x, shelter.y);
    });
    expect(entered).toBe(true);

    // Wait for the 05:00 bus to open its doors at the gate; the Board prompt is the EXISTING
    // first-person affordance (interactionPrompt + activateFirstPersonInteraction — the E key).
    // Sol time is stepped per poll (spec 150 PR2) since the fleet ignores sim speed.
    await page.waitForFunction(
      (stepSrc: string) => {
        const step = new Function(`return (${stepSrc})`)() as (
          delta: number,
        ) => void;
        const rt = window.__colony;
        const p = rt.getUiState().firstPerson.view?.interactionPrompt;
        if (p && p.kind === "bus" && String(p.label).startsWith("Board"))
          rt.activateFirstPersonInteraction();
        if (rt.fpRidingBusId === null) step(1);
        return rt.fpRidingBusId !== null;
      },
      STEP_SOL_MINUTES,
      { timeout: 120000, polling: 100 },
    );
    const boardedAt = await page.evaluate(() => {
      const rt = window.__colony;
      const v = rt.getUiState().firstPerson.view;
      return {
        x: v.citizen.positionXY.x,
        y: v.citizen.positionXY.y,
        bus: rt.fpRidingBusId,
      };
    });
    expect(boardedAt.bus).not.toBeNull();
    await page.screenshot({
      path: testInfo.outputPath("boarded-at-depot.png"),
    });

    // Riding: the bus pulls out (spur -> route) and the rider's position tracks it.
    await page.waitForFunction(
      ([start, stepSrc]: [{ x: number; y: number }, string]) => {
        const step = new Function(`return (${stepSrc})`)() as (
          delta: number,
        ) => void;
        const rt = window.__colony;
        if (rt.fpRidingBusId === null) return false;
        step(1);
        const pose = rt.busPoseOf(rt.fpRidingBusId);
        return Math.hypot(pose.x - start.x, pose.y - start.y) > 4;
      },
      [boardedAt, STEP_SOL_MINUTES] as [{ x: number; y: number }, string],
      { timeout: 120000, polling: 100 },
    );
    const riding = await page.evaluate(() => {
      const rt = window.__colony;
      const pose = rt.busPoseOf(rt.fpRidingBusId);
      const v = rt.getUiState().firstPerson.view;
      return {
        gap: Math.hypot(
          pose.x - v.citizen.positionXY.x,
          pose.y - v.citizen.positionXY.y,
        ),
      };
    });
    expect(riding.gap).toBeLessThan(0.5); // the camera's citizen IS on the bus
    await page.screenshot({ path: testInfo.outputPath("riding-the-bus.png") });

    // Step off at the next doors-open dwell (any route stop) via the same E affordance.
    await page.waitForFunction(
      () => {
        const rt = window.__colony;
        const p = rt.getUiState().firstPerson.view?.interactionPrompt;
        if (p && p.kind === "bus" && p.label === "Exit bus")
          rt.activateFirstPersonInteraction();
        return rt.fpRidingBusId === null;
      },
      undefined,
      { timeout: 300000, polling: 100 },
    );
    const after = await page.evaluate(() => {
      const rt = window.__colony;
      const v = rt.getUiState().firstPerson.view;
      return { x: v.citizen.positionXY.x, y: v.citizen.positionXY.y };
    });
    // On foot again, away from where they boarded — they actually WENT somewhere by bus.
    expect(
      Math.hypot(after.x - boardedAt.x, after.y - boardedAt.y),
    ).toBeGreaterThan(3);
    await page.screenshot({
      path: testInfo.outputPath("alighted-at-stop.png"),
    });
  });
});
