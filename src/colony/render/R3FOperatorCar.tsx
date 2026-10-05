import { leveledWorldY } from "./terrainLeveling";
import React, { Suspense, useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Group } from "three";
import { Html, useGLTF } from "@react-three/drei";
import { Box3, Color } from "three";
import type { ShowroomVehicle } from "../showroom/showroomCatalog";
import { SHOWROOM_VEHICLES } from "../showroom/showroomCatalog";
import type { CarSpec } from "../car/carSpec";
import type { ColonySim } from "../sim";
import { buildCarMesh } from "../car/carMesh";
import { getSmoothRoadY, isPointOnRoadSurface } from "./roadSurface";
import { ROAD_RIBBON_LIFT } from "./roadRibbon";
import { disposeDeep } from "./disposeDeep";
import { useSimSignal, type SimBridge } from "./useSimSignal";
import { operatorCarSignature } from "./simSignals";
import { padSeatY } from "./useTerrainLeveling";
import {
  isPointInGarageVicinity,
  localFromGridCoordinates,
} from "./garageAnchorShell";

/** Cached GLB resources belong to the loader, not this instance or the showroom. */
function OwnedVehicleModel({
  vehicle,
  paint,
}: {
  vehicle: ShowroomVehicle;
  paint?: { body?: number; cabin?: number; accent?: number };
}) {
  const { scene } = useGLTF(vehicle.glbUrl!);
  const model = useMemo(() => {
    const copy = scene.clone(true);
    copy.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) {
        node.castShadow = true;
        node.receiveShadow = true;
        const mesh = node as THREE.Mesh;
        if (mesh.material) {
          const rawMats = Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material];
          const clonedMats = rawMats.map((m) => {
            const cm = m.clone();
            const mat = cm as any;
            if (/carpaint/i.test(cm.name)) {
              if (paint?.body !== undefined) {
                mat.color?.set(paint.body);
              }
              // Automotive satin finish: prevents harsh point-specular glare pinpricks
              if (mat.roughness !== undefined) {
                mat.roughness = Math.max(mat.roughness, 0.38);
              }
              if (mat.metalness !== undefined) {
                mat.metalness = Math.min(mat.metalness, 0.25);
              }
              // Subtle emissive base provides soft body presence at night without creating artificial glare dots
              if (mat.emissive) {
                const bodyColor =
                  paint?.body !== undefined
                    ? new Color(paint.body)
                    : mat.color
                      ? mat.color.clone()
                      : new Color(0xd0e4ff);
                mat.emissive.copy(bodyColor).multiplyScalar(0.08);
              }
            } else if (/targa|roof|cabin/i.test(cm.name)) {
              if (paint?.cabin !== undefined) {
                mat.color?.set(paint.cabin);
              }
              if (mat.roughness !== undefined) {
                mat.roughness = Math.max(mat.roughness, 0.4);
              }
              if (mat.metalness !== undefined) {
                mat.metalness = Math.min(mat.metalness, 0.2);
              }
            } else if (
              /alloy|rim|accent/i.test(cm.name) &&
              paint?.accent !== undefined
            ) {
              mat.color?.set(paint.accent);
            }
            return cm;
          });
          mesh.material = Array.isArray(mesh.material)
            ? clonedMats
            : clonedMats[0]!;
        }
      }
    });
    const rotation = vehicle.rotationOffset ?? [0, 0, 0];
    copy.rotation.set(rotation[0], rotation[1], rotation[2]);
    // Model origins differ. Centre the footprint on the runtime anchor and put
    // the lowest tyre/body point on its surveyed surface, using world metres.
    const bounds = new Box3().setFromObject(copy);
    if (!bounds.isEmpty()) {
      copy.position.x -= (bounds.min.x + bounds.max.x) / 2;
      copy.position.y -= bounds.min.y;
      copy.position.z -= (bounds.min.z + bounds.max.z) / 2;
    }
    return copy;
  }, [scene, vehicle, paint?.body, paint?.cabin, paint?.accent]);
  return (
    <primitive
      object={model}
      dispose={null}
      name="owned-vehicle-model"
      userData={{ vehicleId: vehicle.spec.id, assetUrl: vehicle.glbUrl }}
    />
  );
}

function LegacyVehicleModel({ spec }: { spec: CarSpec }) {
  const model = useMemo(() => buildCarMesh(spec), [spec]);
  useEffect(() => () => disposeDeep(model), [model]);
  return <primitive object={model} />;
}

class VehicleModelBoundary extends React.Component<
  React.PropsWithChildren,
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <Html center>
        <span role="alert">Vehicle model unavailable. Reload to retry.</span>
      </Html>
    ) : (
      this.props.children
    );
  }
}

// Spec 131 — the signed-in operator's tuned car parked at their home cell (legacy
// setOperatorCar). The runtime attaches { spec, cell } on sim.state (the raceState
// precedent). Catalog vehicles use the actual showroom GLB; legacy custom cars
// keep their procedural build. Both sit on the road surface or leveled ground.

interface R3FOperatorCarProps {
  sim: ColonySim;
  runtime?: SimBridge;
  /** Spec 134 - the leveled-ground map: pads, graded roads and landscape edits reshape
   *  the visible mesh, and anything standing on the ground must stand on THAT surface. */
  terrainLevel?: ReadonlyMap<number, number> | null;
}

function CarLighting() {
  const leftTarget = useRef<THREE.Object3D>(null);
  const rightTarget = useRef<THREE.Object3D>(null);
  const leftSpot = useRef<THREE.SpotLight>(null);
  const rightSpot = useRef<THREE.SpotLight>(null);

  useEffect(() => {
    if (leftSpot.current && leftTarget.current) {
      leftSpot.current.target = leftTarget.current;
    }
    if (rightSpot.current && rightTarget.current) {
      rightSpot.current.target = rightTarget.current;
    }
  }, []);

  return (
    <group name="car-lighting">
      {/* Front Headlight Aim Targets */}
      <object3D ref={leftTarget} position={[24, 0, -0.6]} />
      <object3D ref={rightTarget} position={[24, 0, 0.6]} />

      {/* Left Headlight */}
      <spotLight
        ref={leftSpot}
        position={[1.85, 0.48, -0.55]}
        color="#f4f8ff"
        intensity={5.0}
        distance={48}
        angle={Math.PI / 7}
        penumbra={0.65}
        decay={1.2}
      />
      {/* Right Headlight */}
      <spotLight
        ref={rightSpot}
        position={[1.85, 0.48, 0.55]}
        color="#f4f8ff"
        intensity={5.0}
        distance={48}
        angle={Math.PI / 7}
        penumbra={0.65}
        decay={1.2}
      />

      {/* Forward Road Wash Light: illuminates the asphalt immediately ahead of the bumper */}
      <pointLight
        position={[3.2, 0.6, 0]}
        color="#eef6ff"
        intensity={2.2}
        distance={18}
        decay={1.4}
      />

      {/* Headlight Lenses */}
      <mesh position={[1.86, 0.48, -0.55]}>
        <sphereGeometry args={[0.07, 8, 8]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      <mesh position={[1.86, 0.48, 0.55]}>
        <sphereGeometry args={[0.07, 8, 8]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>

      {/* Rear Taillights */}
      <pointLight
        position={[-1.85, 0.5, -0.55]}
        color="#ff1a1a"
        intensity={1.8}
        distance={7.0}
        decay={1.5}
      />
      <pointLight
        position={[-1.85, 0.5, 0.55]}
        color="#ff1a1a"
        intensity={1.8}
        distance={7.0}
        decay={1.5}
      />

      {/* Taillight Ruby Red Lenses */}
      <mesh position={[-1.86, 0.5, -0.55]}>
        <boxGeometry args={[0.04, 0.08, 0.16]} />
        <meshBasicMaterial color="#ff2222" />
      </mesh>
      <mesh position={[-1.86, 0.5, 0.55]}>
        <boxGeometry args={[0.04, 0.08, 0.16]} />
        <meshBasicMaterial color="#ff2222" />
      </mesh>
    </group>
  );
}

export function R3FOperatorCar({
  sim,
  runtime,
  terrainLevel,
}: R3FOperatorCarProps) {
  const group = useRef<Group>(null);
  useFrame(() => {
    const car = sim.state.operatorCar;
    if (!group.current || !car) return;
    const t = sim.state.terrain;
    const onRoad = isPointOnRoadSurface(
      car.cell.x,
      car.cell.y,
      sim.state.roadSet,
      sim.state.roadWays,
    );

    const gPad = sim.state.commercialDistrict?.garagePad;
    const gSeat = gPad ? padSeatY(t, gPad.x, gPad.y, gPad.w, gPad.h) : 0;

    const sampleElevation = (cx: number, cy: number) => {
      const isR = isPointOnRoadSurface(
        cx,
        cy,
        sim.state.roadSet,
        sim.state.roadWays,
      );
      if (isR) {
        return Math.max(0, getSmoothRoadY(t, cx, cy)) + ROAD_RIBBON_LIFT;
      }
      const rawG =
        Math.max(
          0,
          leveledWorldY(t, terrainLevel, Math.round(cx), Math.round(cy)),
        ) + 0.02;
      if (gPad && isPointInGarageVicinity(cx, cy, gPad)) {
        const local = localFromGridCoordinates(gPad, cx, cy);
        if (local.z <= 5.5) {
          return Math.max(rawG, gSeat + 0.02);
        }
      }
      return rawG;
    };

    const roadElevation =
      Math.max(0, getSmoothRoadY(t, car.cell.x, car.cell.y)) + ROAD_RIBBON_LIFT;
    const groundElevation = sampleElevation(car.cell.x, car.cell.y);

    // Grounding: on road sits on road ribbon. If near road edge, prevent wheels from sinking below the road deck.
    const centerY = onRoad
      ? roadElevation
      : Math.max(
          groundElevation,
          isPointOnRoadSurface(
            car.cell.x,
            car.cell.y,
            sim.state.roadSet,
            sim.state.roadWays,
          )
            ? roadElevation
            : groundElevation,
        );

    // Slope pitch and roll alignment (4.2m wheelbase)
    const heading = car.heading ?? 0;
    const cosH = Math.cos(heading);
    const sinH = Math.sin(heading);
    const halfLenCells = 2.1 / 4.0;
    const halfWidCells = 0.95 / 4.0;

    const yFront = sampleElevation(
      car.cell.x + cosH * halfLenCells,
      car.cell.y + sinH * halfLenCells,
    );
    const yRear = sampleElevation(
      car.cell.x - cosH * halfLenCells,
      car.cell.y - sinH * halfLenCells,
    );
    const pitch = Math.atan2(yFront - yRear, 4.2);

    const yLeft = sampleElevation(
      car.cell.x - sinH * halfWidCells,
      car.cell.y + cosH * halfWidCells,
    );
    const yRight = sampleElevation(
      car.cell.x + sinH * halfWidCells,
      car.cell.y - cosH * halfWidCells,
    );
    const roll = Math.atan2(yLeft - yRight, 1.9);

    group.current.position.set(
      (car.cell.x - t.size / 2) * 4,
      centerY,
      (car.cell.y - t.size / 2) * 4,
    );
    // Car mesh has longitudinal axis along local +X (headlights) and lateral along local +/-Z.
    // In Euler "YXZ" order, local longitudinal pitch is around Z (+pitch raises front +X),
    // and local lateral roll is around X (-roll raises left +Z).
    group.current.rotation.set(-roll, -heading, pitch, "YXZ");
  });
  const sig = useSimSignal(runtime, () => operatorCarSignature(sim.state));

  const placement = useMemo(() => {
    const parked = sim.state.operatorCar;
    if (!parked) return null;
    const { cell } = parked;
    const t = sim.state.terrain;
    const N = t.size;
    const onRoad = isPointOnRoadSurface(
      cell.x,
      cell.y,
      sim.state.roadSet,
      sim.state.roadWays,
    );
    const y = onRoad
      ? Math.max(0, getSmoothRoadY(t, cell.x, cell.y)) + ROAD_RIBBON_LIFT
      : Math.max(
          0,
          leveledWorldY(
            t,
            terrainLevel,
            Math.round(cell.x),
            Math.round(cell.y),
          ),
        ) + 0.02;
    return [(cell.x - N / 2) * 4, y, (cell.y - N / 2) * 4] as [
      number,
      number,
      number,
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim, sig, terrainLevel]);

  const parked = sim.state.operatorCar;
  if (!placement || !parked) return null;
  const vehicle = SHOWROOM_VEHICLES.find((v) => v.spec.id === parked.spec.id);
  return (
    <group ref={group} name="operator-car" position={placement}>
      <CarLighting />
      {vehicle?.glbUrl ? (
        <VehicleModelBoundary key={vehicle.spec.id}>
          <Suspense
            fallback={
              <Html center>
                <span role="status">Loading your vehicle…</span>
              </Html>
            }
          >
            <OwnedVehicleModel vehicle={vehicle} paint={parked.spec.paint} />
          </Suspense>
        </VehicleModelBoundary>
      ) : (
        <LegacyVehicleModel spec={parked.spec} />
      )}
    </group>
  );
}
