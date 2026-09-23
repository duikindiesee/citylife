import {test,expect} from "@playwright/test";
import {starterWorldFixture,installVehicleOffersFixture} from "./starterWorldFixture";

// Browser/UI contract proof with a stateful fixture authority. This is deliberately
// not a real ledger, grant or deployment receipt; service integration tests cover those.
test("insufficient X19 buyer re-enters, buys a plot, builds and returns home",async({page},info)=>{
  // Three world loads plus two showroom visits and screenshot capture on software WebGL.
  // Each individual arrival still has its own 90-second assertion budget.
  test.setTimeout(420000);
  const fixture=await starterWorldFixture(),manifest=JSON.parse(fixture).manifest;
  const plot=manifest.plots.find((p:{plotId:string})=>p.plotId==="wood1_lot_1");
  let balance=750,car=false,land=false,script:string|null=null;
  const vehicleRequests:{body:unknown;key:string|undefined}[]=[],plotRequests:unknown[]=[],buildRequests:unknown[]=[];
  const json=(body:unknown,status=200)=>({status,contentType:"application/json",body:JSON.stringify(body)});
  await page.route("**/kooker/**",route=>route.fulfill(json({})));
  await installVehicleOffersFixture(page);
  await page.route("**/worlds/seed-4242/starter-catalogue",route=>route.fulfill({status:200,contentType:"application/json",body:fixture}));
  await page.route("**/feature-flags/new-player-journey-v1",route=>route.fulfill(json({enabled:true})));
  await page.route("**/players/me/vehicle",route=>route.fulfill(json({owned:car,vehicleKey:car?"karoo-x19-targa":null})));
  await page.route("**/players/me/vehicle/purchase",route=>{
    vehicleRequests.push({body:route.request().postDataJSON(),key:route.request().headers()["idempotency-key"]});
    if(balance<950)return route.fulfill(json({},402));
    if(!car){balance-=950;car=true;}
    return route.fulfill(json({},201));
  });
  await page.route("**/players/me/home",route=>route.fulfill(json({owned:!!script,status:land?"OWNED":null,
    plotOwned:land,requiresBuild:land&&!script,plotId:land?plot.plotId:null,frameId:land?plot.frameId:null,
    neighbourhoodKey:plot.geometry.neighbourhoodKey,layoutRevision:manifest.layoutRevision,priceKco:350})));
  await page.route("**/players/me/home/available-plots",route=>route.fulfill(json(land?[]:[{...plot,priceKco:350}])));
  await page.route("**/players/me/home/purchase",route=>{
    plotRequests.push(route.request().postDataJSON());
    if(balance<350)return route.fulfill(json({},402));
    if(!land){balance-=350;land=true;}
    return route.fulfill(json({status:"PLOT_OWNED"},201));
  });
  await page.route("**/players/me/home/build",route=>{
    if(!land)return route.fulfill(json({},409));
    if(route.request().method()==="POST"){
      const body=route.request().postDataJSON();buildRequests.push(body);script=body.script;
    }
    return route.fulfill(json({plotId:plot.plotId,frameId:plot.frameId,layoutRevision:manifest.layoutRevision,
      geometry:plot.geometry,script,completed:!!script}));
  });
  await page.addInitScript(()=>sessionStorage.setItem("citylife.session.v5",JSON.stringify({
    token:"opaque.onboarding-fixture.token",expiresAt:Date.now()+3600000,
    operator:{id:"Onboarding fixture",userId:"onboarding-fixture",roles:["CITYLIFE_PLAYER"],scopes:[]},
  })));
  await page.goto("/");
  const showroom=page.getByTestId("showroom-overlay"),acquire=page.getByTestId("showroom-acquire");
  await expect(showroom).toBeVisible({timeout:90000});
  const selectX19=async()=>{
    await page.locator('[data-build-action="showroom-next"]').press("Enter");
    await expect(page.getByTestId("showroom-card-name")).toContainText("GT-V8");
    await page.locator('[data-build-action="showroom-next"]').press("Enter");
    await expect(page.getByTestId("showroom-card-name")).toContainText("X19");
  };
  await selectX19();
  await expect(acquire).toBeEnabled();
  await acquire.press("Enter");
  await expect(acquire).toHaveAttribute("data-acquire-state","insufficient_funds");
  expect(car).toBe(false);expect(balance).toBe(750);
  await page.screenshot({path:info.outputPath("insufficient-funds.png")});
  await page.locator('[data-build-action="showroom-exit"]').press("Enter");
  await expect(showroom).toHaveCount(0);
  await page.locator('[data-build-action="open-showroom"]').press("Enter");
  await expect(showroom).toBeVisible();
  await expect(acquire).toBeEnabled();
  await selectX19();
  // Fixture-only recovery: actual admin funding and starter grants need separate live receipts.
  balance=1300;
  await acquire.press("Enter");
  await expect(page.getByTestId(`home-price-${plot.plotId}`)).toContainText("350",{timeout:30000});
  expect(balance).toBe(350);expect(vehicleRequests).toHaveLength(2);
  expect(vehicleRequests[0]).toEqual(vehicleRequests[1]);
  expect(vehicleRequests[0].body).toEqual({vehicleKey:"karoo-x19-targa"});
  expect(vehicleRequests[0].key).toBeTruthy();
  await page.getByTestId(`home-choice-${plot.plotId}`).press("Enter");
  await page.getByTestId("home-purchase").press("Enter");
  await expect(page.getByTestId("home-build-house")).toBeVisible();
  expect(balance).toBe(0);expect(plotRequests).toEqual([{plotId:plot.plotId,
    neighbourhoodKey:plot.geometry.neighbourhoodKey,layoutRevision:manifest.layoutRevision}]);
  await page.screenshot({path:info.outputPath("paid-plot.png")});
  await page.getByTestId("home-build-house").click();
  await expect(page.locator('[data-build-action="accept"]')).toBeVisible();
  await page.locator('[data-build-action="accept"]').click();
  await expect(page.locator('[data-build-area="saved"]')).toContainText("House saved and confirmed");
  expect(buildRequests).toHaveLength(1);expect(balance).toBe(0);
  await page.screenshot({path:info.outputPath("house-saved.png"),fullPage:true});
  await page.getByRole("link",{name:"Return to CityLife"}).click();
  const arrival=()=>page.evaluate(()=>{
    const r=(window as any).__colony,p=r?.getOwnedDrivePose();
    return p?{x:p.x,y:p.y,car:r.sim.state.operatorCar?.spec.id,
      built:r.lots().filter((lot:any)=>r.isPlayerParcel(lot.id)&&lot.built).map((lot:any)=>lot.id)}:null;
  });
  const expected={...plot.geometry.spawn,car:"showroom:karoo-x19-targa",built:[plot.plotId]};
  await expect.poll(arrival,{timeout:90000}).toEqual(expected);
  await expect(page.getByTestId("starter-property-overlay")).toHaveCount(0);
  await page.screenshot({path:info.outputPath("home-arrival.png")});
  await page.reload();
  await expect.poll(arrival,{timeout:90000}).toEqual(expected);
  expect(vehicleRequests).toHaveLength(2);expect(plotRequests).toHaveLength(1);
  expect(buildRequests).toHaveLength(1);expect(balance).toBe(0);
});
