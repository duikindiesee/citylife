import { test, expect } from "@playwright/test";

declare global {
  interface Window {
    __colony: any;
  }
}

test.describe("player city map", () => {
  test("opens on demand, tracks buses, and lets driving input pass through", async ({
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
    await page.getByRole("button", { name: "Close map" }).click();
    await expect(map).toBeHidden();
    await page.getByTestId("player-map-shortcut").click();
    await expect(map).toBeVisible();
    await expect(map).toHaveCSS("pointer-events", "none");
    await expect(map.locator(".bus-network-minimap__mode")).toHaveText(
      "LOCAL SESSION",
    );
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
  });
});
