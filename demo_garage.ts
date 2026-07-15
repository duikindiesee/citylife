import { chromium } from "playwright";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    recordVideo: {
      dir: "videos/",
      size: { width: 1280, height: 720 },
    },
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();

  console.log("Navigating to CityLife...");
  await page.goto("http://127.0.0.1:5188/");

  // Wait for the game to load
  await page.waitForSelector("canvas", { timeout: 15000 });
  await page.waitForTimeout(3000); // give it a few seconds to load assets

  console.log("Locking pointer and walking...");
  // Click on the canvas to request pointer lock
  await page.click("canvas");
  await page.waitForTimeout(500);

  console.log("Walking towards the house...");
  // Press 'W' to walk forward
  await page.keyboard.down("w");

  // Walk for 5 seconds
  await page.waitForTimeout(5000);

  // Stop walking
  await page.keyboard.up("w");

  // Look around slightly?
  await page.mouse.move(640, 360);
  await page.mouse.move(700, 360, { steps: 10 });

  // Wait to capture the door opening
  await page.waitForTimeout(3000);

  await context.close();
  await browser.close();

  console.log("Demo recorded successfully in videos/ directory.");
})();
