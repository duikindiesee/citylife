import React,{Suspense,useEffect,useRef} from "react";
import {createRoot} from "react-dom/client";
import {Canvas,useThree} from "@react-three/fiber";
import {ContactShadows,useGLTF} from "@react-three/drei";
import * as THREE from "three";
import {ColonySim} from "../sim";
import {pickSlopeFixture, type SlopeFixtureKind} from "./slopeFixtures";
import {gradePlot} from "../slope/plotGrading";
import {housePoseForParcel} from "../render/housePlacement";
import {parcelFencePlacements} from "../render/parcelFencePlacement";
import {forSaleBoardPlacement} from "../render/forSaleBoardPlacement";
import {makeNeighborhoodAt,PARCEL_TIER_LABEL} from "../neighborhood";
import type {Parcel} from "../neighborhood";
import {CELL_SIZE} from "../scale";
import {plotBoardPriceKco} from "../landPrice";
import {starterGaragePlacement} from "../render/starterGaragePlacement";
import {ParcelFence} from "../render/ParcelFence";
import {StarterGarage} from "../render/StarterGarage";
import {ForSaleBoard} from "../render/ForSaleBoard";
import {testbedCameraPose,testbedParcelInfo,applyTestbedTimeline,applyDrivewayGatePose,resolveTestbedCameraMode,testbedFrameState} from "../render/starterGarageCamera";
import {testbedGroundRects,ROAD_LENGTH} from "../render/testbedSurfaces";
import "./fenceGarageTestbed.css";
const requestedFixture=(new URLSearchParams(location.search).get("fixture")||"flat") as SlopeFixtureKind;
const fixture=pickSlopeFixture(["downhill","uphill","gentle","flat"].includes(requestedFixture)?requestedFixture:"flat");
const sim=fixture.runtime.sim;
const neighborhood=sim.state.neighborhood??makeNeighborhoodAt(sim.state.terrain,sim.state.terrain.landing,{small:false});
const testbedParcels=fixture.neighbours;
const parcel:Parcel=fixture.parcel;
const terrainGround=fixture.groundAt;
const kitParcel=(p:Parcel):Parcel=>p.fenceType==="fence"?p:{...p,fenceType:"fence"};
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
function EnvelopeHouse({p,grading}:{p:Parcel;grading:ReturnType<typeof gradePlot>}){const {scene}=useGLTF("/assets/citylife/houses/estate-motor-home-seed9.glb");const model=React.useMemo(()=>scene.clone(true),[scene]);const pose=housePoseForParcel(p,fixture.mapSize,grading);const size=React.useMemo(()=>new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()),[model]);model.userData.runtimeFootprintM={w:size.x,d:size.z};return <primitive object={model} position={pose.position} rotation={[0,pose.rotationY,0]}/>;}
function Heightfield(){const geometry=React.useMemo(()=>{const centre=parcel.gate,span=90,segments=span*2,positions:number[]=[],indices:number[]=[];for(let z=0;z<=segments;z++)for(let x=0;x<=segments;x++){const ox=x-span,oz=z-span,gx=centre.x+ox/CELL_SIZE,gy=centre.y+oz/CELL_SIZE;positions.push((centre.x-fixture.mapSize/2)*CELL_SIZE+ox,terrainGround(gx,gy),(centre.y-fixture.mapSize/2)*CELL_SIZE+oz);}for(let z=0;z<segments;z++)for(let x=0;x<segments;x++){const a=z*(segments+1)+x,b=a+1,c=a+segments+1,d=c+1;indices.push(a,c,b,b,c,d);}const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();return g;},[]);return <mesh geometry={geometry} receiveShadow><meshStandardMaterial color="#90a96a" side={THREE.DoubleSide}/></mesh>;}
function DrapeCell({gx,gy,color}:{gx:number;gy:number;color:string}){const geometry=React.useMemo(()=>{const positions=[gx-.5,gy-.5,gx+.5,gy-.5,gx+.5,gy+.5,gx-.5,gy+.5],vertices:number[]=[];for(let i=0;i<positions.length;i+=2){const x=positions[i]!,y=positions[i+1]!;vertices.push((x-fixture.mapSize/2)*CELL_SIZE,terrainGround(x,y)+.03,(y-fixture.mapSize/2)*CELL_SIZE);}const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(vertices,3));g.setIndex([0,1,2,0,2,3]);g.computeVertexNormals();return g;},[gx,gy]);return <mesh geometry={geometry}><meshStandardMaterial color={color} side={THREE.DoubleSide}/></mesh>;}
function DriveRamp(){const geometry=React.useMemo(()=>{const [streetX,streetY]=info.streetDir,innerX=-streetX,innerY=-streetY;const length=fixture.grading.drive.stationsM.at(-1)??0,steps=Math.max(1,Math.ceil(length));const vertices:number[]=[],indices:number[]=[];for(let i=0;i<=steps;i++){const along=Math.min(length,i),t=length>0?along/length:0;let k=0;while(k<fixture.grading.drive.stationsM.length-2&&fixture.grading.drive.stationsM[k+1]!<along)k++;const a=fixture.grading.drive.stationsM[k]??0,b=fixture.grading.drive.stationsM[k+1]??length,ya=fixture.grading.drive.y[k]??fixture.grading.streetY,yb=fixture.grading.drive.y[k+1]??fixture.grading.garageFloorY;const y=ya+(yb-ya)*(b>a?(along-a)/(b-a):t);const gx=parcel.gate.x+innerX*along/CELL_SIZE,gy=parcel.gate.y+innerY*along/CELL_SIZE;for(const side of [-1,1]){const px=-innerY*side*1.5/CELL_SIZE,py=innerX*side*1.5/CELL_SIZE;vertices.push((gx+px-fixture.mapSize/2)*CELL_SIZE,Math.max(y,terrainGround(gx+px,gy+py)-.25)+.03,(gy+py-fixture.mapSize/2)*CELL_SIZE);}}for(let i=0;i<steps;i++){const a=i*2;indices.push(a,a+1,a+2,a+1,a+3,a+2);}const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(vertices,3));g.setIndex(indices);g.computeVertexNormals();return g;},[]);return <mesh geometry={geometry} receiveShadow><meshStandardMaterial color="#d5d1c3" side={THREE.DoubleSide}/></mesh>;}
function GradingEarthworks(){
 const pose=housePoseForParcel(parcel,fixture.mapSize,fixture.grading);
 const topY=fixture.grading.houseFloorY-.15;
 const street=info.streetDir,side:[number,number]=[-street[1],street[0]];
 const banks=fixture.grading.banks.map((bank,index)=>{
  const sign=index===0?1:-1,half=11.5/2;
  const inner=[pose.position[0]+street[0]*sign*half,pose.position[2]+street[1]*sign*half];
  const outer=[inner[0]+street[0]*sign*bank.lengthM,inner[1]+street[1]*sign*bank.lengthM];
  const left=[side[0]*half,side[1]*half],right=[-side[0]*half,-side[1]*half];
  const vertices=[
   inner[0]+left[0],topY,inner[1]+left[1], inner[0]+right[0],topY,inner[1]+right[1],
   outer[0]+right[0],terrainGround((outer[0]+right[0])/CELL_SIZE+fixture.mapSize/2,(outer[1]+right[1])/CELL_SIZE+fixture.mapSize/2),outer[1]+right[1],
   outer[0]+left[0],terrainGround((outer[0]+left[0])/CELL_SIZE+fixture.mapSize/2,(outer[1]+left[1])/CELL_SIZE+fixture.mapSize/2),outer[1]+left[1],
  ];
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(vertices,3));
  geometry.setIndex([0,1,2,0,2,3]);geometry.computeVertexNormals();
  return <mesh key={`bank${index}`} geometry={geometry}><meshStandardMaterial color="#b5a58d" side={THREE.DoubleSide}/></mesh>;
 });
 return <group>
  <mesh position={[pose.position[0],topY-.12,pose.position[2]]}><boxGeometry args={[11.5,.24,11.5]}/><meshStandardMaterial color="#b5a58d"/></mesh>
  {banks}
  {fixture.grading.retainingWalls.flatMap((wall,i)=>Array.from({length:wall.terraces},(_,step)=>{
   const x0=(wall.from[0]-fixture.mapSize/2)*CELL_SIZE,z0=(wall.from[1]-fixture.mapSize/2)*CELL_SIZE;
   const x1=(wall.to[0]-fixture.mapSize/2)*CELL_SIZE,z1=(wall.to[1]-fixture.mapSize/2)*CELL_SIZE;
   const length=Math.hypot(x1-x0,z1-z0),height=wall.faceHeightM;
   return <mesh key={`wall${i}-${step}`} position={[(x0+x1)/2,topY-height*(step+.5),(z0+z1)/2]} rotation={[0,Math.atan2(-(z1-z0),x1-x0),0]}>
    <boxGeometry args={[length,height,.23]}/><meshStandardMaterial color="#9a948a"/>
   </mesh>;
  }))}
 </group>;
}
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
  const placements=parcelFencePlacements(kitParcel(parcel),info.mapSize,terrainGround).filter(p=>Math.hypot(p.position[0]-origin.x,p.position[2]-origin.z)<=radius);
  return {radius,gateWorld:[origin.x,origin.y,origin.z],parcel:{gateCell:{x:parcel.gate.x,y:parcel.gate.y},side:parcel.side,streetDir:info.streetDir,selection:"first fenced parcel",fenceType:parcel.fenceType,w:parcel.w},instanceCounts,objects:entries,groups:grouped,placements};
 };
 useEffect(()=>{const parcels=testbedParcels.map(p=>({id:p.id,tier:p.tier,label:p.tier?PARCEL_TIER_LABEL[p.tier]:"Residential",wM:p.w*CELL_SIZE,dM:p.h*CELL_SIZE,areaM2:p.w*p.h*CELL_SIZE*CELL_SIZE,priceKco:plotBoardPriceKco(p,sim.state.terrain.distToWater[sim.state.terrain.idx(Math.round(p.x),Math.round(p.y))]??999),envelope:{wM:p.houseZone.w*CELL_SIZE,dM:p.houseZone.d*CELL_SIZE}}));const postGround=testbedParcels.flatMap(p=>parcelFencePlacements(kitParcel(p),fixture.mapSize,terrainGround).filter(item=>item.piece.startsWith("post")).map(item=>({parcelId:p.id,gx:item.position[0]/CELL_SIZE+fixture.mapSize/2,gy:item.position[2]/CELL_SIZE+fixture.mapSize/2,y:item.position[1],groundAt:terrainGround(item.position[0]/CELL_SIZE+fixture.mapSize/2,item.position[2]/CELL_SIZE+fixture.mapSize/2)})));const boardParcel=testbedParcels.find(p=>p.id!==parcel.id);const boardPose=boardParcel?forSaleBoardPlacement(boardParcel,fixture.mapSize,terrainGround):null;(window as any).__testbed={ready:true,info:{...info,fixture:fixture.kind,seed:fixture.seed,parcelId:parcel.id,grading:{band:fixture.grading.band,gradient:fixture.grading.gradient,garageMode:fixture.grading.garageMode,ok:fixture.grading.ok},housePose:housePoseForParcel(parcel,fixture.mapSize,fixture.grading),garageY:fixture.grading.garageFloorY,boardPose,postGround,parcels},setTime,getState,debugScene,duration:14};setTime(initial);return()=>{if((window as any).__testbed?.setTime===setTime)delete (window as any).__testbed};},[initial,mode,doorOverride,gateClosed]);
 const minX=Math.min(...testbedParcels.map(p=>p.x-p.w/2)),maxX=Math.max(...testbedParcels.map(p=>p.x+p.w/2)),minY=Math.min(...testbedParcels.map(p=>p.y-p.h/2)),maxY=Math.max(...testbedParcels.map(p=>p.y+p.h/2));
 const x=(minX+maxX-info.mapSize)/2*CELL_SIZE,z=(minY+maxY-info.mapSize)/2*CELL_SIZE;
 const d=info.streetDir;
 const surfaces=testbedGroundRects(info),kerb=surfaces.kerb,roadAlongX=Math.abs(d[1])>.5;
 const road=surfaces.road,drive=surfaces.drivewayRects.find(r=>r.name==="driveway")!;
 const gateAmount=applyTestbedTimeline(timeRef.current,mode,doorOverride,gateClosed).gateAmount;
 return <><color attach="background" args={["#a9d8ee"]}/><ambientLight intensity={1.7}/><directionalLight position={[30,50,20]} intensity={2.4} castShadow/>{fixture.kind==="flat"?<mesh rotation={[-Math.PI/2,0,0]} position={[x,-.12,z]} receiveShadow><planeGeometry args={[(maxX-minX+5)*CELL_SIZE,(maxY-minY+5)*CELL_SIZE]}/><meshStandardMaterial color="#90a96a"/></mesh>:<Heightfield/>}
 {fixture.kind==="flat"?<><mesh rotation={[-Math.PI/2,0,0]} position={[road.cx,0,road.cz]} receiveShadow><planeGeometry args={roadAlongX?[road.length,road.width]:[road.width,road.length]}/><meshStandardMaterial color="#45494b"/></mesh><mesh rotation={[-Math.PI/2,0,0]} position={[kerb[0],.04,kerb[1]]}><planeGeometry args={roadAlongX?[ROAD_LENGTH,.28]:[.28,ROAD_LENGTH]}/><meshStandardMaterial color="#d5d0bd"/></mesh><mesh rotation={[-Math.PI/2,0,0]} position={[drive.cx,.05,drive.cz]} receiveShadow><planeGeometry args={roadAlongX?[drive.width,drive.length]:[drive.length,drive.width]}/><meshStandardMaterial color="#d5d1c3"/></mesh></>:null}
 {neighborhood.carriage.map(c=>fixture.kind==="flat"?<mesh key={`c${c.x},${c.y}`} rotation={[-Math.PI/2,0,0]} position={[W(c.x),-.02,W(c.y)]}><planeGeometry args={[CELL_SIZE,CELL_SIZE]}/><meshStandardMaterial color="#45494b"/></mesh>:<DrapeCell key={`c${c.x},${c.y}`} gx={c.x} gy={c.y} color="#45494b"/>)}
 {neighborhood.verge.map(c=>fixture.kind==="flat"?<mesh key={`v${c.x},${c.y}`} rotation={[-Math.PI/2,0,0]} position={[W(c.x),-.04,W(c.y)]}><planeGeometry args={[CELL_SIZE,CELL_SIZE]}/><meshStandardMaterial color="#a7b58a"/></mesh>:<DrapeCell key={`v${c.x},${c.y}`} gx={c.x} gy={c.y} color="#a7b58a"/>)}
 {fixture.kind!=="flat"?<><GradingEarthworks/><DriveRamp/></>:null}
 {near.map((p,i)=><group key={`ctx${p.id}`}>{sold(p,i)?<EnvelopeHouse p={p} grading={gradePlot(p,terrainGround)}/>:null}</group>)}
 {testbedParcels.map(p=><group key={p.id}><ParcelFence parcel={kitParcel(p)} mapSize={info.mapSize} groundAt={terrainGround} gateOpen={p.id===parcel.id?gateAmount:0}/>{fixture.kind==="flat"?p.driveway.map(c=><mesh key={`d${c.x},${c.y}`} rotation={[-Math.PI/2,0,0]} position={[W(c.x),.03,W(c.y)]}><planeGeometry args={[CELL_SIZE,CELL_SIZE]}/><meshStandardMaterial color="#d5d1c3"/></mesh>):null}{!claimed&&!sold(p,near.indexOf(p))?<ForSaleBoard parcel={p} mapSize={info.mapSize} distToWater={sim.state.terrain.distToWater[sim.state.terrain.idx(Math.round(p.x),Math.round(p.y))]??999} groundAt={terrainGround}/>:null}{p.id===parcel.id&&claimed?<><EnvelopeHouse p={p} grading={fixture.grading}/><group ref={garageRef}><StarterGarage parcel={p} mapSize={info.mapSize} groundAt={terrainGround} floorY={fixture.grading.garageFloorY} doorTime={0}/></group></>:null}</group>)}

 <ContactShadows position={[x,.01,z]} opacity={.3} scale={100} blur={2}/></>;
}
function App(){return <><div className="testbed-label">CityLife dev test bed · parcel derived view</div><Canvas shadows camera={{position:[0,25,30],fov:48}}><Suspense fallback={null}><Scene/></Suspense></Canvas></>}
createRoot(document.getElementById("root")!).render(<App/>);
