import { test, expect } from "@playwright/test";

// Spec 124 — the Road Rally course. Asserts on the ACTUAL scene: starting a race via the
// public runtime api builds the course under the 'race' group AND the player's racing car
// appears (R3FPlayerCar, which was dead before raceState was attached to sim.state), and
// exiting the race tears both down.

const countMeshes = (name: string) => `(function(){
  var n = 0;
  (window.__r3fScene||{traverse:function(){}}).traverse(function(o){
    if (o.name === '${name}') o.traverse(function(c){ if (c.isMesh) n++; });
  });
  return n;
})`;

test("R3F race: starting a race renders the course and the player car", async ({
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
  // City layer mounts at boot stage 1.
  await page.waitForFunction(
    () => {
      let found = false;
      (window as any).__r3fScene?.traverse((o: any) => {
        if (o.name === "race") found = true;
      });
      return found;
    },
    undefined,
    { timeout: 30000 },
  );

  // No race yet — the course group is empty.
  const before = (await page.evaluate(`${countMeshes("race")}()`)) as number;
  console.log(`race meshes before start: ${before}`);
  expect(before).toBe(0);

  // Start a race through the public runtime api.
  const started = await page.evaluate(() =>
    (window as any).__colony.startRace(),
  );
  console.log(`startRace returned: ${started}`);
  expect(started).toBe(true);

  // The course builds and the player car becomes visible (it always mounts, hidden, and
  // toggles visible per-frame from raceState — so it must flip visible when the race starts).
  await page.waitForFunction(`${countMeshes("race")}() > 0`, undefined, {
    timeout: 20000,
  });
  const carVisible = `(function(){ var v=false; (window.__r3fScene||{traverse:function(){}}).traverse(function(o){ if(o.name==='R3FPlayerCar') v=o.visible; }); return v; })`;
  await page.waitForFunction(`${carVisible}() === true`, undefined, {
    timeout: 20000,
  });
  const courseMeshes = (await page.evaluate(
    `${countMeshes("race")}()`,
  )) as number;
  console.log(`race course meshes: ${courseMeshes}, player car visible: true`);
  expect(courseMeshes).toBeGreaterThan(0);

  // Exit the race — the course tears down.
  await page.evaluate(() => (window as any).__colony.exitRace());
  await page.waitForFunction(`${countMeshes("race")}() === 0`, undefined, {
    timeout: 20000,
  });
  console.log("race course torn down on exit — race layer verified.");
});
