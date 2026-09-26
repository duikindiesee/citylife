import { test, expect } from "@playwright/test";
import { starterWorldFixture } from "./starterWorldFixture";

for (const viewport of [{width:1280,height:720},{width:390,height:844}]) {
test(`player builds the server plot, confirms save, and reloads at width ${viewport.width}`, async ({page}) => {
  test.setTimeout(120000);
  await page.setViewportSize(viewport);
  const fixture = await starterWorldFixture();
  const manifest = JSON.parse(fixture).manifest;
  const plot = manifest.plots.find((p:{plotId:string})=>p.plotId === "wood1_lot_1");
  let context = {plotId:plot.plotId,frameId:plot.frameId,layoutRevision:manifest.layoutRevision,
    geometry:plot.geometry,script:null as string|null,completed:false};
  let posts=0, reject=true;
  const submitted:unknown[]=[];
  await page.route("**/worlds/seed-4242/starter-catalogue",route=>route.fulfill({status:200,contentType:"application/json",body:fixture}));
  await page.route("**/players/me/home/build",async route=>{
    if(route.request().method()==="POST") {
      posts++;const body=route.request().postDataJSON();submitted.push(body);
      if(reject) return route.fulfill({status:422,contentType:"application/json",body:"{}"});
      context={...context,script:body.script,completed:true};
    }
    return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(context)});
  });
  await page.addInitScript(()=>sessionStorage.setItem("citylife.session.v5",JSON.stringify({
    token:"opaque.player-builder.token",expiresAt:Date.now()+3600000,
    operator:{id:"Builder Tester",userId:"builder-test",roles:["CITYLIFE_PLAYER"],scopes:[]},
  })));
  await page.goto("/builder.html?mode=player-home&lotId=foreign-plot&w=24&d=24&citizenId=another-user&bp=invalid");
  const accept=page.locator('[data-build-action="accept"]');
  await expect(accept).toBeVisible();
  await expect(page.locator('[data-build-action="door-cycle"]')).toBeDisabled();
  const script=await page.locator('[data-build-area="script"]').inputValue();
  expect(script).toContain(`house{w:${plot.geometry.houseZone.width} d:${plot.geometry.houseZone.depth}`);
  await accept.click();
  await expect(page.getByRole("alert")).toContainText("indoor room");
  await expect(page.locator('[data-build-area="saved"]')).toHaveCount(0);
  reject=false;
  await accept.click();
  await expect(page.locator('[data-build-area="saved"]')).toContainText("House saved and confirmed");
  await expect(accept).toBeDisabled();
  expect(posts).toBe(2);
  expect(submitted[0]).toEqual({plotId:plot.plotId,layoutRevision:manifest.layoutRevision,script});
  expect(submitted[1]).toEqual(submitted[0]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({path:`test-results/player-house-builder-saved-${viewport.width}.png`,fullPage:true});
  await page.reload();
  await expect(page.getByRole("heading",{name:"Your house is saved"})).toBeVisible();
  await expect(page.locator('[data-build-action="accept"]')).toHaveCount(0);
  expect(posts).toBe(2);
});
}

test("player builder denies a signed-out visit instead of loading URL-supplied land",async({page})=>{
  let requests=0;
  await page.route("**/kooker/**",route=>{requests++;return route.abort();});
  await page.goto("/builder.html?mode=player-home&lotId=foreign-plot");
  await expect(page.getByRole("alert")).toContainText("Sign in");
  await expect(page.locator('[data-build-action="accept"]')).toHaveCount(0);
  expect(requests).toBe(0);
});
