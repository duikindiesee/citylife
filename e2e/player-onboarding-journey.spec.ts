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
  let delayPaidPlotTruth=false,releasePaidPlotTruth:()=>void=()=>{},signalPaidPlotTruthRead:()=>void=()=>{};
  const paidPlotTruthGate=new Promise<void>(resolve=>{releasePaidPlotTruth=resolve;});
  const paidPlotTruthReadStarted=new Promise<void>(resolve=>{signalPaidPlotTruthRead=resolve;});
  const json=(body:unknown,status=200)=>({status,contentType:"application/json",body:JSON.stringify(body)});
  await page.route("**/kooker/**",route=>route.fulfill(json({})));
  await installVehicleOffersFixture(page);
  await page.route("**/api/ledger/wallets/**/balances**",route=>{
    const requestUrl=new URL(route.request().url());
    expect(requestUrl.pathname).toContain("/onboarding-fixture/balances");
    expect(requestUrl.searchParams.get("appName")).toBe("citylife");
    return route.fulfill(json([{ownerId:"onboarding-fixture",ownerType:"USER",walletType:"DEFAULT",
      appName:"citylife",currency:"KCO",realm:"TEST",balance:balance.toFixed(4)}]));
  });
  await page.route("**/worlds/seed-4242/starter-catalogue",route=>route.fulfill({status:200,contentType:"application/json",body:fixture}));
  await page.route("**/feature-flags/new-player-journey-v1",route=>route.fulfill(json({enabled:true})));
  await page.route("**/players/me/vehicle",route=>route.fulfill(json({owned:car,vehicleKey:car?"karoo-x19-targa":null})));
  await page.route("**/players/me/vehicle/purchase",route=>{
    vehicleRequests.push({body:route.request().postDataJSON(),key:route.request().headers()["idempotency-key"]});
    if(balance<950)return route.fulfill(json({},402));
    if(!car){balance-=950;car=true;}
    return route.fulfill(json({},201));
  });
  await page.route("**/players/me/home",async route=>{
    if(delayPaidPlotTruth){delayPaidPlotTruth=false;signalPaidPlotTruthRead();await paidPlotTruthGate;}
    return route.fulfill(json({owned:!!script,status:land?"OWNED":null,
      plotOwned:land,requiresBuild:land&&!script,plotId:land?plot.plotId:null,frameId:land?plot.frameId:null,
      neighbourhoodKey:plot.geometry.neighbourhoodKey,layoutRevision:manifest.layoutRevision,priceKco:350}));
  });
  await page.route("**/players/me/home/available-plots",route=>route.fulfill(json(land?[]:[{...plot,priceKco:350}])));
  await page.route("**/players/me/home/purchase",route=>{
    plotRequests.push(route.request().postDataJSON());
    if(balance<350)return route.fulfill(json({},402));
    if(!land){balance-=350;land=true;delayPaidPlotTruth=true;}
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
    token:"fixture.eyJ1c2VySWQiOiJvbmJvYXJkaW5nLWZpeHR1cmUifQ==.sig",expiresAt:Date.now()+3600000,
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
  await expect(page.getByTestId("showroom-affordability")).toHaveText("Need ₭200 more");
  await expect(acquire).toHaveText("Insufficient funds");
  await expect(acquire).toHaveAttribute("data-acquire-state","insufficient_funds");
  await expect(acquire).toBeDisabled();
  expect(vehicleRequests).toHaveLength(0);expect(car).toBe(false);expect(balance).toBe(750);
  await page.screenshot({path:info.outputPath("insufficient-funds.png")});
  await page.locator('[data-build-action="showroom-exit"]').press("Enter");
  await expect(showroom).toHaveCount(0);
  balance=1300;
  await page.locator('[data-build-action="open-showroom"]').press("Enter");
  await expect(showroom).toBeVisible();
  await expect(page.getByTestId("showroom-affordability")).toHaveText("You have ₭1,300");
  await selectX19();
  await expect(acquire).toBeEnabled();
  await acquire.press("Enter");
  await expect(page.getByTestId(`home-price-${plot.plotId}`)).toContainText("350",{timeout:30000});
  await expect(page.getByTestId("home-wallet-balance")).toHaveText("₭350");
  expect(balance).toBe(350);expect(vehicleRequests).toHaveLength(1);
  expect(vehicleRequests[0].body).toEqual({vehicleKey:"karoo-x19-targa"});
  expect(vehicleRequests[0].key).toBeTruthy();
  await page.getByTestId(`home-choice-${plot.plotId}`).press("Enter");
  await page.getByTestId("home-purchase").press("Enter");
  await paidPlotTruthReadStarted;
  await expect(page.getByTestId("home-purchase-confirmed")).toBeVisible({timeout:30000});
  await expect(page.getByTestId("home-purchase")).toHaveAttribute("data-purchase-state","plot_owned");
  releasePaidPlotTruth();
  await expect(page.getByTestId("home-build-house")).toBeVisible({timeout:30000});
  await expect(page.getByTestId("home-wallet-balance")).toHaveText("₭0");
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
  const renderLayers=await page.evaluate(()=>Array.from(document.querySelectorAll(".canvas-host"),host=>{
    const element=host as HTMLElement;
    const canvas=host.querySelector("canvas");
    const rect=host.getBoundingClientRect();
    const point=document.elementFromPoint(Math.floor(innerWidth/2),Math.floor(innerHeight/2));
    return {connected:host.isConnected,inlineZ:element.style.zIndex,computedZ:getComputedStyle(host).zIndex,
      position:getComputedStyle(host).position,rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},
      canvasCount:host.querySelectorAll("canvas").length,canvasRect:canvas?.getBoundingClientRect().toJSON(),
      centerHit:point?.tagName,centerHitClass:(point as HTMLElement|null)?.className,
      ancestors:Array.from((host as HTMLElement).parentElement?[host.parentElement!,host.parentElement!.parentElement!]:[],ancestor=>({
        tag:ancestor.tagName,id:ancestor.id,className:ancestor.className,position:getComputedStyle(ancestor).position,
        zIndex:getComputedStyle(ancestor).zIndex,background:getComputedStyle(ancestor).backgroundColor}))};
  }));
  expect(renderLayers).toHaveLength(1);
  expect(renderLayers[0]).toMatchObject({connected:true,canvasCount:1,centerHit:"CANVAS"});
  // Runtime arrival can become authoritative just before the compositor presents the next R3F
  // frame. Poll the actual browser screenshot rather than mistaking the transparent WebGL buffer
  // for the rendered page; retain the first capture that visibly contains the world sky.
  const readLandscapeRed=async(encoded:string)=>page.evaluate(async(value)=>{
    const image=new Image();image.src=`data:image/png;base64,${value}`;await image.decode();
    const canvas=document.createElement("canvas");canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
    const context=canvas.getContext("2d");if(!context)throw new Error("Screenshot pixel reader unavailable");
    context.drawImage(image,0,0);
    // Sample the unobstructed foreground instead of the sky: night lighting legitimately makes
    // the sky nearly black, which must not be mistaken for an unpresented WebGL frame.
    return context.getImageData(Math.floor(image.naturalWidth/2),Math.floor(image.naturalHeight*0.56),1,1).data[0];
  },encoded);
  await expect.poll(async()=>{
    const capture=await page.screenshot({path:info.outputPath("home-arrival.png")});
    return readLandscapeRed(capture.toString("base64"));
  },{timeout:10000,intervals:[100,250,500,1000]}).toBeGreaterThan(50);
  await page.reload();
  await expect.poll(arrival,{timeout:90000}).toEqual(expected);
  expect(vehicleRequests).toHaveLength(1);expect(plotRequests).toHaveLength(1);
  expect(buildRequests).toHaveLength(1);expect(balance).toBe(0);
  const cityMap=page.getByRole("complementary",{name:"Live bus network map"});
  await expect(cityMap).toBeVisible();
  await page.getByTestId("city-map-toggle").click();
  await expect(cityMap).toHaveAttribute("data-expanded","true");
  await expect(cityMap.locator("[data-bus-count]").first()).toBeVisible();
  const playerMarker=page.getByTestId("city-map-player-marker");
  await expect(playerMarker).toBeVisible();
  await expect(playerMarker).toHaveAttribute("data-off-map","false");
  await expect(page.getByTestId("owned-car-controls")).toBeVisible();
  const throttle=page.locator('[data-drive-action="throttle"]');
  const throttleBox=await throttle.boundingBox();
  expect(throttleBox).not.toBeNull();
  expect(await page.evaluate(({x,y})=>!!document.elementFromPoint(x,y)?.closest('[data-drive-action="throttle"]'),{
    x:throttleBox!.x+throttleBox!.width/2,y:throttleBox!.y+throttleBox!.height/2})).toBe(true);
  const driveStart=await page.evaluate(()=>{
    const pose=(window as any).__colony.getOwnedDrivePose();return {x:pose.x,y:pose.y};
  });
  const markerBefore=await playerMarker.locator("circle").first().evaluate(node=>
    `${node.getAttribute("cx")},${node.getAttribute("cy")}`);
  await page.mouse.move(throttleBox!.x+throttleBox!.width/2,throttleBox!.y+throttleBox!.height/2);
  await page.mouse.down();
  try {
    await expect.poll(()=>page.evaluate((start)=>{
      const pose=(window as any).__colony.getOwnedDrivePose();
      return pose?Math.hypot(pose.x-start.x,pose.y-start.y):0;
    },driveStart),{timeout:10000}).toBeGreaterThan(0.1);
  } finally {
    await page.mouse.up();
  }
  await expect.poll(()=>playerMarker.locator("circle").first().evaluate(node=>
    `${node.getAttribute("cx")},${node.getAttribute("cy")}`),{timeout:10000}).not.toBe(markerBefore);
  await page.screenshot({path:info.outputPath("home-map-driving.png")});
});
