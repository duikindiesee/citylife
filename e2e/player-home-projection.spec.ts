import {test,expect} from "@playwright/test";
import {starterWorldFixture} from "./starterWorldFixture";

test("game hydrates the completed owned house on reload and removes it for another account",async({page})=>{
  test.setTimeout(180000);
  const fixture=await starterWorldFixture(),manifest=JSON.parse(fixture).manifest;
  const plot=manifest.plots.find((p:{plotId:string})=>p.plotId==="wood1_lot_1"),h=plot.geometry.houseZone;
  const script=`house{w:${h.width} d:${h.depth} wallH:1 door:s} room{kind:living x:0 y:0 w:${h.width} d:${h.depth} win:1}`;
  let ownsHome=true,buildReads=0,writes=0,failHome=true,failFlag=true,homeReads=0,holdHome=false;
  let releaseHome!:()=>void;
  const homeBarrier=new Promise<void>(resolve=>{releaseHome=resolve;});
  let ownsCar=true;
  await page.route("**/kooker/**",route=>route.fulfill({status:200,contentType:"application/json",body:"{}"}));
  await page.route("**/worlds/seed-4242/starter-catalogue",route=>route.fulfill({status:200,contentType:"application/json",body:fixture}));
  await page.route("**/feature-flags/new-player-journey-v1",route=>route.fulfill({status:failFlag?503:200,contentType:"application/json",body:JSON.stringify({enabled:true,state:"UAT_ALLOWLIST"})}));
  await page.route("**/players/me/vehicle",route=>route.fulfill({status:200,contentType:"application/json",
    body:JSON.stringify({owned:ownsCar,vehicleKey:ownsCar?"karoo-x19-targa":null})}));
  await page.route("**/players/me/home",async route=>{
    homeReads++;
    if(holdHome) await homeBarrier;
    return route.fulfill({status:failHome?503:200,contentType:"application/json",
    body:JSON.stringify({owned:ownsHome,status:ownsHome?"OWNED":null,plotOwned:ownsHome,requiresBuild:false,
      plotId:ownsHome?plot.plotId:null,layoutRevision:manifest.layoutRevision})});
  });
  await page.route("**/players/me/home/build",route=>{
    if(route.request().method()!=="GET") writes++;
    buildReads++;
    return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({plotId:plot.plotId,
      frameId:plot.frameId,layoutRevision:manifest.layoutRevision,geometry:plot.geometry,script,completed:true})});
  });
  await page.addInitScript(()=>{
    if(!sessionStorage.getItem("citylife.session.v5")) sessionStorage.setItem("citylife.session.v5",JSON.stringify({
      token:"opaque.home-owner.token",expiresAt:Date.now()+3600000,
      operator:{id:"Home Owner",userId:"home-owner",roles:["CITYLIFE_PLAYER"],scopes:[]},
    }));
  });
  const snapshot=()=>page.evaluate(()=>{
    const runtime=(window as any).__colony;
    if(!runtime)return null;
    return runtime.lots().filter((lot:any)=>runtime.isPlayerParcel(lot.id)&&lot.built)
      .map((lot:any)=>({id:lot.id,script:lot.blueprint}));
  });
  await page.goto("/");
  await expect(page.getByRole("button",{name:"Retry arrival"})).toBeVisible({timeout:90000});
  expect(await page.evaluate(()=>(window as any).__colony.getOwnedDrivePose())).toBeNull();
  expect(homeReads).toBe(0);
  failFlag=false;
  await page.getByRole("button",{name:"Retry arrival"}).click();
  await expect.poll(()=>homeReads).toBeGreaterThan(0);
  await expect(page.getByRole("button",{name:"Retry arrival"})).toBeVisible();
  failHome=false;
  holdHome=true;
  const previousReads=homeReads;
  await page.getByRole("button",{name:"Retry arrival"}).click();
  await expect.poll(()=>homeReads).toBeGreaterThan(previousReads);
  await expect(page.getByText("Loading your car and home…",{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).__colony.getOwnedDrivePose())).toBeNull();
  holdHome=false;
  releaseHome();
  await expect.poll(snapshot,{timeout:90000}).toEqual([{id:plot.plotId,script}]);
  const car=()=>page.evaluate(()=>{
    const runtime=(window as any).__colony,pose=runtime?.getOwnedDrivePose();
    return pose ? {x:pose.x,y:pose.y,id:runtime.sim.state.operatorCar?.spec.id} : null;
  });
  await expect.poll(car,{timeout:30000}).toEqual({...plot.geometry.spawn,id:"showroom:karoo-x19-targa"});
  await page.keyboard.down("KeyW");
  await expect.poll(()=>page.evaluate(()=>{
    const runtime=(window as any).__colony,pose=runtime.getOwnedDrivePose();
    return !!pose && runtime.sim.state.roadSet.has(`${Math.round(pose.x)},${Math.round(pose.y)}`);
  }),{timeout:20000}).toBe(true);
  await page.keyboard.up("KeyW");
  await page.keyboard.down("Space");
  await expect.poll(()=>page.evaluate(()=>(window as any).__colony.getOwnedDrivePose()?.speed)).toBe(0);
  await page.keyboard.up("Space");
  await page.reload();
  await expect.poll(snapshot,{timeout:90000}).toEqual([{id:plot.plotId,script}]);
  await expect.poll(car,{timeout:30000}).toEqual({...plot.geometry.spawn,id:"showroom:karoo-x19-targa"});
  expect(buildReads).toBe(2);expect(writes).toBe(0);
  ownsHome=false;
  await page.evaluate(()=>{
    const session=JSON.parse(sessionStorage.getItem("citylife.session.v5")!);
    session.operator.userId="different-player";session.operator.id="Another Player";
    sessionStorage.setItem("citylife.session.v5",JSON.stringify(session));
  });
  await page.reload();
  await expect(page.locator('button[title="Sign out of CityLife"]')).toBeVisible({timeout:90000});
  await expect.poll(snapshot).toEqual([]);
  expect(buildReads).toBe(2);expect(writes).toBe(0);
  ownsCar=false;
  await page.reload();
  await expect(page.locator('[data-testid="showroom-overlay"]')).toBeVisible({timeout:90000});
  expect(await car()).toBeNull();
  expect(await snapshot()).toEqual([]);
});
