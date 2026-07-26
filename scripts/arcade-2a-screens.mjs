// ARCADE.2A — capture desktop + narrow-viewport screenshots of the flag-gated Gamehouse venue and the
// isolated 3D cabinet inspection, against a locally-served DEV build using the ?skipauth=1 null-operator
// bypass (the only local, non-production state that opens the gate). No production flag is ever enabled.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.ARCADE_BASE ?? "http://127.0.0.1:5630";
const OUT = "evidence/arcade-2a";
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "narrow", width: 390, height: 844 },
];

const browser = await chromium.launch({
  args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
});

let failed = false;
for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") console.log(`[${vp.name} console.error] ${m.text()}`);
  });
  try {
    await page.goto(`${BASE}/?skipauth=1`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    // Wait for the flag-gated Gamehouse entry affordance to appear (proves the gate opened).
    await page.waitForSelector('[data-build-action="open-gamehouse"]', {
      timeout: 90000,
    });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/${vp.name}-01-world-affordance.png` });

    // Enter the venue. Invoke the button's own click handler to bypass any overlapping bottom-right
    // journey affordances (showroom/home) that share the corner in the flag-everything DEV bypass.
    await page.$eval('[data-build-action="open-gamehouse"]', (el) => el.click());
    await page.waitForSelector('[data-testid="gamehouse-overlay"]', {
      timeout: 15000,
    });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/${vp.name}-02-venue.png` });

    // Interact with the cabinet → open the isolated 3D inspection.
    await page.click('[data-build-action="gamehouse-inspect-cabinet"]');
    await page.waitForSelector('[data-testid="cabinet-inspect-modal"]', {
      timeout: 15000,
    });
    await page.waitForTimeout(2500); // let the 3D viewer settle
    await page.screenshot({ path: `${OUT}/${vp.name}-03-cabinet-inspect.png` });

    // Close it cleanly back to the venue.
    await page.click('[data-build-action="inspect-close"]');
    await page.waitForSelector('[data-testid="cabinet-inspect-modal"]', {
      state: "detached",
      timeout: 15000,
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/${vp.name}-04-closed-back-to-venue.png` });
    console.log(`[${vp.name}] OK`);
  } catch (e) {
    failed = true;
    console.log(`[${vp.name}] FAILED: ${e.message}`);
    await page.screenshot({ path: `${OUT}/${vp.name}-ERROR.png` }).catch(() => {});
  } finally {
    await context.close();
  }
}

await browser.close();
process.exit(failed ? 1 : 0);
