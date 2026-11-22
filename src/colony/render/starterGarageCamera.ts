import type { Parcel } from "../neighborhood";
import type { Cell } from "../pathfind";
import { CELL_SIZE } from "../scale";
import { starterGaragePlacement, parcelStreetDirection } from "./starterGaragePlacement";
export type TestbedCameraMode = "aerial"|"street-gate"|"driveway-approach"|"garage-closed"|"garage-open"|"drive"|"walk"|"board"|"board-line"|"street-mixed"|"for-sale-board"|"street-view"|"slope-aerial"|"slope-side";
export function resolveTestbedCameraMode(raw:string|null):TestbedCameraMode {
 const aliases:Record<string,TestbedCameraMode>={"01-aerial":"aerial","02-street-gate":"street-gate","03-driveway-approach":"driveway-approach","04-garage-door-closed":"garage-closed","05-garage-door-open":"garage-open",garage:"garage-closed"};
 const mode=raw??"aerial";
 return aliases[mode]??(mode==="aerial"||mode==="street-gate"||mode==="driveway-approach"||mode==="garage-closed"||mode==="garage-open"||mode==="drive"||mode==="walk"||mode==="board"||mode==="board-line"||mode==="street-mixed"||mode==="for-sale-board"||mode==="street-view"||mode==="slope-aerial"||mode==="slope-side"?mode:"aerial");
}
export interface TestbedParcelInfo {
 parcelCells:{minX:number;maxX:number;minY:number;maxY:number}; gateWorld:[number,number,number];
 drivewayWorld:[number,number,number][]; garageWorld:[number,number,number]; streetDir:[number,number]; roadCentreWorld:[number,number,number];
 plotCentre:[number,number,number]; frontCentre:[number,number,number]; mapSize:number; roadCellsWorld:[number,number,number][];
}
const world=(c:Cell,size:number):[number,number,number]=>[(c.x-size/2)*CELL_SIZE,0,(c.y-size/2)*CELL_SIZE];
export function testbedParcelInfo(parcel:Parcel,mapSize:number,carriage:Cell[]=[]):TestbedParcelInfo {
 const cells=[...parcel.fence,...parcel.driveway,parcel.gate],xs=cells.map(c=>c.x),ys=cells.map(c=>c.y);
 const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
 const streetDir=parcelStreetDirection(parcel);
 const gateWorld=world(parcel.gate,mapSize),drivewayWorld=parcel.driveway.map(c=>world(c,mapSize));
 const placement=starterGaragePlacement(parcel,mapSize),garageWorld=placement.position;
 const plotCentre:[number,number,number]=[(minX+maxX-mapSize)/2*CELL_SIZE,0,(minY+maxY-mapSize)/2*CELL_SIZE];
 const frontCentre:[number,number,number]=[(minX+maxX-mapSize)/2*CELL_SIZE,0,gateWorld[2]];
 const roadCellsWorld=carriage.map(c=>world(c,mapSize));
 // The road centreline is 7 m street-ward from driveway[0] (the carriageway's outer edge).
 const roadCentreWorld:[number,number,number]=[drivewayWorld[0]![0]+streetDir[0]*7,0,drivewayWorld[0]![2]+streetDir[1]*7];
 return {parcelCells:{minX,maxX,minY,maxY},gateWorld,drivewayWorld,garageWorld,streetDir,roadCentreWorld,plotCentre,frontCentre,mapSize,roadCellsWorld};
}
type Pose={position:[number,number,number];lookAt:[number,number,number]};
const v=(x:number,y:number,z:number):[number,number,number]=>[x,y,z];
/** Keep every sloped-fixture view above the terrain along its complete sightline. */
export function slopeCameraPose(mode:TestbedCameraMode,info:TestbedParcelInfo,groundAt:(gx:number,gy:number)=>number,base:Pose):Pose {
 const worldGround=(x:number,z:number)=>groundAt(x/CELL_SIZE+info.mapSize/2,z/CELL_SIZE+info.mapSize/2);
 const [px,py,pz]=base.position,[lx,ly,lz]=base.lookAt;
 let required=Math.max(worldGround(px,pz)+2.5,worldGround(lx,lz)+2.5);
 const distance=Math.hypot(lx-px,lz-pz),steps=Math.max(1,Math.ceil(distance/2));
 for(let i=0;i<=steps;i++){const t=i/steps;required=Math.max(required,worldGround(px+(lx-px)*t,pz+(lz-pz)*t)+1.5);}
 const position:[number,number,number]=[px,Math.max(py,required),pz];
 if(mode!=="board-line")return {position,lookAt:base.lookAt};
 return {position,lookAt:base.lookAt};
}
export function testbedCameraPose(mode:TestbedCameraMode,t:number,info:TestbedParcelInfo,groundAt?:(gx:number,gy:number)=>number,boardWorld?:[number,number,number],rowCentre?:[number,number,number]):Pose {
 const {gateWorld:g,garageWorld:garage,streetDir:d,roadCentreWorld:r,drivewayWorld:path}=info;
 const left:[number,number]=[-d[1],d[0]];
 const along:[number,number]=[-d[1],d[0]];
 const at=(p:[number,number,number],a:number,b:number=0,c:number=0):[number,number,number]=>[p[0]+d[0]*a+left[0]*c,p[1]+b,p[2]+d[1]*a+left[1]*c];
 if(mode==="slope-aerial") return slopeCameraPose(mode,info,groundAt??(()=>0),{position:at(g,45,30,-35),lookAt:at(g,0,5,0)});
 if(mode==="slope-side") {const centre=info.plotCentre,signs=[1,-1];let best:[number,number,number]|null=null,bestGround=Infinity;for(const sign of signs){const x=centre[0]+left[0]*38*sign,z=centre[2]+left[1]*38*sign,gx=x/CELL_SIZE+info.mapSize/2,gy=z/CELL_SIZE+info.mapSize/2,ground=groundAt?groundAt(gx,gy):0,plotGround=groundAt?groundAt(centre[0]/CELL_SIZE+info.mapSize/2,centre[2]/CELL_SIZE+info.mapSize/2):centre[1];if(Math.max(ground,plotGround)<bestGround){bestGround=Math.max(ground,plotGround);best=[x,bestGround+3,z];}}const plotGround=groundAt?groundAt(centre[0]/CELL_SIZE+info.mapSize/2,centre[2]/CELL_SIZE+info.mapSize/2):centre[1];return slopeCameraPose(mode,info,groundAt??(()=>0),{position:best!,lookAt:[centre[0],plotGround+2,centre[2]]});}
 const door=v(garage[0]+d[0]*4,1.5,garage[2]+d[1]*4);
 if(mode==="aerial") {const pose={position:at(g,45,28),lookAt:door};return groundAt?slopeCameraPose(mode,info,groundAt,pose):pose;}
 if(mode==="street-mixed") return slopeCameraPose(mode,info,groundAt??(()=>0),{position:at(g,8,45,-20),lookAt:at(g,60,0,0)});
 if(mode==="street-view") return slopeCameraPose(mode,info,groundAt??(()=>0),{position:at(g,8,1.7,-8),lookAt:at(g,55,1.7,-8)});
 if(mode==="for-sale-board"||mode==="board") { const board=boardWorld??at(g,4.2,1.7,3.5),base={position:[board[0]-d[0]*7,board[1]+2.2,board[2]-d[1]*7] as [number,number,number],lookAt:board}; return mode==="for-sale-board"?slopeCameraPose(mode,info,groundAt??(()=>0),base):base; }
 if(mode==="board-line") {const centre=rowCentre??g,base={position:[centre[0]-d[0]*16,centre[1]+3.5,centre[2]-d[1]*16] as [number,number,number],lookAt:[centre[0]+along[0]*12,centre[1]+1.2,centre[2]+along[1]*12] as [number,number,number]};return slopeCameraPose(mode,info,groundAt??(()=>0),base);}
 if(mode==="street-gate") return slopeCameraPose(mode,info,groundAt??(()=>0),{position:at(g,14,1.5,-6),lookAt:door});
 if(mode==="driveway-approach") {const pose={position:at(g,-12,1.4),lookAt:door};return groundAt?slopeCameraPose(mode,info,groundAt,pose):pose;}
 if(mode==="garage-closed"||mode==="garage-open") {const pose={position:at(garage,11,1.5),lookAt:door};return groundAt?slopeCameraPose(mode,info,groundAt,pose):pose;}
 const u=Math.max(0,Math.min(1,t/14));
 if(mode==="walk") {const start=at(g,-2,1.7),end=at(garage,5,1.7);const p:[number,number,number]=[start[0]+(end[0]-start[0])*u,1.7+Math.sin(t*1.8)*.025,start[2]+(end[2]-start[2])*u];const pose={position:p,lookAt:door};return groundAt?slopeCameraPose(mode,info,groundAt,pose):pose;}
 // Follow the road for 60 m, turn into the gate, then track the driveway to the door.
 const roadAxis:[number,number]=[d[1],-d[0]],start=v(r[0]-roadAxis[0]*60,r[1]+1.4,r[2]-roadAxis[1]*60);
 const turn=v(g[0]+d[0]*5,1.4,g[2]+d[1]*5),driveEnd=at(garage,7,1.4),ease=(q:number)=>q*q*(3-2*q);
 const mix=(a:[number,number,number],b:[number,number,number],q:number):[number,number,number]=>[a[0]+(b[0]-a[0])*ease(q),1.4,a[2]+(b[2]-a[2])*ease(q)];
 const p: [number,number,number] = u<.45 ? mix(start,v(r[0],1.4,r[2]),u/.45) : u<.58 ? mix(v(r[0],1.4,r[2]),turn,(u-.45)/.13) : mix(turn,driveEnd,(u-.58)/.42);
 const look=u<.45?v(r[0]+roadAxis[0]*6,1.4,r[2]+roadAxis[1]*6):u<.58?turn:door;
 const pose={position:p,lookAt:look};return groundAt?slopeCameraPose(mode,info,groundAt,pose):pose;
}
export function garageDoorTime(t:number,override:"open"|"closed"|null=null):number {
 if(override==="open") return 1;
 if(override==="closed") return 0;
 return Math.max(0,Math.min(1,(t-9.5)/2.5));
}
export function drivewayGateTime(_t:number,closedOverride=false):number { return closedOverride?0:1; }

/** Gate leaves are authored at the hinges: their local origins are the pivot points. */
export function applyDrivewayGatePose(root:import("three").Object3D,amount:number):[number,number] {
 const open=Math.max(0,Math.min(1,amount));
 const left=root.getObjectByName("gate_leaf_left"),right=root.getObjectByName("gate_leaf_right");
 const leftAngle=-Math.PI/2*open,rightAngle=Math.PI/2*open;
 if(left)left.rotation.y=leftAngle;
 if(right)right.rotation.y=rightAngle;
 root.updateMatrixWorld(true);
 return [leftAngle,rightAngle];
}

/** Apply testbed state without depending on React or a rendered frame. */
export function applyTestbedTimeline(t:number, mode:TestbedCameraMode, doorOverride:"open"|"closed"|null, gateClosed:boolean) {
 const doorProgress=mode==="garage-open"?1:mode==="garage-closed"?0:garageDoorTime(t,doorOverride);
 return {t,doorProgress,gateAmount:drivewayGateTime(t,gateClosed)};
}

/** Pure timeline state used by the testbed API before asking R3F to draw. */
export function testbedFrameState(t:number, mode:TestbedCameraMode, info:TestbedParcelInfo, doorOverride:"open"|"closed"|null, gateClosed:boolean) {
 return {...applyTestbedTimeline(t,mode,doorOverride,gateClosed),camera:testbedCameraPose(mode,t,info)};
}
