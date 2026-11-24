import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { pickSlopeFixture, heightfieldWindow } from "../src/colony/testbed/slopeFixtures";
import { housePoseForParcel } from "../src/colony/render/housePlacement";
import { HOUSE_FOOTPRINT_M } from "../src/colony/render/housePlacement";
import { buildEarthworksGeometry, buildFixtureObjects } from "../src/colony/render/earthworksGeometry";
import { parcelFencePlacements } from "../src/colony/render/parcelFencePlacement";
import { forSaleBoardPlacement } from "../src/colony/render/forSaleBoardPlacement";
import { starterGaragePlacement } from "../src/colony/render/starterGaragePlacement";
import { gradePlot, SLOPE_LIMITS } from "../src/colony/slope/plotGrading";
import { CELL_SIZE } from "../src/colony/scale";
import { parcelStreetDirection } from "../src/colony/parcelGeometry";
import { fixtureCameraPose, testbedParcelInfo, type TestbedCameraMode } from "../src/colony/render/starterGarageCamera";
import { buildTestbedRoadDrape, streetAxisFromCarriage, TESTBED_ASPHALT, TESTBED_VERGE } from "../src/colony/render/testbedRoadDrape";

const cases = [
  ["downhill", "steep-downhill"],
  ["uphill", "steep-uphill"],
  ["gentle", "gentle"],
] as const;
const cameraModes: TestbedCameraMode[] = ["slope-aerial","slope-side","board-line","for-sale-board","street-mixed","street-view","street-gate","driveway-approach","aerial"];
const eyeLevelModes = new Set<TestbedCameraMode>(["street-view","street-gate","driveway-approach"]);

describe("sloped fence and garage testbed fixtures", () => {
  it.each(cases.map(([kind]) => kind))("builds terrain-following, faded %s street drapes with two outer kerbs", (kind) => {
    const fixture=pickSlopeFixture(kind), info=testbedParcelInfo(fixture.parcel,fixture.mapSize,fixture.carriage);
    const axis=streetAxisFromCarriage(fixture.carriage), across:[number,number]=[-axis[1],axis[0]];
    const meshes=buildTestbedRoadDrape({carriage:fixture.carriage,verge:fixture.verge,mapSize:fixture.mapSize,groundAt:fixture.groundAt,streetAxis:info.streetDir});
    const carriage=meshes.find(m=>m.kind==="fade")!,verges=meshes.filter(m=>m.kind==="verge"),kerbs=meshes.filter(m=>m.kind==="kerb");
    const pos=(m:typeof carriage)=>m.geometry.getAttribute("position"), col=carriage.geometry.getAttribute("color");
    expect(TESTBED_ASPHALT).toBe("#595f6a");
    const asphalt=new THREE.Color(TESTBED_ASPHALT),verge=new THREE.Color(TESTBED_VERGE);
    const stations=fixture.carriage.map(c=>c.x*axis[0]+c.y*axis[1]);
    const minStation=Math.min(...stations),maxStation=Math.max(...stations),midStation=(minStation+maxStation)/2;
    const midCandidates:number[]=[];
    for(let i=0;i<pos(carriage).count;i++){
      const x=pos(carriage).getX(i)/CELL_SIZE+fixture.mapSize/2,y=pos(carriage).getZ(i)/CELL_SIZE+fixture.mapSize/2;
      const station=x*axis[0]+y*axis[1];
      if(Math.abs(station-midStation)<1.25)midCandidates.push(i);
    }
    expect(midCandidates.length).toBeGreaterThan(0);
    const interior:number[]=[];
    for(let i=0;i<pos(carriage).count;i++){
      const p=pos(carriage),x=p.getX(i)/CELL_SIZE+fixture.mapSize/2,y=p.getZ(i)/CELL_SIZE+fixture.mapSize/2;
      const station=x*axis[0]+y*axis[1];
      if((station-minStation)*CELL_SIZE>10&&(maxStation-station)*CELL_SIZE>10)interior.push(i);
    }
    expect(interior.length).toBeGreaterThan(0);
    for(const i of interior){expect(Math.abs(col.getX(i)-asphalt.r)).toBeLessThanOrEqual(.02);expect(Math.abs(col.getY(i)-asphalt.g)).toBeLessThanOrEqual(.02);expect(Math.abs(col.getZ(i)-asphalt.b)).toBeLessThanOrEqual(.02);expect(pos(carriage).getY(i)-fixture.groundAt(pos(carriage).getX(i)/CELL_SIZE+fixture.mapSize/2,pos(carriage).getZ(i)/CELL_SIZE+fixture.mapSize/2)).toBeCloseTo(.07,2);}
    expect(kerbs).toHaveLength(2);
    for(const kerb of kerbs){
      const p=pos(kerb);let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
      for(let i=0;i<p.count;i++){
        const x=p.getX(i),z=p.getZ(i),gx=x/CELL_SIZE+fixture.mapSize/2,gy=z/CELL_SIZE+fixture.mapSize/2;
        minX=Math.min(minX,x);maxX=Math.max(maxX,x);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);
        expect(Number.isFinite(p.getY(i))).toBe(true);expect(Math.abs(p.getY(i)-fixture.groundAt(gx,gy)-.12)).toBeLessThanOrEqual(.2);
        const acrossOffset=gx*across[0]+gy*across[1];
        const carriageAcross=fixture.carriage.map(c=>c.x*across[0]+c.y*across[1]);
        const minAcross=Math.min(...carriageAcross)-.5,maxAcross=Math.max(...carriageAcross)+.5;
        expect(Math.min(Math.abs(acrossOffset-minAcross),Math.abs(acrossOffset-maxAcross))*CELL_SIZE).toBeLessThanOrEqual(.4);
      }
      const width=Math.min(maxX-minX,maxZ-minZ);
      expect(width).toBeGreaterThanOrEqual(.15);expect(width).toBeLessThanOrEqual(.30);
    }
    const fadeVertices:number[]=[];
    for(let i=0;i<pos(carriage).count;i++){
      const p=pos(carriage),gx=p.getX(i)/CELL_SIZE+fixture.mapSize/2,gy=p.getZ(i)/CELL_SIZE+fixture.mapSize/2;
      const station=gx*axis[0]+gy*axis[1];
      if(Math.min(station-minStation,maxStation-station)*CELL_SIZE<=6)fadeVertices.push(i);
    }
    expect(fadeVertices.length).toBeGreaterThan(0);
    expect(fadeVertices.some(i=>Math.hypot(col.getX(i)-verge.r,col.getY(i)-verge.g,col.getZ(i)-verge.b)<Math.hypot(asphalt.r-verge.r,asphalt.g-verge.g,asphalt.b-verge.b)||pos(carriage).getY(i)-fixture.groundAt(pos(carriage).getX(i)/CELL_SIZE+fixture.mapSize/2,pos(carriage).getZ(i)/CELL_SIZE+fixture.mapSize/2)<.06)).toBe(true);
    // Both terminal fade zones occupy ten metres of the sampled cell surface.
    for(const edge of ["min","max"]){const surfaceStations:number[]=[];for(let i=0;i<pos(carriage).count;i++){const p=pos(carriage),s=p.getX(i)/CELL_SIZE*axis[0]+p.getZ(i)/CELL_SIZE*axis[1];surfaceStations.push(s);}const extreme=edge==="min"?Math.min(...surfaceStations):Math.max(...surfaceStations),near=surfaceStations.filter(s=>Math.abs(s-extreme)*CELL_SIZE<=10.01);expect(near.length).toBeGreaterThan(0);expect(near.length).toBeLessThan(pos(carriage).count);}
    for(const m of [carriage,...verges,...kerbs]){const p=pos(m);for(let i=0;i<p.count;i++){const gx=p.getX(i)/CELL_SIZE+fixture.mapSize/2,gy=p.getZ(i)/CELL_SIZE+fixture.mapSize/2,y=p.getY(i);expect(Number.isFinite(y)).toBe(true);expect(Math.abs(y-fixture.groundAt(gx,gy))).toBeLessThanOrEqual(.25);}}
  });
  it.each(cases.map(([kind]) => kind))("covers all rendered %s geometry with finite terrain", (kind) => {
    const fixture = pickSlopeFixture(kind), window = heightfieldWindow(fixture);
    expect((window.maxGx-window.minGx)*CELL_SIZE).toBeLessThanOrEqual(320);
    expect((window.maxGy-window.minGy)*CELL_SIZE).toBeLessThanOrEqual(320);
    const inside=(gx:number,gy:number)=>{expect(gx).toBeGreaterThanOrEqual(window.minGx);expect(gx).toBeLessThanOrEqual(window.maxGx);expect(gy).toBeGreaterThanOrEqual(window.minGy);expect(gy).toBeLessThanOrEqual(window.maxGy);expect(Number.isFinite(fixture.groundAt(gx,gy))).toBe(true);};
    for(const p of fixture.neighbours){for(const c of p.fence)inside(c.x,c.y);const hw=p.houseZone.w/2,hh=p.houseZone.d/2;for(const [x,y] of [[p.houseZone.x-hw,p.houseZone.y-hh],[p.houseZone.x+hw,p.houseZone.y-hh],[p.houseZone.x+hw,p.houseZone.y+hh],[p.houseZone.x-hw,p.houseZone.y+hh]])inside(x,y);for(const c of p.driveway)inside(c.x,c.y);}
    for(const c of fixture.carriage)inside(c.x,c.y);
  });
  it.each(cases.map(([kind]) => kind))("keeps %s carriage in one connected street network", (kind) => {
    const fixture=pickSlopeFixture(kind), cells=fixture.carriage, keys=new Set(cells.map(c=>`${c.x},${c.y}`)), seen=new Set<string>();let largest=0;
    for(const cell of cells){const key=`${cell.x},${cell.y}`;if(seen.has(key))continue;let size=0,queue=[cell];seen.add(key);while(queue.length){const c=queue.pop()!;size++;for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const n=`${c.x+dx},${c.y+dy}`;if(keys.has(n)&&!seen.has(n)){seen.add(n);queue.push({x:c.x+dx,y:c.y+dy});}}}largest=Math.max(largest,size);}
    expect(largest).toBe(cells.length);
  });
  it.each(cases.map(([kind]) => kind))("keeps every %s fixture camera above its ground sightline", (kind) => {
    const fixture = pickSlopeFixture(kind);
    const info = testbedParcelInfo(fixture.parcel, fixture.mapSize, fixture.carriage);
    const near=fixture.neighbours.filter(p=>Math.hypot((p.gate.x-fixture.parcel.gate.x)*CELL_SIZE,(p.gate.y-fixture.parcel.gate.y)*CELL_SIZE)<=110);
    const board=near.find((p,i)=>p.id!==fixture.parcel.id&&(i%2===0||!gradePlot(p,fixture.groundAt).ok));
    const boardWorld = board ? forSaleBoardPlacement(board, fixture.mapSize, fixture.groundAt).position : undefined;
    const rowCentre:[number,number,number]=near.length?[near.reduce((sum,p)=>sum+(p.gate.x-fixture.mapSize/2)*CELL_SIZE,0)/near.length,0,near.reduce((sum,p)=>sum+(p.gate.y-fixture.mapSize/2)*CELL_SIZE,0)/near.length]:info.plotCentre;
    const nearBounds=near.map(p=>{const ring=[...p.fence,p.gate];return {x0:(Math.min(...ring.map(c=>c.x))-.5-fixture.mapSize/2)*CELL_SIZE,x1:(Math.max(...ring.map(c=>c.x))+.5-fixture.mapSize/2)*CELL_SIZE,z0:(Math.min(...ring.map(c=>c.y))-.5-fixture.mapSize/2)*CELL_SIZE,z1:(Math.max(...ring.map(c=>c.y))+.5-fixture.mapSize/2)*CELL_SIZE};});
    for (const mode of cameraModes) {
      const pose = fixtureCameraPose(mode, 7, info, {kind:fixture.kind,houseParcel:fixture.parcel,houseGrading:fixture.grading,mapSize:fixture.mapSize,boardWorld:boardWorld??info.gateWorld,rowCentre,nearParcels:near,nearBounds}, fixture.groundAt);
      const minClearance = eyeLevelModes.has(mode) ? 1.2 : 1.5;
      const gx = pose.position[0] / CELL_SIZE + fixture.mapSize / 2;
      const gy = pose.position[2] / CELL_SIZE + fixture.mapSize / 2;
      expect(pose.position[1] - fixture.groundAt(gx, gy), `${kind}/${mode} camera clearance`).toBeGreaterThan(minClearance);
      const distance = Math.hypot(pose.lookAt[0] - pose.position[0], pose.lookAt[2] - pose.position[2]);
      const samples = Math.max(1, Math.ceil(distance));
      for (let i = 0; i <= samples; i++) {
        const t = i / samples;
        const x = pose.position[0] + (pose.lookAt[0] - pose.position[0]) * t;
        const z = pose.position[2] + (pose.lookAt[2] - pose.position[2]) * t;
        const sightY=pose.position[1]+(pose.lookAt[1]-pose.position[1])*t;
        expect(sightY, `${kind}/${mode} sightline below terrain at ${t}`).toBeGreaterThanOrEqual(fixture.groundAt(x / CELL_SIZE + fixture.mapSize / 2, z / CELL_SIZE + fixture.mapSize / 2));
      }
      const camera=new THREE.PerspectiveCamera(48,16/9,0.1,2000);camera.position.set(...pose.position);camera.lookAt(...pose.lookAt);camera.updateMatrixWorld(true);
      expect(camera.up.clone().applyQuaternion(camera.quaternion).dot(new THREE.Vector3(0,1,0)),`${kind}/${mode} camera up`).toBeGreaterThan(0.5);
      const project=(p:[number,number,number])=>new THREE.Vector3(...p).project(camera);
      if(mode==="street-mixed") {
        const house=housePoseForParcel(fixture.parcel,fixture.mapSize,fixture.grading),centre=project([house.position[0],fixture.grading.houseFloorY+3,house.position[2]]);
        expect(Math.abs(centre.x),`${kind}/${mode} selected house centre x`).toBeLessThanOrEqual(.7);
        expect(Math.abs(centre.y),`${kind}/${mode} selected house centre y`).toBeLessThanOrEqual(.7);
        const visibleBoard=project(boardWorld??info.gateWorld);
        expect(Math.abs(visibleBoard.x),`${kind}/${mode} board x`).toBeLessThanOrEqual(.95);
        expect(Math.abs(visibleBoard.y),`${kind}/${mode} board y`).toBeLessThanOrEqual(.95);
      }
      if(mode==="slope-aerial"||mode==="slope-side"){
        const house=housePoseForParcel(fixture.parcel,fixture.mapSize,fixture.grading),centre=project([house.position[0],fixture.grading.houseFloorY+3,house.position[2]]);
        expect(Math.abs(centre.x),`${kind}/${mode} house centre x`).toBeLessThanOrEqual(.6);expect(Math.abs(centre.y),`${kind}/${mode} house centre y`).toBeLessThanOrEqual(.6);expect(centre.z,`${kind}/${mode} house centre depth`).toBeGreaterThan(-1);expect(centre.z).toBeLessThan(1);
        for(const [gx,gy] of house.corners){const corner=project([(gx-fixture.mapSize/2)*CELL_SIZE,fixture.grading.houseFloorY+3,(gy-fixture.mapSize/2)*CELL_SIZE]);expect(Math.abs(corner.x),`${kind}/${mode} house corner x`).toBeLessThanOrEqual(1);expect(Math.abs(corner.y),`${kind}/${mode} house corner y`).toBeLessThanOrEqual(1);}
      }
      if(mode==="for-sale-board"||mode==="board-line") {
        const target=boardWorld??info.gateWorld,ndc=project([target[0],target[1]+.8,target[2]]),street=board?parcelStreetDirection(board):fixture.parcel?parcelStreetDirection(fixture.parcel):info.streetDir;
        expect((pose.position[0]-target[0])*street[0]+(pose.position[2]-target[2])*street[1],`${kind}/${mode} camera on street side`).toBeGreaterThan(0);
        expect(Math.abs(ndc.x),`${kind}/${mode} board x`).toBeLessThanOrEqual(.6);
        expect(Math.abs(ndc.y),`${kind}/${mode} board y`).toBeLessThanOrEqual(.6);
      }
    }
  });
  it.each(cases.map(([kind]) => kind))("connects every %s fixture driveway to its real street", (kind) => {
    const fixture = pickSlopeFixture(kind);
    expect(fixture.carriage.length).toBeGreaterThanOrEqual(20);
    const nearest = Math.min(...fixture.carriage.map((cell) => Math.hypot(cell.x - fixture.parcel.gate.x, cell.y - fixture.parcel.gate.y)));
    expect(nearest).toBeLessThanOrEqual(5);
  });
  it.each(cases)("places the %s fixture on valid graded ground", (kind, expectedBand) => {
    const fixture = pickSlopeFixture(kind);
    const { parcel, grading, groundAt, mapSize } = fixture;
    expect(grading.band).toBe(expectedBand);
    expect(grading.ok).toBe(true);
    if (kind === "downhill") {
      expect(grading.houseFloorY - grading.streetY).toBeGreaterThanOrEqual(0);
      expect(grading.houseFloorY - grading.streetY).toBeLessThanOrEqual(0.5);
      expect(grading.garageFloorY).toBeCloseTo(grading.streetY, 2);
      expect(grading.padY).toBeCloseTo(grading.streetY, 2);
    }

    const pose = housePoseForParcel(parcel, mapSize, grading);
    expect(pose.position[1]+.15).toBeCloseTo(grading.houseFloorY,3);
    expect(pose.position[1]).toBeCloseTo(grading.padY,2);
    const ring = [...parcel.fence, parcel.gate];
    const bounds = {
      minX: Math.min(...ring.map((c) => c.x)) - 0.5,
      maxX: Math.max(...ring.map((c) => c.x)) + 0.5,
      minY: Math.min(...ring.map((c) => c.y)) - 0.5,
      maxY: Math.max(...ring.map((c) => c.y)) + 0.5,
    };
    const side = parcel.w * CELL_SIZE > 16 ? 2.5 : 1.5;
    const street = parcelStreetDirection(parcel);
    const parcelDepthM = (Math.abs(street[0]) * (bounds.maxX - bounds.minX) + Math.abs(street[1]) * (bounds.maxY - bounds.minY)) * CELL_SIZE;
    for (const [gx, gy] of pose.corners) {
      expect(gx).toBeGreaterThanOrEqual(bounds.minX + side / CELL_SIZE - 0.001);
      expect(gx).toBeLessThanOrEqual(bounds.maxX - side / CELL_SIZE + 0.001);
      expect(gy).toBeGreaterThanOrEqual(bounds.minY + side / CELL_SIZE - 0.001);
      expect(gy).toBeLessThanOrEqual(bounds.maxY - side / CELL_SIZE + 0.001);
      const streetProjection = (gx - parcel.gate.x) * street[0] + (gy - parcel.gate.y) * street[1];
      expect(streetProjection).toBeLessThanOrEqual(0.5 - 3 / CELL_SIZE + 0.001);
      expect(streetProjection).toBeGreaterThanOrEqual(0.5 - parcelDepthM / CELL_SIZE + 3 / CELL_SIZE - 0.001);
    }

    for (const post of parcelFencePlacements({ ...parcel, fenceType: "fence" }, mapSize, groundAt).filter((p) => p.piece.startsWith("post"))) {
      const gx = post.position[0] / CELL_SIZE + mapSize / 2;
      const gy = post.position[2] / CELL_SIZE + mapSize / 2;
      expect(post.position[1]).toBeCloseTo(groundAt(gx, gy), 3);
      expect(post.position[1]).toBeGreaterThan(0.5);
    }

    expect(starterGaragePlacement(parcel, mapSize, groundAt, grading.garageFloorY).garageFloorY).toBe(grading.garageFloorY);
    expect(grading.garageFloorY).toBeGreaterThan(0.5);
    expect(grading.drive.y[0]).toBeCloseTo(groundAt(parcel.gate.x, parcel.gate.y), 2);
    expect(grading.drive.y.at(-1)).toBeCloseTo(grading.garageFloorY, 3);
    const stations = grading.drive.stationsM;
    for (let i = 1; i < stations.length; i++) {
      const grade = Math.abs(grading.drive.y[i]! - grading.drive.y[i - 1]!) / (stations[i]! - stations[i - 1]!);
      expect(grade).toBeLessThanOrEqual((i === 1 ? SLOPE_LIMITS.driveMaxNearStreet : SLOPE_LIMITS.driveMax) + 1e-9);
    }
    expect(grading.retainingWalls.every((wall) => wall.faceHeightM <= 2)).toBe(true);

    const unsold = fixture.neighbours.find((p) => p.id !== parcel.id);
    expect(unsold).toBeDefined();
    if (unsold) {
      const board = forSaleBoardPlacement(unsold, mapSize, groundAt);
      const frontY = unsold.gate.y + (unsold.side === 1 ? -0.5 : 0.5);
      const streetDirection = parcelStreetDirection(unsold);
      const frontX = unsold.gate.x + streetDirection[0] * 0.5;
      const frontGy = unsold.gate.y + streetDirection[1] * 0.5;
      expect(board.position[1]).toBeCloseTo(groundAt(board.gx, board.gy), 3);
      expect((board.gx - frontX) * streetDirection[0] + (board.gy - frontGy) * streetDirection[1]).toBeGreaterThan(0);
      const clearance=((board.gx-frontX)*streetDirection[0]+(board.gy-frontGy)*streetDirection[1])*CELL_SIZE;
      expect(clearance).toBeGreaterThan(0);
      expect(clearance).toBeLessThanOrEqual(4.01);
      expect(new Set(unsold.driveway.map(c=>`${c.x},${c.y}`)).has(`${Math.round(board.gx)},${Math.round(board.gy)}`)).toBe(false);
      const lateral=Math.abs((board.gx-unsold.gate.x)*-streetDirection[1]+(board.gy-unsold.gate.y)*streetDirection[0]);
      expect(lateral).toBeGreaterThan(1.85/CELL_SIZE);
      for(const post of board.posts){const gx=post.position[0]/CELL_SIZE+mapSize/2,gy=post.position[2]/CELL_SIZE+mapSize/2;expect(post.position[1]).toBeCloseTo(groundAt(gx,gy),3);}
      expect(frontY).toBeGreaterThan(0);
      expect(board.position[1]).toBeGreaterThan(0.5);
    }
  });
  it("builds seated retaining earthworks and upright fixture objects", () => {
    const counts: Record<string, Record<string, number>> = {};
    for (const kind of ["downhill", "uphill"] as const) {
      const fixture=pickSlopeFixture(kind), pieces=buildEarthworksGeometry(fixture.grading,fixture.parcel,fixture.groundAt,fixture.mapSize);
      counts[kind] = {};
      for (const item of pieces) counts[kind]![item.kind] = (counts[kind]![item.kind] ?? 0) + (item.vertices?.length ?? 0) / 12;
      expect(pieces.some(piece => (piece.kind === "wall" || piece.kind === "bank" || piece.kind === "bench" || (kind === "downhill" && piece.kind === "lowerStorey")) && (piece.vertices?.length ?? 0) > 0), `${kind} must render earthworks`).toBe(true);
      const wallQuads=pieces.filter(piece=>piece.kind==="wall"&&piece.material==="#9a948a"&&piece.vertices).flatMap(piece=>Array.from({length:piece.vertices!.length/12},(_,i)=>piece.vertices!.slice(i*12,i*12+12)));
      const wallRuns: number[][][] = [];
      for (const quad of wallQuads) {
        const ax=quad[0]!,az=quad[2]!,bx=quad[3]!,bz=quad[5]!,dx=bx-ax,dz=bz-az,len=Math.hypot(dx,dz), dir:[number,number]=[dx/len,dz/len];
        const mid=(quad[7]!+quad[10]!)/2;
        let run=wallRuns.find(group=>{const first=group[0]!, fdx=first[3]!-first[0]!, fdz=first[5]!-first[2]!, fl=Math.hypot(fdx,fdz), fdir:[number,number]=[fdx/fl,fdz/fl], fmid=(first[7]!+first[10]!)/2, fmx=(first[0]!+first[3]!+first[6]!+first[9]!)/4, fmz=(first[2]!+first[5]!+first[8]!+first[11]!)/4, mx=(quad[0]!+quad[3]!+quad[6]!+quad[9]!)/4, mz=(quad[2]!+quad[5]!+quad[8]!+quad[11]!)/4, firstOffset=(fmx-first[0]!)*fdir[1]-(fmz-first[2]!)*fdir[0], quadOffset=(mx-first[0]!)*fdir[1]-(mz-first[2]!)*fdir[0];return (fdx/fl)*dir[0]+(fdz/fl)*dir[1]>.98&&Math.abs(fmid-mid)<=.2&&Math.abs(quadOffset-firstOffset)<=.3;});
        if(!run){run=[];wallRuns.push(run);} run.push(quad);
      }
      for(const run of wallRuns){
        const vertices=run.flatMap(q=>[[q[0]!,q[1]!,q[2]!],[q[3]!,q[4]!,q[5]!],[q[6]!,q[7]!,q[8]!],[q[9]!,q[10]!,q[11]!]]);
        const first=run[0]!, dx=first[3]!-first[0]!,dz=first[5]!-first[2]!, length=Math.hypot(dx,dz), dir:[number,number]=[dx/length,dz/length];
        const tops=run.flatMap(q=>[[q[6]!,q[7]!,q[8]!],[q[9]!,q[10]!,q[11]!]]);
        const positions=tops.map(v=>v[0]!*dir[0]+v[2]!*dir[1]), ys=tops.map(v=>v[1]!);
        const min=Math.min(...positions), max=Math.max(...positions), minY=Math.min(...ys), maxY=Math.max(...ys);
        const firstAtMin=tops.find(v=>Math.abs(v[0]!*dir[0]+v[2]!*dir[1]-min)<1e-5)!, firstAtMax=tops.find(v=>Math.abs(v[0]!*dir[0]+v[2]!*dir[1]-max)<1e-5)!;
        const residual=Math.max(...positions.map((x,i)=>{const t=(x-min)/(max-min||1), expected=firstAtMin[1]!+(firstAtMax[1]!-firstAtMin[1]!)*t;return Math.abs(ys[i]!-expected);}));
        expect(maxY-minY<=.04||residual<=.04,`${kind} masonry run top must be flat or linear`).toBe(true);
        for(const v of tops){const t=(v[0]!*dir[0]+v[2]!*dir[1]-min)/(max-min||1), expected=firstAtMin[1]!+(firstAtMax[1]!-firstAtMin[1]!)*t;expect(Math.abs(v[1]!-expected),`${kind} masonry top has no spikes`).toBeLessThanOrEqual(.08);}
        for(const q of run) for(const [to,bo] of [[7,1],[10,4]]) {const x=q[to-1]!,y=q[to]!,z=q[to+1]!,gx=x/CELL_SIZE+fixture.mapSize/2,gy=z/CELL_SIZE+fixture.mapSize/2;expect(y-Math.max(q[bo]!,fixture.groundAt(gx,gy)),`${kind} masonry face visible height`).toBeLessThanOrEqual(2.05);}
      }
      const benchQuads=pieces.filter(piece=>(piece.kind==="bench"||piece.kind==="bank")&&piece.vertices).flatMap(piece=>Array.from({length:piece.vertices!.length/12},(_,i)=>piece.vertices!.slice(i*12,i*12+12)));
      const wallTopVertices=wallQuads.flatMap(quad=>[[quad[0]!,quad[1]!,quad[2]!],[quad[3]!,quad[4]!,quad[5]!],[quad[6]!,quad[7]!,quad[8]!],[quad[9]!,quad[10]!,quad[11]!]]);
      for(const piece of pieces.filter(piece=>piece.kind==="wall"&&piece.material==="#7d776e"&&piece.vertices)) for(let q=0;q<piece.vertices!.length;q+=12) {
        for(const offset of [1,4,7,10]) {
          const y=piece.vertices![q+offset]!, x=piece.vertices![q+offset-1]!, z=piece.vertices![q+offset+1]!;
          expect(wallTopVertices.some(([wx,wy,wz])=>Math.abs(y-wy)<=.02&&Math.hypot(x-wx,z-wz)<=.3),`${kind} coping top must align with a wall top`).toBe(true);
        }
      }
      for(const piece of pieces){
        if(piece.vertices) for(let q=0;q<piece.vertices.length;q+=12){
          const heights=[1,4,7,10].map(offset=>piece.vertices![q+offset]!);
          if(piece.kind==="wall"&&piece.material==="#9a948a") {
            for(const offset of [0,3]) {
              const x=piece.vertices[q+offset]!,y=piece.vertices[q+offset+1]!,z=piece.vertices[q+offset+2]!,gx=x/CELL_SIZE+fixture.mapSize/2,gy=z/CELL_SIZE+fixture.mapSize/2;
              const buriedOrAtGround=y<=fixture.groundAt(gx,gy)+.05;
              const supported=benchQuads.some(bench=>[0,3,6,9].some(benchOffset=>{
                const bx=bench[benchOffset]!,by=bench[benchOffset+1]!,bz=bench[benchOffset+2]!;
                return Math.hypot(x-bx,z-bz)<=.6&&Math.abs(y-by)<=.05;
              }));
              const wallSupported=wallTopVertices.some(([wx,wy,wz])=>Math.hypot(x-wx,z-wz)<=1.5&&Math.abs(y-wy)<=.05);
              expect(buriedOrAtGround||supported||wallSupported,`${kind} wall bottom must meet terrain, bench, or lower wall`).toBe(true);
            }
            for(const offset of [7,10]) { const x=piece.vertices[q+offset-1]!, y=piece.vertices[q+offset]!, z=piece.vertices[q+offset+1]!, gx=x/CELL_SIZE+fixture.mapSize/2, gy=z/CELL_SIZE+fixture.mapSize/2; expect(y).toBeLessThanOrEqual(Math.max(fixture.grading.houseFloorY,fixture.groundAt(gx,gy))+.2); }
            for(const [topOffset,bottomOffset] of [[7,1],[10,4]]) {
              const x=piece.vertices[q+bottomOffset-1]!, z=piece.vertices[q+bottomOffset+1]!, gx=x/CELL_SIZE+fixture.mapSize/2, gy=z/CELL_SIZE+fixture.mapSize/2;
              expect(piece.vertices[q+topOffset]!-Math.max(piece.vertices[q+bottomOffset]!,fixture.groundAt(gx,gy))).toBeLessThanOrEqual(2.05);
            }
          }
          if(piece.kind==="bank") for(const offset of [6,9]) { const x=piece.vertices[q+offset]!,y=piece.vertices[q+offset+1]!,z=piece.vertices[q+offset+2]!,gx=x/CELL_SIZE+fixture.mapSize/2,gy=z/CELL_SIZE+fixture.mapSize/2;expect(Math.abs(y-fixture.groundAt(gx,gy))).toBeLessThanOrEqual(.05); }
        }
      }
      const objects=buildFixtureObjects(fixture);
      for(const object of objects){const rotation=new THREE.Euler(...object.rotation),up=new THREE.Vector3(0,1,0).applyEuler(rotation);expect(up.dot(new THREE.Vector3(0,1,0))).toBeGreaterThanOrEqual(.999);expect(object.rotation[0]).toBe(0);expect(object.rotation[2]).toBe(0);}
      expect(objects.every(o=>o.position.every(Number.isFinite))).toBe(true);
    }
    const down=pickSlopeFixture("downhill"), pieces=buildEarthworksGeometry(down.grading,down.parcel,down.groundAt,down.mapSize);
    expect(down.grading.garageMode).toBe("street-level-front");
    expect(down.grading.houseFloorY-down.grading.streetY).toBeGreaterThanOrEqual(0);
    expect(down.grading.houseFloorY-down.grading.streetY).toBeLessThanOrEqual(.5);
    expect(down.grading.padY).toBeCloseTo(down.grading.streetY,2);
    expect(buildFixtureObjects(down).map(o=>o.kind)).toEqual(["house"]);
    const lowerStoreyFaces = pieces.filter(p=>p.kind==="lowerStorey"&&p.material==="#b8b0a0");
    expect(lowerStoreyFaces.length).toBeGreaterThan(0);
    expect(Math.max(...lowerStoreyFaces.flatMap(p=>p.topY))).toBeCloseTo(down.grading.houseFloorY, 6);
    const street=parcelStreetDirection(down.parcel), pose=housePoseForParcel(down.parcel,down.mapSize,down.grading);
    const padCorners: [number,number][] = [[-HOUSE_FOOTPRINT_M.w/2-.25,-HOUSE_FOOTPRINT_M.d/2-.25],[HOUSE_FOOTPRINT_M.w/2+.25,-HOUSE_FOOTPRINT_M.d/2-.25],[HOUSE_FOOTPRINT_M.w/2+.25,HOUSE_FOOTPRINT_M.d/2+.25],[-HOUSE_FOOTPRINT_M.w/2-.25,HOUSE_FOOTPRINT_M.d/2+.25]].map(([x,z])=>{
      const rx=x*Math.cos(pose.rotationY)+z*Math.sin(pose.rotationY), rz=-x*Math.sin(pose.rotationY)+z*Math.cos(pose.rotationY);
      return [pose.position[0]/CELL_SIZE+down.mapSize/2+rx/CELL_SIZE,pose.position[2]/CELL_SIZE+down.mapSize/2+rz/CELL_SIZE];
    });
    const frontEdge=padCorners.reduce((best,a,i)=>{
      const b=padCorners[(i+1)%padCorners.length]!, midpoint:[number,number]=[(a[0]+b[0])/2, (a[1]+b[1])/2];
      const projection=(midpoint[0]-pose.position[0]/CELL_SIZE-down.mapSize/2)*street[0]+(midpoint[1]-pose.position[2]/CELL_SIZE-down.mapSize/2)*street[1];
      return projection>best.projection?{a,b,projection}:{...best};
    },{a:padCorners[0]!,b:padCorners[1]!,projection:-Infinity});
    const edgeWorld:[[number,number],[number,number]]=[[ (frontEdge.a[0]-down.mapSize/2)*CELL_SIZE,(frontEdge.a[1]-down.mapSize/2)*CELL_SIZE ],[ (frontEdge.b[0]-down.mapSize/2)*CELL_SIZE,(frontEdge.b[1]-down.mapSize/2)*CELL_SIZE ]];
    const frontFaces=lowerStoreyFaces.flatMap(p=>Array.from({length:(p.vertices?.length??0)/12},(_,i)=>p.vertices!.slice(i*12,i*12+12)))
      .filter(q=>{
        const a:[number,number]=[q[0]!,q[2]!],b:[number,number]=[q[3]!,q[5]!];
        const onEdge=(p:[number,number])=>Math.abs((edgeWorld[1][0]-edgeWorld[0][0])*(p[1]-edgeWorld[0][1])-(edgeWorld[1][1]-edgeWorld[0][1])*(p[0]-edgeWorld[0][0]))<=.02 &&
          (p[0]-edgeWorld[0][0])*(p[0]-edgeWorld[1][0])+(p[1]-edgeWorld[0][1])*(p[1]-edgeWorld[1][1])<=.02;
        return onEdge(a)&&onEdge(b);
      });
    expect(frontFaces).toHaveLength(0);
    if (pieces.some(p=>p.kind==="wall"&&p.material==="#9a948a")) expect(pieces.some(p=>p.kind==="wall"&&p.material==="#9a948a")).toBe(true);
    expect(pieces.some(p=>p.kind==="lowerStorey"&&p.material==="#3a3732")).toBe(false);
    for(const piece of pieces.filter(p=>["pad","bank","wall","lowerStorey"].includes(p.kind)&&p.vertices)){
      for(let q=0;q<piece.vertices!.length;q+=12){
        const v=piece.vertices!,a=new THREE.Vector3(v[q]!,v[q+1]!,v[q+2]!),b=new THREE.Vector3(v[q+3]!,v[q+4]!,v[q+5]!),c=new THREE.Vector3(v[q+6]!,v[q+7]!,v[q+8]!),d=new THREE.Vector3(v[q+9]!,v[q+10]!,v[q+11]!);
        const normal=b.clone().sub(a).cross(c.clone().sub(a));
        expect(normal.length()).toBeGreaterThan(1e-6);
        expect(Math.abs(d.clone().sub(a).dot(normal.clone().normalize()))).toBeLessThanOrEqual(.04);
      }
    }
    for (const kind of ["downhill", "uphill"] as const) expect(Object.values(counts[kind]!).reduce((sum, n) => sum + n, 0), `${kind} quad counts: ${JSON.stringify(counts[kind])}`).toBeGreaterThan(0);
  });

});
