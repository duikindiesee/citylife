# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: first_plot.spec.ts >> Builds a road, waits for a house to spawn, and explores in First Person
- Location: e2e\first_plot.spec.ts:3:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('button').filter({ hasText: 'Exit Builder' })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('button').filter({ hasText: 'Exit Builder' })

```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | 
  3  | test('Builds a road, waits for a house to spawn, and explores in First Person', async ({ page }) => {
  4  |   test.setTimeout(300000); // Allow time for loading and simulation
  5  | 
  6  |   console.log('Navigating to CityLife...');
  7  |   await page.goto('/');
  8  | 
  9  |   // Wait for the simulation to be ready by checking if the canvas is rendered
  10 |   await page.waitForSelector('canvas', { timeout: 30000 });
  11 |   await page.waitForTimeout(5000); // Give the renderer time to boot up and initialize
  12 | 
  13 |   // Ensure we are in Builder Mode
  14 |   // If "City Builder" button is visible, we are NOT in builder mode. Click it.
  15 |   const cityBuilderBtn = page.locator('button', { hasText: 'City Builder' });
  16 |   if (await cityBuilderBtn.isVisible()) {
  17 |     await cityBuilderBtn.click({ force: true });
  18 |     await page.waitForTimeout(1000);
  19 |   }
  20 | 
  21 |   // Verify HUDs are hidden (Phase 7 UX Overhaul)
  22 |   await expect(page.locator('aside.hud')).toBeHidden();
  23 |   await expect(page.locator('.rally-social-read')).toBeHidden();
  24 |   
  25 |   // Ensure we are in "Plot Roads" mode
  26 |   const plotRoadsBtn = page.locator('button', { hasText: 'Roads' });
  27 |   if (await plotRoadsBtn.isVisible()) {
  28 |     const className = await plotRoadsBtn.getAttribute('class');
  29 |     if (!className?.includes('on')) {
  30 |       await plotRoadsBtn.click({ force: true });
  31 |       await page.waitForTimeout(500);
  32 |     }
  33 |   }
  34 | 
  35 |   console.log('Dragging 4 road segments to create a neighborhood plot...');
  36 |   
  37 |   // Top segment (Right)
  38 |   await page.mouse.move(500, 300);
  39 |   await page.mouse.down();
  40 |   await page.mouse.move(700, 300, { steps: 10 });
  41 |   await page.mouse.up();
  42 |   await page.waitForTimeout(500);
  43 | 
  44 |   // Right segment (Down)
  45 |   await page.mouse.move(700, 300);
  46 |   await page.mouse.down();
  47 |   await page.mouse.move(700, 500, { steps: 10 });
  48 |   await page.mouse.up();
  49 |   await page.waitForTimeout(500);
  50 | 
  51 |   // Bottom segment (Left)
  52 |   await page.mouse.move(700, 500);
  53 |   await page.mouse.down();
  54 |   await page.mouse.move(500, 500, { steps: 10 });
  55 |   await page.mouse.up();
  56 |   await page.waitForTimeout(500);
  57 | 
  58 |   // Left segment (Up)
  59 |   await page.mouse.move(500, 500);
  60 |   await page.mouse.down();
  61 |   await page.mouse.move(500, 300, { steps: 10 });
  62 |   await page.mouse.up();
  63 |   await page.waitForTimeout(500);
  64 | 
  65 |   console.log('Road network built. Waiting 10 seconds for neighborhood simulation to spawn a plot...');
  66 |   await page.waitForTimeout(10000);
  67 | 
  68 |   console.log('Exiting builder mode to enter First Person at ground level...');
  69 |   const exitBuilderBtn = page.locator('button', { hasText: 'Exit Builder' });
> 70 |   await expect(exitBuilderBtn).toBeVisible({ timeout: 5000 });
     |                                ^ Error: expect(locator).toBeVisible() failed
  71 |   await exitBuilderBtn.click({ force: true });
  72 |   
  73 |   // Wait for transition to FP camera
  74 |   await page.waitForTimeout(2000);
  75 | 
  76 |   console.log('Locking pointer and walking...');
  77 |   // Click on the canvas to lock pointer
  78 |   await page.click('canvas', { force: true, position: { x: 640, y: 360 } });
  79 |   await page.waitForTimeout(500);
  80 | 
  81 |   // Walk forward for 5 seconds to approach any spawned elements/roads
  82 |   await page.keyboard.down('w');
  83 |   await page.waitForTimeout(5000);
  84 |   await page.keyboard.up('w');
  85 |   
  86 |   // Turn slightly to look around
  87 |   await page.mouse.move(640, 360); // Centered
  88 |   await page.mouse.move(700, 360, { steps: 20 }); // Pan right
  89 |   await page.waitForTimeout(1000);
  90 |   await page.mouse.move(580, 360, { steps: 20 }); // Pan left
  91 |   await page.waitForTimeout(2000);
  92 |   
  93 |   console.log('E2E Test completed successfully.');
  94 | });
  95 | 
```