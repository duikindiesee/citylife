// Spec 169 slice 1b — DRIVE THE STRAND RUN: the sunset coastal drive, as its own streamed scene.
//
// Its own small Canvas, exactly like ShowroomView and HqReceptionView — a streaming-boundary scene
// that never touches the world scene graph. That is what makes this drivable TODAY without mounting
// the Long Beach region into the island's renderer, frames or roads: the strip, the sea, the road,
// the car and the giant live here, and the island never knows.
//
// Every number this renders comes from strandRunScene.ts (pure, node-tested): terrain mesh, deck
// heights that bridge the arroyos, the ribbon, the chase camera, the gas-giant anchor, the
// kokerboom stands. The DRIVING is the real stepRace/driveCar machinery on the real signature track
// — the same physics the autopilot test completes, now with the operator's own garage car and its
// CAR.STATS.DRIVE.1 stats, so a tuned car drives the Strand differently.
//
// Handbrake is SHIFT here, not Space: the legacy world HUD beneath this overlay binds Space to the
// citizen-sim pause, and two handlers on one key is exactly the kind of wart spec 170 exists to
// remove. Shift avoids the collision without touching the legacy handler.
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { buildLongBeachField } from "./longBeachField";
import { buildStrandRun } from "./strandRun";
import { makeSignatureTrack } from "../racing/signatureTrack";
import { nearestTrackPoint } from "../racing/track";
import {
  isFinished,
  newRaceState,
  stepRace,
  type RaceState,
} from "../racing/race";
import { buildCarMesh } from "../car/carMesh";
import type { CarSpec, CarStatVector } from "../car/carSpec";
import { buildQuiverGeometry } from "../render/R3FQuiverTrees";
import {
  CELL_M,
  EDGE_LINE_WIDTH_M,
  ROAD_WIDTH_M,
  buildRibbonMesh,
  buildTerrainMesh,
  chaseCameraPose,
  deckHeights,
  gasGiantPosition,
  kokerboomInstances,
} from "./strandRunScene";

/** The canonical Long Beach seed for slice 1 — the world the operator drives. */
const LB_CANONICAL_SEED = 1;

const KEY_TO_INPUT: Record<string, keyof PressedKeys> = {
  KeyW: "accelerate",
  ArrowUp: "accelerate",
  KeyS: "brake",
  ArrowDown: "brake",
  KeyA: "steerLeft",
  ArrowLeft: "steerLeft",
  KeyD: "steerRight",
  ArrowRight: "steerRight",
  ShiftLeft: "handbrake",
  ShiftRight: "handbrake",
};

interface PressedKeys {
  accelerate: boolean;
  brake: boolean;
  steerLeft: boolean;
  steerRight: boolean;
  handbrake: boolean;
}

function DriveScene({
  carSpec,
  stats,
  onHud,
}: {
  carSpec: CarSpec;
  stats: CarStatVector;
  onHud: (hud: {
    kmh: number;
    cp: string;
    timeMs: number;
    done: boolean;
  }) => void;
}) {
  const { camera, scene } = useThree();
  const field = useMemo(() => buildLongBeachField(LB_CANONICAL_SEED), []);
  const run = useMemo(() => buildStrandRun(field), [field]);
  const track = useMemo(() => makeSignatureTrack(run), [run]);
  const decks = useMemo(() => deckHeights(field, run), [field, run]);
  const raceRef = useRef<RaceState>(newRaceState(track, stats));

  const keys = useRef<PressedKeys>({
    accelerate: false,
    brake: false,
    steerLeft: false,
    steerRight: false,
    handbrake: false,
  });
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = KEY_TO_INPUT[e.code];
      if (!k) return;
      e.preventDefault();
      keys.current[k] = true;
    };
    const up = (e: KeyboardEvent) => {
      const k = KEY_TO_INPUT[e.code];
      if (!k) return;
      keys.current[k] = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // Static geometry, built once from the pure helpers.
  const terrain = useMemo(() => buildTerrainMesh(field), [field]);
  const asphalt = useMemo(
    () => buildRibbonMesh(field, run, ROAD_WIDTH_M),
    [field, run],
  );
  const edges = useMemo(
    () => [
      buildRibbonMesh(field, run, ROAD_WIDTH_M, 0.02),
      buildRibbonMesh(field, run, ROAD_WIDTH_M - 2 * EDGE_LINE_WIDTH_M, 0.03),
    ],
    [field, run],
  );
  const terrainGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(terrain.positions, 3));
    g.setAttribute("color", new THREE.BufferAttribute(terrain.colors, 3));
    g.setIndex(new THREE.BufferAttribute(terrain.indices, 1));
    g.computeVertexNormals();
    return g;
  }, [terrain]);
  const ribbonGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(asphalt.positions, 3));
    g.setIndex(new THREE.BufferAttribute(asphalt.indices, 1));
    g.computeVertexNormals();
    return g;
  }, [asphalt]);
  // The painted edges: the outer bright ribbon minus the inner asphalt re-draw gives two thin lines.
  const edgeOuterGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(edges[0]!.positions, 3),
    );
    g.setIndex(new THREE.BufferAttribute(edges[0]!.indices, 1));
    return g;
  }, [edges]);
  const edgeInnerGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(edges[1]!.positions, 3),
    );
    g.setIndex(new THREE.BufferAttribute(edges[1]!.indices, 1));
    return g;
  }, [edges]);
  useEffect(
    () => () => {
      terrainGeo.dispose();
      ribbonGeo.dispose();
      edgeOuterGeo.dispose();
      edgeInnerGeo.dispose();
    },
    [terrainGeo, ribbonGeo, edgeOuterGeo, edgeInnerGeo],
  );

  const car = useMemo(() => buildCarMesh(carSpec), [carSpec]);
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

  const quiverGeo = useMemo(() => buildQuiverGeometry(), []);
  useEffect(() => () => quiverGeo.dispose(), [quiverGeo]);
  const kokerbome = useMemo(() => kokerboomInstances(field, run), [field, run]);
  const treeRef = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const mesh = treeRef.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    kokerbome.forEach((t, i) => {
      q.setFromAxisAngle(up, t.yaw);
      m.compose(
        new THREE.Vector3(...t.position),
        q,
        // buildQuiverGeometry is UNIT-HEIGHT with origin at the base, so uniform scale IS the
        // tree's height in metres (2.2–9, quiverTreeHeight's range).
        new THREE.Vector3(t.scaleY, t.scaleY, t.scaleY),
      );
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [kokerbome]);

  const giantRef = useRef<THREE.Mesh>(null);
  const carGroup = useRef<THREE.Group>(null);

  useEffect(() => {
    scene.fog = new THREE.Fog(0x3a2233, 900, 3600);
    return () => {
      scene.fog = null;
    };
  }, [scene]);

  useFrame((_, delta) => {
    const dtMs = Math.min(100, delta * 1000);
    const k = keys.current;
    raceRef.current = stepRace(
      raceRef.current,
      {
        accelerate: k.accelerate,
        brake: k.brake,
        steerLeft: k.steerLeft,
        steerRight: k.steerRight,
        handbrake: k.handbrake,
      },
      dtMs,
    );
    const s = raceRef.current;
    const near = nearestTrackPoint(s.track, s.car.x, s.car.y);
    const deckY =
      decks[Math.max(0, Math.min(decks.length - 1, near.pathIndex))]!;
    if (carGroup.current) {
      carGroup.current.position.set(
        (s.car.x - field.width / 2) * CELL_M,
        deckY + 0.35,
        (s.car.y - field.height / 2) * CELL_M,
      );
      carGroup.current.rotation.set(0, -s.car.heading, 0);
    }
    const pose = chaseCameraPose(field, s.car, deckY);
    camera.position.lerp(new THREE.Vector3(...pose.position), 0.12);
    camera.lookAt(...pose.target);
    if (giantRef.current) {
      giantRef.current.position.set(...gasGiantPosition(camera.position));
    }
    onHud({
      kmh: Math.abs(s.car.speed) * CELL_M * 3.6,
      cp: `${s.checkpoints.filter((c) => c.crossed).length}/${s.checkpoints.length}`,
      timeMs: s.raceTimeMs,
      done: isFinished(s),
    });
  });

  return (
    <group>
      {/* Sunset over the western sea: warm key from the west, cool fill, the giant's own glow. */}
      <ambientLight intensity={0.5} color={0x9fa8c8} />
      <directionalLight
        position={[-600, 160, 80]}
        intensity={1.7}
        color={0xffb070}
      />
      <directionalLight
        position={[300, 220, -200]}
        intensity={0.35}
        color={0x7f9fd0}
      />

      <mesh geometry={terrainGeo} receiveShadow>
        <meshStandardMaterial vertexColors roughness={0.95} metalness={0.02} />
      </mesh>

      {/* The sea: one plane at y=0 — the field's beds dip below it, so shoreline and arroyos read. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-800, 0, 0]}>
        <planeGeometry
          args={[field.width * CELL_M + 6000, field.height * CELL_M + 3000]}
        />
        <meshPhysicalMaterial
          color={0x14384e}
          roughness={0.25}
          metalness={0.1}
          transparent
          opacity={0.92}
        />
      </mesh>

      {/* The carriageway: bright edge lines under a re-drawn asphalt centre. */}
      <mesh geometry={edgeOuterGeo}>
        <meshStandardMaterial color={0xd8d4c8} roughness={0.7} />
      </mesh>
      <mesh geometry={edgeInnerGeo} position={[0, 0.005, 0]}>
        <meshStandardMaterial color={0x2b2e33} roughness={0.9} />
      </mesh>
      <mesh geometry={ribbonGeo} position={[0, -0.02, 0]}>
        <meshStandardMaterial color={0x2b2e33} roughness={0.9} />
      </mesh>

      {/* The blue gas giant, sky-anchored due west over the sea (spec §1.5). */}
      <mesh ref={giantRef}>
        <sphereGeometry args={[260, 48, 32]} />
        <meshStandardMaterial
          color={0x3d6bb3}
          emissive={0x1a3f7a}
          emissiveIntensity={0.55}
          roughness={0.85}
        />
      </mesh>

      {/* Kokerbome lining the drive — the operator's tree frames the operator's road. */}
      <instancedMesh
        ref={treeRef}
        args={[quiverGeo, undefined, Math.max(1, kokerbome.length)]}
        count={kokerbome.length}
      >
        <meshStandardMaterial vertexColors roughness={0.85} />
      </instancedMesh>

      <group ref={carGroup}>
        <primitive object={car} scale={2.4} />
      </group>
    </group>
  );
}

export interface StrandRunViewProps {
  readonly carSpec: CarSpec;
  readonly stats: CarStatVector;
  readonly onClose: () => void;
}

/** The overlay: the drive plus a minimal, state-scoped HUD (speed, checkpoints, time — spec 170's
 *  S5 discipline applied from birth: nothing else is persistent). Esc leaves. */
export function StrandRunView({ carSpec, stats, onClose }: StrandRunViewProps) {
  const [hud, setHud] = useState({ kmh: 0, cp: "0/0", timeMs: 0, done: false });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      data-testid="strand-run"
      style={{ position: "fixed", inset: 0, zIndex: 60, background: "#241726" }}
    >
      <Canvas
        camera={{ fov: 62, near: 0.5, far: 8000, position: [-1800, 40, 0] }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x241726);
        }}
      >
        <DriveScene carSpec={carSpec} stats={stats} onHud={setHud} />
      </Canvas>

      <div
        style={{
          position: "absolute",
          left: "max(16px, env(safe-area-inset-left))",
          bottom: "max(16px, env(safe-area-inset-bottom))",
          display: "flex",
          gap: 14,
          color: "#f2e9dc",
          fontSize: 15,
          textShadow: "0 1px 4px rgba(0,0,0,0.7)",
          pointerEvents: "none",
        }}
      >
        <span style={{ fontSize: 26, fontWeight: 700 }}>
          {hud.kmh.toFixed(0)} km/h
        </span>
        <span style={{ alignSelf: "center" }}>⚑ {hud.cp}</span>
        <span style={{ alignSelf: "center" }}>
          {(hud.timeMs / 1000).toFixed(1)}s
        </span>
      </div>

      {hud.done && (
        <div
          data-testid="strand-run-finished"
          style={{
            position: "absolute",
            top: "40%",
            left: 0,
            right: 0,
            textAlign: "center",
            color: "#ffd9a0",
            fontSize: 34,
            fontWeight: 700,
            textShadow: "0 2px 8px rgba(0,0,0,0.8)",
            pointerEvents: "none",
          }}
        >
          The Strand Run — {(hud.timeMs / 1000).toFixed(1)}s
        </div>
      )}

      <button
        type="button"
        data-testid="strand-run-exit"
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
        Leave Long Beach
      </button>

      <div
        style={{
          position: "absolute",
          top: "max(12px, env(safe-area-inset-top))",
          left: "max(16px, env(safe-area-inset-left))",
          color: "#8fa3b8",
          fontSize: 13,
          letterSpacing: 0.4,
          pointerEvents: "none",
        }}
      >
        The Strand Run · W/S throttle & brake · A/D steer · Shift handbrake
      </div>
    </div>
  );
}
