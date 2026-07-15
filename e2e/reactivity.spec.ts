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

  // Find a flat, dry, buildable area (same scan the zoning spec uses).
  const buildableCenter = await page.evaluate(() => {
    const t = (window as any).__colony?.sim?.state?.terrain;
    if (!t) return null;
    const cellOkLocal = (gx: number, gy: number) => {
      if (gx < 0 || gy < 0 || gx >= t.size || gy >= t.size) return false;
      const idx = gy * t.size + gx;
      if (t.buildable?.[idx] === 0) return false;
      const b = t.biome?.[idx];
      return b !== 4 && b !== 5 && b !== 6 && b !== 7;
    };
    for (let y = 100; y < t.size - 100; y += 10) {
      for (let x = 100; x < t.size - 100; x += 10) {
        let ok = true;
        for (let dy = -15; dy <= 15 && ok; dy++) {
          for (let dx = -15; dx <= 15; dx++) {
            if (!cellOkLocal(x + dx, y + dy)) {
              ok = false;
              break;
            }
          }
        }
        if (ok) return { x, y };
      }
    }
    return { x: t.landing.x, y: t.landing.y };
  });
  expect(buildableCenter).not.toBeNull();
  const bx = buildableCenter!.x;
  const by = buildableCenter!.y;
  console.log(`Buildable center: ${bx},${by}`);

  // Street frontage for the plot, then the plot itself — all through the public runtime api.
  await page.evaluate(
    ({ rx, ry }) => {
      const cells = [] as { x: number; y: number }[];
      for (let x = rx - 5; x <= rx + 5; x++) cells.push({ x, y: ry });
      (window as any).useRoadNetwork.getState().plotRoad(cells, "street");
    },
    { rx: bx, ry: by },
  );

  // A COMMERCIAL plot: auto-settlers only claim residential lots, so the unbuilt overlay
  // stays deterministically visible for the assertion window.
  const placed = await page.evaluate(
    ({ px, py }) => {
      return (window as any).__colony.placeZonedPlot(
        px,
        py + 1,
        "n",
        "BIG",
        "commercial",
      );
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
