import React, { useMemo } from "react";
import * as THREE from "three";
import type { Parcel } from "../neighborhood";
import { plotBoardPriceKco, plotPricePerM2Kco, plotSizeM } from "../landPrice";
import { CELL_SIZE } from "../scale";

function boardTexture(parcel: Parcel, distToWater: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 320;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#f7f2df"; ctx.fillRect(0, 0, 512, 320);
  ctx.strokeStyle = "#67492e"; ctx.lineWidth = 12; ctx.strokeRect(8, 8, 496, 304);
  ctx.textAlign = "center"; ctx.fillStyle = "#243526";
  ctx.font = "bold 43px sans-serif"; ctx.fillText("LAND FOR SALE", 256, 66);
  const size = plotSizeM({W:parcel.w,D:parcel.h,setback:0,houseDepth:0,gardenDepth:0,farmDepth:0,inset:0});
  ctx.font = "bold 40px sans-serif"; ctx.fillText(`${size.w} × ${size.d} m`, 256, 126);
  ctx.font = "32px sans-serif"; ctx.fillText(`${size.areaM2.toLocaleString("en-US")} m²`, 256, 174);
  ctx.font = "bold 48px sans-serif"; ctx.fillText(`${plotBoardPriceKco(parcel,distToWater)} KCO`, 256, 238);
  ctx.font = "24px sans-serif"; ctx.fillText(`${plotPricePerM2Kco().toFixed(4)} KCO/m²`, 256, 282);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function ForSaleBoard({parcel,mapSize,distToWater}:{parcel:Parcel;mapSize:number;distToWater:number}) {
  const texture = useMemo(() => boardTexture(parcel,distToWater),[parcel,distToWater]);
  const dx = parcel.driveway[0]!.x - parcel.gate.x;
  const dy = parcel.driveway[0]!.y - parcel.gate.y;
  // One cell to the parcel's left of the gate, outside the driveway corridor.
  const x = (parcel.gate.x - dy - mapSize/2) * CELL_SIZE;
  const z = (parcel.gate.y + dx - mapSize/2) * CELL_SIZE;
  return <group position={[x,0,z]} rotation={[0,Math.atan2(dx,dy),0]}>
    <mesh position={[0,1.35,0]}><boxGeometry args={[1.2,1.5,.12]}/><meshStandardMaterial color="#60452d"/></mesh>
    <mesh position={[0,1.5,.071]}><planeGeometry args={[1.5,.94]}/><meshBasicMaterial map={texture} toneMapped={false}/></mesh>
  </group>;
}
