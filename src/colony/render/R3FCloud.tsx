import React, { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { buildClouds, CloudLayer } from './cloudLayer';

export function R3FCloud({ worldSize }: { worldSize: number }) {
  const groupRef = useRef<THREE.Group>(null);
  const cloudLayerRef = useRef<CloudLayer | null>(null);

  useEffect(() => {
    if (!groupRef.current) return;
    const layer = buildClouds({ worldSize });
    groupRef.current.add(layer.group);
    cloudLayerRef.current = layer;

    return () => {
      layer.dispose();
      cloudLayerRef.current = null;
    };
  }, [worldSize]);

  useFrame((state) => {
    if (cloudLayerRef.current) {
      cloudLayerRef.current.update(state.clock.elapsedTime * 1000);
    }
  });

  return <group ref={groupRef} />;
}
