import React,{Suspense,useEffect,useRef} from "react";
import {createRoot} from "react-dom/client";
import {Canvas,useThree} from "@react-three/fiber";
import {ContactShadows,useGLTF} from "@react-three/drei";
import * as THREE from "three";
import {ColonySim} from "../sim";
import {makeNeighborhoodAt,PARCEL_TIER_LABEL} from "../neighborhood";
import type {Parcel} from "../neighborhood";
import {CELL_SIZE} from "../scale";
import {plotBoardPriceKco} from "../landPrice";
import {parcelFencePlacements} from "../render/parcelFencePlacement";
import {starterGaragePlacement} from "../render/starterGaragePlacement";
import {ParcelFence} from "../render/ParcelFence";
import {StarterGarage} from "../render/StarterGarage";
import {ForSaleBoard} from "../render/ForSaleBoard";
import {testbedCameraPose,testbedParcelInfo,applyTestbedTimeline,applyDrivewayGatePose,resolveTestbedCameraMode,testbedFrameState} from "../render/starterGarageCamera";
import {testbedGroundRects,ROAD_LENGTH} from "../render/testbedSurfaces";
import "./fenceGarageTestbed.css";
const sim=new ColonySim(180);
const neighborhood=makeNeighborhoodAt(sim.state.terrain,sim.state.terrain.landing,{small:false});
const testbedParcels=neighborhood.parcels;
const parcel:Parcel=testbedParcels.find(p=>p.fenceType==="fence")!;
const info=testbedParcelInfo(parcel,sim.state.terrain.size,neighborhood.carriage);
// Round 11 street context: real carriage/verge cells, every parcel boundary, and real-metre house
// envelopes on "sold" neighbours so the mixed tiers read in measure from the air and the street.
const W=(c:number)=>(c-sim.state.terrain.size/2)*CELL_SIZE;
const bounds=(p:Parcel)=>{const ring=[...p.fence,p.gate];return {x0:W(Math.min(...ring.map(c=>c.x))-.5),x1:W(Math.max(...ring.map(c=>c.x))+.5),z0:W(Math.min(...ring.map(c=>c.y))-.5),z1:W(Math.max(...ring.map(c=>c.y))+.5)};};
const near=testbedParcels.filter(p=>Math.hypot(W(p.gate.x)-W(parcel.gate.x),W(p.gate.y)-W(parcel.gate.y))<=110);
const sold=(p:Parcel,i:number)=>p.id!==parcel.id&&i%2===1;
function streetPose(mode:string):{position:[number,number,number];lookAt:[number,number,number]}|null{
 const d=info.streetDir,g=info.gateWorld;const along:[number,number]=[-d[1],d[0]];
 if(mode==="street-mixed"){const bs=near.map(bounds);const cx=(Math.min(...bs.map(b=>b.x0))+Math.max(...bs.map(b=>b.x1)))/2,cz=(Math.min(...bs.map(b=>b.z0))+Math.max(...bs.map(b=>b.z1)))/2;return {position:[cx+d[0]*95-along[0]*20,85,cz+d[1]*95-along[1]*20],lookAt:[cx-d[0]*8,0,cz-d[1]*8]};}
 if(mode==="street-view"){const e:[number,number,number]=[g[0]+d[0]*7+along[0]*-6,1.7,g[2]+d[1]*7+along[1]*-6];return {position:e,lookAt:[e[0]+along[0]*60-d[0]*14,1.2,e[2]+along[1]*60-d[1]*14]};}
 return null;
}
function Boundary({p}:{p:Parcel}){const b=bounds(p),h=p.fenceType==="wall"?1.5:1.1,t=p.fenceType==="wall"?.25:.6,col=p.fenceType==="wall"?"#cfc6b6":"#4f7a3a";const gx=W(p.gate.x);const front=p.side===1?b.z0:b.z1,back=p.side===1?b.z1:b.z0;
 const seg=(x0:number,z0:number,x1:number,z1:number,k:string)=>{const l=Math.hypot(x1-x0,z1-z0);if(l<.05)return null;return <mesh key={k} position={[(x0+x1)/2,h/2,(z0+z1)/2]} rotation={[0,Math.atan2(-(z1-z0),x1-x0),0]}><boxGeometry args={[l,h,t]}/><meshStandardMaterial color={col}/></mesh>;};
 return <group>{[seg(b.x0,front,gx-1.85,front,"fl"),seg(gx+1.85,front,b.x1,front,"fr"),seg(b.x0,back,b.x1,back,"b"),seg(b.x0,b.z0,b.x0,b.z1,"l"),seg(b.x1,b.z0,b.x1,b.z1,"r")]}</group>;}
function EnvelopeHouse({p}:{p:Parcel}){const z=p.houseZone,w=z.w*CELL_SIZE-.5,dd=z.d*CELL_SIZE-.5,cx=W(z.x+(z.w-1)/2),cz=W(z.y+(z.d-1)/2),r=Math.hypot(w,dd)/2;
 return <group position={[cx,0,cz]}><mesh position={[0,1.5,0]} castShadow><boxGeometry args={[w,3,dd]}/><meshStandardMaterial color="#efe6d6"/></mesh><mesh position={[0,4.1,0]} rotation={[0,Math.PI/4,0]} scale={[w/(r*Math.SQRT2),1,dd/(r*Math.SQRT2)]} castShadow><coneGeometry args={[r,2.2,4]}/><meshStandardMaterial color="#d9772b"/></mesh></group>;}
function Scene(){const store=useThree();const {camera,scene}=store;const params=new URLSearchParams(location.search);const mode=resolveTestbedCameraMode(params.get("cam"));const claimed=params.get("claimed")!=="0";const initial=Number(params.get("t")||0);const doorOverride=params.get("door")==="open"?"open":params.get("door")==="closed"?"closed":null;const gateClosed=params.get("gate")==="closed";const timeRef=useRef(initial);const garageRef=React.useRef<THREE.Group>(null);
 const applyDoor=(progress:number)=>{const door=garageRef.current?.getObjectByName("door");if(!door)return;const clip=useGLTF("/assets/citylife/props/starter-garage.glb").animations.find(a=>a.name==="door_open");const pt=clip?.tracks.find(track=>track.name.endsWith("door.position")),qt=clip?.tracks.find(track=>track.name.endsWith("door.quaternion"));if(pt&&pt.values.length>=6){const closed=Array.from(pt.values.slice(0,3)),open=Array.from(pt.values.slice(pt.values.length-3));door.userData.closedPosition=closed;door.userData.openPosition=open;door.position.set(...closed.map((v,i)=>v+(open[i]!-v)*progress) as [number,number,number]);}if(qt&&qt.values.length>=8){const closed=Array.from(qt.values.slice(0,4)),open=Array.from(qt.values.slice(qt.values.length-4));door.quaternion.copy(new THREE.Quaternion(...closed as [number,number,number,number]).slerp(new THREE.Quaternion(...open as [number,number,number,number]),progress));}door.userData.testbedDoorProgress=progress;door.updateMatrix();};
 const setTime=(t:number):Promise<void>=>{const state=testbedFrameState(t,mode,info,doorOverride,gateClosed);timeRef.current=t;const pose=streetPose(mode)??state.camera;camera.position.set(...pose.position);camera.lookAt(...pose.lookAt);camera.updateMatrixWorld(true);applyDoor(state.doorProgress);scene.updateMatrixWorld(true);store.get().gl.render(scene,camera);return new Promise(resolve=>setTimeout(resolve,0));};
 const getState=()=>{scene.updateMatrixWorld(true);const door=garageRef.current?.getObjectByName("door"),gate=scene.getObjectByName("gate_leaf_left")?.parent,left=gate?.getObjectByName("gate_leaf_left"),right=gate?.getObjectByName("gate_leaf_right"),box=(o:THREE.Object3D|null|undefined)=>{if(!o)return null;const b=new THREE.Box3().setFromObject(o);return {min:{x:b.min.x,y:b.min.y,z:b.min.z},max:{x:b.max.x,y:b.max.y,z:b.max.z}};};return {t:timeRef.current,camera:[camera.position.x,camera.position.y,camera.position.z],doorProgress:door?.userData.testbedDoorProgress??0,gateLeftAngle:left?.rotation.y??0,gateRightAngle:right?.rotation.y??0,gateLeafBoxes:{left:box(left),right:box(right)}};};
 const debugScene=(radius=8)=>{
  scene.updateMatrixWorld(true);
  const origin=new THREE.Vector3(info.gateWorld[0],0,info.gateWorld[2]);
  const entries:Array<{name:string;parentChainNames:string[];type:string;worldBoxMin:{x:number;y:number;z:number};worldBoxMax:{x:number;y:number;z:number};visible:boolean;geometryVertexCount:number|null;materialColor:string|null;topLevelAncestor:string;centreDistance:number}> = [];
  scene.traverse(object=>{
   if(!(object instanceof THREE.Mesh)&&!(object instanceof THREE.Group))return;
   const bounds=new THREE.Box3().setFromObject(object);if(bounds.isEmpty())return;
   const centre=bounds.getCenter(new THREE.Vector3());const horizontalDistance=Math.hypot(centre.x-origin.x,centre.z-origin.z);if(horizontalDistance>radius)return;
   const parents:string[]=[];let parent=object.parent;while(parent&&parents.length<4){parents.push(parent.name||parent.type);parent=parent.parent;}
   let top:THREE.Object3D=object;while(top.parent&&top.parent!==scene)top=top.parent;
   const meshes:THREE.Mesh[]=[];if(object instanceof THREE.Mesh)meshes.push(object);else object.traverse(child=>{if(child instanceof THREE.Mesh)meshes.push(child);});
   const vertexCounts=meshes.map(mesh=>mesh.geometry.getAttribute("position")?.count??0);
   const colors=meshes.flatMap(mesh=>Array.isArray(mesh.material)?mesh.material:[mesh.material]).map(material=>{const color=(material as THREE.MeshStandardMaterial).color;return color?.isColor?`#${color.getHexString()}`:null;}).filter((color):color is string=>color!==null);
   entries.push({name:object.name||"(unnamed)",parentChainNames:parents,type:object.type,worldBoxMin:{x:bounds.min.x,y:bounds.min.y,z:bounds.min.z},worldBoxMax:{x:bounds.max.x,y:bounds.max.y,z:bounds.max.z},visible:object.visible,geometryVertexCount:vertexCounts.length?vertexCounts.reduce((sum,n)=>sum+n,0):null,materialColor:colors.length?[...new Set(colors)].join(","):null,topLevelAncestor:top.name||top.type,centreDistance:horizontalDistance});
  });
  const grouped:Record<string,typeof entries>={};for(const entry of entries)(grouped[entry.topLevelAncestor]??=[]).push(entry);
  const instanceCounts:Record<string,number>={};for(const entry of entries)if(entry.type==="Group"&&entry.name!=="(unnamed)")instanceCounts[entry.name]=(instanceCounts[entry.name]??0)+1;
  const placements=parcelFencePlacements(parcel,info.mapSize).filter(p=>Math.hypot(p.position[0]-origin.x,p.position[2]-origin.z)<=radius);
  return {radius,gateWorld:[origin.x,origin.y,origin.z],parcel:{gateCell:{x:parcel.gate.x,y:parcel.gate.y},side:parcel.side,streetDir:info.streetDir,selection:"first fenced parcel",fenceType:parcel.fenceType,w:parcel.w},instanceCounts,objects:entries,groups:grouped,placements};
 };
 useEffect(()=>{const parcels=testbedParcels.map(p=>({id:p.id,tier:p.tier,label:p.tier?PARCEL_TIER_LABEL[p.tier]:"Residential",wM:p.w*CELL_SIZE,dM:p.h*CELL_SIZE,areaM2:p.w*p.h*CELL_SIZE*CELL_SIZE,priceKco:plotBoardPriceKco(p,sim.state.terrain.distToWater[sim.state.terrain.idx(Math.round(p.x),Math.round(p.y))]??999),envelope:{wM:p.houseZone.w*CELL_SIZE,dM:p.houseZone.d*CELL_SIZE}}));(window as any).__testbed={ready:true,info:{...info,parcels},setTime,getState,debugScene,duration:14};setTime(initial);return()=>{if((window as any).__testbed?.setTime===setTime)delete (window as any).__testbed};},[initial,mode,doorOverride,gateClosed]);
 const minX=Math.min(...testbedParcels.map(p=>p.x-p.w/2)),maxX=Math.max(...testbedParcels.map(p=>p.x+p.w/2)),minY=Math.min(...testbedParcels.map(p=>p.y-p.h/2)),maxY=Math.max(...testbedParcels.map(p=>p.y+p.h/2));
 const x=(minX+maxX-info.mapSize)/2*CELL_SIZE,z=(minY+maxY-info.mapSize)/2*CELL_SIZE;
 const d=info.streetDir;
 const surfaces=testbedGroundRects(info),kerb=surfaces.kerb,roadAlongX=Math.abs(d[1])>.5;
 const road=surfaces.road,drive=surfaces.drivewayRects.find(r=>r.name==="driveway")!;
 const gateAmount=applyTestbedTimeline(timeRef.current,mode,doorOverride,gateClosed).gateAmount;
 return <><color attach="background" args={["#a9d8ee"]}/><ambientLight intensity={1.7}/><directionalLight position={[30,50,20]} intensity={2.4} castShadow/><mesh rotation={[-Math.PI/2,0,0]} position={[x,-.12,z]} receiveShadow><planeGeometry args={[(maxX-minX+5)*CELL_SIZE,(maxY-minY+5)*CELL_SIZE]}/><meshStandardMaterial color="#90a96a"/></mesh>
 <mesh rotation={[-Math.PI/2,0,0]} position={[road.cx,0,road.cz]} receiveShadow><planeGeometry args={roadAlongX?[road.length,road.width]:[road.width,road.length]}/><meshStandardMaterial color="#45494b"/></mesh>
 <mesh rotation={[-Math.PI/2,0,0]} position={[kerb[0],.04,kerb[1]]}><planeGeometry args={roadAlongX?[ROAD_LENGTH,.28]:[.28,ROAD_LENGTH]}/><meshStandardMaterial color="#d5d0bd"/></mesh>
 <mesh rotation={[-Math.PI/2,0,0]} position={[drive.cx,.05,drive.cz]} receiveShadow><planeGeometry args={roadAlongX?[drive.width,drive.length]:[drive.length,drive.width]}/><meshStandardMaterial color="#d5d1c3"/></mesh>
 {neighborhood.carriage.map(c=><mesh key={`c${c.x},${c.y}`} rotation={[-Math.PI/2,0,0]} position={[W(c.x),-.02,W(c.y)]}><planeGeometry args={[CELL_SIZE,CELL_SIZE]}/><meshStandardMaterial color="#45494b"/></mesh>)}
 {neighborhood.verge.map(c=><mesh key={`v${c.x},${c.y}`} rotation={[-Math.PI/2,0,0]} position={[W(c.x),-.04,W(c.y)]}><planeGeometry args={[CELL_SIZE,CELL_SIZE]}/><meshStandardMaterial color="#a7b58a"/></mesh>)}
 {near.map((p,i)=><group key={`ctx${p.id}`}>{p.fenceType!=="fence"?<Boundary p={p}/>:null}{sold(p,i)?<EnvelopeHouse p={p}/>:null}{p.driveway.map(c=><mesh key={`d${c.x},${c.y}`} rotation={[-Math.PI/2,0,0]} position={[W(c.x),.03,W(c.y)]}><planeGeometry args={[CELL_SIZE,CELL_SIZE]}/><meshStandardMaterial color="#d5d1c3"/></mesh>)}{!claimed&&!sold(p,i)&&p.fenceType!=="fence"?<ForSaleBoard parcel={p} mapSize={info.mapSize} distToWater={sim.state.terrain.distToWater[sim.state.terrain.idx(Math.round(p.x),Math.round(p.y))]??999}/>:null}</group>)}
 {testbedParcels.filter(p=>p.fenceType==="fence").map(p=><group key={p.id}><ParcelFence parcel={p} mapSize={info.mapSize} gateOpen={p.id===parcel.id?gateAmount:0}/>{!claimed&&!sold(p,near.indexOf(p))?<ForSaleBoard parcel={p} mapSize={info.mapSize} distToWater={sim.state.terrain.distToWater[sim.state.terrain.idx(Math.round(p.x),Math.round(p.y))]??999}/>:null}{p.id===parcel.id&&claimed?<group ref={garageRef}><StarterGarage parcel={p} mapSize={info.mapSize} doorTime={0}/></group>:null}</group>)}

 <ContactShadows position={[x,.01,z]} opacity={.3} scale={100} blur={2}/></>;
}
function App(){return <><div className="testbed-label">CityLife dev test bed · parcel derived view</div><Canvas shadows camera={{position:[0,25,30],fov:48}}><Suspense fallback={null}><Scene/></Suspense></Canvas></>}
createRoot(document.getElementById("root")!).render(<App/>);
