import {beforeAll,it,expect} from "vitest";
import {ColonyRuntime} from "../src/colony/runtime";
import {cellOk} from "../src/colony/pathfind";
import {createStarterParcelManifest} from "../src/colony/starterParcelManifest";
import {parsePublishedStarterWorld} from "../src/colony/home/starterWorldCatalogue";
import {houseDoor,type HouseBuildSession} from "../src/colony/home/starterHouseBuild";

let session:HouseBuildSession;
beforeAll(()=>{
  const survey=new ColonyRuntime(4242,{surveyOnly:true});
  const manifest=createStarterParcelManifest({layout:survey.captureWorldLayout(),parcels:survey.lots(),
    groundClear:c=>cellOk(survey.sim.state.terrain,c.x,c.y)});
  const inventory=parsePublishedStarterWorld({published:true,manifest},manifest.worldId);
  const plot=manifest.plots[0],zone=plot.geometry.houseZone,door=houseDoor(plot.geometry);
  const script=`house{w:${zone.width} d:${zone.depth} wallH:1 door:${door}} room{kind:living x:0 y:0 w:${zone.width} d:${zone.depth} win:1}`;
  session={userId:"player-a",inventory,door,context:{plotId:plot.plotId,frameId:plot.frameId,
    layoutRevision:manifest.layoutRevision,geometry:plot.geometry,script,completed:true}};
});
function boot() {
  const runtime=new ColonyRuntime(4242,{surveyOnly:true,playerInventory:session.inventory});
  runtime.setOperatorUserId("player-a");
  return runtime;
}
it("projects the exact completed design without another material or ledger charge and clears on account switch",()=>{
  const runtime=boot(),lot=runtime.lots().find(l=>l.id===session.context.plotId)!;
  const before={seed:lot.houseSeed,materials:runtime.sim.state.materials,ledger:JSON.stringify(runtime.sim.state.ledger)};
  const spawn=session.context.geometry.spawn;
  expect(runtime["canOwnedCarOccupy"](spawn.x,spawn.y)).toBe(false);
  expect(runtime.applyCompletedPlayerHome(session)).toBe(true);
  expect(lot.built).toBe(true);expect(lot.blueprint).toBe(session.context.script);
  expect(lot.houseSeed).toBe(session.inventory.layout.seed);
  expect(lot.ownerCitizenId).toBeUndefined();
  expect(runtime["canOwnedCarOccupy"](spawn.x,spawn.y)).toBe(true);
  expect(runtime["canOwnedCarOccupy"](lot.houseZone.x,lot.houseZone.y)).toBe(false);
  expect(runtime.applyCompletedPlayerHome(session)).toBe(true);
  expect(runtime.sim.state.materials).toBe(before.materials);
  expect(JSON.stringify(runtime.sim.state.ledger)).toBe(before.ledger);
  expect(runtime.applyBlueprint(lot.id,session.context.script!)).toBe(false);
  runtime.setOperatorUserId("player-b");
  expect(runtime["canOwnedCarOccupy"](spawn.x,spawn.y)).toBe(false);
  expect(lot.built).toBe(false);expect(lot.blueprint).toBeUndefined();expect(lot.houseSeed).toBe(before.seed);
  expect(runtime.applyCompletedPlayerHome(session)).toBe(false);
});
it("refuses unfinished, stale or displaced house data before touching the parcel",()=>{
  const runtime=boot(),before=JSON.stringify(runtime.lots());
  expect(runtime.applyCompletedPlayerHome({...session,context:{...session.context,completed:false}})).toBe(false);
  expect(runtime.applyCompletedPlayerHome({...session,context:{...session.context,layoutRevision:"b".repeat(64)}})).toBe(false);
  expect(runtime.applyCompletedPlayerHome({...session,context:{...session.context,geometry:{...session.context.geometry,
    houseZone:{...session.context.geometry.houseZone,x:session.context.geometry.houseZone.x+1}}}})).toBe(false);
  expect(JSON.stringify(runtime.lots())).toBe(before);
});
