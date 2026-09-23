import { test, expect, devices } from "@playwright/test";

// PLAYER.FLAG.S3 — prove the fail-closed, default-OFF new-player-journey gate on a representative
// touch/mobile viewport, driven through the REAL authenticated bootstrap. We do not log in through
// the UI; instead we seed an authenticated session into sessionStorage before the app boots (so the
// operator is a genuine, non-null CITYLIFE_PLAYER — NOT the DEV skip-auth null-operator bypass) and
// stub the token-derived entitlement endpoint to drive OFF / allowlisted / account-switch.
//
// Non-cosmetic assertion: when the journey is OFF the garage entry affordance is ABSENT FROM THE DOM
// (count 0), not merely hidden — so it cannot be opened, and the interior overlay never mounts. When
// UAT allowlists the player it appears and opens by touch. An account switch back to an OFF user
// re-hides it, proving no positive entitlement bleeds across sessions.

const NAV_TIMEOUT = 30_000;
const ASSERT_TIMEOUT = 15_000;
const READY_TIMEOUT = 90_000; // one-off world-layout boot on a slow software-WebGL renderer

// The endpoint the client GETs (through the /kooker proxy). Matched loosely so a proxied host prefix
// never breaks the route.
const FLAG_GLOB = "**/feature-flags/new-player-journey-v1";
const SESSION_KEY = "citylife.session.v5";
const READY_MARKER = 'button[title="Sign out of CityLife"]';
const ENTRY = '[data-build-action="open-showroom"]';
const OVERLAY = '[data-testid="showroom-overlay"]';

test.use({
  ...devices["Pixel 5"],
  hasTouch: true,
  isMobile: true,
  actionTimeout: ASSERT_TIMEOUT,
  navigationTimeout: NAV_TIMEOUT,
});

// A real single-finger tap at the control's hit-tested centre. The showroom runs a continuous WebGL
// turntable that starves Playwright's rAF-based `.tap()` actionability sampling, so we resolve the
// on-screen centre + hit-test it in one evaluate (immune to that starvation) and dispatch a genuine
// touch — while still proving the control is the top-most element at its centre (an honest,
// occlusion-aware reachability check). This mirrors the proven helper in showroom-mobile.spec.ts.
async function touchTap(
  page: import("@playwright/test").Page,
  selector: string,
): Promise<void> {
  const locator = page.locator(selector);
  await expect(locator).toBeVisible({ timeout: ASSERT_TIMEOUT });
  const hit = await page.evaluate((sel) => {
    const target = document.querySelector(sel);
    if (!target) return { hasBox: false, onTarget: false, cx: 0, cy: 0 };
    target.scrollIntoView({ block: "center", inline: "center" });
    const r = target.getBoundingClientRect();
    if (r.width === 0 || r.height === 0)
      return { hasBox: false, onTarget: false, cx: 0, cy: 0 };
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const top = document.elementFromPoint(cx, cy);
    const onTarget = !!top && (top === target || target.contains(top));
    return { hasBox: true, onTarget, cx, cy };
  }, selector);
  expect(hit.hasBox, `${selector} should have a layout box`).toBe(true);
  expect(
    hit.onTarget,
    `${selector} must be the top-most element at its centre (reachable by touch)`,
  ).toBe(true);
  await page.touchscreen.tap(hit.cx, hit.cy);
}

/** Seed an authenticated (non-null operator) CityLife session for `userId` before any app script
 *  runs, so AuthGate mounts the colony straight into the authenticated bootstrap. The token is opaque
 *  (not a real JWT) — the entitlement endpoint is stubbed, so only the session identity matters. */
function authAs(userId: string) {
  return {
    token: `opaque.${userId}.token`,
    expiresAt: Date.now() + 60 * 60 * 1000,
    operator: {
      id: `Player ${userId}`,
      userId,
      scopes: [],
      roles: ["CITYLIFE_PLAYER"],
    },
  };
}

async function bootAs(
  page: import("@playwright/test").Page,
  userId: string,
  enabled: boolean,
): Promise<void> {
  // Stub the token-derived entitlement to the desired state (fail-closed = enabled:false).
  await page.route(FLAG_GLOB, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        enabled,
        state: enabled ? "UAT_ALLOWLIST" : "OFF",
      }),
    }),
  );
  await page.addInitScript(
    ([key, session]) => {
      try {
        window.sessionStorage.setItem(key as string, session as string);
      } catch {
        /* no storage */
      }
    },
    [SESSION_KEY, JSON.stringify(authAs(userId))] as const,
  );
  await page.goto("/", { timeout: NAV_TIMEOUT });
  await page.waitForSelector("canvas", { timeout: NAV_TIMEOUT });
  // The authenticated colony HUD (and thus the gated entry decision) is mounted once the world layout
  // boot resolves and the top bar renders its Log-out control.
  await page.waitForSelector(READY_MARKER, { timeout: READY_TIMEOUT });
}

test("returning owner hydrates their exact car without opening Gearbox", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.route("**/citylife/players/me/vehicle", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: '{"owned":true,"vehicleKey":"karoo-x19-targa"}',
    }),
  );
  await bootAs(page, "returning-car-owner", true);
  await expect(page.locator(OVERLAY)).toHaveCount(0);
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const runtime = (
            window as unknown as {
              __colony?: {
                sim: { state: { operatorCar?: { spec: { id: string } } } };
              };
            }
          ).__colony;
          return runtime?.sim.state.operatorCar?.spec.id ?? null;
        }),
      { timeout: ASSERT_TIMEOUT },
    )
    .toBe("showroom:karoo-x19-targa");
  const placement = await page.evaluate(() => {
    const runtime = (
      window as unknown as {
        __colony: {
          operatorCitizenId(): string | null;
          sim: {
            state: {
              roadSet: Set<string>;
              operatorCar?: { cell: { x: number; y: number } };
            };
          };
        };
      }
    ).__colony;
    const cell = runtime.sim.state.operatorCar!.cell;
    return {
      citizenId: runtime.operatorCitizenId(),
      onRoad: runtime.sim.state.roadSet.has(`${cell.x},${cell.y}`),
      cell,
    };
  });
  expect(placement.citizenId).toBeNull();
  expect(placement.onRoad).toBe(true);
  // Inspect the mounted world model, not only the runtime's ownership label.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const scene = (
            window as unknown as { __r3fScene?: import("three").Scene }
          ).__r3fScene;
          const model = scene
            ?.getObjectByName("operator-car")
            ?.getObjectByName("owned-vehicle-model");
          let vertices = 0;
          model?.traverse((node) => {
            const mesh = node as import("three").Mesh;
            if (mesh.isMesh)
              vertices += mesh.geometry.getAttribute("position")?.count ?? 0;
          });
          return { asset: model?.userData.assetUrl, vertices: vertices > 100 };
        }),
      { timeout: READY_TIMEOUT },
    )
    .toEqual({ asset: "/assets/citylife/cars/fiat_x19.glb", vertices: true });
  await expect(page.getByTestId("owned-car-controls")).toBeVisible();
  await page.keyboard.down("KeyW");
  await expect
    .poll(
      () =>
        page.evaluate((start) => {
          const runtime = (
            window as unknown as {
              __colony: import("../src/colony/runtime").ColonyRuntime;
            }
          ).__colony;
          const pose = runtime.getOwnedDrivePose();
          return pose ? Math.hypot(pose.x - start.x, pose.y - start.y) : 0;
        }, placement.cell),
      { timeout: 10_000 },
    )
    .toBeGreaterThan(0.1);
  await page.keyboard.up("KeyW");
  await page.keyboard.down("Space");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const runtime = (
          window as unknown as {
            __colony: import("../src/colony/runtime").ColonyRuntime;
          }
        ).__colony;
        return runtime.getOwnedDrivePose()?.speed;
      }),
    )
    .toBe(0);
  await page.keyboard.up("Space");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const w = window as unknown as {
          __colony: import("../src/colony/runtime").ColonyRuntime;
          __r3fCamera: import("three").Camera;
        };
        const pose = w.__colony.getOwnedDrivePose()!;
        const n = w.__colony.sim.state.terrain.size;
        return Math.hypot(
          w.__r3fCamera.position.x - (pose.x - n / 2) * 4,
          w.__r3fCamera.position.z - (pose.y - n / 2) * 4,
        );
      }),
    )
    .toBeLessThan(0.05);
  await page.screenshot({ path: "test-results/owned-car-seated-driving.png" });
  await touchTap(page, '[data-testid="exit-owned-car"]');
  await expect(page.getByTestId("owned-car-controls")).toHaveCount(0);
  await touchTap(page, '[data-testid="enter-owned-car"]');
  await expect(page.getByTestId("owned-car-controls")).toBeVisible();
  const accelerator = await page
    .locator('[data-drive-action="throttle"]')
    .boundingBox();
  expect(accelerator).not.toBeNull();
  const touch = {
    x: accelerator!.x + accelerator!.width / 2,
    y: accelerator!.y + accelerator!.height / 2,
  };
  expect(
    await page.evaluate(
      ({ x, y }) =>
        document
          .elementFromPoint(x, y)
          ?.closest('[data-drive-action="throttle"]') !== null,
      touch,
    ),
  ).toBe(true);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [touch],
  });
  try {
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as unknown as {
                __colony: import("../src/colony/runtime").ColonyRuntime;
              }
            ).__colony.getOwnedDrivePose()?.speed,
        ),
      )
      .toBeGreaterThan(0);
  } finally {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await cdp.detach();
  }
  // Keep the production controls mounted across a batched seated owner-to-owner change.
  // Navigation would erase the component ref and miss the stale held-throttle regression.
  await page.keyboard.down("KeyW");
  const switchedInput = await page.evaluate(() => {
    const runtime = (window as unknown as {
      __colony: import("../src/colony/runtime").ColonyRuntime;
    }).__colony;
    runtime.setOperatorUserId("second-seated-owner");
    runtime.applyVehicleOwnership("second-seated-owner", ["karoo-x19-targa"]);
    // Same JavaScript turn: even before React effects run, steering must not restore throttle.
    document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW", repeat: true, bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD", bubbles: true }));
    const input = (runtime as unknown as { ownedDriveInput: Record<string, boolean> }).ownedDriveInput;
    return { seated: !!runtime.getOwnedDrivePose(), throttle: !!input.throttle, right: !!input.right };
  });
  expect(switchedInput).toEqual({ seated: true, throttle: false, right: true });
  await page.keyboard.up("KeyW");
  await page.keyboard.up("KeyD");
  await page.reload();
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const runtime = (
            window as unknown as {
              __colony?: {
                sim: {
                  state: {
                    operatorCar?: {
                      spec: { id: string };
                      cell: { x: number; y: number };
                    };
                  };
                };
              };
            }
          ).__colony;
          const car = runtime?.sim.state.operatorCar;
          return car ? { id: car.spec.id, cell: car.cell } : null;
        }),
      { timeout: READY_TIMEOUT },
    )
    .toEqual({ id: "showroom:karoo-x19-targa", cell: placement.cell });
  await page.route("**/citylife/players/me/vehicle", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: '{"owned":false}',
    }),
  );
  await bootAs(page, "different-owner-without-car", true);
  await expect(page.locator(OVERLAY)).toBeVisible({ timeout: READY_TIMEOUT });
  await expect(page.getByTestId("owned-car-controls")).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      (
        window as unknown as {
          __colony: import("../src/colony/runtime").ColonyRuntime;
        }
      ).__colony.getOwnedDrivePose(),
    ),
  ).toBeNull();
});

test("new player can exit and re-enter the showroom without losing acquisition", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.route("**/citylife/players/me/vehicle", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: '{"owned":false}',
    }),
  );
  await bootAs(page, "showroom-reentry-1", true);
  const acquire = page.locator('[data-build-action="showroom-acquire"]');
  await expect(page.locator(OVERLAY)).toBeVisible({ timeout: READY_TIMEOUT });
  await expect(acquire).toBeEnabled({ timeout: ASSERT_TIMEOUT });

  await touchTap(page, '[data-build-action="showroom-exit"]');
  await expect(page.locator(OVERLAY)).toHaveCount(0);
  await touchTap(page, ENTRY);
  await expect(page.locator(OVERLAY)).toBeVisible();
  await expect(acquire).toBeEnabled({ timeout: ASSERT_TIMEOUT });
  await expect(
    page.locator('[data-build-action="showroom-acquire-preview"]'),
  ).toHaveCount(0);

  // A different identity with unavailable ownership truth must not inherit eligibility.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.route("**/citylife/players/me/vehicle", (route) =>
    route.fulfill({ status: 503, body: "unavailable" }),
  );
  await bootAs(page, "showroom-reentry-2", true);
  await expect(page.locator(ENTRY)).toBeVisible({ timeout: READY_TIMEOUT });
  await touchTap(page, ENTRY);
  await expect(
    page.locator('[data-build-action="showroom-acquire-preview"]'),
  ).toBeDisabled();
  await expect(acquire).toHaveCount(0);
});

test("server ownership opens Gearbox despite a stale cached car", async ({
  page,
}) => {
  test.setTimeout(120_000);
  let ownershipReads = 0;
  await page.addInitScript(() => {
    localStorage.setItem(
      "citylife.car.ownership.v1.stale-cache-player",
      JSON.stringify(["karoo-x19-targa"]),
    );
  });
  await page.route("**/citylife/players/me/vehicle", (route) => {
    ownershipReads++;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: '{"owned":false}',
    });
  });
  await bootAs(page, "stale-cache-player", true);
  await expect(page.locator(OVERLAY)).toBeVisible({ timeout: READY_TIMEOUT });
  expect(ownershipReads).toBeGreaterThan(0);
  await expect(
    page.locator('[data-build-action="showroom-acquire"]'),
  ).toBeEnabled({ timeout: ASSERT_TIMEOUT });
});

test("new-player journey gate: OFF hides+blocks entry, allowlist opens it, switch re-hides", async ({
  page,
}) => {
  // Three independent authenticated world-layout boots on a software (non-GPU) WebGL renderer; sized
  // like the showroom-mobile twin. The hard bound remains the OS process-tree kill in the runner.
  test.setTimeout(330_000);

  // 1) Default-OFF authenticated player: the garage entry affordance is absent (not merely hidden)
  //    and the interior overlay never mounts — the gate is not cosmetic.
  await bootAs(page, "uat-off-1", false);
  await expect(page.locator(ENTRY)).toHaveCount(0, { timeout: ASSERT_TIMEOUT });
  await expect(page.locator(OVERLAY)).toHaveCount(0);

  // 2) Operator UAT allowlists this player → entry appears and enters the showroom by touch.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await bootAs(page, "uat-allow-1", true);
  await expect(page.locator(ENTRY)).toBeVisible({ timeout: READY_TIMEOUT });
  await touchTap(page, ENTRY);
  await expect(page.locator(OVERLAY)).toBeVisible({ timeout: ASSERT_TIMEOUT });
  // Acquisition stays honestly locked (preview only) — no economy/ownership in this slice.
  await expect(
    page.locator('[data-build-action="showroom-acquire-preview"]'),
  ).toBeDisabled({ timeout: ASSERT_TIMEOUT });
  await touchTap(page, '[data-build-action="showroom-exit"]');
  await expect(page.locator(OVERLAY)).toHaveCount(0, {
    timeout: ASSERT_TIMEOUT,
  });

  // 3) Account switch to a different, OFF player → the entry is hidden again. No positive
  //    entitlement bled across the session boundary.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await bootAs(page, "uat-off-2", false);
  await expect(page.locator(ENTRY)).toHaveCount(0, { timeout: ASSERT_TIMEOUT });
  await expect(page.locator(OVERLAY)).toHaveCount(0);
});
