import React, { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { BIOME_COLOR, Biome } from '../terrain';

interface R3FOceanProps {
  size: number;
}

export function R3FOcean({ size }: R3FOceanProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  
  const { geometry, base } = useMemo(() => {
    const geo = new THREE.RingGeometry(0.5, size * 0.99, 120, 30);
    const pos = geo.getAttribute('position');
    const b = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      b[i * 2] = pos.getX(i);
      b[i * 2 + 1] = pos.getY(i);
    }
    // RingGeometry creates in X,Y so we must rotate the mesh to lie flat in X,Z
    return { geometry: geo, base: b };
  }, [size]);

  useFrame((state) => {
    if (!meshRef.current) return;
    const geo = meshRef.current.geometry;
    const pos = geo.getAttribute('position');
    const t = state.clock.elapsedTime * 0.5; // slow down slightly for calm swells
    
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 2];
      const y = base[i * 2 + 1];
      const z =
        Math.sin(x * 0.05 + t * 0.85) * 0.18 +
        Math.sin(y * 0.063 - t * 0.7) * 0.14 +
        Math.sin((x + y) * 0.028 + t * 1.25) * 0.09;
      pos.setZ(i, z);
    }
    pos.needsUpdate = true;
    // Removed computeVertexNormals() - it's too slow for CPU each frame!
  });

  return (
    <mesh 
      ref={meshRef} 
      geometry={geometry} 
      rotation={[-Math.PI / 2, 0, 0]} 
      position={[0, 0.15, 0]} 
      receiveShadow
    >
      <meshStandardMaterial 
        color={BIOME_COLOR[Biome.Ocean]}
        roughness={0.7}
        metalness={0.0}
        flatShading={false}
      />
    </mesh>
  );
}
