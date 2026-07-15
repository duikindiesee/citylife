import { test, expect } from "@playwright/test";

declare global {
  interface Window {
    __colony: any;
  }
}

test.describe("spec 149 — persistent live bus network minimap", () => {
  test("stays visible in street and world view and tracks moving coaches", async ({
    page,
  }, testInfo) => {
    test.setTimeout(180000);
    await page.goto("/?skipauth=1");
    const map = page.getByRole("complementary", {
      name: "Live bus network map",
    });
    await expect(map).toBeVisible({ timeout: 30000 });
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
      window.__colony.debugSetClock(8, 0);
      window.__colony.setSpeed(5);
    });
    await expect.poll(markerPositions, { timeout: 90000 }).not.toBe(before);
    await page.getByRole("button", { name: /World View/i }).click();
    await expect(map).toBeVisible();
    await page.waitForTimeout(1200);
    await page.screenshot({
      path: testInfo.outputPath("bus-network-minimap-day.png"),
    });
    await page.evaluate(() => window.__colony.debugSetClock(23, 5));
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: testInfo.outputPath("bus-network-minimap-night.png"),
    });
  });
});
