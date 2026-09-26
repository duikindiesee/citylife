import { test, expect } from "@playwright/test";

const SESSION_KEY = "citylife.session.v5";
const MAP_FLAG_GLOB = "**/feature-flags/new-player-journey-v1";

declare global {
  interface Window {
    __colony: any;
  }
}

test.describe("player city map", () => {
  test("hides personal position when signed out; authenticated map tracks the player and buses", async ({
    page,
  }, testInfo) => {
    test.setTimeout(180000);
    await page.goto("/?skipauth=1");
    const map = page.getByTestId("player-map");
    await expect(map).toBeHidden({ timeout: 30000 });
    await expect(page.locator(".geo-readout")).toHaveCount(0);
    await expect(page.locator(".rally-social-read")).toHaveCount(0);
    await page.getByTestId("player-map-shortcut").click();
    await expect(map).toBeVisible();
    await expect(map).toContainText("Position unavailable");
    await expect(page.getByTestId("city-map-player-marker")).toHaveCount(0);
    await page.getByRole("button", { name: "Close map" }).click();
    await expect(map).toBeHidden();

    // Switch from the local signed-out preview to a mocked authenticated CITYLIFE_PLAYER. The token
    // is opaque and all token-derived endpoints used here are stubbed; no real account is contacted.
    const testUserId = "map-test-player";
    await page.route(MAP_FLAG_GLOB, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ enabled: false, state: "OFF" }),
      }),
    );
    await page.route("**/api/ledger/me/wallet", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ownerId: testUserId,
          appName: "citylife",
          walletType: "DEFAULT",
          instrument: "KCO",
          realm: "TEST",
          balance: 750,
        }),
      }),
    );
    await page.evaluate(
      ([key, userId]) => {
        window.sessionStorage.setItem(
          key,
          JSON.stringify({
            token: `opaque.${userId}.token`,
            expiresAt: Date.now() + 60 * 60 * 1000,
            operator: {
              // Bind this isolated mock player to a deterministic seeded citizen so the positive
              // map case exercises an identity-matched camera, not another citizen marked `local`.
              id: "KOOKER the Builder",
              userId,
              scopes: [],
              roles: ["CITYLIFE_PLAYER"],
            },
          }),
        );
        window.history.replaceState(null, "", window.location.pathname);
      },
      [SESSION_KEY, testUserId] as const,
    );
    await page.reload();
    await page.waitForSelector('[data-testid="player-wallet-hud"]', {
      timeout: 90000,
    });
    await expect(map).toBeHidden();
    await page.getByTestId("player-map-shortcut").click();
    await expect(map).toBeVisible();
    await expect(map).toHaveCSS("pointer-events", "none");
    await expect(map.locator(".bus-network-minimap__mode")).toHaveText(
      "LOCAL SESSION",
    );
    await expect(map).toContainText("You are here");
    const playerMarker = page.getByTestId("city-map-player-marker");
    await expect(playerMarker).toBeVisible();
    const cameraBefore = await page.evaluate(() =>
      window.__colony.fpCameraCell
        ? { ...window.__colony.fpCameraCell }
        : null,
    );
    expect(cameraBefore).not.toBeNull();
    const playerMarkerPosition = () =>
      playerMarker
        .locator("circle")
        .first()
        .evaluate(
          (node) => `${node.getAttribute("cx")},${node.getAttribute("cy")}`,
        );
    const markerBeforeWalking = await playerMarkerPosition();
    await page.keyboard.down("KeyW");
    try {
      await expect
        .poll(
          () =>
            page.evaluate(() => ({
              x: window.__colony.fpCameraCell?.x,
              y: window.__colony.fpCameraCell?.y,
            })),
          { timeout: 15000 },
        )
        .not.toEqual(cameraBefore);
      await expect
        .poll(playerMarkerPosition, { timeout: 15000 })
        .not.toBe(markerBeforeWalking);
    } finally {
      await page.keyboard.up("KeyW");
    }
    await page.waitForFunction(
      () => !!window.__colony?.busDepot && !!window.__colony?.busRoute,
      null,
      { timeout: 60000 },
    );
    const expected = await page.evaluate(() => ({
      roads: window.__colony.sim.state.roadWays.length,
      stops: window.__colony.busRoute.stops.length,
      buses: window.__colony.busFleet.buses.length,
    }));
    await expect(map.locator("polyline")).toHaveCount(expected.roads);
    await expect
      .poll(async () =>
        map
          .locator("[data-bus-count]")
          .evaluateAll((nodes) =>
            nodes.reduce(
              (sum, node) => sum + Number(node.getAttribute("data-bus-count")),
              0,
            ),
          ),
      )
      .toBe(expected.buses);
    await expect(map.locator(".bus-network-minimap__stop")).toHaveCount(
      expected.stops,
    );
    const markerPositions = () =>
      map
        .locator(".bus-network-minimap__bus")
        .evaluateAll((nodes) =>
          nodes
            .map(
              (node) => `${node.getAttribute("cx")},${node.getAttribute("cy")}`,
            )
            .join("|"),
        );
    const before = await markerPositions();
    await page.evaluate(() => {
      // debugSetSolTimeOfDay shifts solNowMs() (canonical sol clock read by the bus fleet).
      // debugSetClock only moves the legacy sim clock which the fleet ignores since spec 150 PR2.
      window.__colony.debugSetSolTimeOfDay(8, 0);
    });
    await expect.poll(markerPositions, { timeout: 90000 }).not.toBe(before);
    await page.waitForTimeout(1200);
    await page.screenshot({
      path: testInfo.outputPath("bus-network-minimap-day.png"),
    });
    await page.evaluate(() => window.__colony.debugSetSolTimeOfDay(23, 5));
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: testInfo.outputPath("bus-network-minimap-night.png"),
    });
    await page.evaluate((key) => {
      window.sessionStorage.removeItem(key);
      window.history.replaceState(null, "", `${window.location.pathname}?skipauth=1`);
    }, SESSION_KEY);
    await page.reload();
    await page.waitForSelector("canvas", { timeout: 90000 });
    await page.getByTestId("player-map-shortcut").click();
    await expect(map).toContainText("Position unavailable");
    await expect(page.getByTestId("city-map-player-marker")).toHaveCount(0);
  });
});
