import React, { useMemo } from "react";
import * as THREE from "three";
import type { Parcel } from "../neighborhood";
import { plotPricePerM2Kco, plotSizeM } from "../landPrice";
import { plotPriceBreakdown } from "../land";
import { COLONY } from "../config";
import { PARCEL_TIER_LABEL } from "../neighborhood";
import { forSaleBoardPlacement } from "./forSaleBoardPlacement";
import { FLAT_GROUND, type GroundAt } from "./kitGround";

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
  const bill=plotPriceBreakdown(size.areaM2,distToWater,COLONY.economy.land);
  const label=parcel.tier?PARCEL_TIER_LABEL[parcel.tier]:"Residential";
  ctx.font = "bold 30px sans-serif"; ctx.fillText(`${label} plot`, 256, 108);
  ctx.font = "bold 32px sans-serif"; ctx.fillText(`${size.w} × ${size.d} m`, 256, 150);
  ctx.font = "27px sans-serif"; ctx.fillText(`${size.areaM2.toLocaleString("en-US")} m²`, 256, 190);
  ctx.font = "bold 38px sans-serif"; ctx.fillText(`${bill.totalKco} KCO`, 256, 238);
  ctx.font = "22px sans-serif"; ctx.fillText(`${plotPricePerM2Kco().toFixed(2)} KCO/m²`, 256, 272);
  if(bill.premiumKco>0){ctx.font="18px sans-serif";ctx.fillText(`incl. +${bill.premiumKco} KCO waterfront`,256,302);}
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function ForSaleBoard({parcel,mapSize,distToWater,groundAt=FLAT_GROUND}:{parcel:Parcel;mapSize:number;distToWater:number;groundAt?:GroundAt}) {
  const texture = useMemo(() => boardTexture(parcel,distToWater),[parcel,distToWater]);
  const placement = useMemo(() => forSaleBoardPlacement(parcel,mapSize,groundAt),[parcel,mapSize,groundAt]);
  return <group position={placement.position} rotation={[0,placement.rotationY,0]}>
    <mesh position={[0,1.35,0]}><boxGeometry args={[1.2,1.5,.12]}/><meshStandardMaterial color="#60452d"/></mesh>
    <mesh position={[0,1.5,.071]}><planeGeometry args={[1.5,.94]}/><meshBasicMaterial map={texture} toneMapped={false}/></mesh>
  </group>;
}
