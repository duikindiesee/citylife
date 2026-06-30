import { test, expect } from '@playwright/test';

test('Zoning and building plots E2E', async ({ page }) => {
  test.setTimeout(120000); // 2 minutes timeout

  console.log('Navigating to CityLife...');
  await page.goto('/');

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
  const streetBtn = page.locator('button', { hasText: 'Street' });
  const gravelBtn = page.locator('button', { hasText: 'Gravel Avenue' });
  await expect(streetBtn).toBeVisible();
  await expect(gravelBtn).toBeVisible();
  console.log('Category submenus for roads are successfully displayed.');

  // Ensure we are in "Plot Roads" mode to draw a road
  const plotRoadsBtn = page.locator('button', { hasText: 'Roads' });
  if (await plotRoadsBtn.isVisible()) {
    const className = await plotRoadsBtn.getAttribute('class');
    if (!className?.includes('on')) {
      await plotRoadsBtn.click({ force: true });
      await page.waitForTimeout(500);
    }
  }

  console.log('Drawing a road segment at the center of the screen...');
  // Draw a horizontal road segment from (500, 300) to (700, 300)
  await page.mouse.move(500, 300);
  await page.mouse.down();
  await page.mouse.move(700, 300, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(1000);

  // Switch to Zoning Mode
  const zoningCategoryBtn = page.locator('button', { hasText: 'Zoning' });
  await expect(zoningCategoryBtn).toBeVisible();
  await zoningCategoryBtn.click({ force: true });
  await page.waitForTimeout(500);

  // Assert that zoning submenus (Residential Plot / Commercial Plot) show up
  const resPlotBtn = page.locator('button', { hasText: 'Residential Plot' });
  const commPlotBtn = page.locator('button', { hasText: 'Commercial Plot' });
  await expect(resPlotBtn).toBeVisible();
  await expect(commPlotBtn).toBeVisible();
  console.log('Category submenus for zoning are successfully displayed.');

  // Click Residential Plot
  await resPlotBtn.click({ force: true });
  await page.waitForTimeout(500);

  // 2. Assert that clicking Residential Plot draws the zoning preview
  // Hover over the canvas to activate pointer hover cell and trigger preview
  console.log('Moving mouse to trigger zoning preview...');
  await page.mouse.move(600, 330);
  await page.waitForTimeout(1000);

  // Check if we are in zoning mode in the store
  const builderMode = await page.evaluate(() => {
    return (window as any).__colony?.builderMode;
  });
  expect(builderMode).toBe('zoning_residential');
  console.log('Zoning mode is active.');

  // Dismiss any dialogs that might pop up (like road connection alerts if placement fails)
  let alertMessage = '';
  page.on('dialog', async dialog => {
    alertMessage = dialog.message();
    console.log(`Alert dialog shown: "${alertMessage}"`);
    await dialog.dismiss();
  });

  // 3. Assert that placing a plot near a road successfully creates a parcel
  // We click at (600, 330), which should be adjacent to the horizontal road at y=300.
  console.log('Clicking to place the plot next to the road...');
  await page.mouse.click(600, 330);
  await page.waitForTimeout(2000);

  // If the placement failed because of coordinate offset, try another nearby offset (e.g. 600, 320 or 600, 325)
  const lotsCountAfterFirstClick = await page.evaluate(() => {
    return (window as any).__colony?.neighborhood?.lots?.length ?? 0;
  });

  if (lotsCountAfterFirstClick === initialLotsCount) {
    console.log('First placement attempt did not create a lot. Trying alternative offset (600, 323)...');
    await page.mouse.click(600, 323);
    await page.waitForTimeout(2000);
  }

  const finalLotsCount = await page.evaluate(() => {
    return (window as any).__colony?.neighborhood?.lots?.length ?? 0;
  });

  console.log(`Final lots count: ${finalLotsCount}`);
  expect(finalLotsCount).toBeGreaterThan(initialLotsCount);
  console.log('Residential Plot successfully placed near a road and parcel created.');
});
