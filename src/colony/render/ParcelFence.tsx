import React, { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import type { Parcel } from "../neighborhood";
import { parcelFencePlacements, type FencePiece } from "./parcelFencePlacement";
import { applyDrivewayGatePose } from "./starterGarageCamera";

const URL: Record<FencePiece,string> = {
 panel:"/assets/citylife/props/picket-fence-panel.glb", "post-line":"/assets/citylife/props/picket-fence-post-line.glb",
 "post-corner":"/assets/citylife/props/picket-fence-post-corner.glb", "post-end":"/assets/citylife/props/picket-fence-post-end.glb",
 "gate-driveway":"/assets/citylife/props/picket-fence-gate-driveway.glb"
};
export function ParcelFence({parcel,mapSize,gateOpen=0}: {parcel:Parcel;mapSize:number;gateOpen?:number}) {
 const placements=useMemo(()=>parcelFencePlacements(parcel,mapSize),[parcel,mapSize]);
 const panel=useGLTF(URL.panel).scene;
 const line=useGLTF(URL["post-line"]).scene;
 const corner=useGLTF(URL["post-corner"]).scene;
 const end=useGLTF(URL["post-end"]).scene;
 const gate=useGLTF(URL["gate-driveway"]).scene;
 const models:Record<FencePiece,THREE.Object3D>={panel,"post-line":line,"post-corner":corner,"post-end":end,"gate-driveway":gate};
 return <group>{placements.map((p,i)=>{const object=models[p.piece]!.clone(true);if(p.piece==="gate-driveway")applyDrivewayGatePose(object,gateOpen);return <primitive key={`${p.piece}-${i}`} object={object} position={p.position} rotation={[0,p.rotationY,0]}/>})}</group>;
}
