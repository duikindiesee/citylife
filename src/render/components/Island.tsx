import React, { useMemo } from "react";
import { createNoise3D } from "simplex-noise";
import * as THREE from "three";
import { RigidBody } from "@react-three/rapier";

// Simple Mulberry32 seeded PRNG
function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function Island() {
  const size = 2000; // SUPER LARGE for a city builder
  const segments = 256;

  // Generate terrain geometry
  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2); // Lay flat on XZ plane

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);

    // Seed the noise so the world is deterministic
    const rng = mulberry32(12345);
    const noise3D = createNoise3D(rng);

    const sandColor = new THREE.Color("#d2b48c");
    const dirtColor = new THREE.Color("#8b5a2b");
    const grassColor = new THREE.Color("#4c8a32");
    const rockColor = new THREE.Color("#666666");
    const tmpColor = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);

      // Distance from center to create an island mask
      const dist = Math.sqrt(x * x + z * z);
      const maxDist = size / 2;
      const mask = Math.max(0, 1 - Math.pow(dist / maxDist, 2));

      // Layered noise (frequencies adjusted for larger map)
      let y = noise3D(x * 0.002, z * 0.002, 0) * 80; // Large hills
      y += noise3D(x * 0.01, z * 0.01, 10) * 15; // Medium bumps

      // Apply mask so edges dip into the water
      y = (y + 20) * mask - 10;

      pos.setY(i, y);

      // Simple biomes based on height (scaled for new 80+ height range)
      if (y < 0) {
        tmpColor.copy(sandColor);
      } else if (y < 10) {
        tmpColor.copy(sandColor).lerp(dirtColor, y / 10);
      } else if (y < 40) {
        tmpColor.copy(dirtColor).lerp(grassColor, (y - 10) / 30);
      } else {
        tmpColor.copy(grassColor).lerp(rockColor, Math.min(1, (y - 40) / 40));
      }

      colors[i * 3] = tmpColor.r;
      colors[i * 3 + 1] = tmpColor.g;
      colors[i * 3 + 2] = tmpColor.b;
    }

    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    return geo;
  }, []);

  return (
    <group>
      {/* Terrain */}
      <RigidBody type="fixed" colliders="trimesh">
        <mesh geometry={geometry} receiveShadow castShadow>
          <meshStandardMaterial
            vertexColors
            side={THREE.FrontSide}
            roughness={0.8}
          />
        </mesh>
      </RigidBody>

      {/* Ocean Plane */}
      <mesh
        position={[0, -0.5, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <planeGeometry args={[size * 3, size * 3]} />
        <meshStandardMaterial
          color="#0a5e8f"
          roughness={0.1}
          metalness={0.8}
          transparent
          opacity={0.9}
        />
      </mesh>
    </group>
  );
}
