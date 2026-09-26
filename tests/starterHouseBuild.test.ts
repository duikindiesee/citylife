import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {createWorldLayoutDocument} from "../src/colony/spatial/worldLayoutDocument";
import {parseHouseBuildContext,completeHouseBuild,type HouseBuildSession} from "../src/colony/home/starterHouseBuild";
const auth=vi.hoisted(()=>({operator:{userId:"a"},getValidToken:vi.fn()}));
vi.mock("../src/colony/authClient",()=>({getAuthClient:()=>auth}));
const layout=createWorldLayoutDocument({worldId:"seed-4242",seed:4242,revision:{number:1,parentHash:null},
  frames:[{id:"f",address:"spatial://citylife/surface",kind:"region",layer:"surface",
    transform:{position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}}}],
  placements:[],roads:[],ways:[],terrainEdits:[],portals:[]});
const inventory={worldId:"seed-4242",layoutRevision:layout.revision.contentHash,plotIds:["p"],plotFrames:new Map([["p","f"]]),
  plotGeometry:new Map<string,import("../src/colony/starterParcelSurvey").StarterParcelGeometry>(),layout};
const context={plotId:"p",frameId:"f",layoutRevision:inventory.layoutRevision,completed:false,script:null,
  geometry:{plotId:"p",worldId:inventory.worldId,layoutRevision:inventory.layoutRevision,neighbourhoodKey:"wood1",
    parcel:{x:0,y:0,width:9,depth:10},houseZone:{x:2,y:5,width:5,depth:4},
    driveway:[{x:4,y:0},{x:4,y:1},{x:4,y:2},{x:4,y:3},{x:4,y:4}],roadCells:[{x:4,y:0}],spawn:{x:4,y:2}}};
const script="house{w:5 d:4 wallH:1 door:n} room{kind:living x:0 y:0 w:5 d:4 win:1}";
const session:HouseBuildSession={userId:"a",context,inventory,door:"n"};
inventory.plotGeometry.set("p",context.geometry);
const response=(raw:unknown)=>new Response(JSON.stringify(raw),{status:200});
beforeEach(()=>{auth.operator.userId="a";auth.getValidToken.mockResolvedValue("test-token");});
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});
it("binds the build to published plot, frame, revision and driveway",()=>{
  expect(parseHouseBuildContext(context,inventory)).toEqual(context);
  for(const changed of [{plotId:"foreign"},{frameId:"other"},{layoutRevision:"b".repeat(64)},
    {completed:true},{geometry:{...context.geometry,worldId:"another"}},
    {script:script.replace("door:n","door:s")}])
    expect(()=>parseHouseBuildContext({...context,...changed},inventory)).toThrow();
});
it("requires both completion receipt and fresh readback of the exact saved script",async()=>{
  const completed={...context,script,completed:true};
  const fetcher=vi.fn().mockResolvedValueOnce(response(completed)).mockResolvedValueOnce(response(context));
  vi.stubGlobal("fetch",fetcher);
  await expect(completeHouseBuild(session,script)).rejects.toThrow(/not be confirmed/);
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({plotId:"p",layoutRevision:inventory.layoutRevision,script});
  fetcher.mockImplementation(async()=>response(completed));
  expect(await completeHouseBuild(session,script)).toEqual(completed);
});
it("does not post or accept saved state across an account switch",async()=>{
  const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
  auth.operator.userId="b";
  await expect(completeHouseBuild(session,script)).rejects.toThrow(/account changed/);
  expect(fetcher).not.toHaveBeenCalled();
  auth.operator.userId="a";
  fetcher.mockImplementation(async()=>{auth.operator.userId="b";return response({...context,script,completed:true});});
  await expect(completeHouseBuild(session,script)).rejects.toThrow(/account changed/);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
