import {it,expect} from "vitest";
import type {ColonySim} from "../src/colony/sim";
import {ownedVehicleSurfaceY} from "../src/colony/render/ownedVehicleSurface";
import {ROAD_RIBBON_LIFT} from "../src/colony/render/roadRibbon";

it("uses graded driveway height continuously while retaining the rendered road surface",()=>{
  const sim={state:{terrain:{size:4,worldY:()=>2,worldYAt:()=>2},roadSet:new Set<string>()}} as unknown as ColonySim;
  const grade=new Map([[5,12],[6,16],[9,12],[10,16]]);
  expect(ownedVehicleSurfaceY(sim,grade,1,1)).toBeCloseTo(12.02);
  expect(ownedVehicleSurfaceY(sim,grade,1.25,1)).toBeCloseTo(13.02);
  sim.state.roadSet.add("1,1");
  expect(ownedVehicleSurfaceY(sim,grade,1,1)).toBeCloseTo(2+ROAD_RIBBON_LIFT);
});
