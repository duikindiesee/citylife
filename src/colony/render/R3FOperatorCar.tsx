import { ownedVehicleSurfaceY } from "./ownedVehicleSurface";
import React, { Suspense, useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group } from "three";
import { Html, useGLTF } from "@react-three/drei";
import { Box3 } from "three";
import type { ShowroomVehicle } from "../showroom/showroomCatalog";
import { SHOWROOM_VEHICLES } from "../showroom/showroomCatalog";
import type { CarSpec } from "../car/carSpec";
import type { ColonySim } from "../sim";
import { buildCarMesh } from "../car/carMesh";
import { disposeDeep } from "./disposeDeep";
import { useSimSignal, type SimBridge } from "./useSimSignal";
import { operatorCarSignature } from "./simSignals";

/** Cached GLB resources belong to the loader, not this instance or the showroom. */
function OwnedVehicleModel({ vehicle }: { vehicle: ShowroomVehicle }) {
  const { scene } = useGLTF(vehicle.glbUrl!);
  const model = useMemo(() => {
    const copy = scene.clone(true);
    copy.traverse((node) => {
      node.castShadow = true;
      node.receiveShadow = true;
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
  }, [scene, vehicle]);
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
    const y = ownedVehicleSurfaceY(sim, terrainLevel, car.cell.x, car.cell.y);
    group.current.position.set(
      (car.cell.x - t.size / 2) * 4,
      y,
      (car.cell.y - t.size / 2) * 4,
    );
    group.current.rotation.y = -(car.heading ?? 0);
  });
  const sig = useSimSignal(runtime, () => operatorCarSignature(sim.state));

  const placement = useMemo(() => {
    const parked = sim.state.operatorCar;
    if (!parked) return null;
    const { cell } = parked;
    const t = sim.state.terrain;
    const N = t.size;
    const y = ownedVehicleSurfaceY(sim, terrainLevel, cell.x, cell.y);
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
      {vehicle?.glbUrl ? (
        <VehicleModelBoundary key={vehicle.spec.id}>
          <Suspense
            fallback={
              <Html center>
                <span role="status">Loading your vehicle…</span>
              </Html>
            }
          >
            <OwnedVehicleModel vehicle={vehicle} />
          </Suspense>
        </VehicleModelBoundary>
      ) : (
        <LegacyVehicleModel spec={parked.spec} />
      )}
    </group>
  );
}
