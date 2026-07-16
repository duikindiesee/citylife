import React, { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { RigidBody, RapierRigidBody, CapsuleCollider } from '@react-three/rapier';
import { Vector3, Euler, Quaternion } from 'three';
import { COLONY } from '../../colony/config';
import { leveledWorldY } from '../../colony/render/terrainLeveling';
import { getSmoothRoadY } from '../../colony/render/roadSurface';
import { BUS_ROAD_LIFT } from '../../colony/render/busLayer';
import {
  PLAYER_HALF_HEIGHT,
  PLAYER_RADIUS_M,
  PLAYER_HALF_EXTENT,
  PLAYER_EYE_OFFSET,
} from '../../colony/scale';

const MOVEMENT_SPEED = 10;
const LOOK_SPEED = 2;
const BUS_RIDER_EYE = 2.4; // eye height above the road while seated on the 3 m coach (spec 149)

// Spec 149 — the slice of the runtime the walker capsule talks to: ride pinning, one-shot
// teleports, and reporting where the camera stands so bus prompts measure from the real player.
interface FpRuntimeBridge {
  fpRidingBusId?: number | null;
  busPoseOf?: (id: number) => { x: number; y: number; heading: number } | null;
  fpTeleportRequest?: { x: number; y: number; yaw?: number; seq: number } | null;
  fpCameraCell?: { x: number; y: number } | null;
}

export function FirstPersonController({ sim, runtime, startPosition = [0, 2, 0], terrainLevel }: { sim?: any, runtime?: FpRuntimeBridge | null, startPosition?: [number, number, number], terrainLevel?: Map<number, number> | null }) {
  const rigidBody = useRef<RapierRigidBody>(null);
  const consumedTeleport = useRef(0);
  const { camera } = useThree();
  
  useEffect(() => {
    const oldFov = (camera as any).fov;
    (camera as any).fov = 65;
    (camera as any).updateProjectionMatrix();
    return () => {
      (camera as any).fov = oldFov;
      (camera as any).updateProjectionMatrix();
    };
  }, [camera]);
  
  const input = useRef({
    forward: false,
    backward: false,
    left: false,
    right: false,
    sprint: false,
    mouseX: 0,
    mouseY: 0,
  });

  const rotation = useRef(new Euler(0, 0, 0, 'YXZ'));

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'KeyW') input.current.forward = true;
      if (e.code === 'KeyS') input.current.backward = true;
      if (e.code === 'KeyA') input.current.left = true;
      if (e.code === 'KeyD') input.current.right = true;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') input.current.sprint = true;
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'KeyW') input.current.forward = false;
      if (e.code === 'KeyS') input.current.backward = false;
      if (e.code === 'KeyA') input.current.left = false;
      if (e.code === 'KeyD') input.current.right = false;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') input.current.sprint = false;
    };

    // Pointer lock for mouse look
    const handleMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement) {
        rotation.current.y -= e.movementX * 0.002;
        rotation.current.x -= e.movementY * 0.002;
        rotation.current.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, rotation.current.x));
      }
    };

    const handleClick = (e: MouseEvent) => {
      // Only lock pointer if clicking directly on the 3D canvas, not UI elements!
      if (e.target instanceof HTMLCanvasElement) {
        document.body.requestPointerLock();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('click', handleClick);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('click', handleClick);
    };
  }, []);

  useFrame((state, delta) => {
    if (!rigidBody.current) return;
    // Spec 131 (verify F2) — yield the camera while the cinematic fly-around owns it. The
    // R3FCameraDirector wins over this controller only by useFrame registration order,
    // which flips when the builder toggle remounts this component — the explicit guard
    // makes camera ownership deterministic instead of mount-order luck.
    if (sim?.state?.cinematic) return;

    const terrainSizeForGrid = sim?.state?.terrain?.size ?? 0;
    const toGridX = (wx: number) => wx / 4 + terrainSizeForGrid / 2;
    const toGridZ = (wz: number) => wz / 4 + terrainSizeForGrid / 2;
    const toWorldX = (gx: number) => (gx - terrainSizeForGrid / 2) * 4;
    const toWorldZ = (gy: number) => (gy - terrainSizeForGrid / 2) * 4;

    // Spec 149 — one-shot teleports (debug placement, stepping off a bus) land the CAPSULE, not
    // just the roster citizen, so the player's eyes actually go there.
    const tp = runtime?.fpTeleportRequest;
    if (tp && tp.seq !== consumedTeleport.current && terrainSizeForGrid > 0) {
      consumedTeleport.current = tp.seq;
      const gx = Math.max(0, Math.min(terrainSizeForGrid - 1, Math.round(tp.x)));
      const gz = Math.max(0, Math.min(terrainSizeForGrid - 1, Math.round(tp.y)));
      const groundY = leveledWorldY(sim.state.terrain, terrainLevel, gx, gz);
      rigidBody.current.setTranslation(
        { x: toWorldX(tp.x), y: groundY + 1.5, z: toWorldZ(tp.y) },
        true,
      );
      rigidBody.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
      if (tp.yaw !== undefined) {
        rotation.current.y = tp.yaw;
        rotation.current.x = 0;
      }
    }

    // Spec 149 — riding the bus: the capsule (and so the camera) is pinned to the coach; mouse
    // look stays free, WASD stays off the wheel. Leaving the pin (alight) drops you where it is.
    const ridingId = runtime?.fpRidingBusId ?? null;
    if (ridingId !== null && runtime?.busPoseOf && sim?.state?.terrain) {
      const pose = runtime.busPoseOf(ridingId);
      if (pose) {
        const roadTop =
          Math.max(0, getSmoothRoadY(sim.state.terrain, pose.x, pose.y)) +
          BUS_ROAD_LIFT;
        const wx = toWorldX(pose.x);
        const wz = toWorldZ(pose.y);
        rigidBody.current.setTranslation(
          // Body centre below the seated eye by the SAME offset the walking path uses (spec 137
          // metric scale), so there is no camera pop on the frame the player alights.
          { x: wx, y: roadTop + BUS_RIDER_EYE - PLAYER_EYE_OFFSET, z: wz },
          true,
        );
        rigidBody.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
        camera.position.set(wx, roadTop + BUS_RIDER_EYE, wz);
        camera.quaternion.setFromEuler(rotation.current);
        if (runtime) runtime.fpCameraCell = { x: pose.x, y: pose.y };
        return;
      }
    }

    // 1. Handle Gamepad Input
    const gamepads = navigator.getGamepads();
    const gp = gamepads[0]; // Assuming PS5 controller is index 0
    let moveX = 0;
    let moveZ = 0;
    let lookX = 0;
    let lookY = 0;

    if (gp) {
      // Left stick for movement (axes 0 and 1)
      if (Math.abs(gp.axes[0]) > 0.1) moveX = gp.axes[0];
      if (Math.abs(gp.axes[1]) > 0.1) moveZ = gp.axes[1];
      
      // Right stick for looking (axes 2 and 3)
      if (Math.abs(gp.axes[2]) > 0.1) lookX = gp.axes[2];
      if (Math.abs(gp.axes[3]) > 0.1) lookY = gp.axes[3];

      rotation.current.y -= lookX * delta * LOOK_SPEED;
      rotation.current.x -= lookY * delta * LOOK_SPEED;
      rotation.current.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, rotation.current.x));
    }

    // Combine keyboard input
    if (input.current.forward) moveZ -= 1;
    if (input.current.backward) moveZ += 1;
    if (input.current.left) moveX -= 1;
    if (input.current.right) moveX += 1;

    // Normalize movement vector so diagonal isn't faster
    const movement = new Vector3(moveX, 0, moveZ);
    if (movement.length() > 1) {
      movement.normalize();
    }

    // Apply rotation to movement vector
    movement.applyEuler(new Euler(0, rotation.current.y, 0));
    // Hold Shift to sprint — the multiplier is the spec-104 config value, so the slate's
    // future sprint bar (spec 138) and this speed can never disagree. The charge/recovery
    // budget lands WITH that HUD; silently exhausting sprint with no gauge reads as a bug.
    const sprint = input.current.sprint
      ? COLONY.firstPerson.sprintWalkSpeedMultiplier
      : 1;
    movement.multiplyScalar(MOVEMENT_SPEED * sprint); // Velocity, so no delta

    // Apply movement to physics body
    const currentVel = rigidBody.current.linvel();
    
    // We use a dynamic body so gravity and terrain collisions work automatically!
    rigidBody.current.setLinvel({
      x: movement.x,
      y: currentVel.y, // preserve gravity/jumping
      z: movement.z
    }, true);

    // Sync Camera
    const pos = rigidBody.current.translation();

    // Terrain height guardrail — against the LEVELED ground (spec 134), the same surface
    // the heightfield collider carries. The old raw-worldY clamp fought the collider
    // wherever the road grading CUT the ground below natural height (road cuttings, shore
    // banks): the capsule stood on the graded floor, the clamp read raw terrain metres
    // above, teleported the walker up, gravity dropped them back — the endless bounce the
    // operator hit walking out of the water.
    const terrain = sim?.state?.terrain;
    if (terrain) {
      const terrainSize = terrain.size;
      const gridX = Math.max(0, Math.min(terrainSize - 1, Math.round(pos.x / 4 + terrainSize / 2)));
      const gridZ = Math.max(0, Math.min(terrainSize - 1, Math.round(pos.z / 4 + terrainSize / 2)));
      // Guard against the RENDERED surface, not the raw sim height — leveling overrides
      // (pads, graded roads, terraforming) are where the visible mesh actually is.
      const terrainHeight = leveledWorldY(terrain, terrainLevel, gridX, gridZ);
      
      if (pos.y < terrainHeight - 0.5) {
        rigidBody.current.setTranslation({
          x: pos.x,
          y: terrainHeight + PLAYER_HALF_EXTENT, // body centre so the resized capsule's feet rest on the ground
          z: pos.z
        }, true);
        rigidBody.current.setLinvel({ x: currentVel.x, y: 0, z: currentVel.z }, true);
      }
    }

    const camY = pos.y + PLAYER_EYE_OFFSET; // eye at PLAYER_EYE_M (1.6 m) above the feet — spec 146
    camera.position.set(pos.x, camY, pos.z);
    camera.quaternion.setFromEuler(rotation.current);
    // Spec 149 — tell the runtime where the player's eyes are (grid coords) so bus boarding
    // prompts measure from the capsule, not the detached roster citizen.
    if (runtime && terrainSizeForGrid > 0)
      runtime.fpCameraCell = { x: toGridX(pos.x), y: toGridZ(pos.z) };
  });

  const safeSpawn = [
    startPosition[0],
    Math.max(startPosition[1], COLONY.world.seaLevel * COLONY.world.heightScale + 2),
    startPosition[2]
  ] as [number, number, number];

  return (
    <RigidBody
      ref={rigidBody}
      type="dynamic"
      colliders={false}
      position={safeSpawn}
      enabledRotations={[false, false, false]}
      mass={1}
      friction={0}
    >
      <CapsuleCollider args={[PLAYER_HALF_HEIGHT, PLAYER_RADIUS_M]} />
      <mesh visible={false}>
        <capsuleGeometry args={[PLAYER_RADIUS_M, PLAYER_HALF_HEIGHT * 2, 4]} />
        <meshBasicMaterial color="red" wireframe />
      </mesh>
    </RigidBody>
  );
}
