import React from "react";
import { Box, Plane, Text, Cylinder } from "@react-three/drei";
import { RigidBody } from "@react-three/rapier";
import { Vector3 } from "three";

// Materials
const matRoad = <meshStandardMaterial color="#333333" roughness={0.9} />;
const matSidewalk = <meshStandardMaterial color="#888888" roughness={0.8} />;
const matCurb = <meshStandardMaterial color="#aaaaaa" roughness={0.7} />;
const matMarking = (
  <meshStandardMaterial
    color="#ffffff"
    roughness={0.5}
    emissive="#ffffff"
    emissiveIntensity={0.2}
  />
);
const matGarageWall = <meshStandardMaterial color="#dcdcdc" roughness={0.6} />;
const matGarageRoof = <meshStandardMaterial color="#222222" roughness={0.9} />;
const matGarageDoor = (
  <meshStandardMaterial color="#555555" roughness={0.4} metalness={0.5} />
);
const matSignage = (
  <meshStandardMaterial
    color="#ffd700"
    emissive="#ffd700"
    emissiveIntensity={0.5}
  />
);
const matCanopy = <meshStandardMaterial color="#aa3333" roughness={0.8} />;
const matPump = (
  <meshStandardMaterial color="#2266cc" roughness={0.5} metalness={0.3} />
);
const matLampPole = (
  <meshStandardMaterial color="#111111" metalness={0.8} roughness={0.2} />
);
const matLampBulb = (
  <meshStandardMaterial
    color="#ffffee"
    emissive="#ffffee"
    emissiveIntensity={2.0}
  />
);

export function CommercialBlock({
  position,
  rotation,
  name,
  userData,
}: {
  position?: [number, number, number];
  rotation?: [number, number, number];
  name?: string;
  userData?: Record<string, unknown>;
}) {
  return (
    <RigidBody
      type="fixed"
      colliders="trimesh"
      position={position}
      rotation={rotation}
      name={name}
      userData={userData}
    >
      <group>
        {/* 1. Road & Edge Markings */}
        <Plane args={[100, 12]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          {matRoad}
        </Plane>
        {/* Center line (dashed approximation via grouped boxes) */}
        {Array.from({ length: 10 }).map((_, i) => (
          <Box key={i} args={[4, 0.01, 0.2]} position={[-45 + i * 10, 0.01, 0]}>
            {matMarking}
          </Box>
        ))}

        {/* 2. Deterministic Curb + Sidewalk / Verge */}
        {/* South Sidewalk (commercial side) */}
        <Box args={[100, 0.2, 4]} position={[0, 0.1, 8]} receiveShadow>
          {matSidewalk}
        </Box>
        {/* Curb edge */}
        <Box args={[100, 0.25, 0.2]} position={[0, 0.125, 5.9]} receiveShadow>
          {matCurb}
        </Box>

        {/* North Sidewalk */}
        <Box args={[100, 0.2, 4]} position={[0, 0.1, -8]} receiveShadow>
          {matSidewalk}
        </Box>
        <Box args={[100, 0.25, 0.2]} position={[0, 0.125, -5.9]} receiveShadow>
          {matCurb}
        </Box>

        {/* 3. Driveway Apron Cut-in for Garage Frontage */}
        {/* We "cut" the curb and slope it down. For simplicity in Three primitives, 
          we place a darker concrete patch over the sidewalk to simulate the apron. */}
        <Box args={[16, 0.22, 4.2]} position={[0, 0.11, 8]} receiveShadow>
          <meshStandardMaterial color="#666666" roughness={0.9} />
        </Box>
        {/* Replace curb section with a ramp-like or flattened apron edge */}
        <Box args={[16, 0.05, 0.5]} position={[0, 0.025, 6]} receiveShadow>
          <meshStandardMaterial color="#666666" roughness={0.9} />
        </Box>

        {/* 4. Marked Service Forecourt / Pump Zone */}
        <group position={[0, 0.21, 14]}>
          <Plane args={[24, 12]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <meshStandardMaterial color="#555555" roughness={0.95} />
          </Plane>
          {/* Forecourt bay markings */}
          <Box args={[0.2, 0.02, 6]} position={[-4, 0.01, 0]}>
            {matMarking}
          </Box>
          <Box args={[0.2, 0.02, 6]} position={[4, 0.01, 0]}>
            {matMarking}
          </Box>

          {/* Gas Pump / Service Terminal */}
          <Box args={[1, 2, 0.8]} position={[0, 1, 0]} castShadow receiveShadow>
            {matPump}
          </Box>
        </group>

        {/* 5. Lamp Placement (Only on verge, never driveway) */}
        <Lamp position={[-20, 0.2, 7.5]} />
        <Lamp position={[20, 0.2, 7.5]} />
        <Lamp position={[-20, 0.2, -7.5]} />
        <Lamp position={[20, 0.2, -7.5]} />

        {/* 6. Garage Facade Massing */}
        {/* Box + panel replaced with Roof lip, doors, canopy, side wall, signage band */}
        <group position={[0, 0.2, 22]}>
          {/* Main building mass */}
          <Box args={[20, 6, 10]} position={[0, 3, 0]} castShadow receiveShadow>
            {matGarageWall}
          </Box>
          {/* Roof lip / Parapet */}
          <Box
            args={[21, 1, 11]}
            position={[0, 6.5, 0]}
            castShadow
            receiveShadow
          >
            {matGarageRoof}
          </Box>
          {/* Front Canopy reaching out over the forecourt */}
          <Box
            args={[20, 0.5, 6]}
            position={[0, 5, -8]}
            castShadow
            receiveShadow
          >
            {matCanopy}
          </Box>
          {/* Canopy Support Pillars */}
          <Cylinder
            args={[0.2, 0.2, 5]}
            position={[-9, 2.5, -10]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial color="#333" />
          </Cylinder>
          <Cylinder
            args={[0.2, 0.2, 5]}
            position={[9, 2.5, -10]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial color="#333" />
          </Cylinder>
          {/* Garage Bay Doors (2 of them) */}
          <Box args={[5, 4, 0.2]} position={[-4, 2, -5.1]} receiveShadow>
            {matGarageDoor}
          </Box>
          <Box args={[5, 4, 0.2]} position={[4, 2, -5.1]} receiveShadow>
            {matGarageDoor}
          </Box>
          {/* Signage Band */}
          <Box args={[18, 1.5, 0.5]} position={[0, 4.5, -5.2]} castShadow>
            {matSignage}
          </Box>
          <Text
            position={[0, 4.5, -4.9]}
            fontSize={1}
            color="#000000"
            maxWidth={16}
            textAlign="center"
          >
            STREET ROD TUNING
          </Text>
        </group>
      </group>
    </RigidBody>
  );
}

function Lamp({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {/* Pole */}
      <Cylinder args={[0.1, 0.1, 5]} position={[0, 2.5, 0]} castShadow>
        {matLampPole}
      </Cylinder>
      {/* Lamp Head */}
      <Box args={[0.4, 0.2, 1]} position={[0, 5.1, -0.4]} castShadow>
        {matLampPole}
      </Box>
      {/* Bulb (Emissive) */}
      <Box args={[0.2, 0.1, 0.6]} position={[0, 5.0, -0.4]}>
        {matLampBulb}
      </Box>
      {/* Point Light for actual illumination */}
      <pointLight
        position={[0, 4.5, -0.4]}
        intensity={20}
        distance={20}
        color="#ffffee"
        castShadow
      />
    </group>
  );
}
