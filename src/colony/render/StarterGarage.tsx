import React, { useMemo, useLayoutEffect } from "react";
import { useGLTF } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Parcel } from "../neighborhood";
import { starterGaragePlacement } from "./starterGaragePlacement";
import { FLAT_GROUND, type GroundAt } from "./kitGround";
export function StarterGarage({parcel,mapSize,doorTime=0,groundAt=FLAT_GROUND,floorY}: {parcel:Parcel;mapSize:number;doorTime?:number;groundAt?:GroundAt;floorY?:number}) {
 const pose=useMemo(()=>starterGaragePlacement(parcel,mapSize,groundAt,floorY),[parcel,mapSize,groundAt,floorY]);
 const {scene}=useGLTF("/assets/citylife/props/starter-garage.glb");
 const clone=useMemo(()=>scene.clone(true),[scene]);
 const {invalidate}=useThree();
 useLayoutEffect(()=>{
  const door=clone.getObjectByName("door");
  if(door){
   const openClip=scene.animations.find(a=>a.name==="door_open");
   const positionTrack=openClip?.tracks.find(track=>track.name.endsWith("door.position"));
   const quaternionTrack=openClip?.tracks.find(track=>track.name.endsWith("door.quaternion"));
   if(positionTrack&&positionTrack.values.length>=6){door.userData.closedPosition=[...positionTrack.values.slice(0,3)];door.userData.openPosition=[...positionTrack.values.slice(positionTrack.values.length-3)];}
   if(quaternionTrack&&quaternionTrack.values.length>=8){door.userData.closedQuaternion=[...quaternionTrack.values.slice(0,4)];door.userData.openQuaternion=[...quaternionTrack.values.slice(quaternionTrack.values.length-4)];}
   const progress=Math.max(0,Math.min(1,doorTime));
   door.userData.testbedDoorProgress=progress;
   const closed=door.userData.closedPosition as number[]|undefined,open=door.userData.openPosition as number[]|undefined;
   if(closed&&open)door.position.set(...closed.map((v,i)=>v+(open[i]!-v)*progress) as [number,number,number]);
   const closedQ=door.userData.closedQuaternion as number[]|undefined,openQ=door.userData.openQuaternion as number[]|undefined;
   if(closedQ&&openQ){const a=new THREE.Quaternion(...closedQ as [number,number,number,number]),b=new THREE.Quaternion(...openQ as [number,number,number,number]);door.quaternion.copy(a).slerp(b,progress);}
   door.updateMatrix(); door.updateMatrixWorld(true);
  }
  invalidate();
 },[clone,doorTime,invalidate,scene]);
 return <group position={pose.position} rotation={[0,pose.rotationY,0]}><primitive object={clone}/></group>;
}
