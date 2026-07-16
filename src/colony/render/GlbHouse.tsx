import React, { useMemo, useRef, useState } from 'react';
import { useGLTF, useAnimations } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useWorldAssets } from '../stores/useWorldAssets';

import { RigidBody } from '@react-three/rapier';

export function GlbHouse({
  assetId,
  position,
  playerCarRef,
  footprint,
}: {
  assetId: string;
  position: [number, number, number];
  playerCarRef?: React.RefObject<THREE.Group>;
  footprint?: { w: number; d: number };
}) {
  const { assets } = useWorldAssets();
  const asset = assets[assetId];
  const groupRef = useRef<THREE.Group>(null);
  const mockDoorRef = useRef<THREE.Mesh>(null);
  const [doorOpen, setDoorOpen] = useState(false);

  // If the asset isn't loaded in the manifest yet or microservice is down, don't crash.
  if (!asset) return null;

  // React Three Fiber's useGLTF hook automatically caches and loads the model from the URL
  const { scene, animations } = useGLTF(asset.modelUrl);
  const { actions } = useAnimations(animations, groupRef);

  // Clone the scene for instancing multiple houses of the same type
  const clonedScene = useMemo(() => scene.clone(), [scene]);

  const fittedScale = useMemo(() => {
    if (!footprint) return null;
    const bounds = new THREE.Box3().setFromObject(clonedScene);
    if (bounds.isEmpty()) return null;

    const size = new THREE.Vector3();
    bounds.getSize(size);
    if (size.x <= 0 || size.z <= 0) return null;

    const worldW = footprint.w * 4;
    const worldD = footprint.d * 4;
    const fit = Math.min(worldW / size.x, worldD / size.z);

    // Override manifest scale to force the garage shell to occupy the lot footprint.
    // The previous `asset.scale` (often 1,1,1) left this model under-sized for 16x11 pads.
    return [fit, fit, fit] as const;
  }, [footprint, clonedScene]);

  const houseScale = fittedScale ?? asset.scale;

  // Proximity check loop
  useFrame(({ camera }) => {
    if (!groupRef.current) return;

    // Check distance between house and either the camera (FirstPerson) or the PlayerCar
    const housePos = new THREE.Vector3(position[0], position[1], position[2]);
    const targetPos = playerCarRef?.current?.position || camera.position;

    const distance = housePos.distanceTo(targetPos);
    const shouldBeOpen = distance < 12; // 12 units is a good driveway distance

    if (shouldBeOpen !== doorOpen) {
      setDoorOpen(shouldBeOpen);
      if (asset.animations?.includes('door_open') && actions['door_open']) {
        if (shouldBeOpen) {
          actions['door_open']?.reset().play();
        } else {
          actions['door_close']?.reset().play();
        }
      }
    }

    // Mock door animation (swinging hinge) if the .glb is just a static box
    if (mockDoorRef.current) {
      const targetRotation = doorOpen ? Math.PI / 2 : 0;
      mockDoorRef.current.rotation.y = THREE.MathUtils.lerp(mockDoorRef.current.rotation.y, targetRotation, 0.1);
    }
  });

  return (
    <group ref={groupRef} position={position} scale={houseScale}>
      <RigidBody type="fixed" colliders="trimesh">
        <primitive object={clonedScene} />
      </RigidBody>

      {/* Temporary Mock Garage Door in case the .glb is just a static box */}
      {asset.metadata?.isGarage && (
        <group position={[0, 1.5, 2]}>
          {/* Move hinge to edge of driveway */}
          <mesh ref={mockDoorRef} position={[1, 0, 0]}>
            {/* Offset mesh from hinge */}
            <boxGeometry args={[2, 3, 0.2]} />
            <meshStandardMaterial color={0x444444} />
          </mesh>
        </group>
      )}
    </group>
  );
}
