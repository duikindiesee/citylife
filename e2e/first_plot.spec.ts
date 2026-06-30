import { test, expect } from '@playwright/test';

test('Builds a road, waits for a house to spawn, and explores in First Person', async ({ page }) => {
  test.setTimeout(300000); // Allow time for loading and simulation

  console.log('Navigating to CityLife...');
  await page.goto('/');

  // Wait for the simulation to be ready by checking if the canvas is rendered
  await page.waitForSelector('canvas', { timeout: 30000 });
  await page.waitForTimeout(5000); // Give the renderer time to boot up and initialize

  // Ensure we are in Builder Mode
  // If "City Builder" button is visible, we are NOT in builder mode. Click it.
  const cityBuilderBtn = page.locator('button', { hasText: 'City Builder' });
  if (await cityBuilderBtn.isVisible()) {
    await cityBuilderBtn.click({ force: true });
    await page.waitForTimeout(1000);
  }

  // Verify HUDs are hidden (Phase 7 UX Overhaul)
  await expect(page.locator('aside.hud')).toBeHidden();
  await expect(page.locator('.rally-social-read')).toBeHidden();
  
  // Ensure we are in "Plot Roads" mode
  const plotRoadsBtn = page.locator('button', { hasText: 'Roads' });
  if (await plotRoadsBtn.isVisible()) {
    const className = await plotRoadsBtn.getAttribute('class');
    if (!className?.includes('on')) {
      await plotRoadsBtn.click({ force: true });
      await page.waitForTimeout(500);
    }
  }

  console.log('Dragging 4 road segments to create a neighborhood plot...');
  
  // Top segment (Right)
  await page.mouse.move(500, 300);
  await page.mouse.down();
  await page.mouse.move(700, 300, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(500);

  // Right segment (Down)
  await page.mouse.move(700, 300);
  await page.mouse.down();
  await page.mouse.move(700, 500, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(500);

  // Bottom segment (Left)
  await page.mouse.move(700, 500);
  await page.mouse.down();
  await page.mouse.move(500, 500, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(500);

  // Left segment (Up)
  await page.mouse.move(500, 500);
  await page.mouse.down();
  await page.mouse.move(500, 300, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(500);

  console.log('Road network built. Waiting 10 seconds for neighborhood simulation to spawn a plot...');
  await page.waitForTimeout(10000);

  console.log('Exiting builder mode to enter First Person at ground level...');
  const exitBuilderBtn = page.locator('button', { hasText: 'Exit Builder' });
  await expect(exitBuilderBtn).toBeVisible({ timeout: 5000 });
  await exitBuilderBtn.click({ force: true });
  
  // Wait for transition to FP camera
  await page.waitForTimeout(2000);

  console.log('Locking pointer and walking...');
  // Click on the canvas to lock pointer
  await page.click('canvas', { force: true, position: { x: 640, y: 360 } });
  await page.waitForTimeout(500);

  // Walk forward for 5 seconds to approach any spawned elements/roads
  await page.keyboard.down('w');
  await page.waitForTimeout(5000);
  await page.keyboard.up('w');
  
  // Turn slightly to look around
  await page.mouse.move(640, 360); // Centered
  await page.mouse.move(700, 360, { steps: 20 }); // Pan right
  await page.waitForTimeout(1000);
  await page.mouse.move(580, 360, { steps: 20 }); // Pan left
  await page.waitForTimeout(2000);
  
  console.log('E2E Test completed successfully.');
});
