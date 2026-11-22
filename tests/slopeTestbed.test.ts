import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { pickSlopeFixture, heightfieldWindow } from "../src/colony/testbed/slopeFixtures";
import { housePoseForParcel } from "../src/colony/render/housePlacement";
import { parcelFencePlacements } from "../src/colony/render/parcelFencePlacement";
import { forSaleBoardPlacement } from "../src/colony/render/forSaleBoardPlacement";
import { starterGaragePlacement } from "../src/colony/render/starterGaragePlacement";
import { parcelStreetDirection } from "../src/colony/parcelGeometry";
import { gradePlot, SLOPE_LIMITS } from "../src/colony/slope/plotGrading";
import { CELL_SIZE } from "../src/colony/scale";
import { fixtureCameraPose, testbedParcelInfo, type TestbedCameraMode } from "../src/colony/render/starterGarageCamera";

const cases = [
  ["downhill", "steep-downhill"],
  ["uphill", "steep-uphill"],
  ["gentle", "gentle"],
] as const;
const cameraModes: TestbedCameraMode[] = ["slope-aerial","slope-side","board-line","for-sale-board","street-mixed","street-view","street-gate","driveway-approach","aerial"];
const eyeLevelModes = new Set<TestbedCameraMode>(["street-view","street-gate","driveway-approach"]);

describe("sloped fence and garage testbed fixtures", () => {
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
      if(mode==="slope-aerial"||mode==="slope-side"){
        const house=housePoseForParcel(fixture.parcel,fixture.mapSize,fixture.grading),centre=project([house.position[0],fixture.grading.houseFloorY+3,house.position[2]]);
        expect(Math.abs(centre.x),`${kind}/${mode} house centre x`).toBeLessThanOrEqual(.6);expect(Math.abs(centre.y),`${kind}/${mode} house centre y`).toBeLessThanOrEqual(.6);expect(centre.z,`${kind}/${mode} house centre depth`).toBeGreaterThan(-1);expect(centre.z).toBeLessThan(1);
        for(const [gx,gy] of house.corners){const corner=project([(gx-fixture.mapSize/2)*CELL_SIZE,fixture.grading.houseFloorY+3,(gy-fixture.mapSize/2)*CELL_SIZE]);expect(Math.abs(corner.x),`${kind}/${mode} house corner x`).toBeLessThanOrEqual(1);expect(Math.abs(corner.y),`${kind}/${mode} house corner y`).toBeLessThanOrEqual(1);}
      }
      if(mode==="for-sale-board"||mode==="board-line") {const target=boardWorld??info.gateWorld,ndc=project(target);expect(Math.abs(ndc.x),`${kind}/${mode} board x`).toBeLessThanOrEqual(.9);expect(Math.abs(ndc.y),`${kind}/${mode} board y`).toBeLessThanOrEqual(.9);}
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

    const pose = housePoseForParcel(parcel, mapSize, grading);
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
      expect(frontY).toBeGreaterThan(0);
      expect(board.position[1]).toBeGreaterThan(0.5);
    }
  });
});
