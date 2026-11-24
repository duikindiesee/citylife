import type { Parcel } from "../neighborhood";
import { CELL_SIZE } from "../scale";
import { FLAT_GROUND, type GroundAt } from "./kitGround";

export type FencePiece = "panel" | "post-line" | "post-corner" | "post-end" | "gate-driveway";
export interface FencePlacement { piece: FencePiece; position: [number, number, number]; rotationY: number; length?: number; bottomGapMax?: number; postExtra?: number }

/** Place a 2 m picket rhythm on the true parcel boundary with a 3.7 m gate opening. */
export function parcelFencePlacements(parcel: Parcel, mapSize: number, groundAt: GroundAt = FLAT_GROUND): FencePlacement[] {
  if (parcel.fenceType !== "fence") return [];
  const ring = [...parcel.fence, parcel.gate];
  const minX = Math.min(...ring.map(c => c.x)) - .5, maxX = Math.max(...ring.map(c => c.x)) + .5;
  const minY = Math.min(...ring.map(c => c.y)) - .5, maxY = Math.max(...ring.map(c => c.y)) + .5;
  const world = (x:number,y:number):[number,number,number] => [(x-mapSize/2)*CELL_SIZE,groundAt(x,y),(y-mapSize/2)*CELL_SIZE];
  const out:FencePlacement[]=[];
  const frontY=parcel.gate.y+(parcel.side===1?-.5:.5), gateX=(parcel.gate.x-mapSize/2)*CELL_SIZE, gateZ=(frontY-mapSize/2)*CELL_SIZE;
  const postExtras = new Map<string, number>();
  const post=(x:number,y:number)=>out.push({piece:"post-line",position:world(x,y),rotationY:0,postExtra:postExtras.get(`${x},${y}`) ?? 0});
  const panel=(x:number,z:number,length:number,rotationY:number,gx0:number,gy0:number,gx1:number,gy1:number)=>{
    const y0=groundAt(gx0,gy0),y1=groundAt(gx1,gy1),base=Math.max(y0,y1);
    let gap=0;
    for(let i=0;i<5;i++){const t=i/4;gap=Math.max(gap,base-groundAt(gx0+(gx1-gx0)*t,gy0+(gy1-gy0)*t));}
    for(const [gx,gy,gyGround] of [[gx0,gy0,y0],[gx1,gy1,y1]] as const){const k=`${gx},${gy}`;postExtras.set(k,Math.max(postExtras.get(k)??0,Math.max(0,base-gyGround)));}
    out.push({piece:"panel",position:[x,base,z],rotationY,length,bottomGapMax:gap});
  };
  const run=(a:number,b:number,fixed:number,horizontal:boolean,gate:boolean)=>{
    const coord=(q:number)=>horizontal?world(q,fixed)[0]:world(fixed,q)[2];
    const lo=Math.min(coord(a),coord(b)),hi=Math.max(coord(a),coord(b)),points:number[]=[];
    for(let q=lo;q<=hi+1e-6;q+=2)points.push(q);if(Math.abs(points.at(-1)!-hi)>1e-6)points.push(hi);
    const toCell=(q:number)=>q/CELL_SIZE+mapSize/2, axisGate=horizontal?gateX:gateZ, gl=axisGate-1.85,gr=axisGate+1.85,glo=Math.min(gl,gr),ghi=Math.max(gl,gr);
    const addPost=(q:number)=>horizontal?post(toCell(q),fixed):post(fixed,toCell(q));
    const fix=horizontal?world(0,fixed)[2]:world(fixed,0)[0],rot=horizontal?0:Math.PI/2;
    const addPanel=(q0:number,q1:number)=>horizontal
      ? panel((q0+q1)/2,fix,q1-q0,rot,toCell(q0),fixed,toCell(q1),fixed)
      : panel(fix,(q0+q1)/2,q1-q0,rot,fixed,toCell(q0),fixed,toCell(q1));
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
  out.push({piece:"gate-driveway",position:[gateX,groundAt(parcel.gate.x,frontY),gateZ],rotationY:parcel.side===1?0:Math.PI});
  // Re-apply calculated extensions after all adjacent panels have contributed their grade delta.
  for(const placement of out){if(placement.piece==="post-line"){const gx=placement.position[0]/CELL_SIZE+mapSize/2,gy=placement.position[2]/CELL_SIZE+mapSize/2;placement.postExtra=postExtras.get(`${gx},${gy}`)??0;}}
  return out;
}
