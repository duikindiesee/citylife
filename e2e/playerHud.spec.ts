import { test, expect } from "@playwright/test";

declare global {
  interface Window {
    __colony: any;
  }
}

for (const viewport of [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`player HUD is clean and usable at ${viewport.name} size`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const hudFlagRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("hud-player-state-v1"))
        hudFlagRequests.push(request.url());
    });
    await page.goto("/?skipauth=1");
    await page.waitForFunction(
      () => !!window.__colony?.busDepot && !!window.__colony?.busRoute,
      null,
      { timeout: 90000 },
    );

    await expect(page.locator(".geo-readout")).toHaveCount(0);
    await expect(page.locator(".rally-social-read")).toHaveCount(0);
    await expect(page.locator(".first-person-panel__friend-banner")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Road Rally/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Join Race/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open map" })).toBeVisible();
    await expect(page.getByTestId("build-stamp")).toBeVisible();
    await expect(page.getByTestId("player-wallet-hud")).toHaveCount(0);
    expect(hudFlagRequests).toEqual([]);
    const topbarLayout = await page.locator(".topbar").evaluate((node) => ({
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
      children: Array.from(node.children).map((child) => ({
        text: (child.textContent || "").trim().slice(0, 40),
        width: Math.round(child.getBoundingClientRect().width),
        display: getComputedStyle(child).display,
      })),
    }));
    expect(topbarLayout.scrollWidth <= topbarLayout.clientWidth).toBe(true);

    await page.getByTestId("topbar-menu").click();
    const menu = page.getByTestId("player-pause-menu");
    await expect(menu).toBeVisible();
    await page.getByRole("button", { name: "Controls" }).click();
    await expect(menu).toContainText("W A S D / arrows");
    await page.getByRole("button", { name: "Friends" }).click();
    await expect(menu).toContainText("Online multiplayer is not connected yet");
    await expect(menu).not.toContainText("Cole the Racer");
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();

    await page.getByTestId("player-map-shortcut").click();
    const map = page.getByTestId("player-map");
    await expect(map).toBeVisible();
    await expect(map).toHaveCSS("pointer-events", "none");
    await expect(map.locator("[data-bus-count]")).not.toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath(`player-hud-${viewport.name}.png`),
    });
    await page.getByRole("button", { name: "Close map" }).click();
    await expect(map).toBeHidden();
  });
}
