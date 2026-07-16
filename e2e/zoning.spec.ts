import { test, expect } from "@playwright/test";

test("Zoning and building plots E2E", async ({ page }) => {
  // Heavy build-interaction flow (open zoning menus, drag a plot, wait for the sim to build it).
  // On the slow headless CI runner the drag + per-plot terrain/collider recompute overran the 2 min
  // budget (it reached "Zoning mode active" then timed out placing the plot). Same class as
  // first_plot — 5 min gives it comfortable headroom in a single attempt (global retries are 0).
  test.setTimeout(300000);

  console.log("Navigating to CityLife...");
  await page.goto("/?skipauth=1");

  // Wait for the simulation to be ready by checking if the canvas is rendered
  await page.waitForSelector("canvas", { timeout: 30000 });
  await page.waitForTimeout(5000); // Give the renderer time to boot up and initialize

  // Get initial lots count
  const initialLotsCount = await page.evaluate(() => {
    return (window as any).__colony?.neighborhood?.lots?.length ?? 0;
  });
  console.log(`Initial lots count: ${initialLotsCount}`);

  // Ensure we are in Builder Mode
  // If "City Builder" button is visible, we are NOT in builder mode. Click it.
  const cityBuilderBtn = page.locator("button", { hasText: "City Builder" });
  if (await cityBuilderBtn.isVisible()) {
    await cityBuilderBtn.click({ force: true });
    await page.waitForTimeout(1000);
  }

  // 1. Assert that entering Builder Mode shows the category submenus
  // By default, entering builder mode starts in 'roads' mode, so the 'Street' and 'Gravel Avenue' submenus should be visible.
  const streetBtn = page.locator("button", { hasText: /street/i });
  const gravelBtn = page.locator("button", { hasText: /gravel/i });
  await expect(streetBtn).toBeVisible();
  await expect(gravelBtn).toBeVisible();
  console.log("Category submenus for roads are successfully displayed.");

  // Find an authoritative road + plot pair. The future plot may fail only for missing frontage;
  // all exact-footprint terrain, shore, reservation and collision checks already have to pass.
  const buildableCenter = await page.evaluate(() => {
    const rt = (window as any).__colony;
    const t = rt?.sim?.state?.terrain;
    if (!rt || !t) return null;
    const roadSet = rt.sim.state.roadSet as Set<string>;
    for (let y = 30; y < t.size - 30; y += 3) {
      for (let x = 30; x < t.size - 30; x += 3) {
        // Use one logical frontage cell. Multi-cell builder strokes add a rendered ribbon whose
        // shoulder occupies the immediately adjacent row, so an exact plot must not overlap it.
        const road = [{ x, y }];
        if (road.some((cell) => roadSet.has(`${cell.x},${cell.y}`))) continue;
        const roadSurvey = rt.surveyRoadPlacement(road, "street");
        if (!roadSurvey.ok) continue;
        const plotSurvey = rt.surveyZonedPlot(
          x,
          y + 1,
          "n",
          "BIG",
          "residential",
        );
        if (
          plotSurvey.failures.length > 0 &&
          plotSurvey.failures.every(
            (failure: any) => failure.code === "ROAD_CONNECTION_REQUIRED",
          )
        ) {
          return {
            x,
            y,
            road,
            roadRevision: roadSurvey.layoutRevision,
          };
        }
      }
    }
    return null;
  });

  console.log(`Found buildable center at: ${JSON.stringify(buildableCenter)}`);
  expect(buildableCenter).not.toBeNull();
  const bx = buildableCenter!.x;
  const by = buildableCenter!.y;

  // Plot road programmatically at the buildable center
  await page.evaluate(({ road, roadRevision }) => {
    const rt = (window as any).__colony;
    (window as any).useRoadNetwork
      .getState()
      .plotRoad(road, "street", rt.sim, roadRevision, rt);
  }, buildableCenter);
  console.log("Road plotted programmatically.");

  // Switch to Zoning Mode
  const zoningCategoryBtn = page.locator("button", { hasText: /zoning/i });
  await expect(zoningCategoryBtn).toBeVisible();
  await zoningCategoryBtn.click({ force: true });
  await page.waitForTimeout(500);

  // Assert that zoning submenus (Residential Plot / Commercial Plot) show up
  const resPlotBtn = page.locator("button", { hasText: /residential/i });
  const commPlotBtn = page.locator("button", { hasText: /commercial/i });
  await expect(resPlotBtn).toBeVisible();
  await expect(commPlotBtn).toBeVisible();
  console.log("Category submenus for zoning are successfully displayed.");

  // Click Residential Plot
  await resPlotBtn.click({ force: true });
  await page.waitForTimeout(500);

  // 2. Assert that clicking Residential Plot draws the zoning preview
  // Hover over the canvas to activate pointer hover cell and trigger preview
  console.log("Moving mouse to trigger zoning preview...");
  await page.mouse.move(640, 360);
  await page.waitForTimeout(1000);

  // Check if we are in zoning mode in the store
  const builderMode = await page.evaluate(() => {
    return (window as any).useRoadNetwork?.getState()?.builderMode;
  });
  expect(builderMode).toBe("zoning_residential");
  console.log("Zoning mode is active.");

  // 3. Assert that placing a plot near a road successfully creates a parcel
  // We place a zoned plot programmatically at the dynamically verified coordinates
  console.log("Placing the plot next to the road programmatically...");
  const placementResult = await page.evaluate(
    ({ px, py }) => {
      const rt = (window as any).__colony;
      const survey = rt.surveyZonedPlot(px, py + 1, "n", "BIG", "residential");
      return rt.commitZonedPlot(
        px,
        py + 1,
        "n",
        "BIG",
        "residential",
        survey.layoutRevision,
      ).ok;
    },
    { px: bx, py: by },
  );

  expect(placementResult).toBe(true);

  const finalLotsCount = await page.evaluate(() => {
    return (window as any).__colony?.neighborhood?.lots?.length ?? 0;
  });

  console.log(`Final lots count: ${finalLotsCount}`);
  expect(finalLotsCount).toBeGreaterThan(initialLotsCount);
  console.log(
    "Residential Plot successfully placed near a road and parcel created.",
  );
});
