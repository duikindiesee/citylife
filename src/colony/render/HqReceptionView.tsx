// HQ.VIEW.1 — the Kooker HQ reception interior: the room you stand in when you walk through the door.
//
// Its own small Canvas, exactly like ShowroomView (PLAYER.GARAGE.1) — a streaming-boundary interior
// scene that never touches the world scene graph. Entering HQ is a boundary, not a coordinate reset
// (spec 152), and keeping the two graphs separate is what makes that true in the renderer as well as
// in the layout document.
//
// EVERY number here comes from `hqReception.ts`, which derives them from the spec-152 reception frame.
// Nothing about the room's size or the camera's limits is decided in this file, so both are unit-tested
// in node rather than eyeballed in a screenshot.
//
// SCOPE. This is reception ONLY. Spec 153's campus — the commons, the Big Board, the Gate Room, the
// per-bot office wings — attaches to the back wall later, append-only, without moving anything here.
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  HQ_EYE_HEIGHT_M,
  HQ_ROOM_DEPTH_M,
  HQ_ROOM_WIDTH_M,
  HQ_WALL_HEIGHT_M,
  hqCameraPosition,
  hqDoorway,
  hqWallSegments,
} from "../hq/hqReception";

/** Slow orbit so the room reads as a space rather than a flat backdrop. Presentation only. */
const ORBIT_RATE = 0.06;
/** The point the camera studies — a standing eyeline at the middle of the room. */
const LOOK_AT = new THREE.Vector3(0, HQ_EYE_HEIGHT_M, 0);

function ReceptionRoom() {
  const walls = useMemo(() => hqWallSegments(), []);
  const door = useMemo(() => hqDoorway(), []);
  return (
    <group name="hqReception">
      {/* Floor. Polished dark stone — the lobby idiom, and it takes the light rig's reflection. */}
      <mesh
        name="hqFloor"
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, 0]}
        receiveShadow
      >
        <planeGeometry args={[HQ_ROOM_WIDTH_M, HQ_ROOM_DEPTH_M]} />
        <meshPhysicalMaterial
          color={0x1b2026}
          metalness={0.35}
          roughness={0.32}
          envMapIntensity={0.9}
        />
      </mesh>

      {/* Walls, including the front wall split into three panels around the street door, so the
          doorway is a real opening rather than a painted one. */}
      {walls.map((w) => (
        <mesh
          key={w.id}
          name={`hqWall-${w.id}`}
          position={[w.x, w.y, w.z]}
          rotation={[0, w.yaw, 0]}
          receiveShadow
        >
          <planeGeometry args={[w.w, w.h]} />
          <meshStandardMaterial
            color={0x2b333c}
            roughness={0.85}
            metalness={0.04}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}

      {/* The reception desk. A single slab, off-centre and facing the door, so the room has an
          obvious front — the "weenie" spec 153 asks for: door, desk, and (later) the commons beyond. */}
      <mesh name="hqDesk" position={[-1.6, 0.55, 1.4]} castShadow receiveShadow>
        <boxGeometry args={[3.4, 1.1, 0.9]} />
        <meshStandardMaterial
          color={0x3a4550}
          roughness={0.5}
          metalness={0.15}
        />
      </mesh>

      {/* The brass door post the citizen-voice text describes. Warm metal against cold stone is the
          whole palette in one object, and it marks the way OUT unmistakably. */}
      <mesh
        name="hqDoorPost"
        position={[door.w / 2 + 0.12, door.h / 2, door.z + 0.06]}
        castShadow
      >
        <cylinderGeometry args={[0.06, 0.06, door.h, 12]} />
        <meshStandardMaterial
          color={0xc9a227}
          metalness={0.85}
          roughness={0.3}
        />
      </mesh>

      {/* Daylight through the doorway — the one warm source, placed AT the opening, so the exit reads
          as the bright end of the room without any UI pointing at it. */}
      <rectAreaLight
        position={[0, door.h / 2, door.z + 0.02]}
        width={door.w}
        height={door.h}
        intensity={5}
        color={0xffd9a0}
      />
    </group>
  );
}

/** Bounded orbit. Azimuth drifts, distance is clamped, elevation is fixed — the camera can never leave
 *  the room or push its near plane through the desk. */
function BoundedOrbit() {
  const { camera } = useThree();
  const azimuth = useRef(0);
  useFrame((_, delta) => {
    azimuth.current += delta * ORBIT_RATE;
    // hqCameraPosition is the ONE place the orbit is computed, and the test sweeps it over a full turn
    // to prove the camera never leaves the room. Do not inline this arithmetic here.
    const p = hqCameraPosition(azimuth.current);
    camera.position.set(p.x, p.y, p.z);
    camera.lookAt(LOOK_AT);
  });
  return null;
}

export interface HqReceptionViewProps {
  readonly onClose: () => void;
}

/**
 * The reception overlay. Esc closes it — the browser convention and the one Roblox's escape menu
 * trains, so it needs no on-screen instruction beyond the labelled button.
 */
export function HqReceptionView({ onClose }: HqReceptionViewProps) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    setReady(true);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      data-testid="hq-reception"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "#0a0d11",
      }}
    >
      <Canvas
        shadows
        camera={{ fov: 55, near: 0.1, far: 120, position: [0, 2.4, 8] }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x0a0d11);
        }}
      >
        {/* A three-point rig plus the doorway's warm key: enough to read the volume of a double-height
            lobby without lighting it like a showroom. */}
        <ambientLight intensity={0.5} color={0x8fa3b8} />
        <directionalLight
          position={[4, HQ_WALL_HEIGHT_M, -3]}
          intensity={1.15}
          castShadow
        />
        <directionalLight
          position={[-5, HQ_WALL_HEIGHT_M * 0.8, 4]}
          intensity={0.45}
          color={0x9fc4ff}
        />
        <ReceptionRoom />
        <BoundedOrbit />
      </Canvas>

      <button
        type="button"
        data-testid="hq-reception-exit"
        onClick={onClose}
        style={{
          position: "absolute",
          top: "max(12px, env(safe-area-inset-top))",
          right: "max(12px, env(safe-area-inset-right))",
          padding: "10px 16px",
          borderRadius: 10,
          border: "1px solid #3a4550",
          background: "#161b21",
          color: "#e8eef5",
          fontSize: 14,
          cursor: "pointer",
        }}
      >
        Leave HQ
      </button>

      <div
        style={{
          position: "absolute",
          left: "max(16px, env(safe-area-inset-left))",
          bottom: "max(16px, env(safe-area-inset-bottom))",
          color: "#8fa3b8",
          fontSize: 13,
          letterSpacing: 0.4,
          opacity: ready ? 1 : 0,
          transition: "opacity 240ms ease",
          pointerEvents: "none",
        }}
      >
        Kooker HQ · Reception
      </div>
    </div>
  );
}
