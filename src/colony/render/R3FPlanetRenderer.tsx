import React, { useEffect, useState, useMemo, useRef } from 'react';
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

import { R3FTerrain } from './R3FTerrain';
import { R3FOcean } from './R3FOcean';
import { R3FFoliage } from './R3FFoliage';
import { R3FCloud } from './R3FCloud';
import { R3FFoam } from './R3FFoam';
import { R3FRoadBuilder } from './R3FRoadBuilder';
import { R3FRoadNetwork } from './R3FRoadNetwork';
import { buildShoreProps } from './shoreProps';
import { buildVenueProps } from './venueProps';
import { useTerrainLeveling } from './useTerrainLeveling';
import { useRoadNetwork } from '../stores/useRoadNetwork';
import { COLONY } from '../config';
import { Html, MapControls } from '@react-three/drei';
import { useThree, useFrame } from '@react-three/fiber';

import { VoxelHouseMesh } from "./VoxelHouseMesh";
import { GlbHouse } from "./GlbHouse";
import { useWorldAssets } from "../stores/useWorldAssets";
import { R3FPlayerCar } from "./R3FPlayerCar";
import { ErrorBoundary } from "./ErrorBoundary";
import { useSimSignal, type SimBridge } from './useSimSignal';
import { zoneSignature, spawnSignature } from './simSignals';

function ZoneManager({ sim, runtime }: { sim: ColonySim; runtime?: SimBridge }) {
  const state = sim.state;
  const { assets, fetchManifest } = useWorldAssets();

  useEffect(() => {
    fetchManifest();
  }, []);

  // Subscribe to the mutable sim — a lot placed, demolished or built must re-render here.
  const zoneSig = useSimSignal(runtime, () => zoneSignature(state));
  const buildings = useMemo(() => {
    const elements = [];

    if (state.cityPlan) {
      const size = state.terrain.size;
      for (const plot of state.cityPlan.plots) {
        if (plot.zone === "commercial") {
          const wX = (plot.x - size / 2) * 4;
          const wZ = (plot.y - size / 2) * 4;
          elements.push(
            <CommercialBlock 
              key={`comm-${plot.id}`} 
              position={[wX, 0, wZ]} 
            />
          );
        }
      }
    }
    
    if (state.neighborhood?.lots) {
      const size = state.terrain.size;
      for (const lot of state.neighborhood.lots) {
        if (lot.built) {
          if (lot.zone === "commercial") {
            const wX = (lot.x - size / 2) * 4;
            const wZ = (lot.y - size / 2) * 4;
            elements.push(
              <CommercialBlock 
                key={`comm-${lot.id}`} 
                position={[wX, 0, wZ]} 
              />
            );
          } else {
            // If the microservice has a functional garage asset, use the GLB House!
            // We wrap in ErrorBoundary + Suspense so bad models fall back to voxel houses.
            if (assets["functional_garage"]) {
               elements.push(
                 <ErrorBoundary 
                   key={`res-err-${lot.id}`} 
                   fallback={<VoxelHouseMesh lot={lot} mapSize={size} />}
                 >
                   <React.Suspense fallback={<VoxelHouseMesh lot={lot} mapSize={size} />}>
                     <GlbHouse assetId="functional_garage" position={[lot.houseZone.x, 0.1, lot.houseZone.y]} />
                   </React.Suspense>
                 </ErrorBoundary>
               );
            } else {
               elements.push(<VoxelHouseMesh key={`res-${lot.id}`} lot={lot} mapSize={size} />);
            }
          }
        } else {
          // Render unbuilt/zoned plot ground footprint overlay
          const wX = (lot.x - size / 2) * 4;
          const wZ = (lot.y - size / 2) * 4;
          const wY = state.terrain.worldY(Math.round(lot.x), Math.round(lot.y));
          const color = lot.zone === "commercial" ? "#55cfff" : "#55ff55";
          elements.push(
            <mesh
              key={`zone-ground-${lot.id}`}
              name={`zone-ground-${lot.id}`}
              position={[wX, wY + 0.1, wZ]}
            >
              <boxGeometry args={[lot.w * 4, 0.1, lot.h * 4]} />
              <meshStandardMaterial color={color} opacity={0.35} transparent roughness={1.0} />
            </mesh>
          );
        }
      }
    }

    return elements;
  }, [sim, zoneSig, assets]);

  return <group>{buildings}</group>;
}

const DAY_BG = new THREE.Color('#5b9bd5'); // Softer, desaturated daytime blue
const NIGHT_BG = new THREE.Color('#1a2035'); // Brightened from #050510 to a deep dusk/moonlight blue

function DayNightCycle({ sim }: { sim: ColonySim }) {
  const bgRef = useRef<THREE.Color>(null);
  const fogRef = useRef<THREE.FogExp2>(null);
  const ambientLightRef = useRef<THREE.AmbientLight>(null);
  const dirLightRef = useRef<THREE.DirectionalLight>(null);
  const skyRef = useRef<any>(null); // Sky doesn't easily support ref updates for sunPosition in some versions, but we can pass it via props if we use state. But wait, useFrame is better! Let's update it.

  useFrame(() => {
    // Read the sim clock directly
    const time = sim.state.clock.hour + sim.state.clock.minute / 60;
    
    // Calculate sun position (0=midnight, 6=dawn, 12=noon, 18=dusk)
    const sunAngle = ((time - 6) / 24) * Math.PI * 2;
    const sunX = Math.cos(sunAngle) * 200;
    const sunY = Math.max(-10, Math.sin(sunAngle) * 200);
    const sunZ = 0;

    // Determine day/night blend factor (0 = night, 1 = day)
    let dayFactor = 0;
    if (time > 5 && time < 7) {
      dayFactor = (time - 5) / 2; // dawn blend
    } else if (time >= 7 && time <= 17) {
      dayFactor = 1; // full day
    } else if (time > 17 && time < 19) {
      dayFactor = 1 - (time - 17) / 2; // dusk blend
    }

    // Apply interpolated values
    if (bgRef.current) bgRef.current.lerpColors(NIGHT_BG, DAY_BG, dayFactor);
    if (fogRef.current) {
      fogRef.current.color.lerpColors(NIGHT_BG, DAY_BG, dayFactor);
      // Exponential fog is much smoother. Adjust density instead of near/far
      // Night density: 0.003 (thinned out to improve visibility), Day density: 0.001
      fogRef.current.density = 0.003 - dayFactor * 0.002;
    }
    if (ambientLightRef.current) {
      // Increased base night ambient light from 0.2 to 0.5 so it's never too dark
      ambientLightRef.current.intensity = 0.5 + dayFactor * 0.3;
    }
    if (dirLightRef.current) {
      dirLightRef.current.position.set(sunX, sunY, sunZ);
      dirLightRef.current.intensity = dayFactor * 2;
    }
    if (skyRef.current?.material) {
      skyRef.current.material.uniforms.sunPosition.value.set(sunX, sunY, sunZ);
    }
  });

  return (
    <>
      <color ref={bgRef} attach="background" args={['#050510']} />
      <fogExp2 ref={fogRef} attach="fog" args={['#050510', 0.005]} />
      
      <ambientLight ref={ambientLightRef} intensity={0.2} />
      <directionalLight
        ref={dirLightRef}
        castShadow
        position={[0, -10, 0]}
        intensity={0}
        shadow-mapSize={[4096, 4096]}
        shadow-camera-left={-200}
        shadow-camera-right={200}
        shadow-camera-top={200}
        shadow-camera-bottom={-200}
        shadow-camera-far={500}
      />
      <Sky ref={skyRef} turbidity={0.1} rayleigh={0.5} mieCoefficient={0.005} />
    </>
  );
}

/** Live probe in the spirit of window.__colony — exposes the three.js scene so Playwright
 *  specs (and the operator console) can assert on what is actually rendered, not just on
 *  sim state. See e2e/reactivity.spec.ts. */
function SceneProbe() {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const w = window as unknown as { __r3fScene?: THREE.Scene };
    w.__r3fScene = scene;
    return () => {
      if (w.__r3fScene === scene) w.__r3fScene = undefined;
    };
  }, [scene]);
  return null;
}

function AerialCameraController() {
  const { camera } = useThree();
  
  useEffect(() => {
    // Position camera high up looking down
    camera.position.set(0, 150, 0);
    camera.rotation.set(-Math.PI / 2, 0, 0);
  }, [camera]);

  return (
    <MapControls 
      makeDefault 
      dampingFactor={0.1} 
      maxPolarAngle={Math.PI / 2.2} 
      minDistance={10} 
      maxDistance={2500} 
      mouseButtons={{
        LEFT: undefined as any, // Reserved for building roads
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN
      }}
    />
  );
}



function findDrySpawn(terrain: any) {
  const N = terrain.size;
  const cx = terrain.landing.x;
  const cz = terrain.landing.y;
  
  const isLand = (x: number, y: number) => {
    const i = y * N + x;
    return terrain.elev[i] >= COLONY.world.seaLevel && !terrain.water[i];
  };
  
  for (let r = 0; r < N; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = Math.round(cx + dx);
        const y = Math.round(cz + dy);
        if (x < 0 || y < 0 || x >= N || y >= N) continue;
        if (isLand(x, y)) {
          const wx = (x - N/2) * 4;
          const wz = (y - N/2) * 4;
          return [wx, terrain.worldY(x, y) + 2, wz] as [number, number, number];
        }
      }
    }
  }
  return [0, COLONY.world.seaLevel * COLONY.world.heightScale + 2, 0] as [number, number, number];
}

function R3FWorld({ sim, runtime }: { sim: ColonySim; runtime?: any }) {
  const terrainSize = sim.state.terrain.size;
  
  // Extract road cells for terrain leveling
  const tiles = useRoadNetwork(state => state.tiles);
  const landscapeEdits = useRoadNetwork(state => state.landscapeEdits);
  const isDrawing = useRoadNetwork(state => state.isDrawing);
  const builderMode = useRoadNetwork(state => state.builderMode);
  
  const roadCells = useMemo(() => new Set(Object.keys(tiles)), [tiles]);
  const terrainLevel = useTerrainLeveling(sim, roadCells, landscapeEdits, runtime);

  // DEBOUNCE: Only rebuild the 370k-vertex terrain mesh on mouse-release when plotting roads.
  // Terraforming (Raise/Lower/Flatten) still updates live.
  const [debouncedTerrainLevel, setDebouncedTerrainLevel] = useState(terrainLevel);
  useEffect(() => {
    if (!isDrawing || builderMode !== 'roads') {
      setDebouncedTerrainLevel(terrainLevel);
    }
  }, [isDrawing, builderMode, terrainLevel]);

  // Construct static props (Founders' Lighthouse and Rally Overlook props)
  const { shoreProps, venueProps } = useMemo(() => {
    const N = sim.state.terrain.size;
    const wx = (x: number) => (x - N / 2) * 4;
    const wz = (y: number) => (y - N / 2) * 4;

    const sp = buildShoreProps({
      terrain: sim.state.terrain,
      structures: sim.state.structures,
      roadSet: sim.state.roadSet,
      occupied: sim.state.occupied,
      wx,
      wz
    });

    const vp = buildVenueProps({
      terrain: sim.state.terrain,
      structures: sim.state.structures,
      roadSet: sim.state.roadSet,
      occupied: sim.state.occupied,
      wx,
      wz
    });

    return { shoreProps: sp, venueProps: vp };
  }, [sim]);

  // Update dynamic lights / animations on lighthouse and venue props in frame loop
  useFrame((state) => {
    const timeMs = state.clock.getElapsedTime() * 1000;
    const time = sim.state.clock.hour + sim.state.clock.minute / 60;
    let dayFactor = 0;
    if (time > 5 && time < 7) {
      dayFactor = (time - 5) / 2;
    } else if (time >= 7 && time <= 17) {
      dayFactor = 1;
    } else if (time > 17 && time < 19) {
      dayFactor = 1 - (time - 17) / 2;
    }

    if (shoreProps) shoreProps.update(dayFactor, timeMs);
    if (venueProps) venueProps.update(dayFactor, timeMs);
  });

  const spawnSig = useSimSignal(runtime, () => spawnSignature(sim.state));
  const startPos = useMemo(() => {
    const size = sim.state.terrain.size;
    const roads = sim.state.roads;
    if (roads && roads.length > 0) {
      const road = roads[0];
      const wx = (road.x - size / 2) * 4;
      const wz = (road.y - size / 2) * 4;
      const wy = sim.state.terrain.worldY(road.x, road.y);
      return [wx, wy + 2, wz] as [number, number, number];
    }

    const lot = sim.state.neighborhood?.lots?.find((l) => l.id === 'starter-plot');
    if (lot) {
      const wx = (lot.doorX - size / 2) * 4;
      const wz = (lot.doorY - size / 2) * 4;
      const wy = sim.state.terrain.worldY(Math.round(lot.doorX), Math.round(lot.doorY));
      return [wx, wy + 2, wz] as [number, number, number];
    }
    return findDrySpawn(sim.state.terrain);
  }, [sim, spawnSig]);

  return (
    <>
      <SceneProbe />
      <DayNightCycle sim={sim} />

      <Physics>
        <R3FTerrain sim={sim} terrainLevel={debouncedTerrainLevel} />
        <R3FOcean size={terrainSize} />
        <R3FFoam sim={sim} />
        <R3FCloud worldSize={terrainSize} />
        
        {/* Founders' Lighthouse and Rally Overlook static props */}
        {shoreProps && <primitive object={shoreProps.group} />}
        {venueProps && <primitive object={venueProps.group} />}
        
        {/* SimCity Style Road Architecture */}
        <R3FRoadBuilder sim={sim} runtime={runtime} />
        <R3FRoadNetwork sim={sim} runtime={runtime} />

        {/* Dynamic World Elements */}
        <R3FFoliage sim={sim} runtime={runtime} />
        <ZoneManager sim={sim} runtime={runtime} />
        <R3FPlayerCar sim={sim} />

        {/* Toggle between aerial view and first person */}
        {useRoadNetwork(state => state.builderActive || state.worldViewActive) ? (
          <AerialCameraController />
        ) : (
          <FirstPersonController sim={sim} startPosition={startPos} />
        )}
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

  constructor(
    private container: HTMLElement,
    private sim: ColonySim,
    public runtime?: any
  ) {
    container.style.width = '100vw';
    container.style.height = '100vh';
    container.style.position = 'absolute';
    container.style.top = '0';
    container.style.left = '0';
    container.style.zIndex = '-1';

    this.root = createRoot(container);
    this.root.render(
      <Canvas shadows camera={{ fov: 45, far: 1000 }}>
        <R3FWorld sim={this.sim} runtime={this.runtime} />
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
