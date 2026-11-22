import type { Parcel } from "../neighborhood";
import type { Cell } from "../pathfind";
import { CELL_SIZE } from "../scale";
import { starterGaragePlacement, parcelStreetDirection } from "./starterGaragePlacement";
import { housePoseForParcel } from "./housePlacement";
import type { PlotGrading } from "../slope/plotGrading";
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
/** Return fixture landmarks on the terrain surface, preserving the authored garage floor. */
export function groundedInfo(info:TestbedParcelInfo,groundAt:(gx:number,gy:number)=>number,mapSize:number,garageFloorY:number):TestbedParcelInfo {
 const yAt=([x,,z]:[number,number,number])=>groundAt(x/CELL_SIZE+mapSize/2,z/CELL_SIZE+mapSize/2);
 const point=([x,,z]:[number,number,number]):[number,number,number]=>[x,yAt([x,0,z]),z];
 return {...info,gateWorld:point(info.gateWorld),drivewayWorld:info.drivewayWorld.map(point),garageWorld:[info.garageWorld[0],garageFloorY,info.garageWorld[2]],roadCentreWorld:point(info.roadCentreWorld),plotCentre:point(info.plotCentre),frontCentre:point(info.frontCentre),roadCellsWorld:info.roadCellsWorld.map(point)};
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
export interface FixtureCameraInputs {
 kind: "flat"|"downhill"|"uphill"|"gentle";
 houseParcel: Parcel;
 houseGrading: PlotGrading;
 mapSize: number;
 boardWorld?: [number,number,number];
 rowCentre?: [number,number,number];
 nearParcels: Parcel[];
 nearBounds?: {x0:number;x1:number;z0:number;z1:number}[];
}
const v=(x:number,y:number,z:number):[number,number,number]=>[x,y,z];
/** Keep every sloped-fixture view above the terrain along its complete sightline. */
export function slopeCameraPose(mode:TestbedCameraMode,info:TestbedParcelInfo,groundAt:(gx:number,gy:number)=>number,base:Pose):Pose {
 const worldGround=(x:number,z:number)=>groundAt(x/CELL_SIZE+info.mapSize/2,z/CELL_SIZE+info.mapSize/2);
 const eyeLevelModes=new Set<TestbedCameraMode>(["street-view","street-gate","driveway-approach","board","drive","walk"]);
 const [basePx,basePy,basePz]=base.position,[baseLx,baseLy,baseLz]=base.lookAt;
 let px=basePx,py=basePy,pz=basePz,lx=baseLx,ly=baseLy,lz=baseLz;
 if(eyeLevelModes.has(mode)) {
  const positionGround=worldGround(px,pz),lookGround=worldGround(lx,lz);
  py=Math.max(positionGround+basePy,positionGround+1.5);
  ly=baseLy<=4?lookGround+baseLy:Math.max(baseLy,lookGround+.5);
 }
 // Authored targets are offsets from the local ground in the fixture poses.
 // Keep every target above its own terrain sample before solving the ray.
 ly=Math.max(ly,worldGround(lx,lz)+1.5);
 const distance=Math.hypot(lx-px,lz-pz),steps=Math.max(1,Math.ceil(distance));
 let lookAt: [number,number,number]=[lx,ly,lz];
 if(mode==="board-line") {
  // Board shots need a clear metre above the actual terrain along the entire ray.
  // Keep the target at least 1.4 m above its ground, then lift the eye enough
  // that steep terrain between the row and target cannot cross the sightline.
  const targetGround=worldGround(lx,lz);
  lookAt=[lx,Math.max(ly,targetGround+1.4),lz];
 }
 const targetY=lookAt[1];
 let required=Math.max(worldGround(px,pz)+2.5,worldGround(lx,lz)+1.5);
 for(let i=0;i<=steps;i++){
  const t=i/steps,ground=worldGround(px+(lx-px)*t,pz+(lz-pz)*t);
  // Raising only the eye leaves the target low; solve for the eye height
  // required to keep each linearly interpolated sight sample above terrain.
  if(t<1) required=Math.max(required,(ground+1.0-targetY*t)/(1-t));
 }
 const position:[number,number,number]=[px,Math.max(py,required),pz];
 return {position,lookAt};
}
export function testbedCameraPose(mode:TestbedCameraMode,t:number,info:TestbedParcelInfo,groundAt?:(gx:number,gy:number)=>number,boardWorld?:[number,number,number],rowCentre?:[number,number,number],houseTarget?:[number,number,number]):Pose {
 const {gateWorld:g,garageWorld:garage,streetDir:d,roadCentreWorld:r,drivewayWorld:path}=info;
 const left:[number,number]=[-d[1],d[0]];
 const along:[number,number]=[-d[1],d[0]];
 const at=(p:[number,number,number],a:number,b:number=0,c:number=0):[number,number,number]=>[p[0]+d[0]*a+left[0]*c,p[1]+b,p[2]+d[1]*a+left[1]*c];
 if(mode==="slope-aerial") return slopeCameraPose(mode,info,groundAt??(()=>0),{position:at(g,45,30,-25),lookAt:at(g,0,5,0)});
 if(mode==="slope-side") {const centre=info.plotCentre,signs=[1,-1];let best:[number,number,number]|null=null,bestGround=Infinity;for(const sign of signs){const x=centre[0]+left[0]*34*sign,z=centre[2]+left[1]*34*sign,gx=x/CELL_SIZE+info.mapSize/2,gy=z/CELL_SIZE+info.mapSize/2,ground=groundAt?groundAt(gx,gy):0;if(ground<bestGround){bestGround=ground;best=[x,ground+3,z];}}const look=houseTarget??[centre[0],bestGround+2,centre[2]];return slopeCameraPose(mode,info,groundAt??(()=>0),{position:best!,lookAt:look});}
 const door=v(garage[0]+d[0]*4,garage[1]+1.5,garage[2]+d[1]*4);
 if(mode==="aerial") {const pose={position:at(g,45,28),lookAt:door};return groundAt?slopeCameraPose(mode,info,groundAt,pose):pose;}
 if(mode==="street-mixed") return slopeCameraPose(mode,info,groundAt??(()=>0),{position:at(g,8,45,-20),lookAt:at(g,60,0,0)});
 if(mode==="street-view") return slopeCameraPose(mode,info,groundAt??(()=>0),{position:at(g,8,1.7,-8),lookAt:at(g,55,1.7,-8)});
 if(mode==="for-sale-board"||mode==="board") { const board=boardWorld??at(g,4.2,1.7,3.5),base={position:[board[0]-d[0]*7,board[1]+2.2,board[2]-d[1]*7] as [number,number,number],lookAt:board}; return mode==="for-sale-board"?slopeCameraPose(mode,info,groundAt??(()=>0),base):base; }
 if(mode==="board-line") {const centre=boardWorld??rowCentre??g;const lookAt:[number,number,number]=[centre[0],centre[1]+.8,centre[2]],position:[number,number,number]=[centre[0]-d[0]*14,centre[1]+2.2,centre[2]-d[1]*14];return slopeCameraPose(mode,info,groundAt??(()=>0),{position,lookAt});}
 if(mode==="street-gate") return slopeCameraPose(mode,info,groundAt??(()=>0),{position:at(g,14,1.5,-6),lookAt:door});
 if(mode==="driveway-approach") {const pose={position:at(g,groundAt?-35:-12,groundAt?1.7:1.4),lookAt:door};return groundAt?slopeCameraPose(mode,info,groundAt,pose):pose;}
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

/** Single pose entry point shared by the real fixture scene and slope-camera tests. */
export function fixtureCameraPose(mode:TestbedCameraMode,t:number,info:TestbedParcelInfo,inputs:FixtureCameraInputs,groundAt:(gx:number,gy:number)=>number):Pose {
 const {kind,houseParcel,houseGrading,mapSize}=inputs;
 if(kind==="flat") return testbedCameraPose(mode,t,info,undefined,inputs.boardWorld??(mode==="for-sale-board"?info.gateWorld:undefined),inputs.rowCentre??info.plotCentre);
 const grounded=groundedInfo(info,groundAt,mapSize,houseGrading.garageFloorY);
 const board=inputs.boardWorld;
 const rowCentre=inputs.rowCentre?groundedInfo({...grounded,plotCentre:inputs.rowCentre},groundAt,mapSize,houseGrading.garageFloorY).plotCentre:grounded.plotCentre;
 const house=housePoseForParcel(houseParcel,mapSize,houseGrading);
 const houseTarget:[number,number,number]=[house.position[0],houseGrading.houseFloorY+3,house.position[2]];
 return testbedCameraPose(mode,t,grounded,groundAt,board??(mode==="for-sale-board"?grounded.gateWorld:undefined),rowCentre,houseTarget);
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
