import React, { useEffect, useState, useMemo, useRef } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import { Sky, ContactShadows } from '@react-three/drei';
import { EffectComposer, Bloom, ToneMapping } from '@react-three/postprocessing';
import { Physics, RigidBody } from '@react-three/rapier';
import { ToneMappingMode } from 'postprocessing';
import * as THREE from 'three';

import type { ColonySim } from '../sim';
import type { Terrain } from '../terrain';
import type { Neighborhood } from '../neighborhood';
import type { CommercialDistrict } from '../commerce/district';
import type { RoadWay } from './roadRibbon';
import type { BusRoute } from '../transit/busRoute';
import type { RaceState } from '../racing/race';
import type { CarSpec } from '../car/carSpec';
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
import { R3FRoadRibbons } from './R3FRoadRibbons';
import { buildShoreProps } from './shoreProps';
import { buildVenueProps } from './venueProps';
import { useTerrainLeveling } from './useTerrainLeveling';
import { useRoadNetwork } from '../stores/useRoadNetwork';
import { COLONY } from '../config';
import { Html, MapControls } from '@react-three/drei';
import { useThree, useFrame } from '@react-three/fiber';

import { VoxelHouseMesh } from "./VoxelHouseMesh";
import { GlbHouse } from "./GlbHouse";
import { ZoneLotOverlay } from "./ZoneLotOverlay";
import { RENDER_DRY_FLOOR } from "./useTerrainLeveling";
import { useWorldAssets } from "../stores/useWorldAssets";
import { R3FPlayerCar } from "./R3FPlayerCar";
import { ErrorBoundary } from "./ErrorBoundary";
import { useSimSignal, type SimBridge } from './useSimSignal';
import { zoneSignature, spawnSignature } from './simSignals';
import { nextBootStage } from './bootStage';
import { R3FAvatars, type AvatarRefs } from './R3FAvatars';
import { R3FPedestrians } from './R3FPedestrians';
import { R3FBus } from './R3FBus';
import { R3FRace } from './R3FRace';
import { R3FTarentaal } from './R3FTarentaal';
import { R3FArtifacts } from './R3FArtifacts';

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
      // Spec 128 — houses SEAT on their leveled pad: the same formula useTerrainLeveling
      // grades the pad with (max of the houseZone-centre ground and the dry floor), so the
      // house and its pad always agree. The old absolute y=0.05 buried every house under
      // the 8-17m-high city terrain.
      const seatOf = (hz: { x: number; y: number; w: number; d: number }) =>
        Math.max(
          state.terrain.worldY(hz.x + (hz.w - 1) / 2, hz.y + (hz.d - 1) / 2),
          RENDER_DRY_FLOOR,
        );
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
            const hz = lot.houseZone;
            const seat = seatOf(hz);
            // If the microservice has a functional garage asset, use the GLB House!
            // We wrap in ErrorBoundary + Suspense so bad models fall back to voxel houses.
            if (assets["functional_garage"]) {
               // grid → world transform + pad seat (spec 128): the old call passed RAW GRID
               // coords as world position, stacking every garage near world (380, 0.1, 350).
               const gX = (hz.x + (hz.w - 1) / 2 - size / 2) * 4;
               const gZ = (hz.y + (hz.d - 1) / 2 - size / 2) * 4;
               elements.push(
                 <ErrorBoundary
                   key={`res-err-${lot.id}`}
                   fallback={<VoxelHouseMesh lot={lot} mapSize={size} seatY={seat + 0.02} />}
                 >
                   <React.Suspense fallback={<VoxelHouseMesh lot={lot} mapSize={size} seatY={seat + 0.02} />}>
                     <GlbHouse assetId="functional_garage" position={[gX, seat + 0.02, gZ]} />
                   </React.Suspense>
                 </ErrorBoundary>
               );
            } else {
               elements.push(<VoxelHouseMesh key={`res-${lot.id}`} lot={lot} mapSize={size} seatY={seat + 0.02} />);
            }
          }
        } else {
          // Unbuilt/zoned plot: the draped per-cell "purchasable land" tint (spec 128).
          elements.push(
            <ZoneLotOverlay key={`zone-ground-${lot.id}`} lot={lot} terrain={state.terrain} />
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

  // The shadow map used to re-render EVERY frame (three's autoUpdate default) over every
  // castShadow caster — thousands of foliage instances, houses and crowds — because the sun
  // light was repositioned each frame. Refresh on a 4-frame cadence instead (~15 Hz shadows
  // for the ambient walkers, imperceptible) and only re-aim the sun when it actually moved.
  const gl = useThree((s) => s.gl);
  const shadowFrame = useRef(0);
  const lastSun = useRef({ x: 9999, y: 9999 });
  useEffect(() => {
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    return () => {
      gl.shadowMap.autoUpdate = true;
    };
  }, [gl]);

  useFrame(() => {
    // Build mode always shows daylight (operator request): clamp the clock to noon while the
    // builder or world view is open — both are working modes where night lighting makes
    // placement unusable. getState() (not a hook) so the frame loop never re-renders React.
    const { builderActive, worldViewActive } = useRoadNetwork.getState();
    const time = (builderActive || worldViewActive)
      ? 12
      : sim.state.clock.hour + sim.state.clock.minute / 60;

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
      // re-aim the sun (and its shadow camera) only when it moved meaningfully — the sim
      // clock advances slowly, so during a pan the light is stationary
      if (
        Math.abs(sunX - lastSun.current.x) + Math.abs(sunY - lastSun.current.y) >
        0.5
      ) {
        dirLightRef.current.position.set(sunX, sunY, sunZ);
        lastSun.current.x = sunX;
        lastSun.current.y = sunY;
      }
      dirLightRef.current.intensity = dayFactor * 2;
    }
    if (skyRef.current?.material) {
      skyRef.current.material.uniforms.sunPosition.value.set(sunX, sunY, sunZ);
    }
    if ((shadowFrame.current++ & 3) === 0) gl.shadowMap.needsUpdate = true;
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
        shadow-mapSize={[2048, 2048]}
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
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls);
  useEffect(() => {
    const w = window as unknown as {
      __r3fScene?: THREE.Scene;
      __r3fCamera?: THREE.Camera;
      __r3fControls?: unknown;
    };
    w.__r3fScene = scene;
    // Spec 127 — the camera + active controls too, so e2e specs can FRAME what they assert
    // on (screenshots of roads/junctions), not just count meshes.
    w.__r3fCamera = camera;
    w.__r3fControls = controls;
    return () => {
      if (w.__r3fScene === scene) w.__r3fScene = undefined;
      if (w.__r3fCamera === camera) w.__r3fCamera = undefined;
      if (w.__r3fControls === controls) w.__r3fControls = undefined;
    };
  }, [scene, camera, controls]);
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

/** Spec 117 — staged mount. Advance the boot stage on PRESENTED frames so the first paint
 *  (terrain + sea) is never blocked by the city or the dressing. */
function useBootStage(): number {
  const [stage, setStage] = useState(0);
  const frames = useRef(0);
  useFrame(() => {
    frames.current += 1;
    const next = nextBootStage(stage, frames.current);
    if (next !== stage) setStage(next);
  });
  return stage;
}

function R3FWorld({ sim, runtime, avatarRefs }: { sim: ColonySim; runtime?: any; avatarRefs: AvatarRefs }) {
  const terrainSize = sim.state.terrain.size;
  const bootStage = useBootStage();

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

  // Construct static props (Founders' Lighthouse and Rally Overlook props).
  // Spec 117: built only once the dressing stage arrives — building them during the
  // first commit blocked the first paint.
  const { shoreProps, venueProps } = useMemo(() => {
    if (bootStage < 2) return { shoreProps: null, venueProps: null };
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
  }, [sim, bootStage]);

  // Update dynamic lights / animations on lighthouse and venue props in frame loop
  useFrame((state) => {
    const timeMs = state.clock.getElapsedTime() * 1000;
    // Same daylight clamp as DayNightCycle — the lighthouse beacon and venue lamps must not
    // burn their night lights while the builder forces daylight.
    const { builderActive, worldViewActive } = useRoadNetwork.getState();
    const time = (builderActive || worldViewActive)
      ? 12
      : sim.state.clock.hour + sim.state.clock.minute / 60;
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
    return findDrySpawn(sim.state.terrain);
  }, [sim, spawnSig]);

  return (
    <>
      <SceneProbe />
      <DayNightCycle sim={sim} />

      <Physics>
        {/* Stage 0 — the world exists: terrain, sea, camera, physics floor */}
        <R3FTerrain sim={sim} terrainLevel={debouncedTerrainLevel} />
        <R3FOcean size={terrainSize} />

        {/* Stage 1 — the city arrives (spec 117) */}
        {bootStage >= 1 && (
          <>
            <R3FFoam sim={sim} />
            {/* SimCity Style Road Architecture — the smooth ribbon surface (spec 127) over
                the cell data; R3FRoadNetwork keeps only the cul-de-sac bulbs */}
            <R3FRoadBuilder sim={sim} runtime={runtime} />
            <R3FRoadRibbons sim={sim} runtime={runtime} />
            <R3FRoadNetwork sim={sim} runtime={runtime} />
            {/* Dynamic World Elements */}
            <R3FFoliage sim={sim} runtime={runtime} />
            <ZoneManager sim={sim} runtime={runtime} />
            <R3FPlayerCar sim={sim} />
            <R3FAvatars sim={sim} refs={avatarRefs} />
            <R3FPedestrians sim={sim} />
            <R3FBus sim={sim} runtime={runtime} />
            <R3FRace sim={sim} />
            <R3FTarentaal sim={sim} />
            <R3FArtifacts sim={sim} />
          </>
        )}

        {/* Stage 2 — the dressing lands (spec 117) */}
        {bootStage >= 2 && (
          <>
            <R3FCloud worldSize={terrainSize} />
            {/* Founders' Lighthouse and Rally Overlook static props */}
            {shoreProps && <primitive object={shoreProps.group} />}
            {venueProps && <primitive object={venueProps.group} />}
          </>
        )}

        {/* Toggle between aerial view and first person */}
        {useRoadNetwork(state => state.builderActive || state.worldViewActive) ? (
          <AerialCameraController />
        ) : (
          <FirstPersonController sim={sim} startPosition={startPos} />
        )}
      </Physics>

      {bootStage >= 2 && (
        <>
          <ContactShadows resolution={1024} frames={1} scale={200} blur={2} opacity={0.4} far={20} color="#000000" />
          <EffectComposer>
            <Bloom luminanceThreshold={1} mipmapBlur intensity={1.5} />
            <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          </EffectComposer>
        </>
      )}
    </>
  );
}

export class PlanetRenderer {
  private root: Root;
  public onGroundClick?: (gx: number, gy: number) => void;
  /** Spec 120 — mutable refs bridging the runtime's imperative avatar hooks into the React
   *  tree without re-rendering it: R3FAvatars reads them in useFrame every frame. */
  private avatarRefs: AvatarRefs = {
    source: { current: null },
    fpCitizenId: { current: null },
  };

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
        <R3FWorld sim={this.sim} runtime={this.runtime} avatarRefs={this.avatarRefs} />
      </Canvas>
    );
  }

  // No-op compatibility surface. R3F owns the frame loop, camera and layers, so these runtime
  // hooks do nothing here — but they keep the signatures of the legacy canvas renderer
  // (./PlanetRenderer.ts) so the runtime can drive either implementation.
  // Legacy frame() takes no arguments, but the runtime passes the real dt (runtime.ts), so the
  // parameter is kept. The PNG captures return null (never a data URL) until R3F implements them.
  frame(_dt: number) {}
  resize() {}
  dispose() { this.root.unmount(); }

  firstPersonPNG(_home: { x: number; y: number }, _look: { x: number; y: number }): string | null { return null; }
  capturePNG(): string | null { return null; }

  setOperatorCar(_spec: CarSpec | null, _cell: { x: number; y: number } | null) {}
  // Spec 120 — the first-person citizen is hidden from the avatar layer (the player IS
  // that citizen), matching the legacy renderer.
  enterFirstPerson(id: string) { this.avatarRefs.fpCitizenId.current = id; }
  exitFirstPerson() { this.avatarRefs.fpCitizenId.current = null; }
  setRaceState(_race: RaceState | null) {}

  setViewMode(_mode: ViewMode) {}
  setView(_mode: ViewMode) {}
  setCameraPreset(_preset: CameraPreset) {}
  applyPreset(_preset: CameraPreset) {}
  setCinematic(_on: boolean) {}

  setAvatarView(_avatars: AvatarView[]) {}
  // Spec 120 — the runtime registers its live per-frame avatar feed here; R3FAvatars
  // pulls it in useFrame.
  setAvatarSource(source: () => AvatarView[]) { this.avatarRefs.source.current = source; }
  setBarState(_cells: unknown[], _occupants: unknown[], _by: unknown[]) {}

  syncTerrain(_t: Terrain) {}
  setZoningVisible(_v: boolean) {}
  setZonesVisible(_v: boolean) {}

  setNeighborhood(_n: Neighborhood) {}
  setCommercialDistrict(_d: CommercialDistrict | null | undefined) {}
  setRoadWays(ways: RoadWay[] | null | undefined) {
    // Spec 127 — the ribbon centre-lines reach the React tree via sim.state (the raceState
    // precedent). The runtime attaches its array in the constructor; this keeps the legacy
    // call path working too.
    this.sim.state.roadWays = ways ?? [];
  }
  setBusRoute(_route: BusRoute | null | undefined) {}
}
