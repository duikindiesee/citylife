# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: zoning.spec.ts >> Zoning and building plots E2E
- Location: e2e\zoning.spec.ts:3:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('button').filter({ hasText: 'Street' })
Expected: visible
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 15000ms
  - waiting for locator('button').filter({ hasText: 'Street' })

```

```yaml
- text: Rally point Cole Waiting for a friend
- banner:
  - text: CityLife
  - emphasis: · Colony
  - text: Sol 0 · 10:13 ☀
  - button "❚❚"
  - button "1×"
  - button "2×"
  - button "5×"
  - button "Road Rally"
  - button "📷"
  - button "🌍 World View"
  - button "🏗️ City Builder"
  - button "Log out"
- complementary:
  - heading "Landing One" [level=2]
  - button "▾ HUD details"
- button "📻 Radio"
```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test';
  2   | 
  3   | test('Zoning and building plots E2E', async ({ page }) => {
  4   |   test.setTimeout(120000); // 2 minutes timeout
  5   | 
  6   |   console.log('Navigating to CityLife...');
  7   |   await page.goto('/');
  8   | 
  9   |   // Wait for the simulation to be ready by checking if the canvas is rendered
  10  |   await page.waitForSelector('canvas', { timeout: 30000 });
  11  |   await page.waitForTimeout(5000); // Give the renderer time to boot up and initialize
  12  | 
  13  |   // Get initial lots count
  14  |   const initialLotsCount = await page.evaluate(() => {
  15  |     return (window as any).__colony?.neighborhood?.lots?.length ?? 0;
  16  |   });
  17  |   console.log(`Initial lots count: ${initialLotsCount}`);
  18  | 
  19  |   // Ensure we are in Builder Mode
  20  |   // If "City Builder" button is visible, we are NOT in builder mode. Click it.
  21  |   const cityBuilderBtn = page.locator('button', { hasText: 'City Builder' });
  22  |   if (await cityBuilderBtn.isVisible()) {
  23  |     await cityBuilderBtn.click({ force: true });
  24  |     await page.waitForTimeout(1000);
  25  |   }
  26  | 
  27  |   // 1. Assert that entering Builder Mode shows the category submenus
  28  |   // By default, entering builder mode starts in 'roads' mode, so the 'Street' and 'Gravel Avenue' submenus should be visible.
  29  |   const streetBtn = page.locator('button', { hasText: 'Street' });
  30  |   const gravelBtn = page.locator('button', { hasText: 'Gravel Avenue' });
> 31  |   await expect(streetBtn).toBeVisible();
      |                           ^ Error: expect(locator).toBeVisible() failed
  32  |   await expect(gravelBtn).toBeVisible();
  33  |   console.log('Category submenus for roads are successfully displayed.');
  34  | 
  35  |   // Ensure we are in "Plot Roads" mode to draw a road
  36  |   const plotRoadsBtn = page.locator('button', { hasText: 'Roads' });
  37  |   if (await plotRoadsBtn.isVisible()) {
  38  |     const className = await plotRoadsBtn.getAttribute('class');
  39  |     if (!className?.includes('on')) {
  40  |       await plotRoadsBtn.click({ force: true });
  41  |       await page.waitForTimeout(500);
  42  |     }
  43  |   }
  44  | 
  45  |   console.log('Drawing a road segment at the center of the screen...');
  46  |   // Draw a horizontal road segment from (500, 300) to (700, 300)
  47  |   await page.mouse.move(500, 300);
  48  |   await page.mouse.down();
  49  |   await page.mouse.move(700, 300, { steps: 10 });
  50  |   await page.mouse.up();
  51  |   await page.waitForTimeout(1000);
  52  | 
  53  |   // Switch to Zoning Mode
  54  |   const zoningCategoryBtn = page.locator('button', { hasText: 'Zoning' });
  55  |   await expect(zoningCategoryBtn).toBeVisible();
  56  |   await zoningCategoryBtn.click({ force: true });
  57  |   await page.waitForTimeout(500);
  58  | 
  59  |   // Assert that zoning submenus (Residential Plot / Commercial Plot) show up
  60  |   const resPlotBtn = page.locator('button', { hasText: 'Residential Plot' });
  61  |   const commPlotBtn = page.locator('button', { hasText: 'Commercial Plot' });
  62  |   await expect(resPlotBtn).toBeVisible();
  63  |   await expect(commPlotBtn).toBeVisible();
  64  |   console.log('Category submenus for zoning are successfully displayed.');
  65  | 
  66  |   // Click Residential Plot
  67  |   await resPlotBtn.click({ force: true });
  68  |   await page.waitForTimeout(500);
  69  | 
  70  |   // 2. Assert that clicking Residential Plot draws the zoning preview
  71  |   // Hover over the canvas to activate pointer hover cell and trigger preview
  72  |   console.log('Moving mouse to trigger zoning preview...');
  73  |   await page.mouse.move(600, 330);
  74  |   await page.waitForTimeout(1000);
  75  | 
  76  |   // Check if we are in zoning mode in the store
  77  |   const builderMode = await page.evaluate(() => {
  78  |     return (window as any).__colony?.builderMode;
  79  |   });
  80  |   expect(builderMode).toBe('zoning_residential');
  81  |   console.log('Zoning mode is active.');
  82  | 
  83  |   // Dismiss any dialogs that might pop up (like road connection alerts if placement fails)
  84  |   let alertMessage = '';
  85  |   page.on('dialog', async dialog => {
  86  |     alertMessage = dialog.message();
  87  |     console.log(`Alert dialog shown: "${alertMessage}"`);
  88  |     await dialog.dismiss();
  89  |   });
  90  | 
  91  |   // 3. Assert that placing a plot near a road successfully creates a parcel
  92  |   // We click at (600, 330), which should be adjacent to the horizontal road at y=300.
  93  |   console.log('Clicking to place the plot next to the road...');
  94  |   await page.mouse.click(600, 330);
  95  |   await page.waitForTimeout(2000);
  96  | 
  97  |   // If the placement failed because of coordinate offset, try another nearby offset (e.g. 600, 320 or 600, 325)
  98  |   const lotsCountAfterFirstClick = await page.evaluate(() => {
  99  |     return (window as any).__colony?.neighborhood?.lots?.length ?? 0;
  100 |   });
  101 | 
  102 |   if (lotsCountAfterFirstClick === initialLotsCount) {
  103 |     console.log('First placement attempt did not create a lot. Trying alternative offset (600, 323)...');
  104 |     await page.mouse.click(600, 323);
  105 |     await page.waitForTimeout(2000);
  106 |   }
  107 | 
  108 |   const finalLotsCount = await page.evaluate(() => {
  109 |     return (window as any).__colony?.neighborhood?.lots?.length ?? 0;
  110 |   });
  111 | 
  112 |   console.log(`Final lots count: ${finalLotsCount}`);
  113 |   expect(finalLotsCount).toBeGreaterThan(initialLotsCount);
  114 |   console.log('Residential Plot successfully placed near a road and parcel created.');
  115 | });
  116 | 
```