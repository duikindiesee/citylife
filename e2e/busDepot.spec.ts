import { test, expect } from '@playwright/test';

// Spec 140 — the bus depot + fleet, asserted against the LIVE world through the __colony runtime
// probe: buses park at the depot overnight, the first departure lands at 08:00 on the sim clock,
// the second bus holds its bay until the first reaches its first stop (the stagger gate), and the
// player boards a dwelling bus at the depot shelter, rides it onto the route, and steps off.
// WebGL suite — judge with --workers=1 (parallel specs crash the 4 GB GPU).

declare global {
  interface Window {
    __colony: any;
    __staggerViolated?: boolean;
  }
}

async function bootWithDepot(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/?skipauth=1');
  await page.waitForSelector('canvas', { timeout: 30000 });
  await page.waitForFunction(() => !!window.__colony, undefined, { timeout: 30000 });
  // The live seed sites a depot (tests/busDepotBoot.test.ts guards this in node); require it here
  // so a silent fall-back to the legacy coach fails loudly.
  const hasDepot = await page.evaluate(() => !!window.__colony.busDepot && !!window.__colony.busFleet);
  expect(hasDepot).toBe(true);
}

/** All owned buses parked, re-pinning the clock to deep night until the last one gets home. */
async function waitAllParkedAtNight(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    window.__colony.setSpeed(15);
    window.__colony.debugSetClock(1, 0);
  });
  await page.waitForFunction(
    () => {
      const rt = window.__colony;
      // In-flight buses finish their run home; keep it night so nobody re-dispatches meanwhile.
      if (rt.sim.state.clock.hour >= 7) rt.debugSetClock(1, 0);
      return rt.busFleet.buses.every((b: any) => b.mode === 'parked');
    },
    undefined,
    { timeout: 120000, polling: 500 },
  );
}

test.describe('spec 140 — bus depot fleet', () => {
  test('buses park at the depot overnight; first departure lands at 08:00; dispatch is staggered', async ({ page }, testInfo) => {
    test.setTimeout(300000);
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
    expect(night.modes).toEqual(['parked', 'parked', 'parked', 'parked', 'parked']);
    expect(night.inPad).toBe(true);
    expect(night.count).toBe(5);
    await page.screenshot({ path: testInfo.outputPath('depot-night-parked.png') });

    // 2. First departure: set 07:58 and catch bus 0 leaving — at or just past 08:00 sim time.
    await page.evaluate(() => {
      window.__colony.setSpeed(1);
      window.__colony.debugSetClock(7, 58);
    });
    await page.waitForFunction(
      () => window.__colony.busFleet.buses[0].mode !== 'parked',
      undefined,
      { timeout: 60000, polling: 100 },
    );
    const departure = await page.evaluate(() => {
      const c = window.__colony.sim.state.clock;
      return c.hour * 60 + c.minute;
    });
    expect(departure).toBeGreaterThanOrEqual(8 * 60);
    expect(departure).toBeLessThan(8 * 60 + 15); // 100 ms polling at 9 sim-min/s ≈ minutes of slack

    // 3. The stagger gate: bus 1 must not leave its bay until bus 0 has reached its first stop.
    await page.evaluate(() => {
      window.__colony.setSpeed(3);
      window.__staggerViolated = false;
    });
    await page.waitForFunction(
      () => {
        const f = window.__colony.busFleet;
        if (f.buses[1].mode !== 'parked' && !f.buses[0].reachedFirstStop)
          window.__staggerViolated = true;
        return f.buses[1].mode !== 'parked';
      },
      undefined,
      { timeout: 180000, polling: 100 },
    );
    const stagger = await page.evaluate(() => ({
      violated: window.__staggerViolated,
      firstReached: window.__colony.busFleet.buses[0].reachedFirstStop,
    }));
    expect(stagger.violated).toBe(false);
    expect(stagger.firstReached).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('depot-morning-dispatch.png') });
  });

  test('the player boards a dwelling bus at the depot shelter, rides it, and steps off at a stop', async ({ page }, testInfo) => {
    test.setTimeout(300000);
    await bootWithDepot(page);
    await waitAllParkedAtNight(page);

    // Step into a citizen and stand them at the depot boarding shelter just before opening.
    const entered = await page.evaluate(() => {
      const rt = window.__colony;
      rt.setSpeed(1);
      rt.debugSetClock(7, 56);
      rt.setPlayerView(false); // skipauth boots as a restricted player; step-in needs the operator view
      const ids = rt.getUiState().firstPerson.stepInCitizenIds;
      if (!ids.length) return false;
      if (!rt.enterFirstPerson(ids[0])) return false;
      const shelter = rt.busDepot.layout.shelter;
      return rt.debugPlaceFirstPerson(shelter.x, shelter.y);
    });
    expect(entered).toBe(true);

    // Wait for the 08:00 bus to open its doors at the gate; the Board prompt is the EXISTING
    // first-person affordance (interactionPrompt + activateFirstPersonInteraction — the E key).
    await page.waitForFunction(
      () => {
        const rt = window.__colony;
        const p = rt.getUiState().firstPerson.view?.interactionPrompt;
        if (p && p.kind === 'bus' && String(p.label).startsWith('Board'))
          rt.activateFirstPersonInteraction();
        return rt.fpRidingBusId !== null;
      },
      undefined,
      { timeout: 120000, polling: 100 },
    );
    const boardedAt = await page.evaluate(() => {
      const rt = window.__colony;
      const v = rt.getUiState().firstPerson.view;
      return { x: v.citizen.positionXY.x, y: v.citizen.positionXY.y, bus: rt.fpRidingBusId };
    });
    expect(boardedAt.bus).not.toBeNull();
    await page.screenshot({ path: testInfo.outputPath('boarded-at-depot.png') });

    // Riding: the bus pulls out (spur -> route) and the rider's position tracks it.
    await page.evaluate(() => window.__colony.setSpeed(3));
    await page.waitForFunction(
      (start) => {
        const rt = window.__colony;
        if (rt.fpRidingBusId === null) return false;
        const pose = rt.busPoseOf(rt.fpRidingBusId);
        return Math.hypot(pose.x - start.x, pose.y - start.y) > 4;
      },
      boardedAt,
      { timeout: 120000, polling: 100 },
    );
    const riding = await page.evaluate(() => {
      const rt = window.__colony;
      const pose = rt.busPoseOf(rt.fpRidingBusId);
      const v = rt.getUiState().firstPerson.view;
      return {
        gap: Math.hypot(pose.x - v.citizen.positionXY.x, pose.y - v.citizen.positionXY.y),
      };
    });
    expect(riding.gap).toBeLessThan(0.5); // the camera's citizen IS on the bus
    await page.screenshot({ path: testInfo.outputPath('riding-the-bus.png') });

    // Step off at the next doors-open dwell (any route stop) via the same E affordance.
    await page.waitForFunction(
      () => {
        const rt = window.__colony;
        const p = rt.getUiState().firstPerson.view?.interactionPrompt;
        if (p && p.kind === 'bus' && p.label === 'Exit bus')
          rt.activateFirstPersonInteraction();
        return rt.fpRidingBusId === null;
      },
      undefined,
      { timeout: 180000, polling: 100 },
    );
    const after = await page.evaluate(() => {
      const rt = window.__colony;
      const v = rt.getUiState().firstPerson.view;
      return { x: v.citizen.positionXY.x, y: v.citizen.positionXY.y };
    });
    // On foot again, away from where they boarded — they actually WENT somewhere by bus.
    expect(Math.hypot(after.x - boardedAt.x, after.y - boardedAt.y)).toBeGreaterThan(3);
    await page.screenshot({ path: testInfo.outputPath('alighted-at-stop.png') });
  });
});
