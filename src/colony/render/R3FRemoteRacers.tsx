import React, { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { ColonySim } from "../sim";
import { useSimSignal, type SimBridge } from "./useSimSignal";
import { remoteRacersSignature } from "./simSignals";
import { leveledWorldY } from "./terrainLeveling";
import { SHOWROOM_VEHICLES } from "../showroom/showroomCatalog";
import type { CarSpec } from "../car/carSpec";
import { buildCarMesh } from "../car/carMesh";
import { getSmoothRoadY, isPointOnRoadSurface } from "./roadSurface";
import { ROAD_RIBBON_LIFT } from "./roadRibbon";
import { disposeDeep } from "./disposeDeep";
import { padSeatY } from "./useTerrainLeveling";
import {
  garageApronSurfaceY,
  isPointInGarageVicinity,
  localFromGridCoordinates,
} from "./garageAnchorShell";
import { buildCrabGeometry } from "./crabGeometry";
import { AVATAR_BODY, AVATAR_HEAD } from "./avatarLayer";

interface R3FRemoteRacersProps {
  sim: ColonySim;
  runtime?: SimBridge;
  terrainLevel?: ReadonlyMap<number, number> | null;
}

/** Create a floating 3D text nameplate above the racer's vehicle or walking avatar */
function makeRacerPlate(username: string, isPedestrian = false): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = isPedestrian ? "rgba(10, 25, 45, 0.88)" : "rgba(10, 20, 35, 0.85)";
    ctx.strokeStyle = isPedestrian ? "rgba(100, 220, 255, 0.95)" : "rgba(80, 200, 255, 0.95)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(8, 8, 240, 48, 14);
    ctx.fill();
    ctx.stroke();

    ctx.font = "bold 26px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = isPedestrian ? "rgba(100, 220, 255, 0.9)" : "rgba(80, 200, 255, 0.9)";
    ctx.shadowBlur = 8;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(username, 128, 32, 220);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });

  const sprite = new THREE.Sprite(material);
  sprite.scale.set(3.2, 0.8, 1);
  sprite.position.set(0, isPedestrian ? 2.15 : 1.65, 0);
  return sprite;
}

function RemotePedestrianVisual({ racer }: { racer: { username: string } }) {
  const geometry = useMemo(() => buildCrabGeometry(), []);
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.55,
        metalness: 0.15,
      }),
    [],
  );

  const plate = useMemo(() => {
    const sprite = makeRacerPlate(racer.username, true);
    sprite.position.set(0, 0.95, 0);
    return sprite;
  }, [racer.username]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
      plate.material.map?.dispose();
      plate.material.dispose();
    };
  }, [geometry, material, plate]);

  return (
    <group name={`pedestrian-crab-${racer.username}`}>
      <mesh geometry={geometry} material={material} castShadow />
      <primitive object={plate} />
    </group>
  );
}

function RemoteSeatedCrabVisual({
  racer,
}: {
  racer: { username: string; seatedBusId?: number | null; seatIndex?: number | null };
}) {
  const geometry = useMemo(() => buildCrabGeometry(), []);
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.55,
        metalness: 0.15,
      }),
    [],
  );

  const plate = useMemo(() => {
    const sprite = makeRacerPlate(racer.username, true);
    sprite.position.set(0, 0.95, 0);
    return sprite;
  }, [racer.username]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
      plate.material.map?.dispose();
      plate.material.dispose();
    };
  }, [geometry, material, plate]);

  return (
    <group
      name={`seated-crab-${racer.username}`}
      userData={{
        seatedBus: racer.seatedBusId ?? undefined,
        seatedSlot: racer.seatIndex ?? undefined,
      }}
    >
      <mesh geometry={geometry} material={material} castShadow />
      <primitive object={plate} />
    </group>
  );
}

function RemoteCarVisual({ racer }: { racer: { username: string; spec: CarSpec } }) {
  const model = useMemo(() => {
    return buildCarMesh(racer.spec);
  }, [racer.spec]);

  const plate = useMemo(() => makeRacerPlate(racer.username, false), [racer.username]);

  useEffect(() => {
    return () => {
      disposeDeep(model);
      plate.material.map?.dispose();
      plate.material.dispose();
    };
  }, [model, plate]);

  return (
    <group>
      <primitive object={model} />
      <primitive object={plate} />
    </group>
  );
}

function RemoteParkedCarVisual({
  racer,
}: {
  racer: {
    username: string;
    spec: CarSpec;
    carX: number;
    carY?: number;
    carZ?: number;
    carHeading?: number;
  };
}) {
  const model = useMemo(() => {
    return buildCarMesh(racer.spec);
  }, [racer.spec]);

  const plate = useMemo(() => makeRacerPlate(`${racer.username} (Parked)`, false), [racer.username]);

  useEffect(() => {
    return () => {
      disposeDeep(model);
      plate.material.map?.dispose();
      plate.material.dispose();
    };
  }, [model, plate]);

  return (
    <group
      name={`remote-parked-car-${racer.username}`}
      userData={{
        username: racer.username,
        parked: true,
        vehicleKey: racer.spec.id,
      }}
      position={[racer.carX, racer.carY ?? 0, racer.carZ ?? 0]}
      rotation={[0, -(racer.carHeading ?? 0), 0, "YXZ"]}
    >
      <primitive object={model} />
      <primitive object={plate} />
    </group>
  );
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const _tempSeatVec = new THREE.Vector3();

/** 10 passenger seat slots from production busLayer.ts (5 left at z=+0.82, 5 right at z=-0.82) */
export const PASSENGER_SEAT_LOCAL_SLOTS: ReadonlyArray<{ readonly x: number; readonly y: number; readonly z: number }> =
  Object.freeze(
    Array.from({ length: 10 }, (_, seatIdx) => {
      const side = seatIdx < 5 ? 0.82 : -0.82;
      const row = seatIdx % 5;
      return Object.freeze({
        x: -4.25 + row * 1.55,
        y: 1.68,
        z: side,
      });
    }),
  );

/** Authoritative computation of seated crab world pose attached to bus coach rig */
export function computeSeatedCrabWorldPose(
  busPose: { x: number; y: number; heading?: number },
  seatIndex: number,
  terrainSize: number,
  roadElevation: number,
): { x: number; y: number; z: number; rotationY: number } {
  const seatIdx =
    typeof seatIndex === "number" && seatIndex >= 0 && seatIndex < PASSENGER_SEAT_LOCAL_SLOTS.length
      ? seatIndex
      : 0;
  const slot = PASSENGER_SEAT_LOCAL_SLOTS[seatIdx]!;
  const heading = busPose.heading ?? 0;
  const worldBusX = (busPose.x - terrainSize / 2) * 4;
  const worldBusZ = (busPose.y - terrainSize / 2) * 4;
  const roadH = roadElevation + ROAD_RIBBON_LIFT;
  _tempSeatVec.set(slot.x, slot.y, slot.z).applyAxisAngle(Y_AXIS, -heading);
  return {
    x: worldBusX + _tempSeatVec.x,
    y: roadH + _tempSeatVec.y,
    z: worldBusZ + _tempSeatVec.z,
    rotationY: -heading + Math.PI / 2,
  };
}

export function R3FRemoteRacers({ sim, runtime, terrainLevel }: R3FRemoteRacersProps) {
  useSimSignal(runtime, () => remoteRacersSignature(sim.state));

  const rootGroup = useRef<THREE.Group>(null);
  const racerGroups = useRef<Map<string, THREE.Group>>(new Map());

  useFrame((state, delta) => {
    const racersMap = sim.state.remoteRacers;
    if (!racersMap || racersMap.size === 0) {
      if (rootGroup.current) rootGroup.current.visible = false;
      return;
    }
    if (rootGroup.current) rootGroup.current.visible = true;

    const t = sim.state.terrain;
    const gPad = sim.state.commercialDistrict?.garagePad;
    const gSeat = gPad ? padSeatY(t, gPad.x, gPad.y, gPad.w, gPad.h) : 0;

    const sampleElevation = (cx: number, cy: number) => {
      const isR = isPointOnRoadSurface(cx, cy, sim.state.roadSet, sim.state.roadWays);
      if (gPad && isPointInGarageVicinity(cx, cy, gPad)) {
        const local = localFromGridCoordinates(gPad, cx, cy);
        const apronH = garageApronSurfaceY(gPad, t, null, local.x, local.z, gSeat);
        if (isR) {
          const roadH = Math.max(0, getSmoothRoadY(t, cx, cy)) + ROAD_RIBBON_LIFT;
          return Math.max(roadH, apronH);
        }
        return apronH;
      }
      if (isR) {
        return Math.max(0, getSmoothRoadY(t, cx, cy)) + ROAD_RIBBON_LIFT;
      }
      return Math.max(0, leveledWorldY(t, terrainLevel, Math.round(cx), Math.round(cy))) + 0.02;
    };

    for (const [id, racer] of racersMap.entries()) {
      const grp = racerGroups.current.get(id);
      if (!grp) continue;

      const heading = racer.heading ?? 0;
      const isSeatedOnBus = Boolean(
        racer.mode === "riding_bus" &&
          racer.seatedBusId !== null &&
          racer.seatedBusId !== undefined,
      );
      const isPedestrian = Boolean((racer.isPedestrian || !racer.spec) && !isSeatedOnBus);
      const targetWorldX = (racer.cell.x - t.size / 2) * 4;
      const targetWorldZ = (racer.cell.y - t.size / 2) * 4;

      if (isSeatedOnBus) {
        const busId = racer.seatedBusId!;
        const coach = state.scene.getObjectByName(`bus-coach-${busId}`);
        const seatIdx =
          typeof racer.seatIndex === "number" && racer.seatIndex >= 0 && racer.seatIndex < PASSENGER_SEAT_LOCAL_SLOTS.length
            ? racer.seatIndex
            : 0;
        const sideName = seatIdx < 5 ? "left" : "right";
        const rowIdx = seatIdx % 5;
        let seatMesh: any = null;
        if (coach) {
          coach.updateMatrixWorld(true);
          seatMesh = coach.getObjectByName(`bus-seat-${sideName}-${rowIdx}`);
        }

        if (seatMesh && coach) {
          // Mount ground-origin crab on cushion top surface (+0.25m in seat local Y from box center)
          seatMesh.localToWorld(_tempSeatVec.set(0, 0.25, 0));
          grp.position.copy(_tempSeatVec);
          grp.rotation.set(coach.rotation.x, coach.rotation.y + Math.PI / 2, coach.rotation.z, "YXZ");
        } else {
          const busPose = runtime?.busPoseOf ? runtime.busPoseOf(busId) : null;
          if (busPose) {
            const roadElevation = Math.max(0, getSmoothRoadY(t, busPose.x, busPose.y));
            const p = computeSeatedCrabWorldPose(busPose, racer.seatIndex ?? 0, t.size, roadElevation);
            grp.position.set(p.x, p.y, p.z);
            grp.rotation.set(0, p.rotationY, 0, "YXZ");
          } else {
            const groundElevation = sampleElevation(racer.cell.x, racer.cell.y);
            grp.position.set(targetWorldX, groundElevation, targetWorldZ);
            grp.rotation.set(0, -heading + Math.PI / 2, 0, "YXZ");
          }
        }
      } else if (isPedestrian) {
        const groundElevation = sampleElevation(racer.cell.x, racer.cell.y);
        const dist = Math.hypot(grp.position.x - targetWorldX, grp.position.z - targetWorldZ);
        const lerpFactor = dist > 20 || (grp.position.x === 0 && grp.position.z === 0) ? 1 : Math.min(1, delta * 12);
        grp.position.x += (targetWorldX - grp.position.x) * lerpFactor;
        grp.position.y += (groundElevation - grp.position.y) * lerpFactor;
        grp.position.z += (targetWorldZ - grp.position.z) * lerpFactor;
        grp.rotation.set(0, -heading + Math.PI / 2, 0, "YXZ");
      } else {
        const onRoad = isPointOnRoadSurface(racer.cell.x, racer.cell.y, sim.state.roadSet, sim.state.roadWays);
        const roadElevation = Math.max(0, getSmoothRoadY(t, racer.cell.x, racer.cell.y)) + ROAD_RIBBON_LIFT;
        const groundElevation = sampleElevation(racer.cell.x, racer.cell.y);
        const centerY = onRoad ? Math.max(roadElevation, groundElevation) : groundElevation;

        const cosH = Math.cos(heading);
        const sinH = Math.sin(heading);
        const halfLenCells = 2.1 / 4.0;
        const halfWidCells = 0.95 / 4.0;

        const yFront = sampleElevation(racer.cell.x + cosH * halfLenCells, racer.cell.y + sinH * halfLenCells);
        const yRear = sampleElevation(racer.cell.x - cosH * halfLenCells, racer.cell.y - sinH * halfLenCells);
        const pitch = Math.atan2(yFront - yRear, 4.2);

        const yLeft = sampleElevation(racer.cell.x - sinH * halfWidCells, racer.cell.y + cosH * halfWidCells);
        const yRight = sampleElevation(racer.cell.x + sinH * halfWidCells, racer.cell.y - sinH * halfWidCells);
        const roll = Math.atan2(yLeft - yRight, 1.9);

        const dist = Math.hypot(grp.position.x - targetWorldX, grp.position.z - targetWorldZ);
        const lerpFactor = dist > 30 || (grp.position.x === 0 && grp.position.z === 0) ? 1 : Math.min(1, delta * 12);
        grp.position.x += (targetWorldX - grp.position.x) * lerpFactor;
        grp.position.y += (centerY - grp.position.y) * lerpFactor;
        grp.position.z += (targetWorldZ - grp.position.z) * lerpFactor;
        grp.rotation.set(-roll, -heading, pitch, "YXZ");
      }
    }
  });

  const racersList = Array.from(sim.state.remoteRacers?.values() ?? []);

  return (
    <group ref={rootGroup} name="remote-racers">
      {racersList.map((racer) => {
        const isSeatedOnBus = Boolean(
          racer.mode === "riding_bus" &&
            racer.seatedBusId !== null &&
            racer.seatedBusId !== undefined,
        );
        const isPedestrian = Boolean((racer.isPedestrian || !racer.spec) && !isSeatedOnBus);
        const hasParkedCar = Boolean(
          (isPedestrian || isSeatedOnBus) &&
            racer.spec &&
            racer.carX !== undefined &&
            Number.isFinite(racer.carX),
        );
        return (
          <React.Fragment key={racer.participantId}>
            <group
              name={`remote-racer-${racer.username}`}
              userData={{
                username: racer.username,
                userId: racer.userId,
                participantId: racer.participantId,
                isPedestrian,
                mode: racer.mode ?? (isPedestrian ? "walking" : isSeatedOnBus ? "riding_bus" : "driving"),
                vehicleKey: racer.vehicleKey ?? null,
                seatedBusId: racer.seatedBusId ?? null,
                seatIndex: racer.seatIndex ?? null,
              }}
              ref={(el) => {
                if (el) racerGroups.current.set(racer.participantId, el);
                else racerGroups.current.delete(racer.participantId);
              }}
            >
              {isSeatedOnBus ? (
                <RemoteSeatedCrabVisual racer={racer} />
              ) : isPedestrian ? (
                <RemotePedestrianVisual racer={racer} />
              ) : (
                <RemoteCarVisual racer={racer as { username: string; spec: CarSpec }} />
              )}
            </group>
            {hasParkedCar && (
              <RemoteParkedCarVisual
                racer={
                  racer as {
                    username: string;
                    spec: CarSpec;
                    carX: number;
                    carY?: number;
                    carZ?: number;
                    carHeading?: number;
                  }
                }
              />
            )}
          </React.Fragment>
        );
      })}
    </group>
  );
}
