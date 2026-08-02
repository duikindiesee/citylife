import { expect, test } from "@playwright/test";

async function bootSession(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/?skipauth=1");
  await page.waitForSelector("canvas", { timeout: 60_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { __colony?: unknown }).__colony,
    undefined,
    { timeout: 60_000 },
  );
  await page.waitForTimeout(1500);
}

test("desktop keeps privacy-safe presence provenance without legacy rally chrome", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await bootSession(page);

  await expect(page.locator(".geo-readout")).toBeVisible();
  await expect(page.locator(".geo-readout")).toContainText("SIMULATION CITIZEN");
  await expect(page.locator(".geo-readout")).toContainText(
    "not an authenticated online session",
  );
  await expect(page.locator(".bus-network-minimap")).toContainText("VEHICLES");
  await expect(page.getByText("Road Rally", { exact: true })).toHaveCount(0);
  await expect(page.locator(".rally-social-read")).toHaveCount(0);
});

test("mobile default keeps diagnostics and legacy rally chrome out of gameplay", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await bootSession(page);

  await expect(page.locator(".geo-readout")).toBeHidden();
  await expect(page.locator(".bus-network-minimap")).toBeHidden();
  await expect(page.getByText("Road Rally", { exact: true })).toHaveCount(0);
  await expect(page.locator(".rally-social-read")).toHaveCount(0);
});
