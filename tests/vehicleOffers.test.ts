import {it,expect,vi,beforeEach,afterEach} from "vitest";
const identity=vi.hoisted(()=>({userId:"player-a"}));
vi.mock("../src/colony/authClient",()=>({getAuthClient:()=>({
  operator:identity,getValidToken:async()=>"opaque-offer-test-token",
})}));
import {parseVehicleOffers,fetchVehicleOffers,VEHICLE_OFFERS_PATH} from "../src/colony/car/vehicleOffers";
const offer={vehicleKey:"karoo-x19-targa",priceKco:1247,currency:"KCO"};
beforeEach(()=>{identity.userId="player-a";});
afterEach(()=>vi.unstubAllGlobals());
it("uses the server price and rejects ambiguous or malformed price books",()=>{
  expect(parseVehicleOffers([offer])).toEqual([offer]);
  for(const value of [{},null,[offer,offer],[{...offer,priceKco:-1}],
    [{...offer,priceKco:"950"}],[{...offer,priceKco:0.5}],[{...offer,currency:"USD"}]])
    expect(parseVehicleOffers(value)).toBeNull();
  expect(parseVehicleOffers([])).toEqual([]);
});
it("reads no-store with a bounded authenticated request",async()=>{
  const fetch=vi.fn(async()=>({ok:true,json:async()=>[offer]}));vi.stubGlobal("fetch",fetch);
  expect(await fetchVehicleOffers()).toEqual([offer]);
  expect(fetch).toHaveBeenCalledWith(VEHICLE_OFFERS_PATH,expect.objectContaining({
    cache:"no-store",headers:{Authorization:"Bearer opaque-offer-test-token"},signal:expect.any(AbortSignal),
  }));
});
it("discards failed reads and responses for an account that has changed",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>({ok:false})));
  expect(await fetchVehicleOffers()).toBeNull();
  vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>{
    identity.userId="player-b";return [offer];
  }})));
  expect(await fetchVehicleOffers()).toBeNull();
});
