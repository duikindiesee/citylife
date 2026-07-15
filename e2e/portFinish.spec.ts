import { test, expect } from "@playwright/test";

// Spec 131 — the port-finish layer: porters render from the economy, the rally nameplate
// layer mounts, the camera director is live, and the HUD snapshot button actually returns
// a PNG (capturePNG was a stub returning null).

test("R3F port-finish: porters, nameplate layer, snapshot PNG", async ({
  page,
}) => {
  test.setTimeout(120000);

  await page.goto("/?skipauth=1");
  await page.waitForSelector("canvas", { timeout: 30000 });
  await page.waitForFunction(
    () => !!(window as any).__r3fScene && !!(window as any).__colony,
    undefined,
    { timeout: 30000 },
  );
  await page.waitForFunction(
    () => {
      let f = false;
      (window as any).__r3fScene?.traverse((o: any) => {
        if (o.name === "porters") f = true;
      });
      return f;
    },
    undefined,
    { timeout: 60000 },
  );
  await page.waitForTimeout(2000);

  const probe = await page.evaluate(() => {
    const scene = (window as any).__r3fScene;
    const rt = (window as any).__colony;
    let piles = -1,
      cartsMesh = false,
      plates = false;
    scene.traverse((o: any) => {
      if (o.name === "porter-piles") piles = o.count;
      if (o.name === "porter-carts") cartsMesh = true;
      if (o.name === "rally-nameplates") plates = true;
    });
    const sheds = rt.sim.state.buildings.filter(
      (b: any) => b.artifact.kind === "porter",
    ).length;
    return {
      piles,
      cartsMesh,
      plates,
      sheds,
      materials: rt.sim.state.materials,
      food: rt.sim.state.food,
    };
  });
  console.log(`port-finish probe: ${JSON.stringify(probe)}`);

  // porter meshes mounted; when the seeded world has sheds + stock, piles must be drawn
  expect(probe.piles).toBeGreaterThanOrEqual(0);
  expect(probe.cartsMesh).toBe(true);
  expect(probe.plates).toBe(true);
  if (probe.sheds > 0 && (probe.materials >= 8 || probe.food >= 8)) {
    expect(probe.piles).toBeGreaterThan(0);
  }

  // the HUD snapshot button path — capturePNG used to return null
  const png = await page.evaluate(() => (window as any).__colony.snapshot());
  expect(typeof png).toBe("string");
  expect((png as string).startsWith("data:image/png")).toBe(true);
  console.log(`snapshot PNG length: ${(png as string).length}`);
});
