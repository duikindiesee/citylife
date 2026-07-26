import { test, expect } from "@playwright/test";

// Spec 122 — the town bus. Asserts on the ACTUAL scene: when the runtime has a bus route
// (>= 2 road-connected hoods, true at boot for the live seed), the bus layer mounts under
// the 'bus' group with real geometry (the coach + stop markers), proving setBusRoute's data
// reaches the render.

test("R3F bus: the town coach renders when a route exists", async ({
  page,
}) => {
  test.setTimeout(120000);

  await page.goto("/?skipauth=1");
  await page.waitForSelector("canvas", { timeout: 30000 });
  await page.waitForTimeout(5000);

  await page.waitForFunction(
    () => !!(window as any).__r3fScene && !!(window as any).__colony,
    undefined,
    { timeout: 15000 },
  );

  const hasRoute = await page.evaluate(
    () => !!(window as any).__colony?.busRoute,
  );
  console.log(`runtime has bus route: ${hasRoute}`);

  // The bus group mounts at boot stage 1.
  await page.waitForFunction(
    () => {
      let found = false;
      (window as any).__r3fScene?.traverse((o: any) => {
        if (o.name === "bus") found = true;
      });
      return found;
    },
    undefined,
    { timeout: 30000 },
  );

  if (hasRoute) {
    // The bus layer builds inside the frame loop once it sees the route — wait for meshes.
    await page.waitForFunction(
      () => {
        let meshes = 0;
        (window as any).__r3fScene?.traverse((o: any) => {
          if (o.name === "bus")
            o.traverse((c: any) => {
              if (c.isMesh) meshes++;
            });
        });
        return meshes > 0;
      },
      undefined,
      { timeout: 10000 },
    );

    const meshes = await page.evaluate(() => {
      let m = 0;
      (window as any).__r3fScene?.traverse((o: any) => {
        if (o.name === "bus")
          o.traverse((c: any) => {
            if (c.isMesh) m++;
          });
      });
      return m;
    });
    console.log(`bus layer meshes: ${meshes}`);
    expect(meshes).toBeGreaterThan(0);
  } else {
    // No route (isolated hoods) — the bus group renders empty, which is correct.
    console.log("no route at boot; bus group correctly empty");
  }
});

test("R3F bus: buses move continuously along authoritative road routes at frame cadence", async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);

  await page.goto("/?skipauth=1");
  await page.waitForSelector("canvas", { timeout: 30000 });
  await page.waitForFunction(
    () => !!(window as any).__colony?.busPoses,
    undefined,
    { timeout: 30000 },
  );

  await page.evaluate(() => {
    (window as any).__colony.debugSetSolTimeOfDay(10, 0);
  });

  const getPoses = () =>
    page.evaluate(() =>
      ((window as any).__colony.busPoses() as any[]).map((p) => ({
        x: p.x,
        y: p.y,
        moving: p.moving,
      })),
    );

  const posesBefore = await getPoses();
  await page.waitForTimeout(500);
  const posesAfter = await getPoses();

  expect(posesBefore.length).toBeGreaterThan(0);
  let moved = false;
  for (let i = 0; i < posesBefore.length; i++) {
    if (posesBefore[i].moving || posesAfter[i].moving) {
      const dist = Math.hypot(
        posesAfter[i].x - posesBefore[i].x,
        posesAfter[i].y - posesBefore[i].y,
      );
      if (dist > 0) moved = true;
    }
  }
  expect(moved).toBe(true);

  await page.screenshot({
    path: testInfo.outputPath("continuous-bus-motion.png"),
  });
});
