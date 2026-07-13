import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    __colony: any;
    __r3fScene?: any;
  }
}

async function bootPillar(page: import("@playwright/test").Page, clock: string) {
  await page.goto(
    `/?skipauth=1&pillarStage=3&clock=${encodeURIComponent(clock)}&pillarView=1`,
  );
  await page.waitForSelector("canvas", { timeout: 30_000 });
  await page.waitForFunction(
    () => !!window.__colony && !!window.__r3fScene,
    undefined,
    { timeout: 30_000 },
  );
  await page.waitForFunction(
    () => {
      let glb = false;
      let trail = false;
      window.__r3fScene?.traverse((node: any) => {
        if (node.name === "IronworkPillarGLB") glb = true;
        if (node.name === "IronworkHikePath") trail = true;
      });
      return glb && trail;
    },
    undefined,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(800);
}

async function captureAndSample(
  page: import("@playwright/test").Page,
  path: string,
) {
  const capture = await page.screenshot({ path, type: "jpeg", quality: 88 });
  const sourceUrl = `data:image/jpeg;base64,${capture.toString("base64")}`;
  return page.evaluate(async (url) => {
    const source = await createImageBitmap(await (await fetch(url)).blob());
    const probe = document.createElement("canvas");
    probe.width = 64;
    probe.height = 64;
    const context = probe.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("2D canvas probe unavailable");
    context.drawImage(
      source,
      source.width * 0.25,
      source.height * 0.2,
      source.width * 0.5,
      source.height * 0.75,
      0,
      0,
      probe.width,
      probe.height,
    );
    source.close();
    const pixels = context.getImageData(0, 0, probe.width, probe.height).data;
    let min = 255;
    let max = 0;
    let sum = 0;
    let sumSquares = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const luminance =
        0.2126 * pixels[i]! + 0.7152 * pixels[i + 1]! + 0.0722 * pixels[i + 2]!;
      min = Math.min(min, luminance);
      max = Math.max(max, luminance);
      sum += luminance;
      sumSquares += luminance * luminance;
    }
    const count = pixels.length / 4;
    const mean = sum / count;
    return {
      range: max - min,
      deviation: Math.sqrt(sumSquares / count - mean * mean),
    };
  }, sourceUrl);
}

test.describe("spec 144 Ironwork Pillar live R3F landmark", () => {
  test("renders the completed mountain monolith and hike in daylight and at midnight", async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    await bootPillar(page, "12:00");

    const daylight = await page.evaluate(() => {
      const found: Record<string, any> = {};
      window.__r3fScene?.traverse((node: any) => {
        if (
          [
            "IronworkPillar",
            "IronworkPillarGLB",
            "IronworkHikePath",
            "IronworkHikeShoulder",
            "IronworkTrailTreadStones",
            "IronworkTrailRuneSlits",
            "IronworkSummitVeil",
            "Pillar_Stage_1",
            "Pillar_Stage_2",
            "Pillar_Stage_3",
            "Pillar_Summit_Apron",
            "Pillar_Sentinel_01",
            "Pillar_Retune_Ring",
            "Pillar_Crown_Halo",
            "Pillar_Crown_Core",
            "IronworkCrownLight",
            "IronworkUndercroftLight",
            "IronworkFacetLight",
          ].includes(node.name)
        ) {
          found[node.name] = {
            visible: node.visible,
            positionCount: node.geometry?.attributes?.position?.count ?? 0,
            instanceCount: node.count ?? 0,
            intensity: node.intensity ?? 0,
          };
        }
      });
      const state = window.__colony.sim.state;
      const pillar = state.structures.find(
        (structure: any) => structure.kind === "ironworkPillar",
      );
      return {
        stage: state.pillarStage,
        hour: state.clock.hour,
        pillar,
        found,
      };
    });
    expect(daylight.stage).toBe(3);
    expect(daylight.hour).toBe(12);
    expect(daylight.pillar).toBeTruthy();
    for (const name of [
      "IronworkPillar",
      "IronworkPillarGLB",
      "Pillar_Stage_1",
      "Pillar_Stage_2",
      "Pillar_Stage_3",
      "Pillar_Summit_Apron",
      "Pillar_Sentinel_01",
      "Pillar_Retune_Ring",
      "Pillar_Crown_Halo",
      "Pillar_Crown_Core",
    ]) {
      expect(daylight.found[name]?.visible, name).toBe(true);
    }
    expect(daylight.found.IronworkHikePath?.positionCount).toBeGreaterThan(50);
    expect(daylight.found.IronworkHikeShoulder?.positionCount).toBeGreaterThan(50);
    expect(daylight.found.IronworkTrailTreadStones?.instanceCount).toBeGreaterThan(5);
    expect(daylight.found.IronworkTrailRuneSlits?.instanceCount).toBeGreaterThan(8);
    expect(daylight.found.IronworkSummitVeil).toBeTruthy();
    expect(daylight.found.IronworkCrownLight).toBeTruthy();
    expect(daylight.found.IronworkUndercroftLight).toBeTruthy();
    expect(daylight.found.IronworkFacetLight?.intensity).toBeGreaterThan(20);
    const daylightPixels = await captureAndSample(
      page,
      testInfo.outputPath("ironwork-pillar-day.jpg"),
    );
    expect(daylightPixels.range).toBeGreaterThan(30);
    expect(daylightPixels.deviation).toBeGreaterThan(5);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const mobileDay = await page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      return canvas
        ? { width: canvas.clientWidth, height: canvas.clientHeight }
        : null;
    });
    expect(mobileDay).toEqual({ width: 390, height: 844 });
    const mobileDayPixels = await captureAndSample(
      page,
      testInfo.outputPath("ironwork-pillar-day-mobile.jpg"),
    );
    expect(mobileDayPixels.range).toBeGreaterThan(30);
    expect(mobileDayPixels.deviation).toBeGreaterThan(5);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(300);

    await page.evaluate(() => {
      window.__colony.debugSetClock(0, 30);
      window.__colony.sim.state.clock.daylight = 0;
    });
    await page.waitForTimeout(900);
    const midnight = await page.evaluate(() => {
      const result = {
        hour: window.__colony.sim.state.clock.hour,
        minute: window.__colony.sim.state.clock.minute,
        ringEmissive: 0,
        crownIntensity: 0,
        undercroftIntensity: 0,
        irisLeftX: 0,
        irisRightX: 0,
      };
      window.__r3fScene?.traverse((node: any) => {
        if (node.name === "Pillar_Retune_Ring_Hoop")
          result.ringEmissive = node.material?.emissiveIntensity ?? 0;
        if (node.name === "IronworkCrownLight") result.crownIntensity = node.intensity;
        if (node.name === "IronworkUndercroftLight")
          result.undercroftIntensity = node.intensity;
        if (node.name === "Pillar_Iris_Left") result.irisLeftX = node.position.x;
        if (node.name === "Pillar_Iris_Right") result.irisRightX = node.position.x;
      });
      return result;
    });
    expect(midnight).toMatchObject({ hour: 0, minute: 30 });
    expect(midnight.ringEmissive).toBeGreaterThan(1);
    expect(midnight.crownIntensity).toBeGreaterThan(50);
    expect(midnight.undercroftIntensity).toBeGreaterThan(30);
    expect(midnight.irisLeftX).toBeLessThan(-2);
    expect(midnight.irisRightX).toBeGreaterThan(2);
    const midnightPixels = await captureAndSample(
      page,
      testInfo.outputPath("ironwork-pillar-midnight.jpg"),
    );
    expect(midnightPixels.range).toBeGreaterThan(20);
    expect(midnightPixels.deviation).toBeGreaterThan(3);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const mobileMidnightPixels = await captureAndSample(
      page,
      testInfo.outputPath("ironwork-pillar-midnight-mobile.jpg"),
    );
    expect(mobileMidnightPixels.range).toBeGreaterThan(20);
    expect(mobileMidnightPixels.deviation).toBeGreaterThan(3);
  });
});
