import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createWorldLayoutDocument } from "../src/colony/spatial/worldLayoutDocument";
const auth = vi.hoisted(() => ({ operator: { userId: "a" }, getValidToken: vi.fn() }));
vi.mock("../src/colony/authClient", () => ({ getAuthClient: () => auth }));
import { fetchPublishedStarterWorld, parsePublishedStarterWorld } from "../src/colony/home/starterWorldCatalogue";
const transform = {position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}};
const layout = createWorldLayoutDocument({worldId:"seed-4242",seed:4242,
  revision:{number:1,parentHash:"a".repeat(64)},
  frames:[{id:"surface",address:"spatial://citylife/surface",kind:"region",layer:"surface",transform},
    {id:"parcel",address:"spatial://citylife/surface/region/parcel",kind:"region",layer:"surface",parentId:"surface",transform}],
  placements:[],roads:[],ways:[],terrainEdits:[],portals:[]});
const body = () => ({published:true,manifest:{schemaVersion:"citylife.starter-parcel-manifest/v1",
  worldId:"seed-4242",layoutRevision:layout.revision.contentHash,sourceLayoutRevision:"a".repeat(64),layout,
  plots:[{plotId:"wood1_lot_1",frameId:"parcel",geometry:{plotId:"wood1_lot_1",worldId:"seed-4242",layoutRevision:layout.revision.contentHash}}]}});
beforeEach(() => {auth.operator.userId="a"; auth.getValidToken.mockResolvedValue("test-token");});
afterEach(() => {vi.unstubAllGlobals();vi.clearAllMocks();});
describe("published starter world bootstrap", () => {
  it("requires the published wrapper, canonical hash and unique plot/frame binding", () => {
    expect(parsePublishedStarterWorld(body(),"seed-4242").plotIds).toEqual(["wood1_lot_1"]);
    expect(() => parsePublishedStarterWorld({...body(),published:false},"seed-4242")).toThrow();
    const duplicate=body();duplicate.manifest.plots.push(duplicate.manifest.plots[0]);
    expect(() => parsePublishedStarterWorld(duplicate,"seed-4242")).toThrow();
    const wrong=body();wrong.manifest.layoutRevision="b".repeat(64);
    expect(() => parsePublishedStarterWorld(wrong,"seed-4242")).toThrow();
    expect(() => parsePublishedStarterWorld(body(),"other-world")).toThrow();
  });
  it("does not turn missing or unavailable catalogues into empty land", async () => {
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response("",{status:404})));
    await expect(fetchPublishedStarterWorld("seed-4242")).rejects.toThrow(/not been published/);
  });
  it("drops a catalogue response from the previous account", async () => {
    vi.stubGlobal("fetch",vi.fn().mockImplementation(async () => {
      auth.operator.userId="b";return new Response(JSON.stringify(body()),{status:200});
    }));
    await expect(fetchPublishedStarterWorld("seed-4242")).rejects.toThrow(/session changed/);
  });
  it("does not fetch after token refresh changes identity", async () => {
    auth.getValidToken.mockImplementation(async () => {auth.operator.userId="b";return "test-token";});
    const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
    await expect(fetchPublishedStarterWorld("seed-4242")).rejects.toThrow(/session changed/);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
