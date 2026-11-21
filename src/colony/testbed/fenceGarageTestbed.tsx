import React,{Suspense,useEffect,useRef} from "react";
import {createRoot} from "react-dom/client";
import {Canvas,useThree} from "@react-three/fiber";
import {ContactShadows,useGLTF} from "@react-three/drei";
import * as THREE from "three";
import {ColonySim} from "../sim";
import {makeNeighborhoodAt,ESTATE} from "../neighborhood";
import type {Parcel} from "../neighborhood";
import {CELL_SIZE} from "../scale";
import {parcelFencePlacements} from "../render/parcelFencePlacement";
import {starterGaragePlacement} from "../render/starterGaragePlacement";
import {ParcelFence} from "../render/ParcelFence";
import {StarterGarage} from "../render/StarterGarage";
import {testbedCameraPose,testbedParcelInfo,applyTestbedTimeline,applyDrivewayGatePose,resolveTestbedCameraMode,testbedFrameState} from "../render/starterGarageCamera";
import "./fenceGarageTestbed.css";
const sim=new ColonySim(180);
const neighborhood=makeNeighborhoodAt(sim.state.terrain,sim.state.terrain.landing,{small:false});
const testbedParcels=neighborhood.parcels;
const parcel:Parcel=testbedParcels.find(p=>p.fenceType==="fence"&&p.w===ESTATE.W)??testbedParcels.find(p=>p.fenceType==="fence")!;
const info=testbedParcelInfo(parcel,sim.state.terrain.size,neighborhood.carriage);
useGLTF.preload("/assets/citylife/props/picket-for-sale-sign.glb");
function Scene(){const store=useThree();const {camera,scene}=store;const params=new URLSearchParams(location.search);const mode=resolveTestbedCameraMode(params.get("cam"));const initial=Number(params.get("t")||0);const doorOverride=params.get("door")==="open"?"open":params.get("door")==="closed"?"closed":null;const gateClosed=params.get("gate")==="closed";const timeRef=useRef(initial);const garageRef=React.useRef<THREE.Group>(null);
 const applyDoor=(progress:number)=>{const door=garageRef.current?.getObjectByName("door");if(!door)return;const clip=useGLTF("/assets/citylife/props/starter-garage.glb").animations.find(a=>a.name==="door_open");const pt=clip?.tracks.find(track=>track.name.endsWith("door.position")),qt=clip?.tracks.find(track=>track.name.endsWith("door.quaternion"));if(pt&&pt.values.length>=6){const closed=Array.from(pt.values.slice(0,3)),open=Array.from(pt.values.slice(pt.values.length-3));door.userData.closedPosition=closed;door.userData.openPosition=open;door.position.set(...closed.map((v,i)=>v+(open[i]!-v)*progress) as [number,number,number]);}if(qt&&qt.values.length>=8){const closed=Array.from(qt.values.slice(0,4)),open=Array.from(qt.values.slice(qt.values.length-4));door.quaternion.copy(new THREE.Quaternion(...closed as [number,number,number,number]).slerp(new THREE.Quaternion(...open as [number,number,number,number]),progress));}door.userData.testbedDoorProgress=progress;door.updateMatrix();};
 const setTime=(t:number):Promise<void>=>{const state=testbedFrameState(t,mode,info,doorOverride,gateClosed);timeRef.current=t;camera.position.set(...state.camera.position);camera.lookAt(...state.camera.lookAt);camera.updateMatrixWorld(true);applyDoor(state.doorProgress);scene.updateMatrixWorld(true);store.get().gl.render(scene,camera);return new Promise(resolve=>setTimeout(resolve,0));};
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
  return {radius,gateWorld:[origin.x,origin.y,origin.z],parcel:{gateCell:{x:parcel.gate.x,y:parcel.gate.y},side:parcel.side,streetDir:info.streetDir,selection:"first fenced parcel with w === ESTATE.W; otherwise first fenced parcel",fenceType:parcel.fenceType,w:parcel.w},instanceCounts,objects:entries,groups:grouped,placements};
 };
 useEffect(()=>{(window as any).__testbed={ready:true,info,setTime,getState,debugScene,duration:14};setTime(initial);return()=>{if((window as any).__testbed?.setTime===setTime)delete (window as any).__testbed};},[initial,mode,doorOverride,gateClosed]);
 const sign=useGLTF("/assets/citylife/props/picket-for-sale-sign.glb");
 const minX=info.parcelCells.minX,maxX=info.parcelCells.maxX,minY=info.parcelCells.minY,maxY=info.parcelCells.maxY;
 const x=(minX+maxX-info.mapSize)/2*CELL_SIZE,z=(minY+maxY-info.mapSize)/2*CELL_SIZE;
 const sx=info.roadCentreWorld[0],sz=info.roadCentreWorld[2];
 const d=info.streetDir,left:[number,number]=[-d[1],d[0]],roadLength=120,roadWidth=9,roadAlongX=Math.abs(d[1])>.5;
 const doorFace:[number,number]=[info.garageWorld[0]+d[0]*4,info.garageWorld[2]+d[1]*4];
 const kerb:[number,number]=[sx-d[0]*roadWidth/2,sz-d[1]*roadWidth/2];
 const driveLength=Math.hypot(doorFace[0]-kerb[0],doorFace[1]-kerb[1]);
 const driveMid:[number,number]=[(doorFace[0]+kerb[0])/2,(doorFace[1]+kerb[1])/2];
 const gateAmount=applyTestbedTimeline(timeRef.current,mode,doorOverride,gateClosed).gateAmount;
 return <><color attach="background" args={["#a9d8ee"]}/><ambientLight intensity={1.7}/><directionalLight position={[30,50,20]} intensity={2.4} castShadow/><mesh rotation={[-Math.PI/2,0,0]} position={[x,-.12,z]} receiveShadow><planeGeometry args={[(maxX-minX+5)*CELL_SIZE,(maxY-minY+5)*CELL_SIZE]}/><meshStandardMaterial color="#90a96a"/></mesh>
 <mesh rotation={[-Math.PI/2,0,0]} position={[sx,0,sz]} receiveShadow><planeGeometry args={roadAlongX?[roadLength,roadWidth]:[roadWidth,roadLength]}/><meshStandardMaterial color="#45494b"/></mesh>
 <mesh rotation={[-Math.PI/2,0,0]} position={[kerb[0],.04,kerb[1]]}><planeGeometry args={roadAlongX?[roadLength,.28]:[.28,roadLength]}/><meshStandardMaterial color="#d5d0bd"/></mesh>
 <mesh rotation={[-Math.PI/2,0,0]} position={[driveMid[0],.05,driveMid[1]]} receiveShadow><planeGeometry args={roadAlongX?[4,driveLength]:[driveLength,4]}/><meshStandardMaterial color="#d5d1c3"/></mesh>
 <mesh rotation={[-Math.PI/2,0,0]} position={[kerb[0]+d[0]*1.2,.06,kerb[1]+d[1]*1.2]}><planeGeometry args={roadAlongX?[5,2.4]:[2.4,5]}/><meshStandardMaterial color="#d5d1c3"/></mesh>
 <ParcelFence parcel={parcel} mapSize={info.mapSize} gateOpen={gateAmount}/><group ref={garageRef}><StarterGarage parcel={parcel} mapSize={info.mapSize} doorTime={0}/></group>
 <primitive object={sign.scene.clone(true)} position={[info.gateWorld[0]+left[0]*3,0,kerb[1]+d[1]*.4]} rotation={[0,Math.atan2(d[0],d[1]),0]}/>
 <ContactShadows position={[x,.01,z]} opacity={.3} scale={100} blur={2}/></>;
}
function App(){return <><div className="testbed-label">CityLife dev test bed · parcel derived view</div><Canvas shadows camera={{position:[0,25,30],fov:48}}><Suspense fallback={null}><Scene/></Suspense></Canvas></>}
createRoot(document.getElementById("root")!).render(<App/>);
