import { test, expect, type Page } from "@playwright/test";

// Regression coverage for the P0 access bug: ColonyApp rendered BuilderPanel unconditionally, so a
// signed-in CITYLIFE_PLAYER (or any other non-operator) could see and enter City Builder. These
// tests seed a real (unsigned, but structurally valid) session into sessionStorage — the exact
// storage key/shape AuthClient.restore() reads — so AuthGate treats the page as genuinely
// authenticated with a chosen role, WITHOUT using the local DEV/E2E `?skipauth=1` bypass. That
// bypass is exercised separately below and by the existing builder e2e specs (zoning, first_plot,
// roadRibbons, etc.), which all rely on it remaining unrestricted.

const SESSION_STORAGE_KEY = "citylife.session.v5";

function seedSession(page: Page, roles: string[]) {
  return page.addInitScript(
    ({ key, roles: sessionRoles }) => {
      const session = {
        token: "e2e-fake-token",
        expiresAt: Date.now() + 1000 * 60 * 60 * 8,
        operator: {
          id: "E2E Tester",
          userId: "e2e-user",
          scopes: [],
          roles: sessionRoles,
        },
      };
      window.sessionStorage.setItem(key, JSON.stringify(session));
    },
    { key: SESSION_STORAGE_KEY, roles },
  );
}

const cityBuilderBtn = (page: Page) =>
  page.locator("button", { hasText: "City Builder" });
const worldViewBtn = (page: Page) =>
  page.locator("button", { hasText: "World View" });
const surveyMapBtn = (page: Page) =>
  page.locator("button", { hasText: "Survey Map" });

test.describe("City Builder role gate (P0 CITYLIFE_PLAYER access regression)", () => {
  test("a CITYLIFE_PLAYER never sees City Builder, but World View and Survey Map remain", async ({
    page,
  }) => {
    await seedSession(page, ["CITYLIFE_PLAYER"]);
    await page.goto("/");
    await page.waitForSelector("canvas", { timeout: 30000 });
    await page.waitForTimeout(2000);

    await expect(cityBuilderBtn(page)).toHaveCount(0);
    await expect(worldViewBtn(page)).toBeVisible();
    await expect(surveyMapBtn(page)).toBeVisible();

    // No builder toolbar (roads/zoning/landscaping/bulldoze/exit) is reachable at all.
    await expect(
      page.locator("button", { hasText: "EXIT BUILDER" }),
    ).toHaveCount(0);
  });

  test("an unrecognised/empty role list also fails closed", async ({
    page,
  }) => {
    await seedSession(page, []);
    await page.goto("/");
    await page.waitForSelector("canvas", { timeout: 30000 });
    await page.waitForTimeout(2000);

    await expect(cityBuilderBtn(page)).toHaveCount(0);
    await expect(worldViewBtn(page)).toBeVisible();
  });

  test("ADMIN can still see, enter and use City Builder", async ({ page }) => {
    await seedSession(page, ["ADMIN"]);
    await page.goto("/");
    await page.waitForSelector("canvas", { timeout: 30000 });
    await page.waitForTimeout(2000);

    await expect(cityBuilderBtn(page)).toBeVisible();
    await cityBuilderBtn(page).click({ force: true });
    await page.waitForTimeout(500);
    await expect(
      page.locator("button", { hasText: "EXIT BUILDER" }),
    ).toBeVisible();
  });

  test("a CITYLIFE_PLAYER who also holds ADMIN keeps builder access (operator role is authoritative)", async ({
    page,
  }) => {
    await seedSession(page, ["CITYLIFE_PLAYER", "ADMIN"]);
    await page.goto("/");
    await page.waitForSelector("canvas", { timeout: 30000 });
    await page.waitForTimeout(2000);

    await expect(cityBuilderBtn(page)).toBeVisible();
  });

  test("a stale builderActive=true is forced off for a restricted session (defense in depth)", async ({
    page,
  }) => {
    await seedSession(page, ["CITYLIFE_PLAYER"]);
    await page.goto("/");
    await page.waitForSelector("canvas", { timeout: 30000 });
    await page.waitForTimeout(2000);

    // Simulate stale/programmatic store state — e.g. left over from a prior authorized session in
    // the same tab — the way BuilderPanel's enforcement effect is documented to defend against.
    await page.evaluate(() => {
      (window as any).useRoadNetwork.setState({
        builderActive: true,
        isDrawing: true,
      });
    });

    // The gate must self-correct: no builder toolbar renders, and the store is reset. The store
    // carries a large starter road network, so give the reset generous headroom under headless
    // rendering load rather than the default 5s poll.
    await expect(
      page.locator("button", { hasText: "EXIT BUILDER" }),
    ).toHaveCount(0);
    await expect(cityBuilderBtn(page)).toHaveCount(0);
    await expect(worldViewBtn(page)).toBeVisible();
    await expect
      .poll(
        () =>
          page.evaluate(
            () => (window as any).useRoadNetwork.getState().builderActive,
          ),
        { timeout: 15000 },
      )
      .toBe(false);
    await expect
      .poll(
        () =>
          page.evaluate(
            () => (window as any).useRoadNetwork.getState().isDrawing,
          ),
        { timeout: 15000 },
      )
      .toBe(false);
  });

  test("the local DEV/E2E skip-auth bypass still grants unrestricted City Builder access", async ({
    page,
  }) => {
    await page.goto("/?skipauth=1");
    await page.waitForSelector("canvas", { timeout: 30000 });
    await page.waitForTimeout(2000);

    await expect(cityBuilderBtn(page)).toBeVisible();
  });
});
