import { test, expect } from "@playwright/test";
import { starterWorldFixture } from "./starterWorldFixture";

test("unpublished world blocks runtime and retry loads canonical inventory", async ({ page }) => {
  test.setTimeout(150_000);
  const fixture = await starterWorldFixture();
  let published = false;
  await page.route("**/kooker/**", route => route.fulfill({status:200,contentType:"application/json",body:"{}"}));
  await page.route("**/worlds/seed-4242/starter-catalogue", route => route.fulfill({
    status:published ? 200 : 404,contentType:"application/json",body:published ? fixture : "{}",
  }));
  await page.addInitScript(() => sessionStorage.setItem("citylife.session.v5", JSON.stringify({
    token:"opaque.catalogue-test.token",expiresAt:Date.now()+3600000,
    operator:{id:"Catalogue Tester",userId:"catalogue-test",roles:["ADMIN"],scopes:[]},
  })));
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("not been published");
  await expect(page.locator("canvas")).toHaveCount(0);
  expect(await page.evaluate(() => Boolean((window as any).__colony))).toBe(false);
  await page.screenshot({path:"test-results/starter-world-unpublished.png"});
  published = true;
  await page.getByRole("button",{name:"Retry",exact:true}).click();
  await expect(page.locator('button[title="Sign out of CityLife"]')).toBeVisible({timeout:90000});
  const inventory = await page.evaluate(() => {
    const runtime = (window as any).__colony;
    return {protected:runtime.lots().filter((lot:any)=>runtime.isPlayerParcel(lot.id)).length,
      frames:runtime.worldLayoutDocument().frames.length};
  });
  expect(inventory).toEqual({protected:10,frames:19});
  // Screenshot warm-up only; the assertions above prove the boot contract, not rendered gameplay.
  await page.waitForTimeout(5000);
  await page.screenshot({path:"test-results/starter-world-published.png"});
});
