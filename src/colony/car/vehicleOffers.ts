import {getAuthClient} from "../authClient";

export const VEHICLE_OFFERS_PATH="/kooker/api/v1/citylife/players/me/vehicle/offers";
export interface VehicleOffer { vehicleKey:string; priceKco:number; currency:"KCO"; }

/** The current catalogue prices whole KCO. Reject malformed/ambiguous prices rather than round a debit. */
export function parseVehicleOffers(raw:unknown):VehicleOffer[]|null {
  if(!Array.isArray(raw))return null;
  const seen=new Set<string>(),offers:VehicleOffer[]=[];
  for(const item of raw){
    if(!item||typeof item!=="object"||typeof item.vehicleKey!=="string"||
      !/^[a-z0-9][a-z0-9-]{0,119}$/.test(item.vehicleKey)||seen.has(item.vehicleKey)||
      !Number.isSafeInteger(item.priceKco)||item.priceKco<0||item.currency!=="KCO")return null;
    seen.add(item.vehicleKey);offers.push({vehicleKey:item.vehicleKey,priceKco:item.priceKco,currency:"KCO"});
  }
  return offers;
}

export async function fetchVehicleOffers():Promise<VehicleOffer[]|null>{
  const auth=getAuthClient(),userId=auth.operator?.userId;
  if(!userId)return null;
  try{
    const token=await auth.getValidToken();
    if(!token||auth.operator?.userId!==userId)return null;
    const response=await fetch(VEHICLE_OFFERS_PATH,{headers:{Authorization:`Bearer ${token}`},
      cache:"no-store",signal:AbortSignal.timeout(10000)});
    if(!response.ok)return null;
    const body:unknown=await response.json();
    return auth.operator?.userId===userId?parseVehicleOffers(body):null;
  }catch{return null;}
}
