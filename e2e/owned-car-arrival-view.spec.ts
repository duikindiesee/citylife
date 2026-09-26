import {test,expect} from "@playwright/test";
import {starterWorldFixture} from "./starterWorldFixture";
import {writeFile} from "node:fs/promises";

test("owned-car view stays clear and driveway park/exit presents the parked car",async({page},info)=>{
  test.setTimeout(120000);
  const fixture=await starterWorldFixture(),manifest=JSON.parse(fixture).manifest;
  const plot=manifest.plots.find((p:{plotId:string})=>p.plotId==="wood1_lot_1"),h=plot.geometry.houseZone;
  const script=`house{w:${h.width} d:${h.depth} wallH:1 door:s} room{kind:living x:0 y:0 w:${h.width} d:${h.depth} win:1}`;
  const json=(body:unknown)=>({status:200,contentType:"application/json",body:JSON.stringify(body)});
  await page.route("**/kooker/**",r=>r.fulfill(json({})));
  await page.route("**/worlds/seed-4242/starter-catalogue",r=>r.fulfill({status:200,contentType:"application/json",body:fixture}));
  await page.route("**/feature-flags/new-player-journey-v1",r=>r.fulfill(json({enabled:true})));
  await page.route("**/players/me/vehicle",r=>r.fulfill(json({owned:true,vehicleKey:"karoo-x19-targa"})));
  await page.route("**/players/me/home",r=>r.fulfill(json({owned:true,status:"OWNED",plotId:plot.plotId})));
  await page.route("**/players/me/home/build",r=>r.fulfill(json({plotId:plot.plotId,frameId:plot.frameId,
    layoutRevision:manifest.layoutRevision,geometry:plot.geometry,script,completed:true})));
  await page.addInitScript(()=>sessionStorage.setItem("citylife.session.v5",JSON.stringify({
    token:"opaque.camera-fixture.token",expiresAt:Date.now()+3600000,
    operator:{id:"Camera fixture",userId:"camera-fixture",roles:["CITYLIFE_PLAYER"],scopes:[]},
  })));
  await page.goto("/");
  const measurement=()=>page.evaluate(()=>{
    const w=window as any,group=w.__r3fScene?.getObjectByName("operator-car"),camera=w.__r3fCamera;
    const model=group?.getObjectByName("owned-vehicle-model");
    if(!model||!camera||!w.__colony)return null;
    const seated=!!w.__colony.getOwnedDrivePose();
    group.updateWorldMatrix(true,true);
    const min=group.position.clone().set(Infinity,Infinity,Infinity),max=min.clone().multiplyScalar(-1);
    model.traverse((node:any)=>{
      if(!node.geometry)return;
      node.geometry.computeBoundingBox();const b=node.geometry.boundingBox;
      for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z]){
        const p=group.position.clone().set(x,y,z).applyMatrix4(node.matrixWorld);min.min(p);max.max(p);
      }
    });
    const carTarget=group.position.clone();carTarget.y+=0.5;carTarget.project(camera);
    return {camera:camera.position.toArray(),car:group.position.toArray(),carVisible:group.visible,seated,
      carOnScreen:Math.abs(carTarget.x)<0.9&&Math.abs(carTarget.y)<0.9&&carTarget.z>-1&&carTarget.z<1,
      eyeHeight:camera.position.y-group.position.y,dimensions:max.clone().sub(min).toArray()};
  });
  await expect.poll(async()=> (await measurement())?.seated,{timeout:90000}).toBe(true);
  await expect.poll(async()=> (await measurement())?.eyeHeight,{timeout:90000}).toBeCloseTo(1.05,2);
  await expect.poll(async()=> (await measurement())?.carVisible).toBe(false);
  await info.attach("camera-and-model-measurements",{body:JSON.stringify(await measurement()),contentType:"application/json"});
  await writeFile(info.outputPath("measurements.json"),JSON.stringify(await measurement(),null,2));
  await page.screenshot({path:info.outputPath("driveway-view.png")});
  await page.getByTestId("exit-owned-car").click();
  await expect(page.getByTestId("owned-car-controls")).toHaveCount(0);
  await expect.poll(async()=> (await measurement())?.seated).toBe(false);
  await expect.poll(async()=> (await measurement())?.carVisible).toBe(true);
  const outside=await measurement();
  expect(Math.hypot(outside!.camera[0]-outside!.car[0],outside!.camera[2]-outside!.car[2])).toBeGreaterThan(2);
  expect(outside!.carOnScreen).toBe(true);
  await info.attach("parked-car-camera-measurements",{body:JSON.stringify(outside),contentType:"application/json"});
  await writeFile(info.outputPath("parked-car-measurements.json"),JSON.stringify(outside,null,2));
  await page.screenshot({path:info.outputPath("parked-car-outside-view.png")});
  await page.getByTestId("enter-owned-car").click();
  await expect(page.getByTestId("owned-car-controls")).toBeVisible();
  await expect.poll(async()=> (await measurement())?.carVisible).toBe(false);
  await page.keyboard.down("KeyW");
  try {
    await expect.poll(()=>page.evaluate(()=>{
      const r=(window as any).__colony,p=r.getOwnedDrivePose();
      return !!p&&r.sim.state.roadSet.has(`${Math.round(p.x)},${Math.round(p.y)}`);
    }),{timeout:20000}).toBe(true);
  } finally {await page.keyboard.up("KeyW");}
  await page.keyboard.down("Space");
  await expect.poll(()=>page.evaluate(()=>(window as any).__colony.getOwnedDrivePose()?.speed)).toBe(0);
  await page.keyboard.up("Space");
  await expect.poll(async()=> (await measurement())?.eyeHeight).toBeCloseTo(1.05,2);
  await page.screenshot({path:info.outputPath("road-view.png")});
});
