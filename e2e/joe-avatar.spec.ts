import { expect, test } from "@playwright/test";

test("Joe renders as an animated GLB while the crowd remains instanced", async ({
  page,
}) => {
  const [assetResponse] = await Promise.all([
    page.waitForResponse((response) =>
      response.url().endsWith("/assets/citylife/avatars/joe-crab.glb"),
    ),
    page.goto("/?skipauth=1"),
  ]);

  expect(assetResponse.status()).toBe(200);

  await page.waitForFunction(() => Boolean((window as any).__colony?.renderer?.scene));
  await page.evaluate(() => {
    const colony = (window as any).__colony;
    const joe = colony.citizens.byId("citizen_joe");
    colony.setPaused(true);
    joe.spd = 0;
    colony.citizens.setTarget("citizen_joe", {
      x: joe.pos.x,
      y: joe.pos.y,
    });
    // Let the renderer observe the final walking position, then a stable position.
    // The presentation-only action selector switches to Joe_idle on that second frame.
    colony.renderer.frame();
    colony.renderer.frame();
  });

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const colony = (window as any).__colony;
        const scene = colony.renderer.scene;
        const joe = scene.getObjectByName("named-avatar:citizen_joe");
        return {
          loaded: joe?.userData.loaded ?? false,
          currentAction: joe?.userData.currentAction ?? null,
          visible: joe?.visible ?? false,
          childCount: joe?.children.length ?? 0,
        };
      }),
    )
    .toEqual({
      loaded: true,
      currentAction: "Joe_idle",
      visible: true,
      childCount: 1,
    });

  const crowd = await page.evaluate(() => {
    const colony = (window as any).__colony;
    const scene = colony.renderer.scene;
    const avatars = colony.citizens.avatars();
    const crowdAvatars = avatars.filter((avatar: any) => !avatar.glbUrl);
    return {
      namedJoeInCrowd: crowdAvatars.some(
        (avatar: any) => avatar.id === "citizen_joe",
      ),
      humanInstanceCount: scene.getObjectByName("citizen-avatar-human-bodies")
        .count,
      expectedHumanInstances: crowdAvatars.filter(
        (avatar: any) =>
          avatar.kind !== "crab" && avatar.avatarKind !== "crab",
      ).length,
      crabInstanceCount: scene.getObjectByName("citizen-avatar-instanced-crabs")
        .count,
      expectedCrabInstances: crowdAvatars.filter(
        (avatar: any) =>
          avatar.kind === "crab" || avatar.avatarKind === "crab",
      ).length,
    };
  });

  expect(crowd.namedJoeInCrowd).toBe(false);
  expect(crowd.humanInstanceCount).toBe(crowd.expectedHumanInstances);
  expect(crowd.humanInstanceCount).toBeGreaterThan(0);
  expect(crowd.crabInstanceCount).toBe(crowd.expectedCrabInstances);
});
