import React, { useEffect, useState, useMemo, useRef } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import { ContactShadows } from '@react-three/drei';
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
import { clusterCommercialLots } from './commercialClusters';
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
import { leveledWorldY } from './terrainLeveling';
import { useRoadNetwork } from '../stores/useRoadNetwork';
import { COLONY } from '../config';
import { Html, MapControls } from '@react-three/drei';
import { useThree, useFrame } from '@react-three/fiber';

import { VoxelHouseMesh } from "./VoxelHouseMesh";
import { GlbHouse } from "./GlbHouse";
import { ZoneLotOverlay } from "./ZoneLotOverlay";
import { padSeatY } from "./useTerrainLeveling";
import { useWorldAssets } from "../stores/useWorldAssets";
import { R3FPlayerCar } from "./R3FPlayerCar";
import { ErrorBoundary } from "./ErrorBoundary";
import { useSimSignal, type SimBridge } from './useSimSignal';
import { zoneSignature, spawnSignature, roadwaySignature } from './simSignals';
import { ribbonCoverage } from './roadRibbon';
import { findJunctionZones } from './roadJunctions';
import { attachCapPolys, capCoverageCells } from './junctionCap';
import { getSmoothRoadY } from './roadSurface';
import { nextBootStage } from './bootStage';
import { R3FAvatars, type AvatarRefs } from './R3FAvatars';
import { R3FPedestrians } from './R3FPedestrians';
import { R3FBus } from './R3FBus';
import { R3FRace } from './R3FRace';
import { R3FTarentaal } from './R3FTarentaal';
import { R3FArtifacts } from './R3FArtifacts';
import { R3FPorters } from './R3FPorters';
import { R3FOperatorCar } from './R3FOperatorCar';
import { R3FRallyNameplates } from './R3FRallyNameplates';
import { R3FCameraDirector } from './R3FCameraDirector';
import { R3FCommercialDistrict } from './R3FCommercialDistrict';
import { R3FDarkCity } from './R3FDarkCity';
import { isPublicSafe } from '../newcomers';

function ZoneManager({ sim, runtime }: { sim: ColonySim; runtime?: SimBridge }) {
  const state = sim.state;
  const { assets, fetchManifest } = useWorldAssets();

  useEffect(() => {
    fetchManifest();
  }, []);

  // Subscribe to the mutable sim — a lot placed, demolished or built must re-render here.
  const zoneSig = useSimSignal(runtime, () => zoneSignature(state));
  const buildings = useMemo(() => {
    const elements: React.ReactElement[] = [];
    const overlays: React.ReactElement[] = [];

    // Spec 139 — the giant red building fix. CommercialBlock is a ~100 m gas-station SCENE, so
    // one per 4 m lot fused into a red wall. Collect the built commercial lots and render ONE
    // block per contiguous cluster (below), instead of one per lot. (The old cityPlan-commercial
    // branch was dead code — makeCityPlan only ever emits residential plots — and is removed.)
    const commercialLots: { id: string; x: number; y: number }[] = [];

    if (state.neighborhood?.lots) {
      const size = state.terrain.size;
      // Spec 128 — houses SEAT on their leveled pad: the SHARED padSeatY formula
      // useTerrainLeveling grades the pad with (max of the houseZone-centre ground and the
      // dry floor), so the house and its pad always agree. The old absolute y=0.05 buried
      // every house under the 8-17m-high city terrain — and the inlined copy of the formula
      // sampled raw worldY at the fractional zone centre (NaN off the integer grid).
      const seatOf = (hz: { x: number; y: number; w: number; d: number }) =>
        padSeatY(state.terrain, hz.x, hz.y, hz.w, hz.d);
      for (const lot of state.neighborhood.lots) {
        if (lot.built) {
          if (lot.zone === "commercial") {
            commercialLots.push({ id: lot.id, x: lot.x, y: lot.y });
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
          // Gated by the HUD zones toggle (spec 131) via the zone-overlays group below.
          overlays.push(
            <ZoneLotOverlay key={`zone-ground-${lot.id}`} lot={lot} terrain={state.terrain} />
          );
        }
      }

      // Spec 139 — one CommercialBlock per contiguous commercial cluster, at its centroid, so a
      // painted commercial run reads as a single street scene instead of a fused red wall.
      for (const c of clusterCommercialLots(commercialLots)) {
        elements.push(
          <CommercialBlock
            key={`comm-${c.id}`}
            position={[(c.x - size / 2) * 4, 0, (c.y - size / 2) * 4]}
          />
        );
      }
    }

    return { elements, overlays };
  }, [sim, zoneSig, assets]);

  return (
    <group>
      {buildings.elements}
      <group name="zone-overlays" visible={state.zonesVisible !== false}>
        {buildings.overlays}
      </group>
    </group>
  );
}

const DAY_BG = new THREE.Color('#5b9bd5'); // Softer, desaturated daytime blue
const NIGHT_BG = new THREE.Color('#1a2035'); // Brightened from #050510 to a deep dusk/moonlight blue

function DayNightCycle({ sim }: { sim: ColonySim }) {
  const bgRef = useRef<THREE.Color>(null);
  const fogRef = useRef<THREE.FogExp2>(null);
  const ambientLightRef = useRef<THREE.AmbientLight>(null);
  const dirLightRef = useRef<THREE.DirectionalLight>(null);

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
    // Build mode always shows daylight (operator request): clamp the clock to noon while
    // the BUILDER is open. World view is NOT clamped (spec 136) — the floating-island
    // night vista (stars, gas giant, lit roads) lives there, and clamping it made night
    // unreachable from above. getState() (not a hook) so the frame loop never re-renders.
    const { builderActive } = useRoadNetwork.getState();
    const time = builderActive
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
      {/* Spec 136 — no Sky dome: the sky has always been the lerped background colour (the
          drei Sky sat beyond the old far plane, invisible; the raised far plane let a corner
          of its box in as a beige wall). The void + stars + gas giant ARE the sky. */}
    </>
  );
}

/** Live probe in the spirit of window.__colony — exposes the three.js scene so Playwright
 *  specs (and the operator console) can assert on what is actually rendered, not just on
 *  sim state. See e2e/reactivity.spec.ts. */
/** Module-scoped bridge from the R3F store to the imperative PlanetRenderer class — the
 *  snapshot button (capturePNG, spec 131) needs the live renderer/scene/camera. */
const r3fProbe: {
  gl: THREE.WebGLRenderer | null;
  scene: THREE.Scene | null;
  camera: THREE.Camera | null;
} = { gl: null, scene: null, camera: null };

function SceneProbe() {
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls);
  const gl = useThree((s) => s.gl);
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
    r3fProbe.gl = gl;
    r3fProbe.scene = scene;
    r3fProbe.camera = camera;
    return () => {
      if (w.__r3fScene === scene) w.__r3fScene = undefined;
      if (w.__r3fCamera === camera) w.__r3fCamera = undefined;
      if (w.__r3fControls === controls) w.__r3fControls = undefined;
      if (r3fProbe.gl === gl) {
        r3fProbe.gl = null;
        r3fProbe.scene = null;
        r3fProbe.camera = null;
      }
    };
  }, [scene, camera, controls, gl]);
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
  
  // Spec 130 — the leveling grades the cells the ribbon ACTUALLY covers, each to the
  // SURFACE height the mesh renders there (segment-bridged over dips), unioned with the
  // tile cells (gravel/cul-de-sacs and the dry-floor/water guards that key off them).
  // Tile keys alone missed the ribbon's wider, curve-cutting footprint — the ungraded
  // slopes the walker saw under.
  const roadwaySig = useSimSignal(runtime, () => roadwaySignature(sim.state));
  const roadCells = useMemo(() => {
    const terrain = sim.state.terrain;
    const roadY = (x: number, y: number) => getSmoothRoadY(terrain, x, y);
    const cover = ribbonCoverage(sim.state.roadWays ?? [], terrain, roadY);
    // Spec 137 — the junction caps' hull corners reach 1-3 cells beyond the ribbon
    // sweep; union their cells so the grading rises under the corner aprons too (the
    // old slab hovered with 1.2-2.1 m of open air under its corners).
    const capCover = capCoverageCells(
      attachCapPolys(findJunctionZones(sim.state.roadWays ?? [])),
      terrain,
      roadY,
    );
    for (const [k, h] of capCover) {
      const cur = cover.get(k);
      if (cur === undefined || h > cur) cover.set(k, h);
    }
    for (const k of Object.keys(tiles)) {
      if (!cover.has(k)) {
        const c = k.indexOf(',');
        cover.set(k, Math.max(0, getSmoothRoadY(terrain, +k.slice(0, c), +k.slice(c + 1))));
      }
    }
    return cover;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiles, sim, roadwaySig]);
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
    // Same daylight clamp as DayNightCycle — the lighthouse beacon and venue lamps must
    // not burn their night lights while the builder forces daylight. World view stays
    // unclamped (spec 136), matching the sky.
    const { builderActive } = useRoadNetwork.getState();
    const time = builderActive
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
      // Spawn on the RENDERED surface: road grading / pad leveling can move the visible mesh
      // away from the raw sim height, and the walker must not start under (or above) it.
      const wy = leveledWorldY(sim.state.terrain, debouncedTerrainLevel, road.x, road.y);
      return [wx, wy + 2, wz] as [number, number, number];
    }
    return findDrySpawn(sim.state.terrain);
  }, [sim, spawnSig, debouncedTerrainLevel]);

  return (
    <>
      <SceneProbe />
      <DayNightCycle sim={sim} />

      <Physics>
        {/* Stage 0 — the world exists: terrain, sea, camera, physics floor */}
        <R3FTerrain sim={sim} terrainLevel={debouncedTerrainLevel} />
        {/* Spec 136 — the ocean reaches the Dark City slab's waterline (0.72 × the world
            width, like legacy). The old cell-count size left a 4×-too-small puddle that cut
            through mid-island terrain and bared the void at the coasts. */}
        <R3FOcean size={terrainSize * 2.9} />

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
            <R3FAvatars sim={sim} refs={avatarRefs} terrainLevel={debouncedTerrainLevel} />
            <R3FPedestrians sim={sim} terrainLevel={debouncedTerrainLevel} />
            <R3FBus sim={sim} runtime={runtime} />
            <R3FRace sim={sim} />
            <R3FTarentaal sim={sim} terrainLevel={debouncedTerrainLevel} />
            <R3FArtifacts sim={sim} terrainLevel={debouncedTerrainLevel} />
            <R3FPorters sim={sim} terrainLevel={debouncedTerrainLevel} />
            <R3FOperatorCar sim={sim} runtime={runtime} terrainLevel={debouncedTerrainLevel} />
            <R3FRallyNameplates sim={sim} runtime={runtime} refs={avatarRefs} />
            <R3FCameraDirector sim={sim} />
            <R3FCommercialDistrict sim={sim} runtime={runtime} terrainLevel={debouncedTerrainLevel} />
          </>
        )}

        {/* Stage 2 — the dressing lands (spec 117) */}
        {bootStage >= 2 && (
          <>
            <R3FDarkCity sim={sim} />
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
          <FirstPersonController sim={sim} runtime={runtime} startPosition={startPos} terrainLevel={debouncedTerrainLevel} />
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
    lastList: { current: null },
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
    // Spec 136 — the far plane reaches the starfields (5-6.7k) and the gas giant (3.7k);
    // near raised to keep the depth ratio sane. The old far of 1000 culled the cosmos.
    this.root.render(
      <Canvas shadows camera={{ fov: 45, near: 0.5, far: 12000 }}>
        <R3FWorld sim={this.sim} runtime={this.runtime} avatarRefs={this.avatarRefs} />
      </Canvas>
    );
  }

  // No-op compatibility surface. R3F owns the frame loop, camera and layers, so these runtime
  // hooks do nothing here — but they keep the signatures the legacy canvas renderer exposed
  // (deleted; see spec 128) because the runtime still calls them.
  // Legacy frame() takes no arguments, but the runtime passes the real dt (runtime.ts), so the
  // parameter is kept. The PNG captures return null (never a data URL) until R3F implements them.
  frame(_dt: number) {}
  resize() {}
  dispose() { this.root.unmount(); }

  firstPersonPNG(_home: { x: number; y: number }, _look: { x: number; y: number }): string | null { return null; }
  capturePNG(): string | null {
    // Spec 131 — the HUD snapshot button. R3F does not preserve the drawing buffer, so
    // render one fresh frame straight through the base renderer (no postprocessing) and
    // read it out before the buffer is cleared. The mounted EffectComposer forces
    // gl.toneMapping to none (it tone-maps in its own pass), so reapply ACES for this one
    // frame or the capture comes out washed out vs the on-screen look (verify F4).
    const { gl, scene, camera } = r3fProbe;
    if (!gl || !scene || !camera) return null;
    const prevToneMapping = gl.toneMapping;
    try {
      gl.toneMapping = THREE.ACESFilmicToneMapping;
      gl.render(scene, camera);
      return gl.domElement.toDataURL("image/png");
    } finally {
      gl.toneMapping = prevToneMapping;
    }
  }

  setOperatorCar(spec: CarSpec | null, cell: { x: number; y: number } | null) {
    // Spec 131 — the raceState precedent: attach on sim.state, R3FOperatorCar renders it.
    this.sim.state.operatorCar = spec && cell ? { spec, cell } : null;
  }
  // Spec 120 — the first-person citizen is hidden from the avatar layer (the player IS
  // that citizen), matching the legacy renderer.
  enterFirstPerson(id: string) { this.avatarRefs.fpCitizenId.current = id; }
  exitFirstPerson() { this.avatarRefs.fpCitizenId.current = null; }
  setRaceState(_race: RaceState | null) {}

  setViewMode(_mode: ViewMode) {}
  setView(_mode: ViewMode) {}
  setCameraPreset(_preset: CameraPreset) {}
  applyPreset(_preset: CameraPreset) {}
  setCinematic(on: boolean) {
    // Spec 131 — R3FCameraDirector orbits the landing while true (the login backdrop).
    this.sim.state.cinematic = on;
  }
  setRallyPresentCitizens(citizens: { id: string; displayName: string }[]) {
    // Spec 131 — public-safe filter at the bridge (legacy behavior), then the raceState
    // precedent: attach on sim.state, R3FRallyNameplates renders the plates.
    this.sim.state.rallyPresence = (citizens ?? []).filter(
      (c) => isPublicSafe(c.id) && isPublicSafe(c.displayName),
    );
  }

  setAvatarView(_avatars: AvatarView[]) {}
  // Spec 120 — the runtime registers its live per-frame avatar feed here; R3FAvatars
  // pulls it in useFrame.
  setAvatarSource(source: () => AvatarView[]) { this.avatarRefs.source.current = source; }
  setBarState(_cells: unknown[], _occupants: unknown[], _by: unknown[]) {}

  syncTerrain(_t: Terrain) {}
  setZoningVisible(v: boolean) {
    this.setZonesVisible(v);
  }
  setZonesVisible(v: boolean) {
    // Spec 131 — the HUD zones toggle; ZoneManager hides the unbuilt-lot overlays.
    this.sim.state.zonesVisible = v;
  }

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
