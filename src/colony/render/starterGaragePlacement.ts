import type { Parcel } from "../neighborhood";
import { CELL_SIZE } from "../scale";
import { FLAT_GROUND, type GroundAt } from "./kitGround";
import { parcelStreetDirection } from "../parcelGeometry";
export { parcelStreetDirection } from "../parcelGeometry";

export interface GaragePlacement { position:[number,number,number]; rotationY:number; garageFloorY:number }
/** Center the 4 m frontage on the driveway, with the door at its inland end. */
export function starterGaragePlacement(parcel: Parcel, mapSize: number, groundAt: GroundAt = FLAT_GROUND): GaragePlacement {
 const inland=parcel.driveway[parcel.driveway.length-1] ?? parcel.gate, street=parcelStreetDirection(parcel);
 const x=(inland.x-mapSize/2)*CELL_SIZE, z=(inland.y-mapSize/2)*CELL_SIZE;
 const rotationY=Math.atan2(street[0],street[1]);
 // Front face is at the inland edge of the final driveway cell; body extends 8 m inland.
 const doorX=inland.x,doorY=inland.y;
 const garageFloorY=groundAt(doorX,doorY);
 return {position:[x-street[0]*6,garageFloorY,z-street[1]*6],rotationY,garageFloorY};
}

/** Grid-cell bounds check for the 4 x 8 m axis-aligned garage footprint. */
export function garageFootprintInside(parcel:Parcel, placement:GaragePlacement, mapSize:number):boolean {
 const cx=placement.position[0]/CELL_SIZE+mapSize/2, cy=placement.position[2]/CELL_SIZE+mapSize/2;
 const c=Math.cos(placement.rotationY),s=Math.sin(placement.rotationY);
 const corners=[[-.5,-1],[.5,-1],[-.5,1],[.5,1]].map(([x,z])=>[cx+x*c+z*s,cy-x*s+z*c]);
 const fenceXs=parcel.fence.map(c=>c.x),fenceYs=parcel.fence.map(c=>c.y);
 const inParcel=corners.every(([x,y])=>x!>=Math.min(...fenceXs)-.5&&x!<=Math.max(...fenceXs)+.5&&y!>=Math.min(...fenceYs)-.5&&y!<=Math.max(...fenceYs)+.5);
 return inParcel&&corners.every(([x,y])=>x!>=parcel.houseZone.x-.5&&x!<=parcel.houseZone.x+parcel.houseZone.w-.5&&y!>=parcel.houseZone.y-.5&&y!<=parcel.houseZone.y+parcel.houseZone.d-.5);
}
