import {describe,it,expect} from "vitest";
import * as THREE from "three";
import {GLTFLoader} from "three/addons/loaders/GLTFLoader.js";
// @ts-ignore - Vitest runs in Node; project tsconfig intentionally omits Node globals.
import {readFileSync} from "node:fs";
import {ColonySim} from "../src/colony/sim";
import {makeNeighborhoodAt,ESTATE} from "../src/colony/neighborhood";
import {parcelFencePlacements} from "../src/colony/render/parcelFencePlacement";
import {starterGaragePlacement,garageFootprintInside} from "../src/colony/render/starterGaragePlacement";
import {testbedParcelInfo,testbedCameraPose,garageDoorTime,drivewayGateTime,applyDrivewayGatePose,testbedFrameState,resolveTestbedCameraMode} from "../src/colony/render/starterGarageCamera";
describe("fence garage testbed assets and parcel",()=>{
 it("keeps the gate open and opens the garage door along the drive timeline",()=>{
  expect(garageDoorTime(0)).toBe(0);
  expect(garageDoorTime(13)).toBe(1);
  expect(garageDoorTime(0)).toBe(0);
  expect(garageDoorTime(14)).toBe(1);
  let previous=0;for(let i=0;i<=140;i++){const value=garageDoorTime(i/10);expect(value).toBeGreaterThanOrEqual(previous);previous=value;}
  expect(garageDoorTime(9.5)).toBe(0);expect(garageDoorTime(12)).toBe(1);
  for(const t of [0,4,9,12,14])expect(drivewayGateTime(t)).toBe(1);
 });
 it("uses one ParcelFence gate instance in the testbed and reports per-piece instance counts",()=>{
  const source=readFileSync(new URL("../src/colony/testbed/fenceGarageTestbed.tsx",import.meta.url),"utf8");
  expect((source.match(/<ParcelFence\b/g)??[]).length).toBeGreaterThan(0);
  expect((source.match(/<primitive object=\{gateRoot\}/g)??[])).toHaveLength(0);
  expect(source).toMatch(/gateOpen=\{p\.id===displayParcel\.id\?gateAmount:0\}/);
  expect(source).toContain("instanceCounts");
  expect(source).toContain("instanceCounts[entry.name]");
 });
 it("places fence, garage, and gate within the parcel",()=>{
  const sim=new ColonySim(180),parcels=makeNeighborhoodAt(sim.state.terrain,sim.state.terrain.landing,{small:false}).parcels,parcel=parcels.find(p=>p.fenceType==="fence"&&p.w===ESTATE.W)??parcels.find(p=>p.fenceType==="fence")!;
  const placements=parcelFencePlacements(parcel,sim.state.terrain.size),garage=starterGaragePlacement(parcel,sim.state.terrain.size);
  expect(placements.length).toBeGreaterThan(0);expect(placements.some(p=>p.piece==="gate-driveway")).toBe(true);
  expect(placements.filter(p=>p.piece==="gate-driveway")).toHaveLength(1);
  const xs=parcel.fence.map(c=>c.x),ys=parcel.fence.map(c=>c.y),gx=garage.position[0]/4+sim.state.terrain.size/2,gz=garage.position[2]/4+sim.state.terrain.size/2;
  expect(gx).toBeGreaterThanOrEqual(Math.min(...xs));expect(gx).toBeLessThanOrEqual(Math.max(...xs));expect(gz).toBeGreaterThanOrEqual(Math.min(...ys));expect(gz).toBeLessThanOrEqual(Math.max(...ys));
  expect(garageFootprintInside(parcel,garage,sim.state.terrain.size)).toBe(true);
  const info=testbedParcelInfo(parcel,sim.state.terrain.size),roadDelta=[info.roadCentreWorld[0]-info.drivewayWorld[0]![0],info.roadCentreWorld[2]-info.drivewayWorld[0]![2]];
  expect(roadDelta[0]*info.streetDir[0]+roadDelta[1]*info.streetDir[1]).toBeGreaterThan(0);
  const shots=["aerial","street-gate","driveway-approach","garage-closed","garage-open","board"] as const;
  const shotPositions=shots.map(mode=>testbedCameraPose(mode,0,info).position.join(","));
  expect(shotPositions[3]).toBe(shotPositions[4]);
  expect(new Set(shotPositions.slice(0,4)).size).toBe(4);
  expect(parcel.fence.some(c=>(Math.abs(c.x-parcel.gate.x)+Math.abs(c.y-parcel.gate.y))===1)).toBe(true);
  const gateCellEdges=placements.filter(p=>p.piece==="panel"&&Math.abs(p.position[0]-info.gateWorld[0])<1.86&&Math.abs(p.position[2]-info.gateWorld[2])<1.86);
  expect(gateCellEdges.length).toBe(0); // gate lane stays clear; neighboring edges remain panelled.
 });
 it("keeps every moving gate mesh under a leaf and clears the lane when open",async()=>{
  const bytes=readFileSync(new URL("../public/assets/citylife/props/picket-fence-gate-driveway.glb",import.meta.url));
  const gltf=await new Promise<any>((resolve,reject)=>new GLTFLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),"",resolve,reject));
  const movingMeshes:any[]=[];gltf.scene.traverse((o:any)=>{if(o.isMesh){let p=o.parent,leaf=false;while(p){if(p.name==="gate_leaf_left"||p.name==="gate_leaf_right")leaf=true;p=p.parent;}if(!leaf)movingMeshes.push(o);}});
  expect(movingMeshes.map(m=>m.name).sort()).toEqual(["Gate_Post_Shaft","Gate_Post_Shaft_1"]);
  const gate=gltf.scene.clone(true),angles=applyDrivewayGatePose(gate,1);gate.updateMatrixWorld(true);
  expect(angles[0]).toBeCloseTo(-Math.PI/2);expect(angles[1]).toBeCloseTo(Math.PI/2);
  const lane=new THREE.Box3(new THREE.Vector3(-1.6,0,-Infinity),new THREE.Vector3(1.6,1.3,Infinity));
  const allOpen=new THREE.Box3();gate.traverse((o:any)=>{if(o.isMesh)allOpen.union(new THREE.Box3().setFromObject(o));});
  // Posts sit at the lane edges, but no mesh bbox may overlap the lane's X/Y opening.
  const openMeshes:any[]=[];gate.traverse((o:any)=>{if(o.isMesh)openMeshes.push(o);});
  expect(openMeshes.every(mesh=>{const b=new THREE.Box3().setFromObject(mesh);return b.max.x<=lane.min.x||b.min.x>=lane.max.x||b.max.y<=lane.min.y||b.min.y>=lane.max.y;})).toBe(true);
  expect(allOpen.isEmpty()).toBe(false);
  const closed=gltf.scene.clone(true);applyDrivewayGatePose(closed,0);closed.updateMatrixWorld(true);
  const leftBox=new THREE.Box3().setFromObject(closed.getObjectByName("gate_leaf_left")!),rightBox=new THREE.Box3().setFromObject(closed.getObjectByName("gate_leaf_right")!);
  expect(leftBox.min.x).toBeLessThan(-1.7);expect(leftBox.max.x).toBeCloseTo(0,1);expect(rightBox.max.x).toBeGreaterThan(1.7);expect(rightBox.min.x).toBeCloseTo(0,1);
  const source=readFileSync(new URL("../src/colony/render/ParcelFence.tsx",import.meta.url),"utf8");
  expect((source.match(/placements\.map\(/g)??[])).toHaveLength(1);
  expect((source.match(/models\[p\.piece\]/g)??[])).toHaveLength(1);
 });
 it("applies timeline state synchronously for capture time and load camera modes",()=>{
  const sim=new ColonySim(180),parcel=makeNeighborhoodAt(sim.state.terrain,sim.state.terrain.landing,{small:false}).parcels.find(p=>p.fenceType==="fence")!,info=testbedParcelInfo(parcel,sim.state.terrain.size);
  expect(testbedFrameState(13,resolveTestbedCameraMode("drive"),info,null,false)).toMatchObject({t:13,doorProgress:1,gateAmount:1});
  expect(testbedFrameState(0,resolveTestbedCameraMode("garage-open"),info,null,false).doorProgress).toBe(1);
  expect(testbedFrameState(0,resolveTestbedCameraMode("garage-closed"),info,null,false).doorProgress).toBe(0);
  expect(testbedFrameState(0,resolveTestbedCameraMode("drive"),info,"open",false).doorProgress).toBe(1);
 });
});
