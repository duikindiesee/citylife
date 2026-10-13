import { test, expect } from "@playwright/test";
import { zonedPlotDefinition } from "../src/colony/placement/placeableCatalog";
import { zonedPlotCells } from "../src/colony/placement/surveyPlacement";

test("Zoning and building plots E2E", async ({ page }) => {
  // Heavy build-interaction flow (open zoning menus, drag a plot, wait for the sim to build it).
  // On the slow headless CI runner the drag + per-plot terrain/collider recompute overran the 2 min
  // budget (it reached "Zoning mode active" then timed out placing the plot). Same class as
  // first_plot — 5 min gives it comfortable headroom in a single attempt (global retries are 0).
  test.setTimeout(300000);

  console.log("Navigating to CityLife...");
  await page.goto("/?skipauth=1");

  // Wait for the simulation to be ready by checking if the canvas is rendered
  await page.waitForSelector("canvas", { timeout: 90000 });
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

  // Derive production footprint offsets for BIG residential plot (front-centred-rectangle, orientation n)
  const def = zonedPlotDefinition("residential", "BIG");
  expect(def.footprint.type).toBe("front-centred-rectangle");
  expect(def.footprint.width).toBeGreaterThan(0);
  expect(def.footprint.depth).toBeGreaterThan(0);
  const template = zonedPlotCells(
    0,
    0,
    def.footprint.width,
    def.footprint.depth,
    "n",
  );
  expect(template.cells.length).toBeGreaterThan(0);
  const plotFootprintOffsets = template.cells.map((c) => ({
    dx: c.x,
    dy: c.y,
  }));

  // Find an authoritative road + plot pair. The future plot may fail only for missing frontage;
  // all exact-footprint terrain, shore, reservation and collision checks already have to pass.
  const searchResult = await page.evaluate(
    ({ plotFootprintOffsets }) => {
      const rt = (window as any).__colony;
      if (!rt) return { error: "Missing runtime (__colony)" };
      const t = rt?.sim?.state?.terrain;
      if (!t) return { error: "Missing terrain" };
      const roadSet = rt.sim?.state?.roadSet as Set<string> | undefined;
      if (!roadSet || roadSet.size === 0) {
        return { error: "Missing or empty roadSet" };
      }
      const pCtx = rt.placementContext?.();
      if (!pCtx) return { error: "Missing placementContext from runtime" };
      const renderedRoads = pCtx.renderedRoadCells as Set<string> | undefined;
      const reservedCells = pCtx.reservedCells as Set<string> | undefined;
      const occupiedCells = pCtx.occupiedCells as Set<string> | undefined;
      if (!renderedRoads || !reservedCells || !occupiedCells) {
        return {
          error:
            "Missing required placement context sets (renderedRoadCells, reservedCells, occupiedCells)",
        };
      }

      const CARDINALS = [
        { dx: 0, dy: -1 },
        { dx: 1, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: -1, dy: 0 },
      ];
      const visited = new Set<string>();
      const startTime = performance.now();
      const MAX_CANDIDATES = 64;
      const DEADLINE_MS = 10000;
      let tested = 0;

      for (const roadKey of roadSet) {
        const commaIdx = roadKey.indexOf(",");
        const rx = Number(roadKey.slice(0, commaIdx));
        const ry = Number(roadKey.slice(commaIdx + 1));

        for (const { dx, dy } of CARDINALS) {
          if (
            tested >= MAX_CANDIDATES ||
            performance.now() - startTime >= DEADLINE_MS
          ) {
            return {
              candidate: null,
              tested,
              elapsedMs: performance.now() - startTime,
              reason:
                tested >= MAX_CANDIDATES
                  ? "MAX_CANDIDATES_REACHED"
                  : "DEADLINE_EXCEEDED",
            };
          }

          const x = rx + dx;
          const y = ry + dy;
          const key = `${x},${y}`;
          if (visited.has(key)) continue;
          visited.add(key);

          if (!t.inBounds(x, y) || !t.inBounds(x, y + 1)) continue;
          // Road cell must be unpaved, not reserved/occupied (do not exclude proposed road for rendered ribbon)
          if (
            roadSet.has(key) ||
            reservedCells.has(key) ||
            occupiedCells.has(key)
          ) {
            continue;
          }

          const roadIdx = t.idx(x, y);
          if (
            t.buildable[roadIdx] < 1 ||
            t.isWater(x, y) ||
            t.biome[roadIdx] === 2
          ) {
            continue; // 2 = Biome.Beach
          }

          // Footprint check for BIG plot oriented "n" at (x, y + 1) using production offsets:
          let footprintOk = true;
          for (const offset of plotFootprintOffsets) {
            const px = x + offset.dx;
            const py = y + 1 + offset.dy;
            if (!t.inBounds(px, py)) {
              footprintOk = false;
              break;
            }
            const pKey = `${px},${py}`;
            if (
              roadSet.has(pKey) ||
              renderedRoads.has(pKey) ||
              reservedCells.has(pKey) ||
              occupiedCells.has(pKey)
            ) {
              footprintOk = false;
              break;
            }
            const pIdx = t.idx(px, py);
            if (
              t.buildable[pIdx] < 1 ||
              t.isWater(px, py) ||
              t.biome[pIdx] === 2
            ) {
              footprintOk = false;
              break;
            }
          }

          if (!footprintOk) continue;

          tested++;
          const road = [{ x, y }];
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
              candidate: {
                x,
                y,
                road,
                roadRevision: roadSurvey.layoutRevision,
              },
              tested,
              elapsedMs: performance.now() - startTime,
            };
          }
        }
      }
      return {
        candidate: null,
        tested,
        elapsedMs: performance.now() - startTime,
        reason: "EXHAUSTED",
      };
    },
    { plotFootprintOffsets },
  );

  console.log(`Candidate search result: ${JSON.stringify(searchResult)}`);
  expect(searchResult.error).toBeUndefined();
  expect(searchResult.candidate).not.toBeNull();
  const buildableCenter = searchResult.candidate!;
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
