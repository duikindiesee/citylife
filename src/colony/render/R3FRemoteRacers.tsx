import React, { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { ColonySim } from "../sim";
import type { SimBridge } from "./useSimSignal";
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

interface R3FRemoteRacersProps {
  sim: ColonySim;
  runtime?: SimBridge;
  terrainLevel?: ReadonlyMap<number, number> | null;
}

/** Create a floating 3D text nameplate above the racer's vehicle */
function makeRacerPlate(username: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(10, 20, 35, 0.85)";
    ctx.strokeStyle = "rgba(80, 200, 255, 0.95)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(8, 8, 240, 48, 14);
    ctx.fill();
    ctx.stroke();

    ctx.font = "bold 26px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(80, 200, 255, 0.9)";
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
  sprite.position.set(0, 1.65, 0);
  return sprite;
}

function RemoteCarVisual({ racer }: { racer: { username: string; spec?: any } }) {
  const model = useMemo(() => {
    try {
      if (racer.spec) {
        return buildCarMesh(racer.spec);
      }
    } catch {}

    // Fallback crisp procedural racing car
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x3388ff,
      roughness: 0.35,
      metalness: 0.2,
      emissive: 0x002255,
      emissiveIntensity: 0.3,
    });
    const cabinMat = new THREE.MeshStandardMaterial({
      color: 0x111122,
      roughness: 0.1,
      metalness: 0.8,
    });
    const wheelMat = new THREE.MeshStandardMaterial({
      color: 0x222222,
      roughness: 0.8,
    });

    const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.45, 0.95), bodyMat);
    body.position.y = 0.28;
    group.add(body);

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.38, 0.75), cabinMat);
    cabin.position.set(-0.15, 0.65, 0);
    group.add(cabin);

    for (const x of [-0.65, 0.65]) {
      for (const z of [-0.5, 0.5]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.15, 12), wheelMat);
        wheel.rotation.x = Math.PI / 2;
        wheel.position.set(x, 0.24, z);
        group.add(wheel);
      }
    }

    return group;
  }, [racer.spec]);

  const plate = useMemo(() => makeRacerPlate(racer.username), [racer.username]);

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

export function R3FRemoteRacers({ sim, terrainLevel }: R3FRemoteRacersProps) {
  const rootGroup = useRef<THREE.Group>(null);
  const racerGroups = useRef<Map<string, THREE.Group>>(new Map());

  useFrame(() => {
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

      const onRoad = isPointOnRoadSurface(racer.cell.x, racer.cell.y, sim.state.roadSet, sim.state.roadWays);
      const roadElevation = Math.max(0, getSmoothRoadY(t, racer.cell.x, racer.cell.y)) + ROAD_RIBBON_LIFT;
      const groundElevation = sampleElevation(racer.cell.x, racer.cell.y);
      const centerY = onRoad ? Math.max(roadElevation, groundElevation) : groundElevation;

      const heading = racer.heading ?? 0;
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

      grp.position.set(
        (racer.cell.x - t.size / 2) * 4,
        centerY,
        (racer.cell.y - t.size / 2) * 4
      );
      grp.rotation.set(-roll, -heading, pitch, "YXZ");
    }
  });

  const racersList = Array.from(sim.state.remoteRacers?.values() ?? []);

  return (
    <group ref={rootGroup} name="remote-racers">
      {racersList.map((racer) => (
        <group
          key={racer.participantId}
          name={`remote-racer-${racer.username}`}
          userData={{
            username: racer.username,
            userId: racer.userId,
            participantId: racer.participantId,
          }}
          ref={(el) => {
            if (el) racerGroups.current.set(racer.participantId, el);
            else racerGroups.current.delete(racer.participantId);
          }}
        >
          <RemoteCarVisual racer={racer} />
        </group>
      ))}
    </group>
  );
}
