// PLAYER.GARAGE.1 / SHOWROOM.LOOK.1 — the showroom interior scene: a dark "Karoo Dusk" room, a
// polished dark-stone rotating plinth, the selected procedural CarSpec vehicle, a warm/cool four-light
// rig over a baked environment map, and a bounded orbit camera. The PLINTH rotates, not the camera:
// azimuth is presentation, zoom is the only free axis and it is clamped by clampShowroomZoom. This is
// its own small Canvas (a streaming-boundary interior scene, spec 152 spirit) — it never touches the
// world scene graph.
//
// The environment map in showroomEnvironment.tsx is load-bearing, not decoration: without it the car's
// metalness deletes albedo instead of adding sheen, which is why the paint used to read as primer.
import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { buildCarMesh } from "../car/carMesh";
import type { ShowroomVehicle } from "../showroom/showroomCatalog";
import { clampShowroomZoom } from "../showroom/showroomState";
import { ShowroomEnvironment, ShowroomSky } from "./showroomEnvironment";

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
      {/* The plinth — rotates WITH the car so the pair reads as one display. Two materials: a
          polished dark-stone top the car reflects INTO, and a matte skirt so the two separate. The
          soft blurred reflection under the car, not the shadow, is what makes it look placed. */}
      <mesh
        name="showroomPlinth"
        position={[0, PLINTH_HEIGHT / 2, 0]}
        receiveShadow
      >
        <cylinderGeometry
          args={[PLINTH_RADIUS, PLINTH_RADIUS * 1.06, PLINTH_HEIGHT, 48]}
        />
        {/* order matches cylinderGeometry's groups: [side, top, bottom] */}
        <meshPhysicalMaterial
          attach="material-0"
          color={0x232a31}
          metalness={0.7}
          roughness={0.45}
          envMapIntensity={1.0}
        />
        {/* roughness 0.22 rather than the spec's 0.14: at 0.14 the environment's cool kicker
            reflected off the top as a hard blue-white blob that read as a lens artifact. 0.22 keeps
            the soft blurred reflection that makes the car look placed, without the hotspot. */}
        <meshPhysicalMaterial
          attach="material-1"
          color={0x171b20}
          metalness={0.15}
          roughness={0.22}
          clearcoat={0.6}
          clearcoatRoughness={0.14}
          envMapIntensity={1.2}
        />
        <meshPhysicalMaterial
          attach="material-2"
          color={0x171b20}
          metalness={0.15}
          roughness={0.45}
          envMapIntensity={0.6}
        />
      </mesh>
      {/* one warm ring at the plinth lip — the only emissive in the room, so it reads as deliberate */}
      <mesh
        name="showroomPlinthRing"
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, PLINTH_HEIGHT + 0.002, 0]}
      >
        <ringGeometry
          args={[PLINTH_RADIUS * 0.945, PLINTH_RADIUS * 0.972, 64]}
        />
        {/* intensity 1.1, not the spec's 2.4: 2.4 blew through ACES to flat white and became the
            brightest thing in frame, which is the car's job. The ring should be seen, not read. */}
        <meshStandardMaterial
          color={0xffb975}
          emissive={0xffb975}
          emissiveIntensity={1.1}
          roughness={1}
          metalness={0}
        />
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

/** The studio room: a dark slab floor, a dark frame backdrop and a warm/cool "Karoo Dusk" rig,
 *  deliberately outside the world's day/night cycle so the presentation stays consistent at any hour.
 *
 *  The old room was four near-identical desaturated greys within ~9% luminance of each other, which
 *  left a car silhouette nothing to sit against. These values exist to give the car VALUE SEPARATION.
 *  Both surfaces receiveShadow — without it the whole shadow pass was being computed and thrown away.
 *
 *  No light in here is white. A white light in a dusk set flattens the warm/cool split that does the
 *  actual work: 3000 K amber key against a 9000 K sky fill and a cool blue rim. */
function StudioRoom() {
  return (
    <group name="showroomStudio">
      <mesh
        name="showroomFloor"
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, 0]}
        receiveShadow
      >
        <circleGeometry args={[11, 48]} />
        {/* roughness 0.62, not the spec's 0.35. The spec assumed a small floor; this disc is radius
            11, and at 0.35 the four coloured lights each painted a broad specular wash across it —
            amber left, cool centre, violet right — which read as a rainbow smear rather than a room.
            A rougher floor keeps the value separation while letting the colours stay minor. */}
        <meshStandardMaterial color={0x1a1e22} roughness={0.62} />
      </mesh>
      {/* curved-feel backdrop: a big soft wall behind the plinth */}
      <mesh name="showroomBackdrop" position={[0, 4.4, -7.5]} receiveShadow>
        <planeGeometry args={[26, 10]} />
        <meshStandardMaterial color={0x131920} roughness={0.7} />
      </mesh>

      {/* A hemisphere carries the sky/ground split that a flat ambientLight cannot. */}
      <hemisphereLight
        color={0x3e5b85}
        groundColor={0x0e1114}
        intensity={0.35}
      />

      {/* KEY — warm interior spill, ~3000 K. The signature light. The ortho frustum is tightened to
          ±4.5 (plinth radius 1.7, presented car ~2.28 m) because the old default wasted almost the
          entire shadow map on empty floor — tightening matters more than raising the map size. */}
      <directionalLight
        color={0xffb975}
        position={[4.2, 6.0, 3.6]}
        intensity={2.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-camera-left={-4.5}
        shadow-camera-right={4.5}
        shadow-camera-top={4.5}
        shadow-camera-bottom={-4.5}
        shadow-camera-near={0.5}
        shadow-camera-far={22}
      />

      {/* FILL — cool blue-hour sky, ~9000 K. Never above 0.6 or the warm/cool split collapses. 0.28
          here because the hemisphere already carries a cool sky term; at 0.5 the two stacked into a
          blue-white hotspot on the polished plinth that read as a lens artifact. */}
      <directionalLight
        color={0xc8dcff}
        position={[-5.0, 3.2, 2.4]}
        intensity={0.28}
      />

      {/* RIM — cool blue from behind; separates roof and shoulder from the dark backdrop. */}
      <directionalLight
        color={0x3e8fd0}
        position={[-1.6, 3.6, -6.0]}
        intensity={1.15}
      />

      {/* KICKER — violet, opposite side and low. Makes the rear quarter read as three-dimensional
          rather than a flat shape. Intensity 0.16, well under the spec's 0.45: a directional light
          lights the whole radius-11 floor, not just the car, so at 0.45 the violet stopped being an
          accent on the rear quarter and became a purple field across half the room. The palette rule
          is that violet and blue stay strictly minor against the amber — 0.45 broke it. */}
      <directionalLight
        color={0x8a6bff}
        position={[3.2, 2.2, -5.4]}
        intensity={0.16}
      />
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
      dpr={[1, 2]}
      // toneMapping and outputColorSpace are very likely already the R3F v9 defaults — set explicitly
      // so the intent is legible and a future R3F upgrade cannot silently change the look.
      // toneMappingExposure genuinely is not set by R3F (it leaves it at 1); 1.05 gives a touch of
      // lift now that the scene has real dark values to lift against.
      gl={{
        antialias: true,
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.05,
        outputColorSpace: THREE.SRGBColorSpace,
      }}
    >
      {/* Replaces the old flat 0xced4d8 clear colour. See showroomEnvironment for why a clear colour
          could never work here: it is not geometry, is not lit, and reflects nothing. The visible sky
          and the reflection environment are separate on purpose — the emitters that make a good
          reflection make a terrible backdrop. */}
      <ShowroomSky />
      <ShowroomEnvironment />
      <StudioRoom />
      <TurntableCar vehicle={vehicle} />
      <ShowroomCameraRig zoom={zoom} />
    </Canvas>
  );
}
