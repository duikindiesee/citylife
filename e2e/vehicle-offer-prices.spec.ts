import {test,expect} from "@playwright/test";
import {installStarterWorldFixture} from "./starterWorldFixture";

test("Gearbox retries unavailable prices and displays authority instead of the planned price",async({page},info)=>{
  test.setTimeout(150000);
  let unavailable=true,posts=0;
  await page.route("**/kooker/**",r=>r.fulfill({status:200,contentType:"application/json",body:"{}"}));
  await installStarterWorldFixture(page);
  await page.route("**/feature-flags/new-player-journey-v1",r=>r.fulfill({status:200,contentType:"application/json",body:'{"enabled":true}'}));
  await page.route("**/players/me/vehicle",r=>r.fulfill({status:200,contentType:"application/json",body:'{"owned":false}'}));
  await page.route("**/players/me/home",r=>r.fulfill({status:200,contentType:"application/json",body:'{"owned":false}'}));
  await page.route("**/players/me/vehicle/offers",r=>r.fulfill({status:unavailable?503:200,
    contentType:"application/json",body:JSON.stringify([{vehicleKey:"karoo-x19-targa",priceKco:1247,currency:"KCO"}])}));
  await page.route("**/players/me/vehicle/purchase",r=>{
    posts++;expect(r.request().postDataJSON()).toEqual({vehicleKey:"karoo-x19-targa"});
    return r.fulfill({status:422,body:"{}"});
  });
  await page.addInitScript(()=>sessionStorage.setItem("citylife.session.v5",JSON.stringify({
    token:"opaque.offer-fixture.token",expiresAt:Date.now()+3600000,
    operator:{id:"Offer fixture",userId:"offer-fixture",roles:["CITYLIFE_PLAYER"],scopes:[]},
  })));
  await page.goto("/");
  await expect(page.getByTestId("showroom-overlay")).toBeVisible({timeout:90000});
  await expect(page.getByTestId("showroom-card-price")).toHaveText("Price unavailable");
  await expect(page.getByTestId("showroom-acquire")).toHaveCount(0);expect(posts).toBe(0);
  unavailable=false;
  await page.getByTestId("showroom-retry-price").press("Enter");
  await expect(page.getByTestId("showroom-card-price")).toHaveText("Not currently offered");
  await expect(page.getByTestId("showroom-acquire")).toHaveCount(0);
  await page.locator('[data-build-action="showroom-next"]').press("Enter");
  await expect(page.getByTestId("showroom-card-name")).toContainText("GT-V8");
  await page.locator('[data-build-action="showroom-next"]').press("Enter");
  await expect(page.getByTestId("showroom-card-name")).toContainText("X19");
  await expect(page.getByTestId("showroom-card-price")).toHaveText("1,247 KCO");
  await expect(page.getByTestId("showroom-acquire")).toBeEnabled();
  await page.getByTestId("showroom-acquire").press("Enter");
  await expect(page.getByTestId("showroom-acquire")).toHaveAttribute("data-acquire-state","insufficient_funds");
  expect(posts).toBe(1);
  await page.screenshot({path:info.outputPath("authoritative-price.png")});
});
