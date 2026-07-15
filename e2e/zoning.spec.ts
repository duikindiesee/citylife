import { test, expect } from '@playwright/test';

test('Zoning and building plots E2E', async ({ page }) => {
  // Heavy build-interaction flow (open zoning menus, drag a plot, wait for the sim to build it).
  // On the slow headless CI runner the drag + per-plot terrain/collider recompute overran the 2 min
  // budget (it reached "Zoning mode active" then timed out placing the plot). Same class as
  // first_plot — 5 min gives it comfortable headroom in a single attempt (global retries are 0).
  test.setTimeout(300000);

  console.log('Navigating to CityLife...');
  await page.goto('/?skipauth=1');

  // Wait for the simulation to be ready by checking if the canvas is rendered
  await page.waitForSelector('canvas', { timeout: 30000 });
  await page.waitForTimeout(5000); // Give the renderer time to boot up and initialize

  // Get initial lots count
  const initialLotsCount = await page.evaluate(() => {
    return (window as any).__colony?.neighborhood?.lots?.length ?? 0;
  });
  console.log(`Initial lots count: ${initialLotsCount}`);

  // Ensure we are in Builder Mode
  // If "City Builder" button is visible, we are NOT in builder mode. Click it.
  const cityBuilderBtn = page.locator('button', { hasText: 'City Builder' });
  if (await cityBuilderBtn.isVisible()) {
    await cityBuilderBtn.click({ force: true });
    await page.waitForTimeout(1000);
  }

  // 1. Assert that entering Builder Mode shows the category submenus
  // By default, entering builder mode starts in 'roads' mode, so the 'Street' and 'Gravel Avenue' submenus should be visible.
  const streetBtn = page.locator('button', { hasText: /street/i });
  const gravelBtn = page.locator('button', { hasText: /gravel/i });
  await expect(streetBtn).toBeVisible();
  await expect(gravelBtn).toBeVisible();
  console.log('Category submenus for roads are successfully displayed.');

  // Find a flat, dry, buildable area in the terrain
  const buildableCenter = await page.evaluate(() => {
    const t = (window as any).__colony?.sim?.state?.terrain;
    if (!t) return null;
    
    // Serialized-safe cellOk emulator
    const cellOkLocal = (gx: number, gy: number) => {
      if (gx < 0 || gy < 0 || gx >= t.size || gy >= t.size) return false;
      const idx = gy * t.size + gx;
      if (t.buildable?.[idx] === 0) return false;
      const b = t.biome?.[idx];
      // Exclude Mountain (4), Peak (5), Ocean (6), Shallows (7)
      return b !== 4 && b !== 5 && b !== 6 && b !== 7;
    };
    
    // Scan for a 30x30 flat buildable block
    for (let y = 100; y < t.size - 100; y += 10) {
      for (let x = 100; x < t.size - 100; x += 10) {
        let ok = true;
        for (let dy = -15; dy <= 15; dy++) {
          for (let dx = -15; dx <= 15; dx++) {
            if (!cellOkLocal(x + dx, y + dy)) {
              ok = false;
              break;
            }
          }
          if (!ok) break;
        }
        if (ok) return { x, y };
      }
    }
    return { x: t.landing.x, y: t.landing.y };
  });

  console.log(`Found buildable center at: ${JSON.stringify(buildableCenter)}`);
  expect(buildableCenter).not.toBeNull();
  const bx = buildableCenter!.x;
  const by = buildableCenter!.y;

  // Plot road programmatically at the buildable center
  await page.evaluate(({ rx, ry }) => {
    const cells = [];
    for (let x = rx - 5; x <= rx + 5; x++) {
      cells.push({ x, y: ry });
    }
    (window as any).useRoadNetwork.getState().plotRoad(cells, 'street');
  }, { rx: bx, ry: by });
  console.log('Road plotted programmatically.');

  // Switch to Zoning Mode
  const zoningCategoryBtn = page.locator('button', { hasText: /zoning/i });
  await expect(zoningCategoryBtn).toBeVisible();
  await zoningCategoryBtn.click({ force: true });
  await page.waitForTimeout(500);

  // Assert that zoning submenus (Residential Plot / Commercial Plot) show up
  const resPlotBtn = page.locator('button', { hasText: /residential/i });
  const commPlotBtn = page.locator('button', { hasText: /commercial/i });
  await expect(resPlotBtn).toBeVisible();
  await expect(commPlotBtn).toBeVisible();
  console.log('Category submenus for zoning are successfully displayed.');

  // Click Residential Plot
  await resPlotBtn.click({ force: true });
  await page.waitForTimeout(500);

  // 2. Assert that clicking Residential Plot draws the zoning preview
  // Hover over the canvas to activate pointer hover cell and trigger preview
  console.log('Moving mouse to trigger zoning preview...');
  await page.mouse.move(640, 360);
  await page.waitForTimeout(1000);

  // Check if we are in zoning mode in the store
  const builderMode = await page.evaluate(() => {
    return (window as any).useRoadNetwork?.getState()?.builderMode;
  });
  expect(builderMode).toBe('zoning_residential');
  console.log('Zoning mode is active.');

  // 3. Assert that placing a plot near a road successfully creates a parcel
  // We place a zoned plot programmatically at the dynamically verified coordinates
  console.log('Placing the plot next to the road programmatically...');
  const placementResult = await page.evaluate(({ px, py }) => {
    return (window as any).__colony.placeZonedPlot(px, py + 1, 'n', 'BIG', 'residential');
  }, { px: bx, py: by });

  expect(placementResult).toBe(true);

  const finalLotsCount = await page.evaluate(() => {
    return (window as any).__colony?.neighborhood?.lots?.length ?? 0;
  });

  console.log(`Final lots count: ${finalLotsCount}`);
  expect(finalLotsCount).toBeGreaterThan(initialLotsCount);
  console.log('Residential Plot successfully placed near a road and parcel created.');
});
