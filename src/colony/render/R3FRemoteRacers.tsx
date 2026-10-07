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
  const model = useMemo(() => {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x66e0ff,
      roughness: 0.6,
      metalness: 0.1,
    });
    const headMat = new THREE.MeshStandardMaterial({
      color: 0xe0d0b0,
      roughness: 0.8,
      metalness: 0.0,
    });

    const bodyGeo = new THREE.CapsuleGeometry(
      AVATAR_BODY.radius,
      AVATAR_BODY.length,
      4,
      8,
    );
    bodyGeo.translate(0, AVATAR_BODY.lift, 0);
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    group.add(body);

    const headGeo = new THREE.SphereGeometry(AVATAR_HEAD.radius, 10, 8);
    headGeo.translate(0, AVATAR_HEAD.lift, 0);
    const head = new THREE.Mesh(headGeo, headMat);
    group.add(head);

    return group;
  }, []);

  const plate = useMemo(() => makeRacerPlate(racer.username, true), [racer.username]);

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

      const heading = racer.heading ?? 0;
      const isPedestrian = Boolean(racer.isPedestrian || !racer.spec);

      if (isPedestrian) {
        const groundElevation = sampleElevation(racer.cell.x, racer.cell.y);
        grp.position.set(
          (racer.cell.x - t.size / 2) * 4,
          groundElevation,
          (racer.cell.y - t.size / 2) * 4
        );
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

        grp.position.set(
          (racer.cell.x - t.size / 2) * 4,
          centerY,
          (racer.cell.y - t.size / 2) * 4
        );
        grp.rotation.set(-roll, -heading, pitch, "YXZ");
      }
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
          {racer.isPedestrian || !racer.spec ? (
            <RemotePedestrianVisual racer={racer} />
          ) : (
            <RemoteCarVisual racer={racer as { username: string; spec: CarSpec }} />
          )}
        </group>
      ))}
    </group>
  );
}
