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
            "Pillar_Stage_1",
            "Pillar_Stage_2",
            "Pillar_Stage_3",
            "Pillar_Retune_Ring",
            "Pillar_Crown_Core",
            "IronworkCrownLight",
            "IronworkUndercroftLight",
          ].includes(node.name)
        ) {
          found[node.name] = {
            visible: node.visible,
            positionCount: node.geometry?.attributes?.position?.count ?? 0,
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
      "Pillar_Retune_Ring",
      "Pillar_Crown_Core",
    ]) {
      expect(daylight.found[name]?.visible, name).toBe(true);
    }
    expect(daylight.found.IronworkHikePath?.positionCount).toBeGreaterThan(50);
    expect(daylight.found.IronworkCrownLight).toBeTruthy();
    expect(daylight.found.IronworkUndercroftLight).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath("ironwork-pillar-day.jpg") });

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
    await page.screenshot({ path: testInfo.outputPath("ironwork-pillar-midnight.jpg") });
  });
});
