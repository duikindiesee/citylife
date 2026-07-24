// PLAYER.GARAGE.1 — the showroom interior scene: a clean studio room, a white rotating plinth, the
// selected procedural CarSpec vehicle, a fixed three-point studio light rig and a bounded orbit
// camera. The PLINTH rotates, not the camera: azimuth is presentation, zoom is the only free axis
// and it is clamped by clampShowroomZoom. This is its own small Canvas (a streaming-boundary
// interior scene, spec 152 spirit) — it never touches the world scene graph.
import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { buildCarMesh } from "../car/carMesh";
import type { ShowroomVehicle } from "../showroom/showroomCatalog";
import { clampShowroomZoom } from "../showroom/showroomState";

/** Plinth turntable speed, radians per second — slow enough to read the car. */
const TURNTABLE_RATE = 0.45;
/** Fixed camera elevation angle above the plinth plane. */
const CAMERA_POLAR = (28 * Math.PI) / 180;
/** The point the camera studies — roughly the car's beltline on the plinth. */
const LOOK_AT = new THREE.Vector3(0, 0.5, 0);

/** The car scaled onto the plinth. buildCarMesh cars are ~0.95 long; present them at showroom scale. */
const CAR_PRESENTATION_SCALE = 2.4;
const PLINTH_RADIUS = 1.7;
const PLINTH_HEIGHT = 0.14;

function TurntableCar({ vehicle }: { vehicle: ShowroomVehicle }) {
  const group = useRef<THREE.Group>(null);
  const car = useMemo(() => buildCarMesh(vehicle.spec), [vehicle]);
  useEffect(
    () => () => {
      car.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const m = o.material;
          if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
          else m.dispose();
        }
      });
    },
    [car],
  );
  useFrame((_, delta) => {
    if (group.current) group.current.rotation.y += delta * TURNTABLE_RATE;
  });
  return (
    <group ref={group} name="showroomTurntable">
      {/* the white plinth — rotates WITH the car so the pair reads as one display */}
      <mesh name="showroomPlinth" position={[0, PLINTH_HEIGHT / 2, 0]}>
        <cylinderGeometry
          args={[PLINTH_RADIUS, PLINTH_RADIUS * 1.06, PLINTH_HEIGHT, 48]}
        />
        <meshStandardMaterial color={0xf2f2ee} roughness={0.35} />
      </mesh>
      <group
        name="showroomCar"
        position={[0, PLINTH_HEIGHT, 0]}
        scale={CAR_PRESENTATION_SCALE}
      >
        <primitive object={car} />
      </group>
    </group>
  );
}

/** Applies the bounded zoom every frame; the camera never pans and its elevation is fixed. */
function ShowroomCameraRig({ zoom }: { zoom: number }) {
  const camera = useThree((s) => s.camera);
  useFrame(() => {
    const d = clampShowroomZoom(zoom);
    camera.position.set(
      0,
      Math.sin(CAMERA_POLAR) * d + PLINTH_HEIGHT,
      Math.cos(CAMERA_POLAR) * d,
    );
    camera.lookAt(LOOK_AT);
  });
  return null;
}

/** The studio room: soft floor, backdrop and a three-point light rig, deliberately outside the
 *  world's day/night cycle so the presentation stays clean at any hour. */
function StudioRoom() {
  return (
    <group name="showroomStudio">
      <mesh
        name="showroomFloor"
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, 0]}
      >
        <circleGeometry args={[11, 48]} />
        <meshStandardMaterial color={0xe8e8e4} roughness={0.8} />
      </mesh>
      {/* curved-feel backdrop: a big soft wall behind the plinth */}
      <mesh name="showroomBackdrop" position={[0, 4.4, -7.5]}>
        <planeGeometry args={[26, 10]} />
        <meshStandardMaterial color={0xdfe3e6} roughness={0.95} />
      </mesh>
      <ambientLight intensity={0.55} />
      {/* key */}
      <directionalLight position={[4.5, 6.5, 4]} intensity={1.5} castShadow />
      {/* fill */}
      <directionalLight position={[-5, 3.5, 2]} intensity={0.6} />
      {/* rim */}
      <directionalLight position={[0, 4.5, -6]} intensity={0.8} />
    </group>
  );
}

export function ShowroomView({
  vehicle,
  zoom,
}: {
  vehicle: ShowroomVehicle;
  zoom: number;
}) {
  return (
    <Canvas
      shadows
      camera={{ fov: 40, near: 0.1, far: 100, position: [0, 2.5, 5] }}
      style={{ width: "100%", height: "100%" }}
      gl={{ antialias: true }}
    >
      <color attach="background" args={[0xceD4d8]} />
      <StudioRoom />
      <TurntableCar vehicle={vehicle} />
      <ShowroomCameraRig zoom={zoom} />
    </Canvas>
  );
}
