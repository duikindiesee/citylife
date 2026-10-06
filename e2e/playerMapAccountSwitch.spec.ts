import { expect, test } from "@playwright/test";

test("mounted player map hides A's pose on B's first render during an in-place switch", async ({
  page,
}) => {
  await page.goto("/e2e/fixtures/playerMapAccountSwitch.html");
  const map = page.getByTestId("player-map");
  const marker = page.getByTestId("city-map-player-marker");
  await expect(map).toBeVisible();
  await expect(marker).toBeVisible();

  await page.getByRole("button", { name: "Switch account to B" }).click();
  await expect(map).toContainText("Position unavailable");
  await expect(marker).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window.__playerMapAccountRenders ?? []).some(
          (render) =>
            render.authenticatedAccount === "player-b" &&
            render.runtimeAccount === "player-a" &&
            !render.markerVisible,
        ),
      ),
    )
    .toBe(true);

  await expect
    .poll(() =>
      page.evaluate(() =>
        (window.__playerMapAccountRenders ?? []).some(
          (render) =>
            render.authenticatedAccount === "player-b" &&
            render.runtimeAccount === "player-b" &&
            render.markerVisible,
        ),
      ),
    )
    .toBe(true);
  await expect(marker).toBeVisible();

  const accountBFrames = await page.evaluate(() =>
    (window.__playerMapAccountRenders ?? []).filter(
      (render) => render.authenticatedAccount === "player-b",
    ),
  );
  expect(accountBFrames.length).toBeGreaterThan(0);
  expect(
    accountBFrames.every(
      (render) =>
        (render.authenticatedAccount === render.runtimeAccount &&
          render.isCityLifePlayer) ||
        !render.markerVisible,
    ),
  ).toBe(true);

  await page.getByRole("button", { name: "Switch role to operator" }).click();
  await expect(marker).toHaveCount(0);
  const operatorFrame = await page.evaluate(() =>
    (window.__playerMapAccountRenders ?? []).at(-1),
  );
  expect(operatorFrame).toMatchObject({
    authenticatedAccount: "player-b",
    runtimeAccount: "player-b",
    isCityLifePlayer: false,
    markerVisible: false,
  });
});
