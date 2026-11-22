import type { Parcel } from "../neighborhood";
import { CELL_SIZE } from "../scale";

export type FencePiece = "panel" | "post-line" | "post-corner" | "post-end" | "gate-driveway";
export interface FencePlacement { piece: FencePiece; position: [number, number, number]; rotationY: number; length?: number }

/** Place a 2 m picket rhythm on the true parcel boundary with a 3.7 m gate opening. */
export function parcelFencePlacements(parcel: Parcel, mapSize: number): FencePlacement[] {
  if (parcel.fenceType !== "fence") return [];
  const ring = [...parcel.fence, parcel.gate];
  const minX = Math.min(...ring.map(c => c.x)) - .5, maxX = Math.max(...ring.map(c => c.x)) + .5;
  const minY = Math.min(...ring.map(c => c.y)) - .5, maxY = Math.max(...ring.map(c => c.y)) + .5;
  const world = (x:number,y:number):[number,number,number] => [(x-mapSize/2)*CELL_SIZE,0,(y-mapSize/2)*CELL_SIZE];
  const out:FencePlacement[]=[];
  const frontY=parcel.gate.y+(parcel.side===1?-.5:.5), gateX=(parcel.gate.x-mapSize/2)*CELL_SIZE, gateZ=(frontY-mapSize/2)*CELL_SIZE;
  const post=(x:number,y:number)=>out.push({piece:"post-line",position:world(x,y),rotationY:0});
  const panel=(x:number,z:number,length:number,rotationY:number)=>out.push({piece:"panel",position:[x,0,z],rotationY,length});
  const run=(a:number,b:number,fixed:number,horizontal:boolean,gate:boolean)=>{
    const coord=(q:number)=>horizontal?world(q,fixed)[0]:world(fixed,q)[2];
    const lo=Math.min(coord(a),coord(b)),hi=Math.max(coord(a),coord(b)),points:number[]=[];
    for(let q=lo;q<=hi+1e-6;q+=2)points.push(q);if(Math.abs(points.at(-1)!-hi)>1e-6)points.push(hi);
    const toCell=(q:number)=>q/CELL_SIZE+mapSize/2, axisGate=horizontal?gateX:gateZ, gl=axisGate-1.85,gr=axisGate+1.85,glo=Math.min(gl,gr),ghi=Math.max(gl,gr);
    const addPost=(q:number)=>horizontal?post(toCell(q),fixed):post(fixed,toCell(q));
    const fix=horizontal?world(0,fixed)[2]:world(fixed,0)[0],rot=horizontal?0:Math.PI/2;
    const addPanel=(q0:number,q1:number)=>panel(horizontal?(q0+q1)/2:fix,horizontal?fix:(q0+q1)/2,q1-q0,rot);
    if(!gate){points.forEach(addPost);for(let i=0;i<points.length-1;i++)addPanel(points[i]!,points[i+1]!);return;}
    const left=points.filter(q=>q<glo).at(-1)!,right=points.find(q=>q>ghi)!;
    points.filter(q=>q<=left||q>=right).forEach(addPost);addPost(gl);addPost(gr);
    const head=points.filter(q=>q<=left);for(let i=0;i<head.length-1;i++)addPanel(head[i]!,head[i+1]!);
    addPanel(left,gl);addPanel(gr,right);
    const rest=points.filter(q=>q>=right);for(let i=0;i<rest.length-1;i++)addPanel(rest[i]!,rest[i+1]!);
  };
  run(minX,maxX,minY,true,Math.abs(frontY-minY)<1e-6);
  run(minX,maxX,maxY,true,Math.abs(frontY-maxY)<1e-6);
  run(minY,maxY,minX,false,Math.abs(frontY-minY)>1e-6&&Math.abs(frontY-maxY)>1e-6&&parcel.side===1);
  run(minY,maxY,maxX,false,Math.abs(frontY-minY)>1e-6&&Math.abs(frontY-maxY)>1e-6&&parcel.side===-1);
  out.push({piece:"gate-driveway",position:[gateX,0,gateZ],rotationY:parcel.side===1?0:Math.PI});
  return out;
}
