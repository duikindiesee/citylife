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
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
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
    await expect(
      page.locator(".first-person-panel__friend-banner"),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Road Rally/i })).toHaveCount(
      0,
    );
    await expect(page.getByRole("button", { name: /Join Race/i })).toHaveCount(
      0,
    );
    await expect(page.getByRole("button", { name: "Open map" })).toBeVisible();
    const solClock = page.getByTestId("player-sol-clock");
    await expect(solClock).toBeVisible();
    await expect(solClock).toContainText(/Sol \d+ · \d{2}:\d{2}/);
    if (viewport.name === "mobile") {
      const clockBox = await solClock.boundingBox();
      expect(clockBox).not.toBeNull();
      expect(clockBox!.x).toBeGreaterThanOrEqual(0);
      expect(clockBox!.y).toBeGreaterThanOrEqual(0);
      expect(clockBox!.x + clockBox!.width).toBeLessThanOrEqual(viewport.width);
      expect(clockBox!.y + clockBox!.height).toBeLessThanOrEqual(
        viewport.height,
      );
      await expect(
        page.getByRole("button", { name: "Log a reproducible bug" }),
      ).toHaveCount(0);
    }
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
    await page.getByRole("button", { name: "More" }).click();
    await expect(
      page.getByRole("button", { name: "Log a reproducible bug" }),
    ).toBeVisible();
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

    const enteredFirstPerson = await page.evaluate(() => {
      const runtime = window.__colony;
      // This unauthenticated browser fixture has no resident, so seed one only
      // in memory to exercise the real first-person input lifecycle.
      const citizen = runtime.citizens.seedFounder({
        id: "citizen_hud_escape_test",
        householdId: "household_hud_escape_test",
        displayName: "HUD Escape Test",
        plotId: "plot_hud_escape_test",
        plotName: "HUD Escape Test Plot",
        home: { x: 5, y: 5 },
        kind: "human",
        nowMs: Date.now(),
      });
      if (citizen) runtime.setOperatorName(citizen.displayName);
      return citizen ? runtime.enterFirstPerson(citizen.id) : false;
    });
    expect(enteredFirstPerson).toBe(true);
    await expect
      .poll(() =>
        page.evaluate(() => window.__colony.getUiState().firstPerson.active),
      )
      .toBe(true);
    await page.getByTestId("topbar-menu").click();
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect
      .poll(() =>
        page.evaluate(() => window.__colony.getUiState().firstPerson.active),
      )
      .toBe(true);
  });
}

test.describe("mobile active driving session", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("shows only state-scoped session controls and routes touch input", async ({
    page,
  }) => {
    test.setTimeout(180000);
    await page.goto("/?skipauth=1");
    await page.waitForFunction(
      () => !!window.__colony?.busDepot && !!window.__colony?.busRoute,
      null,
      { timeout: 90000 },
    );

    await expect(page.getByTestId("active-race-hud")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Road Rally|Join Race/i }),
    ).toHaveCount(0);

    const started = await page.evaluate(() => window.__colony.startRace());
    expect(started).toBe(true);
    const status = page.getByTestId("active-race-hud");
    await expect(status).toBeVisible();
    await expect(status).toHaveAttribute("data-race-mode", /countdown|running/);
    await expect(status).toContainText(/Get ready|Driving/);
    await expect(status.getByLabel(/Checkpoint \d+ of \d+/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Restart driving session" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Exit driving session" }),
    ).toBeVisible();

    const controls = page.getByRole("group", {
      name: "Mobile driving controls",
    });
    await expect(controls).toBeVisible();
    await expect(
      controls.getByRole("button", { name: "Hold throttle" }),
    ).toBeVisible();
    await page.evaluate(() => {
      const runtime = window.__colony;
      const original = runtime.setRaceKey.bind(runtime);
      (window as any).__raceInputCalls = [];
      runtime.setRaceKey = (key: string, down: boolean) => {
        (window as any).__raceInputCalls.push([key, down]);
        original(key, down);
      };
    });
    const throttle = controls.getByRole("button", { name: "Hold throttle" });
    await throttle.dispatchEvent("pointerdown", {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
    });
    await throttle.dispatchEvent("pointerup", {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
    });
    await expect
      .poll(() => page.evaluate(() => (window as any).__raceInputCalls))
      .toContainEqual(["KeyW", true]);
    await expect
      .poll(() => page.evaluate(() => (window as any).__raceInputCalls))
      .toContainEqual(["KeyW", false]);

    await page.getByRole("button", { name: "Restart driving session" }).click();
    await expect(status).toHaveAttribute("data-race-mode", "countdown");
    await page.getByRole("button", { name: "Exit driving session" }).click();
    await expect(status).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Road Rally|Join Race/i }),
    ).toHaveCount(0);
  });
});
