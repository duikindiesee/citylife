import React, { useEffect, useState, useMemo } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import { Sky, ContactShadows } from '@react-three/drei';
import { EffectComposer, Bloom, ToneMapping } from '@react-three/postprocessing';
import { Physics, RigidBody } from '@react-three/rapier';
import { ToneMappingMode } from 'postprocessing';
import * as THREE from 'three';

import type { ColonySim } from '../sim';
import { FirstPersonController } from '../../render/components/FirstPersonController';
import { CommercialBlock } from '../../render/components/CommercialBlock';
import { Island } from '../../render/components/Island';

export type ViewMode = "biome" | "buildable" | "elevation";
export type CameraPreset = "street" | "district" | "planet";
export interface AvatarView {
  id: string;
  displayName: string;
  x: number;
  y: number;
  heading: number;
  lookPitch?: number;
  hasPod: boolean;
  kind: "human" | "crab";
  isOperator: boolean;
}

const LOT_SIZE = 4;

function ZoneManager({ sim }: { sim: ColonySim }) {
  const state = sim.state;
  
  const buildings = useMemo(() => {
    if (!state.cityPlan) return [];
    
    const elements = [];
    const size = state.terrain.size;
    
    // Plot named cityPlan plots
    for (const plot of state.cityPlan.plots) {
      const wX = (plot.x - size / 2) * LOT_SIZE;
      const wZ = (plot.y - size / 2) * LOT_SIZE;
      
      if (plot.zone === "commercial") {
        elements.push(
          <CommercialBlock 
            key={`comm-${plot.id}`} 
            position={[wX, 0, wZ]} 
          />
        );
      } else if (plot.zone === "residential") {
        elements.push(
          <RigidBody key={`res-${plot.id}`} type="fixed" position={[wX, 2, wZ]}>
            <mesh castShadow receiveShadow>
              <boxGeometry args={[LOT_SIZE * (plot.w || 1), 4, LOT_SIZE * (plot.h || 1)]} />
              <meshStandardMaterial color="#e6cda2" roughness={0.9} />
            </mesh>
          </RigidBody>
        );
      }
    }
    return elements;
  }, [state.cityPlan]);

  return <group>{buildings}</group>;
}

function R3FWorld({ sim }: { sim: ColonySim }) {
  const [time, setTime] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setTime(t => (t + 0.1) % 24);
    }, 1000);
    return () => clearInterval(interval);
  }, [sim]);

  const sunPosition: [number, number, number] = [
    Math.cos((time / 24) * Math.PI * 2 - Math.PI / 2) * 200,
    Math.max(0.1, Math.sin((time / 24) * Math.PI * 2 - Math.PI / 2) * 200),
    0
  ];

  const isNight = time < 6 || time > 18;

  return (
    <>
      <color attach="background" args={isNight ? ['#050510'] : ['#87CEEB']} />
      <fog attach="fog" args={[isNight ? '#050510' : '#87CEEB', 50, 400]} />
      
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
      <Sky sunPosition={sunPosition} turbidity={0.1} rayleigh={0.5} mieCoefficient={0.005} />
      
      <Physics>
        <Island />
        <ZoneManager sim={sim} />
        <FirstPersonController startPosition={[0, 15, 0]} />
      </Physics>

      <ContactShadows resolution={1024} frames={1} scale={200} blur={2} opacity={0.4} far={20} color="#000000" />

      <EffectComposer>
        <Bloom luminanceThreshold={1} mipmapBlur intensity={1.5} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      </EffectComposer>
    </>
  );
}

export class PlanetRenderer {
  private root: Root;
  public onGroundClick?: (gx: number, gy: number) => void;

  constructor(private container: HTMLElement, private sim: ColonySim) {
    container.style.width = '100vw';
    container.style.height = '100vh';
    container.style.position = 'absolute';
    container.style.top = '0';
    container.style.left = '0';
    container.style.zIndex = '-1';

    this.root = createRoot(container);
    this.root.render(
      <Canvas shadows camera={{ fov: 45, far: 1000 }}>
        <R3FWorld sim={this.sim} />
      </Canvas>
    );
  }

  frame(dt: number) {}
  resize(...args: any[]) {}
  dispose() { this.root.unmount(); }
  
  firstPersonPNG(...args: any[]) { return null; }
  capturePNG() { return null; }
  
  setOperatorCar(car: any, cell: any) {}
  enterFirstPerson(id: string) {}
  exitFirstPerson() {}
  setRaceState(state: any) {}
  
  setViewMode(mode: any) {}
  setView(mode: any) {}
  setCameraPreset(preset: any) {}
  applyPreset(preset: any) {}
  setCinematic(enabled: boolean) {}
  
  setAvatarView(avatars: any[]) {}
  setAvatarSource(source: any) {}
  setBarState(cells: any[], occupants: any[], by: any[]) {}
  
  syncTerrain(t: any) {}
  setZoningVisible(v: boolean) {}
  setZonesVisible(v: boolean) {}
  
  setNeighborhood(n: any) {}
  setCommercialDistrict(d: any) {}
  setRoadWays(r: any) {}
  setBusRoute(b: any) {}
}
