import { test, expect } from "@playwright/test";

// QA hardening — the "dead memo" fix. Before the useSimSignal bridge, the R3F components never
// re-rendered when the mutable sim.state changed: placing a plot grew the lot list but the world
// stayed a still photo. This spec asserts on the ACTUAL three.js scene (window.__r3fScene probe),
// not on sim state: a zoned plot must appear in the render, and vanish again when demolished.

/** Count the zone-ground overlay meshes ZoneManager renders for unbuilt lots.
 *  Plain JS — this string is evaluated raw in the browser (no TS transpilation). */
const countZoneMeshes = `(function () {
  var n = 0;
  var scene = window.__r3fScene;
  if (!scene) return -1;
  scene.traverse(function (o) {
    if (typeof o.name === 'string' && o.name.indexOf('zone-ground-') === 0) n++;
  });
  return n;
})`;

test("R3F reactivity: placing and demolishing a plot updates the rendered scene", async ({
  page,
}) => {
  test.setTimeout(120000);

  console.log("Navigating to CityLife...");
  await page.goto("/?skipauth=1");
  await page.waitForSelector("canvas", { timeout: 30000 });
  await page.waitForTimeout(5000); // Give the renderer time to boot up and initialize

  // The scene probe and the runtime probe must both be live.
  await page.waitForFunction(
    () => !!(window as any).__r3fScene && !!(window as any).__colony,
    undefined,
    { timeout: 15000 },
  );

  // Spec 117 staged mount: the city layer (ZoneManager and friends) mounts at boot stage 1,
  // a few presented frames after the world. Wait for the stage-1 foliage mesh before
  // asserting on zone meshes so a slow machine cannot race the staged commit.
  await page.waitForFunction(
    () => {
      let found = false;
      (window as any).__r3fScene?.traverse((o: any) => {
        if (o.name === "foliage") found = true;
      });
      return found;
    },
    undefined,
    { timeout: 30000 },
  );

  const before = (await page.evaluate(`${countZoneMeshes}()`)) as number;
  expect(before).toBeGreaterThanOrEqual(0);
  console.log(`Zone overlay meshes before placement: ${before}`);

  // Find a validator-approved road stroke and adjacent plot. Before the road exists, the exact
  // plot survey may fail only for its missing frontage; every terrain/collision check must pass.
  const buildableCenter = await page.evaluate(() => {
    const rt = (window as any).__colony;
    const t = rt?.sim?.state?.terrain;
    if (!rt || !t) return null;
    const roadSet = rt.sim.state.roadSet as Set<string>;
    for (let y = 30; y < t.size - 30; y += 3) {
      for (let x = 30; x < t.size - 30; x += 3) {
        // A single logical frontage cell is sufficient for zoning and intentionally creates no
        // ribbon way. A multi-cell ribbon has a rendered shoulder beside the centre-line, which
        // the exact plot survey correctly treats as overlap.
        const road = [{ x, y }];
        if (road.some((cell) => roadSet.has(`${cell.x},${cell.y}`))) continue;
        const roadSurvey = rt.surveyRoadPlacement(road, "street");
        if (!roadSurvey.ok) continue;
        const plotSurvey = rt.surveyZonedPlot(
          x,
          y + 1,
          "n",
          "BIG",
          "commercial",
        );
        if (
          plotSurvey.failures.length > 0 &&
          plotSurvey.failures.every(
            (failure: any) => failure.code === "ROAD_CONNECTION_REQUIRED",
          )
        ) {
          return {
            x,
            y,
            road,
            roadRevision: roadSurvey.layoutRevision,
          };
        }
      }
    }
    return null;
  });
  expect(buildableCenter).not.toBeNull();
  const bx = buildableCenter!.x;
  const by = buildableCenter!.y;
  console.log(`Buildable center: ${bx},${by}`);

  // Street frontage for the plot, then the plot itself — all through the public runtime api.
  await page.evaluate(({ road, roadRevision }) => {
    const rt = (window as any).__colony;
    (window as any).useRoadNetwork
      .getState()
      .plotRoad(road, "street", rt.sim, roadRevision, rt);
  }, buildableCenter);

  // A COMMERCIAL plot: auto-settlers only claim residential lots, so the unbuilt overlay
  // stays deterministically visible for the assertion window.
  const placed = await page.evaluate(
    ({ px, py }) => {
      const rt = (window as any).__colony;
      const survey = rt.surveyZonedPlot(px, py + 1, "n", "BIG", "commercial");
      return rt.commitZonedPlot(
        px,
        py + 1,
        "n",
        "BIG",
        "commercial",
        survey.layoutRevision,
      ).ok;
    },
    { px: bx, py: by },
  );
  expect(placed).toBe(true);
  console.log(
    "Plot placed. Waiting for the overlay mesh to appear in the scene...",
  );

  // THE dead-memo assertion: the mutation must reach the rendered scene graph.
  await page.waitForFunction(`${countZoneMeshes}() > ${before}`, undefined, {
    timeout: 10000,
  });
  console.log("Overlay mesh appeared — sim mutation reached the render.");

  // And the reverse: demolish through the public api, the overlay must leave the scene.
  // A dynamic plot records x,y as its CENTER cell — demolish at exactly that.
  const demolished = await page.evaluate(() => {
    const lots = (window as any).__colony.sim.state.neighborhood.lots;
    const lot = lots[lots.length - 1];
    return (window as any).__colony.demolishPlot(lot.x, lot.y);
  });
  expect(demolished).toBe(true);

  await page.waitForFunction(`${countZoneMeshes}() <= ${before}`, undefined, {
    timeout: 10000,
  });
  console.log(
    "Overlay mesh removed — demolition reached the render. Reactivity verified.",
  );
});
