import React, { useEffect, useState, useMemo } from "react";
import { createRoot, Root } from "react-dom/client";
import { Canvas } from "@react-three/fiber";
import { Sky, ContactShadows } from "@react-three/drei";
import {
  EffectComposer,
  Bloom,
  ToneMapping,
} from "@react-three/postprocessing";
import { Physics, RigidBody } from "@react-three/rapier";
import { ToneMappingMode } from "postprocessing";
import * as THREE from "three";

import type { Simulation } from "../engine/simulation";
import type { SimState } from "../engine/types";
import { FirstPersonController } from "./components/FirstPersonController";
import { CommercialBlock } from "./components/CommercialBlock";
import { Island } from "./components/Island";

const LOT_SIZE = 4; // Scale up the 2D grid squares

function ZoneManager({ sim }: { sim: Simulation }) {
  // We use state to force a re-render when the world generates,
  // but since building layouts are static we only compute this once.
  const state = sim.state;

  const buildings = useMemo(() => {
    return state.buildings.map((b) => {
      const isCommercial = b.zone === "commercial";
      const isResidential = b.zone === "residential";

      const x = (b.x - state.width / 2) * LOT_SIZE;
      const z = (b.y - state.height / 2) * LOT_SIZE;

      if (isCommercial) {
        return (
          <CommercialBlock
            key={b.id}
            position={[x, 0, z]}
            rotation={[0, 0, 0]}
          />
        );
      }

      if (isResidential) {
        return (
          <RigidBody key={b.id} type="fixed" position={[x, b.height / 2, z]}>
            <mesh castShadow receiveShadow>
              <boxGeometry args={[LOT_SIZE * 0.8, b.height, LOT_SIZE * 0.8]} />
              <meshStandardMaterial color="#e6cda2" roughness={0.9} />
            </mesh>
          </RigidBody>
        );
      }

      // Default generic building
      return (
        <RigidBody key={b.id} type="fixed" position={[x, b.height / 2, z]}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[LOT_SIZE * 0.8, b.height, LOT_SIZE * 0.8]} />
            <meshStandardMaterial color="#cf9162" roughness={0.9} />
          </mesh>
        </RigidBody>
      );
    });
  }, [state.buildings, state.width, state.height]);

  return <group>{buildings}</group>;
}

function R3FWorld({ sim }: { sim: Simulation }) {
  const [time, setTime] = useState(
    sim.state.clock.hour + sim.state.clock.minute / 60,
  );

  useEffect(() => {
    // Fast polling or subscription to update time of day visually
    const interval = setInterval(() => {
      setTime(sim.state.clock.hour + sim.state.clock.minute / 60);
    }, 1000);
    return () => clearInterval(interval);
  }, [sim]);

  const sunPosition: [number, number, number] = [
    Math.cos((time / 24) * Math.PI * 2 - Math.PI / 2) * 200,
    Math.max(0.1, Math.sin((time / 24) * Math.PI * 2 - Math.PI / 2) * 200),
    0,
  ];

  const isNight = time < 6 || time > 18;

  return (
    <>
      <color attach="background" args={isNight ? ["#050510"] : ["#87CEEB"]} />
      <fog attach="fog" args={[isNight ? "#050510" : "#87CEEB", 50, 400]} />

      <ambientLight intensity={isNight ? 0.2 : 0.6} />
      {!isNight && (
        <directionalLight
          castShadow
          position={sunPosition}
          intensity={2}
          shadow-mapSize={[4096, 4096]}
          shadow-camera-left={-200}
          shadow-camera-right={200}
          shadow-camera-top={200}
          shadow-camera-bottom={-200}
          shadow-camera-far={500}
        />
      )}
      <Sky
        sunPosition={sunPosition}
        turbidity={0.1}
        rayleigh={0.5}
        mieCoefficient={0.005}
      />

      <Physics>
        <Island />
        <ZoneManager sim={sim} />
        <FirstPersonController startPosition={[0, 15, 0]} />
      </Physics>

      <ContactShadows
        resolution={1024}
        frames={1}
        scale={200}
        blur={2}
        opacity={0.4}
        far={20}
        color="#000000"
      />

      <EffectComposer>
        <Bloom luminanceThreshold={1} mipmapBlur intensity={1.5} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      </EffectComposer>
    </>
  );
}

export class R3FCityRenderer {
  private root: Root;

  constructor(
    container: HTMLElement,
    private sim: Simulation,
  ) {
    // Make sure container has dimensions for the Canvas
    container.style.width = "100vw";
    container.style.height = "100vh";
    container.style.position = "absolute";
    container.style.top = "0";
    container.style.left = "0";
    container.style.zIndex = "-1"; // Behind UI

    this.root = createRoot(container);
    this.root.render(
      <Canvas shadows camera={{ fov: 45, far: 1000 }}>
        <R3FWorld sim={this.sim} />
      </Canvas>,
    );
  }

  frame() {
    // R3F internal useFrame handles loop
  }

  resize() {
    // R3F Canvas handles auto-resizing
  }

  refreshBuildings() {
    // R3F handles reactivity when sim state changes
  }

  dispose() {
    this.root.unmount();
  }
}
