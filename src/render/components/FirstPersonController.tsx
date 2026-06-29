import React, { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { RigidBody, RapierRigidBody } from '@react-three/rapier';
import { Vector3, Euler, Quaternion } from 'three';

const MOVEMENT_SPEED = 10;
const LOOK_SPEED = 2;

export function FirstPersonController({ startPosition = [0, 2, 0] }: { startPosition?: [number, number, number] }) {
  const rigidBody = useRef<RapierRigidBody>(null);
  const { camera } = useThree();
  
  const input = useRef({
    forward: false,
    backward: false,
    left: false,
    right: false,
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
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'KeyW') input.current.forward = false;
      if (e.code === 'KeyS') input.current.backward = false;
      if (e.code === 'KeyA') input.current.left = false;
      if (e.code === 'KeyD') input.current.right = false;
    };

    // Pointer lock for mouse look
    const handleMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement) {
        rotation.current.y -= e.movementX * 0.002;
        rotation.current.x -= e.movementY * 0.002;
        rotation.current.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, rotation.current.x));
      }
    };

    const handleClick = () => {
      document.body.requestPointerLock();
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
    movement.multiplyScalar(MOVEMENT_SPEED * delta);

    // Apply movement to physics body
    const pos = rigidBody.current.translation();
    
    // We use a kinematic position body, so we manually update its position based on collisions
    // Wait, dynamic body is better for sliding against walls, but let's use kinematicPosition for simple WASD
    rigidBody.current.setTranslation({
      x: pos.x + movement.x,
      y: pos.y, // simple lock to height
      z: pos.z + movement.z
    }, true);

    // Sync Camera
    camera.position.set(pos.x, pos.y + 1.6, pos.z); // 1.6m eye height
    camera.quaternion.setFromEuler(rotation.current);
  });

  return (
    <RigidBody
      ref={rigidBody}
      type="kinematicPosition"
      colliders="hull"
      position={startPosition}
      enabledRotations={[false, false, false]}
    >
      <mesh visible={false}>
        <capsuleGeometry args={[0.5, 1, 4]} />
        <meshBasicMaterial color="red" wireframe />
      </mesh>
    </RigidBody>
  );
}
