import { expect, test } from "@playwright/test";

test("tarentaal adults and chicks load as animated GLB flock members", async ({ page }) => {
  const adultResponse = page.waitForResponse((response) => response.url().endsWith("/assets/citylife/wildlife/tarentaal-adult.glb"));
  const chickResponse = page.waitForResponse((response) => response.url().endsWith("/assets/citylife/wildlife/tarentaal-chick.glb"));
  await page.goto("/?skipauth=1");
  expect((await adultResponse).status()).toBe(200);
  expect((await chickResponse).status()).toBe(200);

  await expect.poll(
    () => page.evaluate(() => {
      const colony = (window as any).__colony;
      const scene = colony?.renderer?.scene;
      const flock = scene?.getObjectByName("tarentaal-glb-flock");
      const birds = flock?.children ?? [];
      return {
        loaded: flock?.userData.loaded ?? false,
        count: flock?.userData.count ?? 0,
        adults: birds.filter((bird: any) => bird.name.startsWith("tarentaal-glb:") && bird.userData.currentAction?.startsWith("Tarentaal_")).length,
        chicks: birds.filter((bird: any) => bird.userData.currentAction?.startsWith("TarentaalChick_")).length,
        allAnimated: birds.length > 0 && birds.every((bird: any) => /_(walk|chase)$/.test(bird.userData.currentAction ?? "")),
        behaviorMismatches: birds.filter((bird: any) => {
          const expected = bird.userData.behavior === "chase" ? "_chase" : "_walk";
          return !bird.userData.currentAction?.endsWith(expected);
        }).length,
        primitiveAdults: scene?.getObjectByName("tarentaal-primitive-adults")?.count ?? -1,
        primitiveChicks: scene?.getObjectByName("tarentaal-primitive-chicks")?.count ?? -1,
        adultClips: flock?.userData.adultClips ?? [],
        chickClips: flock?.userData.chickClips ?? [],
      };
    }),
    { timeout: 30_000 },
  ).toEqual({
    loaded: true,
    count: 10,
    adults: 4,
    chicks: 6,
    allAnimated: true,
    behaviorMismatches: 0,
    primitiveAdults: 0,
    primitiveChicks: 0,
    adultClips: ["Tarentaal_idle", "Tarentaal_walk", "Tarentaal_chase"],
    chickClips: ["TarentaalChick_idle", "TarentaalChick_walk", "TarentaalChick_chase"],
  });
});

test("tarentaal primitive fallback remains when a GLB fails", async ({ page }) => {
  await page.route("**/assets/citylife/wildlife/tarentaal-chick.glb", (route) => route.abort());
  await page.goto("/?skipauth=1");

  await expect.poll(
    () => page.evaluate(() => {
      const scene = (window as any).__colony?.renderer?.scene;
      const flock = scene?.getObjectByName("tarentaal-glb-flock");
      return {
        failed: Boolean(flock?.userData.error),
        loaded: flock?.userData.loaded ?? false,
        primitiveAdults: scene?.getObjectByName("tarentaal-primitive-adults")?.count ?? -1,
        primitiveChicks: scene?.getObjectByName("tarentaal-primitive-chicks")?.count ?? -1,
      };
    }),
    { timeout: 30_000 },
  ).toEqual({ failed: true, loaded: false, primitiveAdults: 4, primitiveChicks: 6 });
});
