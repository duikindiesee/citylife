import {describe,it,expect} from "vitest";
import {ColonySim} from "../src/colony/sim";
import {makeNeighborhood} from "../src/colony/neighborhood";
import {parcelFencePlacements} from "../src/colony/render/parcelFencePlacement";
import {starterGaragePlacement,garageFootprintInside} from "../src/colony/render/starterGaragePlacement";
import {testbedCameraPose,garageDoorTime,testbedParcelInfo} from "../src/colony/render/starterGarageCamera";
describe("starter fence and garage placement",()=>{
 const sim=new ColonySim(180); const parcel=makeNeighborhood(sim.state.terrain).parcels.find(p=>p.fenceType==="fence")!;
 it("renders a continuous fence ring except for a gate in the street-side gap",()=>{
  const p=parcelFencePlacements(parcel,sim.state.terrain.size);
  expect(p.filter(x=>x.piece==="panel").length).toBeGreaterThan(0);
  expect(p.filter(x=>x.piece==="gate-driveway")).toHaveLength(1);
  expect(p.some(x=>x.piece==="post-line" || x.piece==="post-corner" || x.piece==="post-end")).toBe(true);
  expect(parcel.fence.some(c=>Math.abs(c.x-parcel.gate.x)+Math.abs(c.y-parcel.gate.y)===1)).toBe(true);
  expect(parcelFencePlacements({...parcel,fenceType:"wall"},sim.state.terrain.size)).toEqual([]);
 });
 it("posts every 2 m on the true outer boundary and keeps a single gate",()=>{
  const all=parcelFencePlacements(parcel,sim.state.terrain.size),posts=all.filter(x=>x.piece.startsWith("post"));
  expect(all.filter(x=>x.piece==="gate-driveway")).toHaveLength(1);
  const xs=posts.map(p=>p.position[0]),zs=posts.map(p=>p.position[2]);
  expect(Math.max(...xs)-Math.min(...xs)).toBe(parcel.w*4);
  expect(Math.max(...zs)-Math.min(...zs)).toBe(parcel.h*4);
  for(const vals of [xs,zs]){const unique=[...new Set(vals)].sort((a,b)=>a-b);expect(unique.length).toBeGreaterThan(2);}
 });
 it("puts garage front on driveway centreline and keeps its footprint in house zone",()=>{
  const p=starterGaragePlacement(parcel,sim.state.terrain.size),last=parcel.driveway.at(-1)!;
  const cx=p.position[0]/4+sim.state.terrain.size/2,cz=p.position[2]/4+sim.state.terrain.size/2;
  const streetX=parcel.driveway[0]!.x-parcel.gate.x,streetY=parcel.driveway[0]!.y-parcel.gate.y;
  const frontX=cx+Math.sin(p.rotationY)*1,frontY=cz+Math.cos(p.rotationY)*1;
  expect((frontX-last.x)*streetY-(frontY-last.y)*streetX).toBeCloseTo(0,5);
  expect(garageFootprintInside(parcel,p,sim.state.terrain.size)).toBe(true);
 });
 it("derives road and camera poses from parcel cells",()=>{
  const info=testbedParcelInfo(parcel,sim.state.terrain.size),d=info.streetDir;
  expect(info.gateWorld[0]).toBe((parcel.gate.x-sim.state.terrain.size/2)*4);
  expect(info.drivewayWorld).toHaveLength(parcel.driveway.length);
  expect((info.roadCentreWorld[0]-info.drivewayWorld[0]![0])*d[0]+(info.roadCentreWorld[2]-info.drivewayWorld[0]![2])*d[1]).toBeCloseTo(7);
  const modes=["aerial","street-gate","driveway-approach","garage-closed","garage-open"] as const;
  const positions=modes.map(m=>testbedCameraPose(m,0,info).position.map(n=>n.toFixed(3)).join(","));
  expect(positions[3]).toBe(positions[4]);
  expect(new Set(positions.slice(0,4)).size).toBe(4);
  expect(garageDoorTime(0)).toBe(0);expect(garageDoorTime(13)).toBe(1);
  expect(garageDoorTime(0,"open")).toBe(1);expect(garageDoorTime(13,"closed")).toBe(0);
 });
});
