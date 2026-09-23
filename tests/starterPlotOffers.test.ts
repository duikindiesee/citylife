import {beforeEach, afterEach, describe, expect, it, vi} from "vitest";
const auth = vi.hoisted(() => ({operator:{userId:"player-a"}, getValidToken:vi.fn()}));
vi.mock("../src/colony/authClient", () => ({getAuthClient:() => auth}));
import {fetchStarterPlotOffers, parseStarterPlotOffers, postPurchasePlot, postResumePlotPurchase} from "../src/colony/home/starterPlotOffers";
import {parseHomeTruth} from "../src/colony/home/starterProperty";

const offered = {plotId:"wood1_lot_1",frameId:"frame-wood1-lot-1",priceKco:350,
  geometry:{plotId:"wood1_lot_1",worldId:"seed-4242",neighbourhoodKey:"wood1",
    layoutRevision:"a".repeat(64),parcel:{x:1,y:1,width:9,depth:11}}};
const response = (status:number, body:unknown) => new Response(JSON.stringify(body), {status, headers:{"content-type":"application/json"}});
beforeEach(() => { auth.operator.userId = "player-a"; auth.getValidToken.mockResolvedValue("opaque-test-token"); });
afterEach(() => {vi.unstubAllGlobals(); vi.clearAllMocks();});

describe("actual server plot offers", () => {
  it("retains exact server identity, revision and price, with no synthetic fallback", () => {
    const offer = parseStarterPlotOffers([offered])![0];
    expect(offer).toMatchObject({plotId:offered.plotId,priceKco:350,layoutRevision:"a".repeat(64),neighbourhoodKey:"wood1"});
    expect(parseStarterPlotOffers([])).toEqual([]);
    expect(parseStarterPlotOffers({neighbourhoods:[{key:"wood1",priceKco:350}]})).toBeNull();
    expect(parseStarterPlotOffers([offered,offered])).toBeNull();
    expect(parseStarterPlotOffers([{...offered,priceKco:-1}])).toBeNull();
    expect(parseStarterPlotOffers([{...offered,geometry:{...offered.geometry,plotId:"another"}}])).toBeNull();
    expect(parseStarterPlotOffers([{...offered,geometry:{...offered.geometry,layoutRevision:"latest"}}])).toBeNull();
  });
  it("submits only the offered selection and preserves the same idempotency key", async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(response(200,{status:"PLOT_OWNED"})));
    vi.stubGlobal("fetch",fetcher);
    const offers = parseStarterPlotOffers([offered])!;
    expect(await postPurchasePlot(offered.plotId,offers)).toEqual({kind:"plot_owned"});
    expect(await postPurchasePlot(offered.plotId,offers)).toEqual({kind:"plot_owned"});
    const first = fetcher.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(first.body as string)).toEqual({plotId:offered.plotId,neighbourhoodKey:"wood1",layoutRevision:"a".repeat(64)});
    expect(first.headers).toEqual(fetcher.mock.calls[1][1].headers);
    expect(await postPurchasePlot("not-offered",offers)).toEqual({kind:"disabled"});
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("does not display a late offer list from the previous account", async () => {
    vi.stubGlobal("fetch",vi.fn().mockImplementation(async () => {
      auth.operator.userId = "player-b";
      return response(200,[offered]);
    }));
    expect(await fetchStarterPlotOffers()).toBeNull();
  });
  it("rejects a switch during token refresh before any POST", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch",fetcher);
    auth.getValidToken.mockImplementationOnce(async () => {auth.operator.userId="player-b"; return "other-token";});
    expect(await postPurchasePlot(offered.plotId,parseStarterPlotOffers([offered])!)).toEqual({kind:"disabled"});
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not infer ownership from an unexpected or processing success body", async () => {
    vi.stubGlobal("fetch",vi.fn().mockResolvedValueOnce(response(200,{}))
      .mockResolvedValueOnce(response(200,{status:"PENDING"})));
    const offers = parseStarterPlotOffers([offered])!;
    expect(await postPurchasePlot(offered.plotId,offers)).toEqual({kind:"error",status:200});
    expect(await postPurchasePlot(offered.plotId,offers)).toEqual({kind:"pending"});
  });
  it("keeps selection conflicts distinct from processing and resumes only the rejected existing intent", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(409,{detail:"PLOT_UNAVAILABLE"}))
      .mockResolvedValueOnce(response(422,{status:"INSUFFICIENT_FUNDS"}));
    vi.stubGlobal("fetch",fetcher);
    expect(await postPurchasePlot(offered.plotId,parseStarterPlotOffers([offered])!)).toEqual({kind:"error",status:409});
    const truth = parseHomeTruth({owned:false,status:"REJECTED_INSUFFICIENT_FUNDS",
      plotId:offered.plotId,neighbourhoodKey:"wood1",layoutRevision:"a".repeat(64)})!;
    expect(await postResumePlotPurchase(truth)).toEqual({kind:"insufficient_funds"});
    expect(await postResumePlotPurchase({...truth,status:"PENDING"})).toEqual({kind:"disabled"});
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual(JSON.parse(fetcher.mock.calls[0][1].body));
  });
});
