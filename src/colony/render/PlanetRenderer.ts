// Renders the alien planet: a flat playable terrain region sitting on the apex of a
// large sphere (the "ball"), with ocean, atmosphere, the landed seed, day/night, three
// camera presets (street/district/planet) and view modes (biome/buildable/elevation).
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { COLONY } from "../config";
import { BIOME_COLOR, Biome } from "../terrain";
import type { ColonySim, SeedStructure } from "../sim";
import type { TarentaalBird } from "../tarentaal";
import {
  ARTIFACT_CATALOG_SIZE,
  summarizeRenderableArtifacts,
  type ArtifactKind,
  type VisualArtifact,
} from "../artifacts";
import type { HouseSpec } from "../house";
import { gridOrigin } from "../grid";
import { grabPlane, grabPanDelta } from "./panControls";
import { cellZone, ZONE_COLOR, VIBE_COLOR, type Plot } from "../cityPlan";
import {
  homeLiveability,
  surveyAvailable,
  liveabilityTint,
  porterStatus,
} from "../build";
import type { Neighborhood } from "../neighborhood";
import type { CommercialDistrict } from "../commerce/district";
import { BUSINESSES, type Business, type Emblem } from "../commerce/businesses";
import { surveyBillboards } from "../commerce/billboards";
import {
  BUSINESS_LABEL_VIEWPORT_NDC_LIMIT,
  declutterBusinessLabels,
  labelOpacityForVisibility,
  surveyBusinessLabels,
  type BusinessLabel,
  type BusinessLabelDeclutterInput,
} from "../commerce/businessLabels";
import { buildCarMesh } from "../car/carMesh";
import type { CarSpec } from "../car/carSpec";
import { posterModel, paintPoster } from "../commerce/adCanvas";
import {
  buildVoxelHouse,
  BLOCK_COLOR,
  type VoxelHouse,
  type DoorDir,
} from "../voxelHouse";
import { compileBlueprint, VOXEL_Y } from "../houseBuilder";
import { greedyMesh } from "./voxelMesh";
import { buildChunkedTerrain, type ChunkedTerrain } from "./terrainChunks";
import { defaultBlueprint, streetDoorDir, type Zone } from "../neighborhood";
import { buildShoreProps, type ShorePropsLayer } from "./shoreProps";
import { buildVenueProps, type VenuePropsLayer } from "./venueProps";
import { buildGltfPropLayer, type GltfPropLayer } from "./gltfPropLayer";
import { rallyVenuePropPlacements, venuePropAssets } from "./venuePropAssets";
import { buildFoam, type FoamLayer } from "./foamLayer";
import { buildClouds, type CloudLayer } from "./cloudLayer";
import { buildAmbient, type AmbientLayer } from "./ambientLayer";
import { buildRaceLayer, type RaceLayer } from "./raceLayer";
import { buildBusLayer, type BusLayer } from "./busLayer";
import type { BusRoute } from "../transit/busRoute";
import { buildRoadRibbons, ROAD_RIBBON_LIFT, type RoadWay } from "./roadRibbon";
import { applyCoastalCommercialDryBlend } from "./terrainLeveling";
import {
  buildMallAnchorShellModel,
  mallAnchorNightFloorEmissive,
} from "./mallAnchorShell";
import {
  buildGarageAnchorShellModel,
  garageAnchorNightFloorEmissive,
} from "./garageAnchorShell";
import type { RaceState } from "../racing/race";
import { isPublicSafe } from "../newcomers";
import {
  commercialShopMassing,
  commercialShopNightFloorEmissive,
  type CommercialShopMassing,
} from "./commercialShopMassing";

export type ViewMode = "biome" | "buildable" | "elevation";
export type CameraPreset = "street" | "district" | "planet";

/** P1 — one citizen avatar's live render state, supplied by the runtime each frame from the roster. */
export interface AvatarView {
  id: string;
  displayName: string;
  x: number;
  y: number;
  heading: number;
  lookPitch?: number;
  hasPod: boolean;
  /** Spec 078 — body kind: humans draw as the capsule avatar, Joe the founder draws as the crab mesh. */
  kind: "human" | "crab";
  /** True for the avatar belonging to the logged-in operator (rendered highlighted). */
  isOperator: boolean;
}

export interface RallyPresentCitizenView {
  id: string;
  displayName: string;
}

// Dark City: the colony floats on a slab of rock adrift in deep space. The "sky" is the void —
// dark even at midday — while a local sun still sweeps light across the island for day/night.
const SKY_DAY = new THREE.Color(0x0b1022);
const SKY_NIGHT = new THREE.Color(0x03040a);
// Spec 091 — atmospheric horizon glow. The void zenith stays near-black (SKY_DAY), but by day a soft
// teal-dusk band lifts at the horizon — a gradient sky dome + distance-fog tinted to this colour — so
// the world reads with real depth instead of a flat fill. At night daylight=0 collapses it back to the
// uniform void, so the deep-space look is untouched after dark.
const HORIZON_GLOW = new THREE.Color(0x2c5a73);
// Spec 091 — warmer KEY LIGHT. The sun is a warm white when high and deepens to a golden amber as it
// rakes toward the horizon, so mornings and evenings get a real golden-hour glow instead of a flat white
// midday. updateDayNight lerps between these by sun height each frame.
const SUN_HIGH = new THREE.Color(0xfff2d8); // warm white near noon
const SUN_LOW = new THREE.Color(0xff9a4a); // golden amber near sunrise / sunset
const OCEAN = 0x143a4a;
const SLAB_ROCK = 0x24242f;
// Spec 092 — per-house wall tints. Each built home lerps its masonry vertex colours toward one of these
// (picked deterministically from the house seed) so the city spans a palette instead of all-red-brick.
const HOUSE_TINTS = [
  0xc97b5a, 0xd9c0a0, 0x8fa07a, 0x7d93a8, 0xc9a24a, 0xb0543f, 0x9c8aa8,
  0x9aa05a,
];
// Spec 078 — Joe the Crab's first-person eye height (low to the ground), vs 1.6 for the human avatars.
const CRAB_EYE = 0.42;
// Spec 076 — instance caps for the homestead neighbourhood (zone pads + spine ribbon; voxel blocks
// for houses, fences, crops, garden beds and trees across a full band of large parcels).
// Spec 084 S6 — raised for the estate parcels (a GRAND lot alone pads its garden + farm + walkway
// cell by cell); the S1 dev-mode tripwires still warn the moment either cap drops scenery.
const PAD_CAP = 4096;
const RENDER_DRY_FLOOR = 0.65;
const VOX_CAP = 24576;

export class PlanetRenderer {
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private composer!: EffectComposer;
  private controls: OrbitControls;
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private skyMat?: THREE.ShaderMaterial; // spec 091 — gradient sky-dome material; its colours lerp with daylight
  private oceanGeo?: THREE.BufferGeometry; // spec 090 — the living sea: a subdivided disc with animated swells
  private oceanBase?: Float32Array; // base (x,y) of each ocean vertex, the wave input
  onGroundClick?: (gx: number, gy: number) => void; // spec 090 — set by the runtime; fires on a ground CLICK (not a drag)
  private picker = new THREE.Raycaster();
  private pickDown: { x: number; y: number; t: number } | null = null;
  // Grab-the-world LEFT-drag pan: anchor the clicked ground point under the cursor so a far grab
  // hauls the world fast and a near grab moves it little — 1:1 with the drag — instead of
  // OrbitControls' fixed target-distance pan that crawls when zoomed in. See the pointer handlers.
  private panning = false;
  private panGrab = new THREE.Vector3();
  private panPlane = new THREE.Plane();
  private chunkedTerrain!: ChunkedTerrain; // spec 084 S5 — chunk grid, see terrainChunks.ts
  private terrainMat!: THREE.Material; // kept so the terrain can be rebuilt when footprints level (spec 093)
  // Spec 093 — RENDER-ONLY leveling. Cell index (y*N+x) → the flat seat height of the house whose
  // footprint covers it. The terrain mesh reads this so a house on a slope sits on a cut pad instead of
  // floating / poking through; Terrain.worldY (sim, water, pathfinding) is never touched. terrainLevelSig
  // is the built-lot fingerprint that drives it, so the terrain only rebuilds when a footprint changes.
  private terrainLevel = new Map<number, number>();
  // Spec 095 — cells whose RENDER height we lifted to the road ribbon (the carriageway + a shoulder
  // skirt). Tracked apart from the house-pad levels so colorFor keeps their NATURAL biome colour (no
  // grass repaint) where a road crosses forest / beach / mountain.
  private roadGradedCells = new Set<number>();
  private terrainLevelSig = "";
  private roadSurfaceMesh!: THREE.Mesh;
  private roadShoulderMesh!: THREE.Mesh;
  private roadLineMesh!: THREE.Mesh;
  // Spec 084 S3 — the paved avenue draws as its own asphalt ribbon with raised kerb strips, layered
  // on the same drape/relax/skirt pipeline as the packed-earth streets.
  private avenueSurfaceMesh!: THREE.Mesh;
  private avenueKerbMesh!: THREE.Mesh;
  private lastRoadsVersion = -1;
  // Foliage is rebuilt as the colony grows so trees never sit under streets or buildings.
  private foliageMesh?: THREE.InstancedMesh;
  private foliageWindMat?: THREE.MeshStandardMaterial; // spec 092 — foliage wind-sway material (uTime in frame)
  private lastFoliageSig = -2;
  // Road cells the ambient pedestrians stroll along (their pavement network), refreshed when roads grow.
  private roadCells: { x: number; y: number }[] = [];
  // Sized plot foundations + the spoke roads that serve them from the colony core (the planned-settlement layer).
  private plotPadGroup = new THREE.Group();
  private lastPadSig = "";
  // Spec 073 — Porter Sheds: the economy embodied. Goods pile up as crates/sacks at each shed (growing + shrinking with the live
  // stock), and porter handcarts run the roads while the shed is staffed. Never on water.
  private porterPileMesh!: THREE.InstancedMesh;
  private porterCartMesh!: THREE.InstancedMesh;
  private porterCarts: {
    x: number;
    y: number;
    tx: number;
    ty: number;
    spd: number;
  }[] = [];
  private lastPorterT = 0;
  // A head so the ambient figures read as little PEOPLE, not pills. The visible crowd is capped to the real colonist count
  // (they are the colony's actual people, not a decorative droid army) — the named-Hermes-citizen binding is the next step.
  private pedHeadMesh!: THREE.InstancedMesh;
  private bldgMesh!: THREE.InstancedMesh;
  private crewMesh!: THREE.InstancedMesh;
  private streetPostMesh!: THREE.InstancedMesh;
  private streetHeadMesh!: THREE.InstancedMesh;
  private carsMesh!: THREE.InstancedMesh;
  // Ambient pedestrians — renderer-only wandering figures near the settled ground; no sim impact.
  private pedMesh!: THREE.InstancedMesh;
  private peds: {
    x: number;
    y: number;
    tx: number;
    ty: number;
    spd: number;
    phase: number;
  }[] = [];
  private lastPedT = 0;
  // Tarentaal flock — real deterministic sim birds (adults + chicks), rendered as low-poly instanced ground animals.
  private tarentaalAdultMesh!: THREE.InstancedMesh;
  private tarentaalChickMesh!: THREE.InstancedMesh;
  // Furniture / visual artifacts — deterministic sim catalog instances, foundation for clickable Kookerbook objects.
  private artifactMeshes!: Record<ArtifactKind, THREE.InstancedMesh>;
  private artifactCap = 0;
  // P1 — citizen AVATARS: the real, named Hermes citizens, drawn from the roster (distinct from the ambient
  // ped pool), movable by the bot, and steppable-into for a live first-person view.
  private avatarMesh!: THREE.InstancedMesh;
  private avatarHeadMesh!: THREE.InstancedMesh;
  // Spec 078 — Joe the Crab: one merged, vertex-coloured geometry instanced like the human avatars but
  // routed here by AvatarView.kind. Shares the roster + roam loop; only the body mesh + eye height differ.
  private crabMesh!: THREE.InstancedMesh;
  private avatarSource?: () => AvatarView[];
  private fpCitizenId: string | null = null;
  private rallyPresentCitizenIds = new Set<string>();
  private rallyNameplateGroup = new THREE.Group();
  private rallyNameplates = new Map<
    string,
    {
      group: THREE.Group;
      sprite: THREE.Sprite;
      texture: THREE.CanvasTexture;
      material: THREE.SpriteMaterial;
      floor: THREE.Mesh;
      floorMaterial: THREE.MeshBasicMaterial;
    }
  >();
  // Spec 075 — the buildable neighbourhood: lot pads + minecraft-style voxel homes.
  private neighborhood?: Neighborhood;
  private lotPadMesh!: THREE.InstancedMesh;
  private voxelMesh!: THREE.InstancedMesh;
  private voxelCache = new Map<string, VoxelHouse>();
  // Spec 077 P2 — built houses that carry a blueprint render as ONE merged greedy-meshed BufferGeometry each
  // (fancy brick masonry, not minecraft cubes), parented in this group at a tile-local origin. Lots without
  // a blueprint keep the legacy per-block instanced path above. Rebuilt with the neighbourhood signature.
  private mergedHouseGroup = new THREE.Group();
  private mergedHouseMat!: THREE.MeshStandardMaterial;
  private lastNbhdSig = "";
  // Spec 079 P0 — the vibrant commercial strip: a group of neon market-stall composites surveyed
  // along the high street, rebuilt when the district changes. The sign materials glow brighter after
  // dark (the day/night hook) so the strip reads as the awake heart of the city at dusk.
  private commercialDistrict?: CommercialDistrict;
  private commercialGroup = new THREE.Group();
  private commercialSignMats: THREE.MeshStandardMaterial[] = [];
  private commercialMallFloorMat: THREE.MeshStandardMaterial | null = null;
  private commercialGarageFloorMats: THREE.MeshStandardMaterial[] = [];
  private commercialFloorMats: THREE.MeshStandardMaterial[] = [];
  private commercialLabelMats: {
    group: THREE.Object3D;
    sprite: THREE.SpriteMaterial;
    floor: THREE.MeshBasicMaterial;
    model: BusinessLabel;
    visibilityOpacity: number;
  }[] = [];
  private commercialLabelProjection = new THREE.Vector3();
  private commercialLabelWorld = new THREE.Vector3();
  private commercialLabelDirection = new THREE.Vector3();
  private commercialLabelRaycaster = new THREE.Raycaster();
  private commercialLabelNight = 0;
  // Spec 084 S1 — per-lot house mesh key (blueprint + foundation height) for incremental rebuilds.
  private lotHouseKey = new Map<string, string>();
  private settlerGroup = new THREE.Group();
  private lastSettlerCount = -1;
  // City plan paint — translucent zone tints (residential / commercial / industrial / civic)
  // and named flag-pole markers at every plot. Both are built once from the terrain; the markers
  // dim and re-label as plots get allocated.
  private zoneTintMesh: THREE.Mesh | null = null;
  private liveabilityOn = false; // spec 011 — the overlay toggle now drives the liveability map
  private plotMarkers = new THREE.Group();
  private plotMeshes = new Map<
    string,
    { pole: THREE.Mesh; flag: THREE.Mesh; flagMat: THREE.MeshStandardMaterial }
  >();
  private lastPlotSig = "";
  private dummy = new THREE.Object3D();
  private clock = new THREE.Clock();
  private view: ViewMode = "biome";
  private disposed = false;
  // TV-mode cinematic fly-around — when on, the camera slowly orbits the landing site, drifts up
  // to look at the whole island, dives back to street level, and so on, in a 60-second loop.
  // Reads-only the wall-clock so it stays smooth even if the sim is paused.
  private cinematic = false;
  private cinematicT0 = 0;
  // Per-car smoothed render state (position + heading), so cars glide between the 6 Hz sim steps
  // and ease through turns instead of snapping their heading — and lane offset — at each corner.
  private carRender = new Map<number, { x: number; y: number; h: number }>();
  private lastCarT = 0;
  // Pulsing red nav beacon at the rocket nose — material ref so frame() can blink it.
  private beaconMat: THREE.MeshStandardMaterial | null = null;
  private shoreProps: ShorePropsLayer | null = null;
  private venueProps: VenuePropsLayer | null = null;
  private gltfProps: GltfPropLayer | null = null;
  private foam: FoamLayer | null = null; // spec 091 — animated shoreline surf ring
  private clouds: CloudLayer | null = null; // spec 092 — drifting sky clouds
  private ambient: AmbientLayer | null = null; // spec 092 — gulls gliding over the sea
  private raceLayer: RaceLayer | null = null;
  private busLayer: BusLayer | null = null;
  private roadRibbonGroup: THREE.Group | null = null;
  private roadRibbonCells: Set<string> | null = null; // cells the road ribbon actually covers (for surfaceY)
  private raceState: RaceState | null = null;
  private raceCamActive = false;
  private raceRestorePending = false;

  private N: number;
  private R: number;

  // camera tween
  private tweenT = 1;
  private startPos = new THREE.Vector3();
  private startTarget = new THREE.Vector3();
  private endPos = new THREE.Vector3();
  private endTarget = new THREE.Vector3();

  constructor(
    private container: HTMLElement,
    private sim: ColonySim,
  ) {
    this.N = sim.state.terrain.size;
    this.R = COLONY.world.planetRadius;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
    });
    // Render at the display's native pixel density (capped at 2x) so the world is crisp on HiDPI
    // screens — matches the House Builder + legacy city renderer. The old hardcoded 1 made the 608
    // world upscale (soft, non-HD) on a 2x+ DPR display; the 2x cap keeps the heavy world's fill rate
    // bounded so a 3x phone/Retina panel does not quadruple-plus the fragment load.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.13;
    container.appendChild(this.renderer.domElement);

    this.scene.background = SKY_DAY.clone();
    // Far plane must reach orbital distance or the planet view washes out to sky.
    this.scene.fog = new THREE.Fog(SKY_DAY.clone(), this.N * 1.5, this.R * 1.6);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.5, 36000); // 084 S6 — covers maxDistance at planetRadius 4800

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08; // a touch more glide so pans + orbits coast to a smooth stop
    this.controls.maxPolarAngle = Math.PI * 0.62;
    this.controls.minDistance = 4;
    this.controls.maxDistance = this.R * 2.6;
    this.controls.target.set(0, 5, 0);
    // Map-style navigation (operator UX): LEFT-mouse-drag PANS by GRABBING the world (custom handler
    // below) so a far grab — e.g. the shopfronts across the map — hauls the world toward you fast and
    // a near grab moves it little, 1:1 with the drag. OrbitControls' own pan scaled by the target
    // distance, which crawls when zoomed in, so we leave mouse-LEFT unmapped here and drive it
    // ourselves. RIGHT-drag ORBITS, the wheel zooms. Touch: one finger pans (OrbitControls), two
    // fingers pinch-zoom + rotate.
    this.controls.mouseButtons = {
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    this.controls.touches = {
      ONE: THREE.TOUCH.PAN,
      TWO: THREE.TOUCH.DOLLY_ROTATE,
    };
    this.controls.screenSpacePanning = false;
    this.controls.panSpeed = 1.1;
    this.controls.rotateSpeed = 0.6;
    this.controls.zoomSpeed = 1.1;

    // Spec 090 — CLICK-TO-PICK a plot. A left CLICK (pointer barely moved) raycasts the terrain and
    // hands the grid cell to onGroundClick, opening that plot's Kookerbook. A left DRAG instead GRABS
    // the world: on press we remember the ground point under the cursor, then each move slides the
    // camera so that same point stays under the cursor — a far grab hauls the world toward you fast,
    // a near grab moves it little, always 1:1 with the drag.
    const pickEl = this.renderer.domElement;
    pickEl.addEventListener("pointerdown", (e) => {
      this.pickDown = { x: e.clientX, y: e.clientY, t: performance.now() };
      if (e.button !== 0 || e.pointerType === "touch") return; // left mouse grabs; touch = OrbitControls
      const p = this.pickGroundPoint(e.clientX, e.clientY);
      if (!p) return;
      this.panGrab.copy(p);
      this.panPlane = grabPlane(p);
      this.panning = true;
      try {
        pickEl.setPointerCapture(e.pointerId);
      } catch {
        /* capture is best-effort — the pan still tracks via the listeners */
      }
    });
    pickEl.addEventListener("pointermove", (e) => {
      if (!this.panning) return;
      const d = grabPanDelta(
        this.camera,
        this.panPlane,
        this.panGrab,
        this.clientToNdc(e.clientX, e.clientY),
      );
      if (!d) return;
      this.camera.position.x += d.dx;
      this.camera.position.z += d.dz;
      this.controls.target.x += d.dx;
      this.controls.target.z += d.dz;
      this.camera.updateMatrixWorld();
    });
    const endPan = (e: PointerEvent) => {
      if (!this.panning) return;
      this.panning = false;
      try {
        pickEl.releasePointerCapture(e.pointerId);
      } catch {
        /* pointer was not captured */
      }
    };
    pickEl.addEventListener("pointerup", (e) => {
      endPan(e);
      const d = this.pickDown;
      this.pickDown = null;
      if (!d || !this.onGroundClick) return;
      if (
        Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 ||
        performance.now() - d.t > 500
      )
        return; // a drag, not a click
      const hit = this.pickGround(e.clientX, e.clientY);
      if (hit) this.onGroundClick(hit.gx, hit.gy);
    });
    pickEl.addEventListener("pointercancel", endPan);

    // Cool sky fill (0xbfd6e6) against the warm sun key, with a warmer ground bounce (was a cool
    // 0x35324a) so shadowed faces feel sun-warmed earth rather than cold — a richer key/fill contrast.
    this.hemi = new THREE.HemisphereLight(0xbfd6e6, 0x473c3a, 0.8);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0d8, 1.7);
    this.sun.castShadow = true;
    this.scene.add(this.rallyNameplateGroup);
    // Spec 084 S5 — the shadow frustum FOLLOWS the camera target (updateDayNight translates sun +
    // target together each frame) with a fixed half-extent, instead of covering the whole island:
    // 2048 texels over ~240 world units gives crisp house-contact shadows at any world size.
    this.sun.shadow.mapSize.set(2048, 2048);
    // Spec 090 — kill the terrain SELF-SHADOW ACNE (the flickering black patches the operator saw — NOT
    // cloud shadows; there are none). With no bias the heightfield shadow-tests against itself; nudging
    // the test along the surface normal + a small depth bias removes the shimmer without peter-panning.
    this.sun.shadow.normalBias = 1.6;
    this.sun.shadow.bias = -0.0004;
    const d = Math.min(120, this.N * 0.7);
    this.sun.shadow.camera.left = -d;
    this.sun.shadow.camera.right = d;
    this.sun.shadow.camera.top = d;
    this.sun.shadow.camera.bottom = -d;
    this.sun.shadow.camera.far = this.N * 4;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.buildPlanet();
    this.buildSkyDome();
    this.buildOcean();
    this.buildFoam();
    this.buildClouds();
    this.buildAmbient();
    this.buildTerrain();
    this.buildFoliage();
    this.buildStructures();
    this.buildColonyLayer();
    this.setupComposer();

    this.applyPreset("district");
    window.addEventListener("resize", this.onResize);
    this.resize();
  }

  private wx(x: number) {
    return x - this.N / 2;
  }
  private wz(y: number) {
    return y - this.N / 2;
  }

  /** NDC (-1..1) for a client-space screen point on the canvas. */
  private clientToNdc(clientX: number, clientY: number): THREE.Vector2 {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  /** Raycast the terrain under a screen point; return the world-space hit point, or null. */
  private pickGroundPoint(
    clientX: number,
    clientY: number,
  ): THREE.Vector3 | null {
    if (!this.chunkedTerrain) return null;
    this.picker.setFromCamera(this.clientToNdc(clientX, clientY), this.camera);
    const hits = this.picker.intersectObjects(
      this.chunkedTerrain.group.children,
      true,
    );
    return hits.length ? hits[0]!.point.clone() : null;
  }

  /** Spec 090 — raycast the terrain under a screen point; return the grid cell hit, or null. */
  private pickGround(
    clientX: number,
    clientY: number,
  ): { gx: number; gy: number } | null {
    const p = this.pickGroundPoint(clientX, clientY);
    if (!p) return null;
    return {
      gx: Math.round(p.x + this.N / 2),
      gy: Math.round(p.z + this.N / 2),
    };
  }

  private setupComposer() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { samples: 2 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(
      new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.32, 0.5, 0.9),
    );
    this.composer.addPass(new OutputPass());
  }

  private buildPlanet() {
    // Dark City: a tapered slab of rock drops from just under the waterline into the void, so the
    // island clearly floats in space instead of sitting on a planet.
    const top = this.N * 0.72;
    const base = this.N * 0.34;
    const height = this.N * 1.05;
    const rock = new THREE.Mesh(
      new THREE.CylinderGeometry(top, base, height, 9, 1),
      new THREE.MeshStandardMaterial({
        color: SLAB_ROCK,
        roughness: 0.95,
        metalness: 0.08,
        flatShading: true,
      }),
    );
    rock.position.set(0, -height / 2 - 0.4, 0);
    this.scene.add(rock);

    // Additive glow at the waterline so the island reads as a lit slab adrift in the dark — a tight
    // bright rim plus a taller, fainter halo that bleeds up into the void (Dark City energy).
    const rim = new THREE.Mesh(
      new THREE.CylinderGeometry(
        top * 1.01,
        top * 0.9,
        this.N * 0.06,
        9,
        1,
        true,
      ),
      new THREE.MeshBasicMaterial({
        color: 0x3aa6c8,
        transparent: true,
        opacity: 0.32,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    rim.position.set(0, -0.6, 0);
    this.scene.add(rim);
    const rimHalo = new THREE.Mesh(
      new THREE.CylinderGeometry(
        top * 1.09,
        top * 0.98,
        this.N * 0.17,
        9,
        1,
        true,
      ),
      new THREE.MeshBasicMaterial({
        color: 0x256b8a,
        transparent: true,
        opacity: 0.11,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    rimHalo.position.set(0, -0.36, 0);
    this.scene.add(rimHalo);

    // Starfield — two deterministic Fibonacci shells (fine dust + sparse bright stars), fog-disabled
    // so the void always reads as deep space. Both sit beyond the camera's max orbit distance, so you
    // never fly through them. Two layers give the void real depth instead of a flat scatter.
    const golden = Math.PI * (3 - Math.sqrt(5));
    const makeStars = (
      count: number,
      seed: number,
      rMin: number,
      rSpan: number,
      color: number,
      size: number,
      opacity: number,
    ) => {
      const sg = new THREE.BufferGeometry();
      const pos = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const y = 1 - ((i + 0.5) / count) * 2;
        const rad = Math.sqrt(Math.max(0, 1 - y * y));
        const theta = golden * (i + seed);
        const r = rMin + ((i * 131 + seed * 977) % rSpan);
        pos[i * 3] = Math.cos(theta) * rad * r;
        pos[i * 3 + 1] = y * r;
        pos[i * 3 + 2] = Math.sin(theta) * rad * r;
      }
      sg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      const points = new THREE.Points(
        sg,
        new THREE.PointsMaterial({
          color,
          size,
          sizeAttenuation: true,
          fog: false,
          transparent: true,
          opacity,
          depthWrite: false,
        }),
      );
      points.matrixAutoUpdate = false;
      this.scene.add(points);
    };
    makeStars(2800, 0, 5000, 1700, 0x8d99c8, 4, 0.7); // fine dust
    makeStars(380, 7, 5200, 1500, 0xeef2ff, 11, 0.95); // sparse bright stars

    // A distant gas giant looming in the void — gives the deep-space backdrop depth and a focal
    // point. Lit by the same sun, so it shows a soft day/night terminator. Sits beyond the orbit cap.
    const giant = new THREE.Mesh(
      new THREE.SphereGeometry(760, 48, 32),
      new THREE.MeshStandardMaterial({
        color: 0x4a5688,
        roughness: 1,
        metalness: 0,
        emissive: 0x1a2348,
        emissiveIntensity: 0.9,
        fog: false,
      }),
    );
    giant.position.set(-1400, -100, -3400);
    this.scene.add(giant);
    const giantAtmo = new THREE.Mesh(
      new THREE.SphereGeometry(815, 40, 24),
      new THREE.MeshBasicMaterial({
        color: 0x6f86c8,
        transparent: true,
        opacity: 0.22,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    giantAtmo.position.copy(giant.position);
    this.scene.add(giantAtmo);
  }

  /** Scatter instanced foliage cones across the wooded land (dense in forest, sparse on plains), so
   *  the island reads as living terrain rather than flat colour. Deterministic placement (stable per
   *  seed); pure decoration with no sim or gameplay impact. */
  /** Build (or rebuild) the tree cover. Trees are kept OFF the streets, OFF every building/worksite (+ a one-cell
   *  verge), and OUT of the civic core, so the settled ground reads as a cleared, planned place — not a forest with
   *  roads bulldozed through it. Rebuilt as the colony grows (roads + buildings change). */
  private buildFoliage() {
    const s = this.sim.state;
    const t = s.terrain;
    const N = t.size;
    const hash = (n: number) => ((n * 2654435761) >>> 0) / 4294967296;
    // Spec 090 — a lusher, more varied alien canopy (bright + deep greens, a teal-green, the violet
    // flora, a golden-green) so forests read with life and depth instead of a flat dark mass.
    const TREE_COLORS = [
      0x55925b, 0x6fb069, 0x3f7d5e, 0x7a5aa8, 0x8fb557, 0x356b46,
    ];
    // Cells the colony has cleared: roads, buildings and worksites (each with a one-cell verge), plus the civic core.
    const cleared = new Set<number>();
    const mark = (cx: number, cy: number, rad: number) => {
      const ix = Math.round(cx),
        iy = Math.round(cy);
      for (let yy = iy - rad; yy <= iy + rad; yy++)
        for (let xx = ix - rad; xx <= ix + rad; xx++) {
          if (xx >= 0 && yy >= 0 && xx < N && yy < N) cleared.add(yy * N + xx);
        }
    };
    for (const r of s.roads) mark(r.x, r.y, 1);
    // Spec 084 world ROADS (the smooth avenue/street/path ribbon + verges) live in roadSet, not s.roads —
    // clear them too (+1 verge) so trees never sprout through the carriageway. This was the bug: foliage
    // only knew the old sim roads, so trees grew straight up through the ribbon network.
    if (s.roadSet)
      for (const key of s.roadSet) {
        const cc = key.split(",");
        mark(+cc[0]!, +cc[1]!, 1);
      }
    for (const b of s.buildings) mark(b.x, b.y, 1);
    for (const j of s.jobs) mark(j.x, j.y, 1);
    for (const st of s.structures) mark(st.x, st.y, 1); // the caravan/rocket + landmarks
    if (s.cityPlan)
      for (const p of s.cityPlan.plots)
        mark(
          p.x,
          p.y,
          Math.max(1, Math.ceil(Math.max(p.w || 1, p.h || 1) / 2)),
        ); // clear the lots + their verge
    // Homestead parcels (the fenced lots + houses + gardens) — clear the whole footprint + a verge so no
    // trees grow inside a fence or on a house. Available once setNeighborhood hands the parcels in (foliage
    // is rebuilt there); this.neighborhood is null on the very first construction pass.
    if (this.neighborhood)
      for (const p of this.neighborhood.parcels)
        mark(p.x, p.y, Math.ceil(Math.max(p.w, p.h) / 2) + 1);
    // Commercial plots (spec 079) — the footprint min-corner is (x,y) here, so clear around the centre.
    if (this.commercialDistrict) {
      for (const p of this.commercialDistrict.parcels)
        mark(
          p.x + (p.w - 1) / 2,
          p.y + (p.h - 1) / 2,
          Math.ceil(Math.max(p.w, p.h) / 2) + 1,
        );
      const gp = this.commercialDistrict.garagePad;
      if (gp)
        mark(
          gp.x + (gp.w - 1) / 2,
          gp.y + (gp.h - 1) / 2,
          Math.ceil(Math.max(gp.w, gp.h) / 2) + 2,
        );
    }
    mark(t.landing.x, t.landing.y, 4); // keep the colony heart clear
    const cells: number[] = [];
    for (let i = 0; i < N * N; i++) {
      const b = t.biome[i];
      if (b !== Biome.Forest && b !== Biome.Plains) continue;
      const x = i % N;
      const y = (i / N) | 0;
      if (t.isWater(x, y)) continue;
      if (cleared.has(i)) continue; // no trees on the streets or under the homes
      const p = b === Biome.Forest ? 0.5 : 0.08;
      if (hash(i + 1) < p) cells.push(i);
    }
    // Replace any prior foliage mesh (this method is now a rebuild) — dispose the old GPU resources first.
    if (this.foliageMesh) {
      this.scene.remove(this.foliageMesh);
      this.foliageMesh.geometry.dispose();
      (this.foliageMesh.material as THREE.Material).dispose();
      this.foliageMesh = undefined;
    }
    const cap = Math.min(cells.length, 6000); // spec 084 S5 — headroom for the 608 world's forests
    const geo = new THREE.ConeGeometry(0.42, 1.1, 6);
    geo.translate(0, 0.55, 0);
    // Spec 092 — foliage 2.0: gentle WIND SWAY via a vertex-shader displacement (GPU-cheap for thousands
    // of trees — one uniform, no per-instance CPU work). The cone tip sways more than the base; each tree
    // is phased by its world position so the canopy ripples instead of moving in unison. uTime advances
    // on the wall clock in frame() (render-only, never touches the sim).
    const foliageMat = new THREE.MeshStandardMaterial({
      roughness: 0.9,
      metalness: 0,
      flatShading: true,
      // Spec 092 — a dark-green EMISSIVE FLOOR so the trees never crush to pure black at low light. The
      // dark-green instance colours get almost no illumination at dawn/dusk/night (night sun ~0.18,
      // hemisphere ~0.35), so without this the cones read as floating black blobs that "breathe" with the
      // wind sway — especially the near-shore ones silhouetted against the water from a low camera. The
      // floor is tiny next to the daytime key light (negligible at noon) but keeps trees a readable dark
      // green after dark, mirroring the same trick the clouds + gulls already use against the void.
      emissive: 0x1c4a2a,
      emissiveIntensity: 0.6,
    });
    foliageMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      shader.vertexShader =
        "uniform float uTime;\n" +
        shader.vertexShader.replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          {
            float windPhase = instanceMatrix[3].x * 0.11 + instanceMatrix[3].z * 0.11;
            float gust = sin(uTime * 1.15 + windPhase) + 0.35 * sin(uTime * 2.3 + windPhase * 1.7);
            float hfac = clamp(transformed.y / 1.1, 0.0, 1.0);
            hfac *= hfac;
            transformed.x += gust * hfac * 0.05;
            transformed.z += cos(uTime * 0.9 + windPhase) * hfac * 0.03;
          }`,
        );
      foliageMat.userData.shader = shader;
    };
    this.foliageWindMat = foliageMat;
    const mesh = new THREE.InstancedMesh(geo, foliageMat, Math.max(1, cap));
    // Spec 092 — foliage must NOT cast shadows. Up to 6000 wind-swayed cones rendered into the single
    // 2048 sun depth map (frustum pinned at a fixed ±d that only follows the camera, never re-fits) alias
    // into coarse, tree-shaped dark blobs scattered across the terrain + coastal sea — worst at planet
    // zoom-out, and they "breathe" as the swaying canopy desyncs from its static shadow each gust. The
    // decorative low-poly trees sit flush on the ground so they read fine without a cast shadow; buildings,
    // voxels, props and figures keep castShadow=true for depth. Bonus: 6000 cones leave the depth pass.
    mesh.castShadow = false;
    mesh.frustumCulled = false;
    const col = new THREE.Color();
    let n = 0;
    for (let k = 0; k < cells.length && n < cap; k++) {
      const i = cells[k]!;
      const x = i % N;
      const y = (i / N) | 0;
      const h1 = hash(i * 7 + 3);
      const h2 = hash(i * 13 + 5);
      const wy = Math.max(0, t.worldY(x, y));
      const sc = 0.72 + h1 * 0.9;
      this.dummy.position.set(
        this.wx(x) + (h1 - 0.5) * 0.7,
        wy,
        this.wz(y) + (h2 - 0.5) * 0.7,
      );
      this.dummy.scale.set(sc, sc + h2 * 1.05, sc);
      this.dummy.rotation.set(0, h2 * Math.PI, 0);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(n, this.dummy.matrix);
      col.setHex(TREE_COLORS[(i + x) % TREE_COLORS.length]!);
      mesh.setColorAt(n, col);
      n++;
    }
    mesh.count = n;
    this.foliageMesh = mesh;
    this.scene.add(mesh);
  }

  private buildOcean() {
    // Spec 090/092 — the sea: a subdivided disc so frame() can roll gentle swells across it. The earlier
    // "living sea" pass made it dark-blobby; every fix below was verified live with the operator and is the
    // reason the open water is finally clean:
    //  • SPANS THE WHOLE water area (R = N*0.99, was N*0.66 which left the outer sea uncovered) and is
    //    OPAQUE (was opacity 0.93). Translucent + partial water let the deep procedural seabed show through
    //    as near-black patches.
    //  • DIFFUSE — metalness 0, roughness 0.7 (was 0.55 / 0.1). The glossy half-metallic surface mirrored
    //    the dark space-void as black patches on the swell facets, worst at grazing angles near the rim.
    //  • UNIFORM teal (no vertex-colour depth gradient). The old gradient's dark deep-centre colour read as
    //    a dark blob in the middle of the lagoon.
    //  • Sits at y=0.15, ABOVE the shallow seabed bumps. The seabed rises toward ~0 in the lagoon, so a sea
    //    at y=-0.1 let those bumps poke through as dark spots; a slightly higher waterline covers them.
    // It still reads as a living sea (swells + the separate shoreline foam ring), just clean.
    const R = this.N * 0.99;
    const geo = new THREE.RingGeometry(0.5, R, 120, 30);
    const pos = geo.getAttribute("position");
    const base = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      base[i * 2] = pos.getX(i);
      base[i * 2 + 1] = pos.getY(i);
    }
    const ocean = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        color: 0x1f6f8c,
        roughness: 0.7,
        metalness: 0,
      }),
    );
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.y = 0.15;
    // Spec 092 — the sea must NOT receive shadows. updateOcean recomputes the swell normals every frame,
    // so with receiveShadow the shadow map false-self-shadows the moving surface → scattered BLACK acne
    // blobs that "breathe" across the water (the operator's bug). Water showing the island's shadow is
    // negligible anyway; turning receipt off removes the acne entirely.
    ocean.receiveShadow = false;
    this.scene.add(ocean);
    this.oceanGeo = geo;
    this.oceanBase = base;
  }

  /** Spec 090 — roll gentle layered swells across the ocean disc each frame (render-loop cosmetic, on the
   *  wall clock like the bus + beacon; never touches the sim). Recomputes normals so the swells catch light. */
  private updateOcean(timeMs: number): void {
    const geo = this.oceanGeo,
      base = this.oceanBase;
    if (!geo || !base) return;
    const t = timeMs / 1000;
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 2]!,
        y = base[i * 2 + 1]!;
      const z =
        Math.sin(x * 0.05 + t * 0.85) * 0.18 +
        Math.sin(y * 0.063 - t * 0.7) * 0.14 +
        Math.sin((x + y) * 0.028 + t * 1.25) * 0.09;
      pos.setZ(i, z);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  }

  /** Spec 091 — the shoreline SURF: an additive foam ring traced once from the terrain coastline, parked
   *  just above the living sea. Render-only + deterministic (built from grid data, opacity pulses on the
   *  wall clock); see foamLayer.ts. */
  private buildFoam(): void {
    this.foam = buildFoam({
      terrain: this.sim.state.terrain,
      wx: (x) => this.wx(x),
      wz: (y) => this.wz(y),
    });
    if (this.foam) this.scene.add(this.foam.group);
  }

  /** Spec 092 — drifting sky clouds: soft lit puffs over the island, drifting on the wall clock. */
  private buildClouds(): void {
    this.clouds = buildClouds({ worldSize: this.N });
    if (this.clouds) this.scene.add(this.clouds.group);
  }

  /** Spec 092 — ambient motion: gulls gliding over the sea (see ambientLayer.ts). */
  private buildAmbient(): void {
    this.ambient = buildAmbient({ worldSize: this.N });
    if (this.ambient) this.scene.add(this.ambient.group);
  }

  private colorFor(mode: ViewMode, i: number, out: THREE.Color): void {
    const t = this.sim.state.terrain;
    if (mode === "biome") {
      // Spec 093 — a cell the renderer levelled/dried for a homestead is DRY GROUND now, even if its real
      // elevation is a sub-sea-level Shallows/Beach cell. Paint it Plains grass so a raised coastal cell
      // doesn't show its teal sea / sand colour standing proud above the water (the operator's "blue
      // patches at Joe's house"). The land enrichment below then applies to it as ordinary ground.
      const leveled = this.terrainLevel.has(i) && !this.roadGradedCells.has(i);
      out.setHex(
        leveled ? BIOME_COLOR[Biome.Plains] : BIOME_COLOR[t.biome[i] as Biome],
      );
      // Spec 092 — richer terrain: break the flat per-biome fill on LAND with deterministic per-cell
      // variation — a small brightness jitter, an elevation lift (higher ground catches more light), and
      // a moisture tint (wetter greener, drier warmer) — so plains/forest read as living ground, not one
      // flat colour. Water cells (under the ocean disc) stay flat; levelled cells count as land.
      if (leveled || (t.elev[i]! >= COLONY.world.seaLevel && !t.water[i])) {
        let h = (i * 2654435761) >>> 0;
        h = (h ^ (h >>> 15)) >>> 0;
        out.multiplyScalar(0.93 + (h / 4294967296) * 0.14); // ±7% brightness
        // clamp at the waterline so a raised (levelled) sub-sea cell isn't darkened below grass
        const lift =
          (Math.max(t.elev[i]!, COLONY.world.seaLevel) -
            COLONY.world.seaLevel) *
          0.16;
        out.r += lift;
        out.g += lift;
        out.b += lift;
        const m = t.moisture[i]! - 0.5;
        out.g += m * 0.05; // wetter → greener
        out.r -= m * 0.03; // drier → warmer
        out.r = Math.min(1, Math.max(0, out.r));
        out.g = Math.min(1, Math.max(0, out.g));
        out.b = Math.min(1, Math.max(0, out.b));
      }
    } else if (mode === "buildable") {
      const b = t.buildable[i]!;
      if (t.water[i] || t.elev[i]! < COLONY.world.seaLevel)
        out.setHex(0x163a4a);
      else out.setHex(b === 2 ? 0x4caf50 : b === 1 ? 0xe0c020 : 0xc0493f);
    } else {
      const g = 0.15 + t.elev[i]! * 0.85;
      out.setRGB(g * 0.9, g, g * 0.95);
    }
  }

  private buildTerrain() {
    // Spec 084 S5 — the terrain is a chunk grid (per-chunk frustum culling + one-time analytic
    // normals + staged recolor); see terrainChunks.ts for why each matters at the 608 world.
    this.terrainMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0.02,
      flatShading: false,
    });
    this.rebuildChunkedTerrain();
    // Spec 093 — if the parcels are already known (terrain built after setNeighborhood), level + dry them
    // straight away so the terrain's first visible build already carries the founder pads, never a frame
    // of un-levelled coastal water. relevelTerrain is idempotent (own fingerprint), so this is safe to
    // pair with the setNeighborhood call — whichever runs second with both ready wins, and the per-frame
    // updateNeighborhood remains the path for later builds.
    if (this.neighborhood) this.relevelTerrain();
  }

  /** (Re)build the chunk-grid terrain. Re-run when the footprint level map changes (spec 093) so the
   *  cut pads under sloped houses appear; otherwise the heightAt override stays the same and this is a
   *  one-time boot build. Disposes + swaps the old group so the scene never holds two terrains. */
  private rebuildChunkedTerrain() {
    const N = this.sim.state.terrain.size;
    const next = buildChunkedTerrain(
      this.sim.state.terrain,
      (x) => this.wx(x),
      (y) => this.wz(y),
      (i, out) => this.colorFor(this.view, i, out),
      this.terrainMat,
      8,
      this.terrainLevel.size
        ? (x: number, y: number) => this.terrainLevel.get(y * N + x)
        : undefined,
    );
    if (this.chunkedTerrain) {
      this.scene.remove(this.chunkedTerrain.group);
      this.chunkedTerrain.dispose();
    }
    this.chunkedTerrain = next;
    this.scene.add(next.group);
  }

  /** Spec 093 — recompute the render-only height map from the built lots and, if it changed, rebuild the
   *  terrain mesh. Two effects per built homestead, both VISUAL-only (sim worldY / isWater untouched, so
   *  water, pathfinding and the economy never shift):
   *    1. LEVEL the cells under the house footprint to the house's seat height, so a house on a slope sits
   *       flush on a flat cut pad (uphill cut down, downhill filled up) instead of floating / poking.
   *    2. DRY the rest of the homestead: the sea renders as an opaque disc at y≈0.15, so a parcel cell
   *       whose real worldY is only 0..0.15 is dry land yet is drawn UNDER the sea as a phantom pond (the
   *       operator's "water through Joe's yard"). Any parcel cell below the dry floor is raised clear of
   *       the disc, and the seat is clamped to it so a coastal pad can never dip under the water either.
   *  The pad/garden/driveway/fence DECORATION reads this same map via gy() (see updateNeighborhood), so
   *  pads, veg-beds and fences ride the cut/filled terrain together — no single-source-of-truth drift. */
  private relevelTerrain() {
    const N = this.sim.state.terrain.size;
    const t = this.sim.state.terrain;
    // render-only dry floor. The living sea (buildOcean) sits at y 0.15 and SWELLS by up to ±0.41
    // (updateOcean), so its surface PEAKS at ~0.56; a translucent sheen rides at ~0.4. A homestead cell
    // must clear that peak or the sea washes back over it as a teal tint even though the ground is dry
    // (the operator's "the sea interferes where land is"). 0.65 clears the peak with margin.
    const DRY = RENDER_DRY_FLOOR;
    const SKIRT = 4; // cells of graded transition from the flat pad out to natural ground
    const seatOf = (hz: { x: number; y: number; w: number; d: number }) =>
      Math.max(this.groundY(hz.x + (hz.w - 1) / 2, hz.y + (hz.d - 1) / 2), DRY);
    // Cheap fingerprint: only built lots, their footprint rect, and their seat height drive the map.
    let sig = `r${this.sim.state.roadsVersion}c${this.roadRibbonCells?.size ?? 0}|`;
    for (const lot of this.neighborhood?.parcels ?? []) {
      if (!lot.built) continue;
      const hz = lot.houseZone;
      sig += `${lot.id}:${hz.x},${hz.y},${hz.w},${hz.d}@${seatOf(hz).toFixed(3)}|`;
    }
    // Commercial district drives the map too — its coastal shop pads must be dried like the homesteads
    // or they seat under the sea disc ("commercials is in the ground" / Floyd's night water-clip flag).
    const cd = this.commercialDistrict;
    if (cd) {
      sig += `cd${cd.reserve.x},${cd.reserve.y},${cd.reserve.w},${cd.reserve.h};`;
      for (const p of cd.parcels) sig += `${p.id}:${p.x},${p.y},${p.w},${p.h}|`;
      if (cd.garagePad)
        sig += `garage:${cd.garagePad.x},${cd.garagePad.y},${cd.garagePad.w},${cd.garagePad.h},${cd.garagePad.facingAngle.toFixed(4)}|`;
    }
    if (sig === this.terrainLevelSig) return;
    this.terrainLevelSig = sig;
    const next = new Map<number, number>();
    const put = (x: number, y: number, v: number) => {
      if (x >= 0 && y >= 0 && x < N && y < N) next.set(y * N + x, v);
    };
    for (const lot of this.neighborhood?.parcels ?? []) {
      if (!lot.built) continue;
      const hz = lot.houseZone;
      const py = seatOf(hz);
      // 1) DRY the homestead. Bbox over the fence ring + the driveway run out to the road (so the front
      //    approach dries too); raise any cell below the floor. The footprint cells are overwritten next.
      let x0 = hz.x,
        x1 = hz.x + hz.w,
        y0 = hz.y,
        y1 = hz.y + hz.d;
      const ext = (x: number, y: number) => {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      };
      for (const f of lot.fence) ext(f.x, f.y);
      for (const d of lot.driveway) ext(d.x, d.y);
      if (lot.gate) ext(lot.gate.x, lot.gate.y);
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++)
          // raise sub-floor cells — but not under a road: the road RIBBON rides raw worldY, so a lifted
          // cell would poke up through the asphalt on a low coastal frontage. The ribbon bridges it.
          if (t.worldY(x, y) < DRY && !this.roadRibbonCells?.has(`${x},${y}`))
            put(x, y, DRY);
      // 2) LEVEL the footprint to the flat seat py, then GRADE a skirt out to natural ground over SKIRT
      //    cells (smoothstep) so the pad never drops off a 1-cell cliff. Without the skirt the garden /
      //    driveway pads at the footprint edge sat on a near-vertical 2-3 unit step (float uphill, bury
      //    downhill); the grade lets them — and the terrain — ramp together. The footprint's BOUNDING
      //    vertices (dist 0 spans x..x+w, y..y+d) are flat: a w×d cell pad needs its far edge levelled too,
      //    or the last row ramps under the house wall. The skirt stays ≥ DRY (both ends are), so it never
      //    re-floods. Distance is Chebyshev to the footprint rect; dist ≥ SKIRT is left natural.
      const fx1 = hz.x + hz.w,
        fy1 = hz.y + hz.d;
      for (let y = hz.y - SKIRT + 1; y < fy1 + SKIRT; y++)
        for (let x = hz.x - SKIRT + 1; x < fx1 + SKIRT; x++) {
          const dist = Math.max(0, hz.x - x, x - fx1, hz.y - y, y - fy1);
          if (dist === 0) put(x, y, py);
          else if (dist < SKIRT && x >= 0 && y >= 0 && x < N && y < N) {
            const nat = Math.max(t.worldY(x, y), DRY);
            const s = dist / SKIRT;
            const sm = s * s * (3 - 2 * s); // smoothstep: flat at the pad, flat into natural
            put(x, y, py + (nat - py) * sm);
          }
        }
    }
    // Spec 103/105 — DRY the commercial district like #164, then BLEND coastal low cells around the
    // seat rectangles. #164 seats shops on surfaceY and raises below-dry shop/mall cells; this slice does
    // not redo that dry decision. It extends the render-only height override outward on steep seaward
    // frontages so dry commercial pads ramp toward the shoreline instead of ending in one-cell black
    // cliff faces / floating-table silhouettes at night. Roads are skipped because ribbons bridge them.
    if (cd) {
      // Spec 109 P0 — GRADE EVERY commercial parcel + the mall pad like a homestead, not just coastal
      // ones. The old code only blended seaward sub-dry cells, so an INLAND parcel on the steep hillside
      // got zero grading and the dark foundation plinth (buildCommercialDistrict, colour 0x2a2f38) met the
      // slope as a sheer BLACK vertical wall / floating-table silhouette (the operator's "buildings in the
      // ground / floating"). The shops sit ~1 cell apart on a steep coastal grade, so — unlike the
      // far-apart homesteads — a single per-parcel pass lets a neighbour's skirt overwrite this parcel's
      // footprint, leaving its 4 corners at different surfaceY (large hiY-loY -> tall plinth). So do it in
      // TWO global passes: write ALL skirts first, then ALL footprints, so every footprint cell ends flat
      // at its own seat (hiY==loY -> plinth collapses to ~0.7 and is buried). Stays >= DRY (never floods);
      // roads skipped (the ribbon bridges them). Deterministic height-fn, no RNG.
      const seats = [
        ...cd.parcels.map((p) => ({ x: p.x, y: p.y, w: p.w, h: p.h })),
        { x: cd.mallPad.x, y: cd.mallPad.y, w: cd.mallPad.w, h: cd.mallPad.h },
        ...(cd.garagePad
          ? [
              {
                x: cd.garagePad.x,
                y: cd.garagePad.y,
                w: cd.garagePad.w,
                h: cd.garagePad.h,
              },
            ]
          : []),
      ];
      const seatY = (r: { x: number; y: number; w: number; h: number }) =>
        Math.max(this.groundY(r.x + (r.w - 1) / 2, r.y + (r.h - 1) / 2), DRY);
      // Pass 1 — skirts (smoothstep ramp from the flat pad out to natural ground).
      for (const r of seats) {
        const py = seatY(r);
        const fx1 = r.x + r.w,
          fy1 = r.y + r.h;
        for (let y = r.y - SKIRT + 1; y < fy1 + SKIRT; y++)
          for (let x = r.x - SKIRT + 1; x < fx1 + SKIRT; x++) {
            if (x < 0 || y < 0 || x >= N || y >= N) continue;
            if (this.roadRibbonCells?.has(`${x},${y}`)) continue;
            const dist = Math.max(0, r.x - x, x - fx1, r.y - y, y - fy1);
            if (dist > 0 && dist < SKIRT) {
              const nat = Math.max(t.worldY(x, y), DRY);
              const s = dist / SKIRT;
              put(x, y, py + (nat - py) * (s * s * (3 - 2 * s)));
            }
          }
      }
      // Pass 2 — footprints WIN: flatten each pad to its own seat so all 4 corners match.
      for (const r of seats) {
        const py = seatY(r);
        for (let y = r.y; y <= r.y + r.h; y++)
          for (let x = r.x; x <= r.x + r.w; x++) {
            if (x < 0 || y < 0 || x >= N || y >= N) continue;
            if (this.roadRibbonCells?.has(`${x},${y}`)) continue;
            put(x, y, py);
          }
      }
      const rects = [
        ...cd.parcels.map((p) => ({
          x: p.x - 1,
          y: p.y - 1,
          w: p.w + 2,
          h: p.h + 2,
        })),
        { x: cd.mallPad.x, y: cd.mallPad.y, w: cd.mallPad.w, h: cd.mallPad.h },
        ...(cd.garagePad
          ? [
              {
                x: cd.garagePad.x,
                y: cd.garagePad.y,
                w: cd.garagePad.w,
                h: cd.garagePad.h,
              },
            ]
          : []),
      ];
      applyCoastalCommercialDryBlend({
        next,
        n: N,
        terrain: t,
        rects,
        roadRibbonCells: this.roadRibbonCells,
        dry: DRY,
      });
    }
    // Spec 095 — grade the visible ground UP to the road ribbon (render-only; worldY untouched), so a
    // car riding the ribbon top is never swallowed by a hillside and the world never shows below the road.
    this.gradeRoadsInto(next, N);
    this.terrainLevel = next;
    this.rebuildChunkedTerrain();
  }

  /** Spec 095 — grade the ground to the road ONLY where it genuinely differs from the road surface, so a
   *  car (riding smoothRoadY + 0.12) never sinks on a hill and the uphill bank never hides it — WITHOUT
   *  bermimg flat roads. The first cut graded every ribbon cell to smoothRoadY (a max over the
   *  carriageway), which on flat/gently-noisy ground sits a hair above the local cell, so it raised a low
   *  embankment with shoulder banks under EVERY road ("roads look elevated"). The DEADZONE leaves
   *  near-flush road ground untouched (flat roads read flush again) and only fills a real sink / cuts a
   *  real bank. Render-only — sim worldY, water and pathfinding keep reading Terrain.worldY. */
  private gradeRoadsInto(next: Map<number, number>, N: number) {
    this.roadGradedCells.clear();
    const cells = this.roadRibbonCells;
    if (!cells || cells.size === 0) return;
    const t = this.sim.state.terrain;
    const SKIRT = 3;
    // Only grade where |road surface - ground| exceeds this. Flat/gentle ground stays natural (no berm);
    // real hills (sink/bank are ~1-2.5 units) still grade. Smaller = flatter roads grade; larger = only
    // the steepest. 0.6 clears the per-cell terrain noise while still catching every real hill.
    const DEADZONE = 0.6;
    const ribbon = new Set<number>(); // every road cell (so the skirt never disturbs a flush road cell)
    const graded = new Map<number, number>(); // road cell -> surface height, ONLY where it matters
    for (const key of cells) {
      const c = key.indexOf(",");
      const x = +key.slice(0, c);
      const y = +key.slice(c + 1);
      if (x < 0 || y < 0 || x >= N || y >= N) continue;
      const i = y * N + x;
      ribbon.add(i);
      const h = Math.max(0, this.smoothRoadY(x, y));
      const nat = Math.max(0, t.worldY(x, y));
      if (Math.abs(h - nat) <= DEADZONE) continue; // already flush — leave natural, no berm
      graded.set(i, h);
    }
    if (graded.size === 0) return;
    // Carriageway: meet the ribbon base on real slopes (fill the sink / cut the bank).
    for (const [i, h] of graded) {
      next.set(i, h);
      this.roadGradedCells.add(i);
    }
    // Shoulder: ramp ONLY around graded cells, from the nearest road height to natural ground (smoothstep),
    // so a graded hill road is no cliff. Flush road segments grade nothing, so they grow no shoulder banks.
    const skirt = new Map<number, { h: number; d: number }>();
    for (const [i, h] of graded) {
      const cx = i % N;
      const cy = (i / N) | 0;
      for (let dy = -SKIRT; dy <= SKIRT; dy++)
        for (let dx = -SKIRT; dx <= SKIRT; dx++) {
          const d = Math.abs(dx) > Math.abs(dy) ? Math.abs(dx) : Math.abs(dy);
          if (d === 0) continue;
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= N || y >= N) continue;
          const j = y * N + x;
          if (ribbon.has(j)) continue; // never disturb a road cell (graded or deliberately-flush)
          const cur = skirt.get(j);
          if (!cur || d < cur.d) skirt.set(j, { h, d });
        }
    }
    for (const [j, info] of skirt) {
      if (next.has(j)) continue; // a house pad already owns this cell — leave its grade alone
      const x = j % N;
      const y = (j / N) | 0;
      const nat = Math.max(0, t.worldY(x, y));
      const s = info.d / (SKIRT + 1);
      const sm = s * s * (3 - 2 * s);
      next.set(j, info.h + (nat - info.h) * sm);
      this.roadGradedCells.add(j);
    }
  }

  setView(mode: ViewMode) {
    this.view = mode;
    // Spec 084 S5 — recoloring is STAGED: chunks go dirty here and frame() repaints a few per
    // frame, so a view toggle never stalls (the old full-grid rewrite froze a frame at scale).
    this.chunkedTerrain.markAllDirty();
  }

  /** Show or hide the city-plan overlay (zone tints + plot flag-poles). */
  setZonesVisible(v: boolean) {
    // Spec 011 — repurposed: drives the liveability overlay (homes tinted by wellbeing). The old static
    // zone tints + named-plot flags are retired, so they stay hidden regardless of the toggle.
    this.liveabilityOn = v;
    if (this.zoneTintMesh) this.zoneTintMesh.visible = false;
    this.plotMarkers.visible = false;
  }

  private buildStructures() {
    const t = this.sim.state.terrain;
    const group = new THREE.Group();
    for (const s of this.sim.state.structures) {
      if (s.kind === "lighthouse") continue;
      const mesh = this.makeStructure(s);
      const baseY = Math.max(0.05, t.worldY(s.x, s.y));
      mesh.position.set(this.wx(s.x), baseY, this.wz(s.y));
      mesh.castShadow = true;
      group.add(mesh);
    }
    this.scene.add(group);
    this.shoreProps = buildShoreProps({
      terrain: t,
      structures: this.sim.state.structures,
      roadSet: this.sim.state.roadSet,
      occupied: this.sim.state.occupied,
      wx: (x) => this.wx(x),
      wz: (y) => this.wz(y),
    });
    if (this.shoreProps) this.scene.add(this.shoreProps.group);
    this.venueProps = buildVenueProps({
      terrain: t,
      structures: this.sim.state.structures,
      roadSet: this.sim.state.roadSet,
      occupied: this.sim.state.occupied,
      wx: (x) => this.wx(x),
      wz: (y) => this.wz(y),
    });
    if (this.venueProps) this.scene.add(this.venueProps.group);
    this.gltfProps = buildGltfPropLayer({
      assets: venuePropAssets,
      placements: rallyVenuePropPlacements(this.sim.state.structures, t),
      terrain: t,
      wx: (x) => this.wx(x),
      wz: (y) => this.wz(y),
    });
    if (this.gltfProps) this.scene.add(this.gltfProps.group);
  }

  private makeStructure(s: SeedStructure): THREE.Object3D {
    const g = new THREE.Group();
    if (s.kind === "caravan") {
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(3, 1.5, 1.7),
        new THREE.MeshStandardMaterial({ color: 0xe9e4d6, roughness: 0.7 }),
      );
      body.position.y = 1;
      body.castShadow = true;
      const roof = new THREE.Mesh(
        new THREE.BoxGeometry(3.05, 0.3, 1.75),
        new THREE.MeshStandardMaterial({ color: 0xb24a3a, roughness: 0.6 }),
      );
      roof.position.y = 1.85;
      g.add(body, roof);
    } else if (s.kind === "solar") {
      const post1 = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.07, 0.9),
        new THREE.MeshStandardMaterial({ color: 0x444 }),
      );
      post1.position.set(-0.8, 0.45, 0);
      const post2 = post1.clone();
      post2.position.x = 0.8;
      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(2.6, 0.09, 1.5),
        new THREE.MeshStandardMaterial({
          color: 0x16335a,
          roughness: 0.25,
          metalness: 0.5,
          emissive: 0x0a1830,
          emissiveIntensity: 0.5,
        }),
      );
      panel.position.y = 0.95;
      panel.rotation.x = -0.5;
      panel.castShadow = true;
      g.add(post1, post2, panel);
    } else if (s.kind === "battery") {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 1.3, 0.9),
        new THREE.MeshStandardMaterial({ color: 0x5a6270, roughness: 0.6 }),
      );
      box.position.y = 0.65;
      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(1.25, 0.18, 0.95),
        new THREE.MeshStandardMaterial({
          color: 0x39d353,
          emissive: 0x1f8a2f,
          emissiveIntensity: 0.6,
        }),
      );
      cap.position.y = 1.4;
      box.castShadow = true;
      g.add(box, cap);
    } else if (s.kind === "rocket") {
      // rocket / dropship (landed)
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.9, 1.1, 5, 16),
        new THREE.MeshStandardMaterial({
          color: 0xdfe3e9,
          roughness: 0.4,
          metalness: 0.3,
        }),
      );
      body.position.y = 2.5;
      const nose = new THREE.Mesh(
        new THREE.ConeGeometry(0.9, 2, 16),
        new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.5 }),
      );
      nose.position.y = 6;
      const fin = new THREE.Mesh(
        new THREE.BoxGeometry(0.15, 1.4, 1.2),
        new THREE.MeshStandardMaterial({ color: 0xb0b6bf }),
      );
      fin.position.set(0, 0.9, 0);
      body.castShadow = true;
      nose.castShadow = true;
      // Pulsing red nav beacon just above the nose — the landed dropship still has power.
      const beaconMat = new THREE.MeshStandardMaterial({
        color: 0xff6a55,
        emissive: 0xff2a18,
        emissiveIntensity: 1.5,
      });
      const beacon = new THREE.Mesh(
        new THREE.SphereGeometry(0.18, 12, 10),
        beaconMat,
      );
      beacon.position.y = 7.25;
      this.beaconMat = beaconMat;
      g.add(body, nose, fin, beacon);
    } else if (s.kind === "rally") {
      // Spec 097 — the hilltop Rally Point: a bus-stop-style rendezvous marker that reads from the
      // city below AND at night (emissive floor, per the day-night rule). Iconographic only (no brand
      // text): a signpost carrying a glowing checkered race flag, a stop platform, a bench, a beacon.
      const platform = new THREE.Mesh(
        new THREE.CylinderGeometry(1.6, 1.8, 0.3, 18),
        new THREE.MeshStandardMaterial({ color: 0x8a8f98, roughness: 0.85 }),
      );
      platform.position.y = 0.15;
      platform.receiveShadow = true;
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.09, 3.4, 10),
        new THREE.MeshStandardMaterial({
          color: 0x3a3f47,
          metalness: 0.4,
          roughness: 0.5,
        }),
      );
      pole.position.set(0.9, 1.7, 0.9);
      pole.castShadow = true;
      const board = new THREE.Mesh(
        new THREE.BoxGeometry(1.5, 1.0, 0.08),
        new THREE.MeshStandardMaterial({
          color: 0xf4f4f0,
          emissive: 0xffd25a,
          emissiveIntensity: 0.7,
          roughness: 0.5,
        }),
      );
      board.position.set(0.9, 3.0, 0.9);
      board.castShadow = true;
      const dark = new THREE.MeshStandardMaterial({
        color: 0x202329,
        emissive: 0x14161a,
        emissiveIntensity: 0.2,
      });
      // a 2x2 checker reads as a race flag from a distance
      for (const [sx, sy] of [
        [-0.36, 0.24],
        [0.36, 0.24],
        [0.0, -0.12],
        [-0.36, -0.32],
        [0.36, -0.32],
      ] as const) {
        const c = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.02), dark);
        c.position.set(0.9 + sx, 3.0 + sy, 0.95);
        g.add(c);
      }
      const bench = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 0.12, 0.4),
        new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.85 }),
      );
      bench.position.set(-0.6, 0.62, -0.3);
      bench.castShadow = true;
      // a landmark beacon atop the pole so the point is findable from the city at night
      const beacon = new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 12, 10),
        new THREE.MeshStandardMaterial({
          color: 0xffd25a,
          emissive: 0xffb020,
          emissiveIntensity: 0.8,
        }),
      );
      beacon.position.set(0.9, 3.55, 0.9);
      g.add(platform, pole, board, bench, beacon);
    }
    return g;
  }

  // ── camera presets ──
  private presetPose(p: CameraPreset): {
    pos: THREE.Vector3;
    target: THREE.Vector3;
  } {
    const t = this.sim.state.terrain;
    const L = new THREE.Vector3(
      this.wx(t.landing.x),
      Math.max(0, t.worldY(t.landing.x, t.landing.y)),
      this.wz(t.landing.y),
    );
    if (p === "street") {
      return {
        pos: L.clone().add(new THREE.Vector3(16, 11, 20)),
        target: L.clone().add(new THREE.Vector3(0, 2, 0)),
      };
    }
    if (p === "district") {
      // Spec 084 S5 — frame the NEIGHBORHOOD (derived from its bounding box), not a hardcoded
      // point that only happened to work at the 192 world.
      const lots = this.neighborhood?.parcels ?? [];
      if (lots.length > 0) {
        let minX = Infinity,
          minY = Infinity,
          maxX = -Infinity,
          maxY = -Infinity;
        for (const l of lots) {
          minX = Math.min(minX, l.x - l.w / 2);
          maxX = Math.max(maxX, l.x + l.w / 2);
          minY = Math.min(minY, l.y - l.h / 2);
          maxY = Math.max(maxY, l.y + l.h / 2);
        }
        const cx = (minX + maxX) / 2,
          cy = (minY + maxY) / 2;
        const span = Math.max(maxX - minX, maxY - minY, 24);
        const c = new THREE.Vector3(
          this.wx(cx),
          Math.max(0, t.worldY(Math.round(cx), Math.round(cy))),
          this.wz(cy),
        );
        return {
          pos: c
            .clone()
            .add(new THREE.Vector3(span * 0.9, span * 1.1, span * 1.5)),
          target: c.clone().add(new THREE.Vector3(0, 4, 0)),
        };
      }
      return {
        pos: new THREE.Vector3(95, 105, 150),
        target: new THREE.Vector3(0, 5, 0),
      };
    }
    // planet — orbital framing: your colony region with the planet curving away behind it
    return {
      pos: new THREE.Vector3(0, this.N * 2.4, this.N * 3.4),
      target: new THREE.Vector3(0, 0, 0),
    };
  }

  applyPreset(p: CameraPreset) {
    const pose = this.presetPose(p);
    this.camera.position.copy(pose.pos);
    this.controls.target.copy(pose.target);
    this.controls.update();
  }

  // Spec 091 — the gradient SKY DOME: a huge inward sphere whose fragment colour blends from the
  // horizon glow up to the void zenith, giving the deep-space backdrop real vertical depth. Drawn first
  // (renderOrder -1, depthTest off) as a pure backdrop, so the stars, gas giant and island all paint
  // over it; fog is off so it never washes flat. updateDayNight feeds its two colours each frame.
  private buildSkyDome(): void {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: SKY_DAY.clone() },
        horizonColor: { value: HORIZON_GLOW.clone() },
        expo: { value: 1.15 },
      },
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        uniform float expo;
        varying vec3 vWorldPosition;
        void main() {
          float h = max(0.0, normalize(vWorldPosition).y);
          gl_FragColor = vec4(mix(horizonColor, topColor, pow(h, expo)), 1.0);
        }
      `,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(20000, 32, 16), mat);
    dome.name = "SkyDome";
    dome.renderOrder = -1;
    dome.frustumCulled = false;
    this.scene.add(dome);
    this.skyMat = mat;
  }

  private updateDayNight() {
    const d = this.sim.state.clock.daylight;
    const { hour, minute } = this.sim.state.clock;
    const sky = SKY_NIGHT.clone().lerp(SKY_DAY, d);
    // Horizon glow only by day; at night it collapses back to the flat void so deep space is untouched.
    const horizon = sky.clone().lerp(HORIZON_GLOW, d * 0.85);
    (this.scene.background as THREE.Color).copy(sky);
    // Distance-fog fades to the HORIZON glow (not the zenith void), so far terrain melts into the band —
    // atmospheric perspective that ties the island edge to the sky.
    (this.scene.fog as THREE.Fog).color.copy(horizon);
    if (this.skyMat) {
      (this.skyMat.uniforms.topColor.value as THREE.Color).copy(sky);
      (this.skyMat.uniforms.horizonColor.value as THREE.Color).copy(horizon);
    }
    this.hemi.intensity = 0.35 + d * 0.65;
    this.sun.intensity = 0.18 + d * 1.7;
    const t = hour + minute / 60;
    const ang = ((t - 6) / 12) * Math.PI;
    // Golden-hour key: the lower the sun, the warmer (amber) it burns; high noon stays a warm white.
    const sunHeight = Math.max(0, Math.sin(ang)); // 0 at the horizon .. 1 at noon
    this.sun.color
      .copy(SUN_HIGH)
      .lerp(SUN_LOW, Math.pow(1 - sunHeight, 1.5) * 0.85);
    const r = this.N * 1.1;
    // Spec 084 S5 — sun + target translate TOGETHER to the orbit target: the light DIRECTION (and
    // so all shading) is unchanged, but the fixed-extent shadow frustum now sits wherever the
    // player is looking instead of being pinned to the island centre.
    const c = this.controls.target;
    this.sun.position.set(
      c.x + Math.cos(ang) * r,
      Math.max(6, Math.sin(ang) * r),
      c.z + this.N * 0.25,
    );
    this.sun.target.position.set(c.x, 0, c.z);
  }

  private buildColonyLayer() {
    // Roads drape on the terrain (elevation-compatible): a continuous PACKED-EARTH ribbon with a
    // dashed centre line, rebuilt as the network grows. Warm gravel-earth, not an asphalt-black gash,
    // so the network sits in the landscape like the residential lane does.
    this.roadSurfaceMesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial({
        color: 0x7a6750,
        roughness: 1,
        metalness: 0,
        side: THREE.DoubleSide,
        emissive: 0x4a3c2c,
        emissiveIntensity: 0.32,
      }),
    );
    this.roadSurfaceMesh.frustumCulled = false;
    this.scene.add(this.roadSurfaceMesh);
    this.roadShoulderMesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial({
        color: 0x58604d,
        roughness: 0.98,
        metalness: 0,
        side: THREE.DoubleSide,
        emissive: 0x23271f,
        emissiveIntensity: 0.18,
      }),
    );
    this.roadShoulderMesh.frustumCulled = false;
    this.scene.add(this.roadShoulderMesh);
    this.roadLineMesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial({
        color: 0xd8c879,
        roughness: 0.8,
        metalness: 0,
        emissive: 0x2a2410,
        emissiveIntensity: 0.3,
        side: THREE.DoubleSide,
      }),
    );
    this.roadLineMesh.frustumCulled = false;
    this.scene.add(this.roadLineMesh);
    // Spec 084 S3 — the AVENUE: smooth asphalt (a faint cool emissive keeps it readable under the
    // void sky without crushing to black) and pale concrete kerb strips along its boundary edges.
    this.avenueSurfaceMesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial({
        color: 0x4a4a52,
        roughness: 0.92,
        metalness: 0,
        side: THREE.DoubleSide,
        emissive: 0x23232b,
        emissiveIntensity: 0.35,
      }),
    );
    this.avenueSurfaceMesh.frustumCulled = false;
    this.scene.add(this.avenueSurfaceMesh);
    this.avenueKerbMesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial({
        color: 0x9a9aa2,
        roughness: 0.85,
        metalness: 0,
        side: THREE.DoubleSide,
        emissive: 0x3c3c42,
        emissiveIntensity: 0.3,
      }),
    );
    this.avenueKerbMesh.frustumCulled = false;
    this.scene.add(this.avenueKerbMesh);

    // Building = body box + a low hipped roof merged into one geometry, so each instance reads as a
    // structure with a roof instead of a plain block. The roof scales with the building height.
    const bBody = new THREE.BoxGeometry(0.82, 1, 0.82);
    bBody.translate(0, 0.5, 0);
    const bRoof = new THREE.ConeGeometry(0.64, 0.4, 4);
    bRoof.rotateY(Math.PI / 4);
    bRoof.translate(0, 1.2, 0);
    const bGeo = mergeGeometries([bBody, bRoof])!;
    this.bldgMesh = new THREE.InstancedMesh(
      bGeo,
      new THREE.MeshStandardMaterial({
        roughness: 0.8,
        metalness: 0.03,
        flatShading: true,
      }),
      COLONY.build.maxBuildings + 8,
    );
    this.bldgMesh.count = 0;
    this.bldgMesh.castShadow = true;
    this.bldgMesh.frustumCulled = false;
    this.scene.add(this.bldgMesh);

    const crewGeo = new THREE.BoxGeometry(0.5, 0.3, 0.32);
    this.crewMesh = new THREE.InstancedMesh(
      crewGeo,
      new THREE.MeshStandardMaterial({
        color: 0xf2a23a,
        roughness: 0.5,
        metalness: 0.2,
      }),
      COLONY.build.maxBuildings + 8,
    );
    this.crewMesh.count = 0;
    this.crewMesh.castShadow = true;
    this.crewMesh.frustumCulled = false;
    this.scene.add(this.crewMesh);

    // Ambient pedestrians strolling the settled ground near the landing — the colony feels lived-in.
    const pedGeo = new THREE.CapsuleGeometry(0.13, 0.34, 3, 6);
    pedGeo.translate(0, 0.33, 0);
    this.pedMesh = new THREE.InstancedMesh(
      pedGeo,
      new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.05 }),
      28,
    );
    this.pedMesh.castShadow = true;
    this.pedMesh.frustumCulled = false;
    this.scene.add(this.pedMesh);
    // a head atop each body so the figures read as people (same instance transform, head baked above the body)
    const pedHeadGeo = new THREE.SphereGeometry(0.1, 8, 6);
    pedHeadGeo.translate(0, 0.72, 0);
    this.pedHeadMesh = new THREE.InstancedMesh(
      pedHeadGeo,
      new THREE.MeshStandardMaterial({ color: 0xe0b48a, roughness: 0.85 }),
      28,
    );
    this.pedHeadMesh.count = 0;
    this.pedHeadMesh.castShadow = true;
    this.pedHeadMesh.frustumCulled = false;
    this.scene.add(this.pedHeadMesh);
    this.initPedestrians();

    const tarentaalCap = COLONY.tarentaal.adults + COLONY.tarentaal.chicks;
    const tarentaalAdultGeo = new THREE.SphereGeometry(0.22, 8, 6);
    tarentaalAdultGeo.scale(1.25, 0.72, 0.82);
    tarentaalAdultGeo.translate(0, 0.22, 0);
    this.tarentaalAdultMesh = new THREE.InstancedMesh(
      tarentaalAdultGeo,
      new THREE.MeshStandardMaterial({
        color: 0x32343a,
        roughness: 0.9,
        metalness: 0.02,
        flatShading: true,
      }),
      tarentaalCap,
    );
    this.tarentaalAdultMesh.count = 0;
    this.tarentaalAdultMesh.castShadow = true;
    this.tarentaalAdultMesh.frustumCulled = false;
    this.scene.add(this.tarentaalAdultMesh);
    const tarentaalChickGeo = new THREE.SphereGeometry(0.12, 7, 5);
    tarentaalChickGeo.scale(1.15, 0.78, 0.82);
    tarentaalChickGeo.translate(0, 0.12, 0);
    this.tarentaalChickMesh = new THREE.InstancedMesh(
      tarentaalChickGeo,
      new THREE.MeshStandardMaterial({
        color: 0x8c7444,
        roughness: 0.95,
        metalness: 0,
        flatShading: true,
      }),
      tarentaalCap,
    );
    this.tarentaalChickMesh.count = 0;
    this.tarentaalChickMesh.castShadow = true;
    this.tarentaalChickMesh.frustumCulled = false;
    this.scene.add(this.tarentaalChickMesh);

    const benchSeat = new THREE.BoxGeometry(1.15, 0.12, 0.38);
    benchSeat.translate(0, 0.38, 0);
    const benchBack = new THREE.BoxGeometry(1.15, 0.45, 0.1);
    benchBack.translate(0, 0.58, -0.22);
    const benchGeo = mergeGeometries([benchSeat, benchBack])!;
    const lampPost = new THREE.CylinderGeometry(0.06, 0.07, 1.35, 8);
    lampPost.translate(0, 0.68, 0);
    const lampHead = new THREE.SphereGeometry(0.17, 8, 6);
    lampHead.translate(0, 1.42, 0);
    const lampGeo = mergeGeometries([lampPost, lampHead])!;
    const planterBase = new THREE.CylinderGeometry(0.44, 0.5, 0.32, 8);
    planterBase.translate(0, 0.16, 0);
    const planterPlant = new THREE.SphereGeometry(0.34, 8, 6);
    planterPlant.scale(1, 0.72, 1);
    planterPlant.translate(0, 0.52, 0);
    const planterGeo = mergeGeometries([planterBase, planterPlant])!;
    const fountainBase = new THREE.CylinderGeometry(0.72, 0.78, 0.22, 16);
    fountainBase.translate(0, 0.11, 0);
    const fountainBowl = new THREE.CylinderGeometry(0.42, 0.5, 0.24, 16);
    fountainBowl.translate(0, 0.34, 0);
    const fountainJet = new THREE.CylinderGeometry(0.06, 0.08, 0.52, 8);
    fountainJet.translate(0, 0.72, 0);
    const fountainGeo = mergeGeometries([
      fountainBase,
      fountainBowl,
      fountainJet,
    ])!;
    const shadeTreeTrunk = new THREE.CylinderGeometry(0.16, 0.22, 1.05, 8);
    shadeTreeTrunk.translate(0, 0.52, 0);
    const shadeTreeCrown = new THREE.SphereGeometry(0.72, 10, 8);
    shadeTreeCrown.scale(1, 0.82, 1);
    shadeTreeCrown.translate(0, 1.18, 0);
    const shadeTreeGeo = mergeGeometries([shadeTreeTrunk, shadeTreeCrown])!;
    const noticePost = new THREE.BoxGeometry(0.12, 0.92, 0.12);
    noticePost.translate(0, 0.46, 0);
    const noticePanel = new THREE.BoxGeometry(0.92, 0.5, 0.08);
    noticePanel.translate(0, 0.92, 0);
    const noticeCap = new THREE.BoxGeometry(1.0, 0.08, 0.12);
    noticeCap.translate(0, 1.21, 0);
    const noticeBoardGeo = mergeGeometries([
      noticePost,
      noticePanel,
      noticeCap,
    ])!;
    const wayfinderPost = new THREE.CylinderGeometry(0.07, 0.08, 1.05, 8);
    wayfinderPost.translate(0, 0.52, 0);
    const wayfinderArmA = new THREE.BoxGeometry(0.72, 0.16, 0.08);
    wayfinderArmA.translate(0.24, 0.92, 0);
    const wayfinderArmB = new THREE.BoxGeometry(0.58, 0.14, 0.08);
    wayfinderArmB.translate(-0.18, 0.72, 0);
    const wayfinderGeo = mergeGeometries([
      wayfinderPost,
      wayfinderArmA,
      wayfinderArmB,
    ])!;
    this.artifactCap = Math.max(1, ARTIFACT_CATALOG_SIZE);
    this.artifactMeshes = {
      bench: new THREE.InstancedMesh(
        benchGeo,
        new THREE.MeshStandardMaterial({ color: 0x8b5a35, roughness: 0.82 }),
        this.artifactCap,
      ),
      lamppost: new THREE.InstancedMesh(
        lampGeo,
        new THREE.MeshStandardMaterial({
          color: 0x2f3740,
          emissive: 0xffd67a,
          emissiveIntensity: 0.3,
          roughness: 0.45,
          metalness: 0.25,
        }),
        this.artifactCap,
      ),
      planter: new THREE.InstancedMesh(
        planterGeo,
        new THREE.MeshStandardMaterial({ color: 0x3d7a45, roughness: 0.9 }),
        this.artifactCap,
      ),
      fountain: new THREE.InstancedMesh(
        fountainGeo,
        new THREE.MeshStandardMaterial({ color: 0x6f8da7, roughness: 0.55 }),
        this.artifactCap,
      ),
      shade_tree: new THREE.InstancedMesh(
        shadeTreeGeo,
        new THREE.MeshStandardMaterial({ color: 0x2f6f3e, roughness: 0.88 }),
        this.artifactCap,
      ),
      notice_board: new THREE.InstancedMesh(
        noticeBoardGeo,
        new THREE.MeshStandardMaterial({ color: 0x8f6a3a, roughness: 0.78 }),
        this.artifactCap,
      ),
      wayfinder: new THREE.InstancedMesh(
        wayfinderGeo,
        new THREE.MeshStandardMaterial({ color: 0xd8b45c, roughness: 0.74 }),
        this.artifactCap,
      ),
    };
    for (const mesh of Object.values(this.artifactMeshes)) {
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
    }

    // P1 — citizen avatars: a touch taller + glowing so the real, named citizens stand out from the ambient crowd.
    const AV_CAP = 64;
    const avGeo = new THREE.CapsuleGeometry(0.16, 0.44, 4, 8);
    avGeo.translate(0, 0.4, 0);
    this.avatarMesh = new THREE.InstancedMesh(
      avGeo,
      new THREE.MeshStandardMaterial({
        roughness: 0.55,
        metalness: 0.1,
        emissive: 0x2a2050,
        emissiveIntensity: 0.5,
      }),
      AV_CAP,
    );
    this.avatarMesh.count = 0;
    this.avatarMesh.castShadow = true;
    this.avatarMesh.frustumCulled = false;
    this.scene.add(this.avatarMesh);
    const avHeadGeo = new THREE.SphereGeometry(0.12, 10, 8);
    avHeadGeo.translate(0, 0.86, 0);
    this.avatarHeadMesh = new THREE.InstancedMesh(
      avHeadGeo,
      new THREE.MeshStandardMaterial({ color: 0xe8c49a, roughness: 0.8 }),
      AV_CAP,
    );
    this.avatarHeadMesh.count = 0;
    this.avatarHeadMesh.castShadow = true;
    this.avatarHeadMesh.frustumCulled = false;
    this.scene.add(this.avatarHeadMesh);
    // Spec 078 — Joe the Crab's body: one merged, vertex-coloured geometry drawn by a single material.
    const crabGeo = this.makeCrabGeometry();
    this.crabMesh = new THREE.InstancedMesh(
      crabGeo,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        flatShading: true,
        roughness: 0.6,
        metalness: 0.05,
      }),
      AV_CAP,
    );
    this.crabMesh.count = 0;
    this.crabMesh.castShadow = true;
    this.crabMesh.frustumCulled = false;
    this.scene.add(this.crabMesh);

    // Spec 076 — homestead ground tiles (zone pads + the spine carriageway/verge) + voxel blocks
    // (the house, fences, farm crops, garden beds, trees). Caps raised for the larger parcels.
    // Deep pads: the tile body extends well below its top face, so on sloped ground the sides reach
    // down into the terrain — adjacent stepped tiles read as one merged surface and a tile edge over a
    // dip reads as built-up earth, never a floating wafer (operator feedback).
    const padGeo = new THREE.BoxGeometry(1, 0.6, 1);
    this.lotPadMesh = new THREE.InstancedMesh(
      padGeo,
      new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 }),
      PAD_CAP,
    );
    this.lotPadMesh.count = 0;
    this.lotPadMesh.receiveShadow = true;
    this.lotPadMesh.frustumCulled = false;
    this.scene.add(this.lotPadMesh);
    const blockGeo = new THREE.BoxGeometry(0.96, 0.56, 0.96);
    this.voxelMesh = new THREE.InstancedMesh(
      blockGeo,
      new THREE.MeshStandardMaterial({
        roughness: 0.85,
        metalness: 0.02,
        flatShading: true,
      }),
      VOX_CAP,
    );
    this.voxelMesh.count = 0;
    this.voxelMesh.castShadow = true;
    this.voxelMesh.receiveShadow = true;
    this.voxelMesh.frustumCulled = false;
    this.scene.add(this.voxelMesh);
    // Spec 077 P2 — the merged greedy-meshed brick houses. One shared vertex-colour material (the brick
    // banding lives in the per-vertex colours), flat-shaded so each merged quad reads as a crisp masonry
    // face. Slightly rougher than the instanced blocks so the surface reads as fired brick.
    this.mergedHouseMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.02,
      flatShading: true,
    });
    this.mergedHouseGroup.frustumCulled = false;
    this.scene.add(this.mergedHouseGroup);

    // Spec 073 — goods piled at the Porter Sheds (crates + sacks), and the porter handcarts on the roads.
    const crateGeo = new THREE.BoxGeometry(0.34, 0.34, 0.34);
    crateGeo.translate(0, 0.17, 0);
    this.porterPileMesh = new THREE.InstancedMesh(
      crateGeo,
      new THREE.MeshStandardMaterial({
        roughness: 0.85,
        metalness: 0,
        flatShading: true,
      }),
      320,
    );
    this.porterPileMesh.count = 0;
    this.porterPileMesh.castShadow = true;
    this.porterPileMesh.frustumCulled = false;
    this.scene.add(this.porterPileMesh);
    const cartGeo = new THREE.BoxGeometry(0.42, 0.22, 0.3);
    cartGeo.translate(0, 0.14, 0);
    this.porterCartMesh = new THREE.InstancedMesh(
      cartGeo,
      new THREE.MeshStandardMaterial({
        color: 0x9a7a4a,
        roughness: 0.6,
        metalness: 0.1,
      }),
      28,
    );
    this.porterCartMesh.count = 0;
    this.porterCartMesh.castShadow = true;
    this.porterCartMesh.frustumCulled = false;
    this.scene.add(this.porterCartMesh);

    // street lights at grid intersections
    const lightCap = 360;
    const postGeo = new THREE.CylinderGeometry(0.04, 0.05, 0.9, 5);
    postGeo.translate(0, 0.45, 0);
    this.streetPostMesh = new THREE.InstancedMesh(
      postGeo,
      new THREE.MeshStandardMaterial({ color: 0x2a2a30 }),
      lightCap,
    );
    this.streetPostMesh.count = 0;
    this.streetPostMesh.frustumCulled = false;
    this.scene.add(this.streetPostMesh);
    const headGeo = new THREE.BoxGeometry(0.16, 0.12, 0.16);
    headGeo.translate(0, 0.93, 0);
    this.streetHeadMesh = new THREE.InstancedMesh(
      headGeo,
      new THREE.MeshStandardMaterial({
        color: 0xfff0c0,
        emissive: 0xffd58a,
        emissiveIntensity: 0.4,
      }),
      lightCap,
    );
    this.streetHeadMesh.count = 0;
    this.streetHeadMesh.frustumCulled = false;
    this.scene.add(this.streetHeadMesh);

    const carGeo = new THREE.BoxGeometry(0.36, 0.16, 0.2); // length along +X
    this.carsMesh = new THREE.InstancedMesh(
      carGeo,
      new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.25 }),
      COLONY.traffic.maxCars + 4,
    );
    this.carsMesh.count = 0;
    this.carsMesh.castShadow = true;
    this.carsMesh.frustumCulled = false;
    this.scene.add(this.carsMesh);

    this.scene.add(this.settlerGroup); // unique KOOKER-settler homes live here
    this.scene.add(this.plotMarkers); // city-plan flag poles, one per plot
    this.scene.add(this.plotPadGroup); // sized plot foundations + their spoke roads

    // Zone tint: paint each land cell within the city's reach with its surveyed zone colour. The
    // residential arc (north + west), commercial arc (east), industrial arc (south), and civic
    // centre become visible as soft, translucent ground colour, so the patrol bot's allocations
    // and the player's first-person walk both have a *visible* city plan to land on.
    this.buildZoneTint();
  }

  /** One-time: build the translucent zone-tint mesh from the terrain. Cells off the plan get no quad. */
  private buildZoneTint() {
    const t = this.sim.state.terrain;
    const landing = t.landing;
    const positions: number[] = [];
    const colors: number[] = [];
    const tri = (a: number[], b: number[], c: number[], col: THREE.Color) => {
      positions.push(
        a[0]!,
        a[1]!,
        a[2]!,
        b[0]!,
        b[1]!,
        b[2]!,
        c[0]!,
        c[1]!,
        c[2]!,
      );
      for (let i = 0; i < 3; i++) colors.push(col.r, col.g, col.b);
    };
    const col = new THREE.Color();
    const LIFT = 0.03; // just above the terrain, just below the road
    for (let y = 0; y < t.size; y++) {
      for (let x = 0; x < t.size; x++) {
        if (t.isWater(x, y)) continue;
        const z = cellZone(landing, x, y);
        if (!z) continue;
        col.setHex(ZONE_COLOR[z]);
        // Quad covering the cell footprint, draped on the terrain by sampling corner heights.
        const cornerH = (gx: number, gy: number) => {
          const cl = (v: number) => Math.max(0, Math.min(t.size - 1, v));
          return Math.max(
            0,
            (t.worldY(cl(gx - 1), cl(gy - 1)) +
              t.worldY(cl(gx), cl(gy - 1)) +
              t.worldY(cl(gx - 1), cl(gy)) +
              t.worldY(cl(gx), cl(gy))) /
              4,
          );
        };
        const wx = (gx: number) => gx - t.size / 2;
        const wz = (gy: number) => gy - t.size / 2;
        const A = [wx(x) - 0.5, cornerH(x, y) + LIFT, wz(y) - 0.5];
        const B = [wx(x) + 0.5, cornerH(x + 1, y) + LIFT, wz(y) - 0.5];
        const C = [wx(x) - 0.5, cornerH(x, y + 1) + LIFT, wz(y) + 0.5];
        const D = [wx(x) + 0.5, cornerH(x + 1, y + 1) + LIFT, wz(y) + 0.5];
        tri(A, C, B, col);
        tri(B, C, D, col);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.36,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.zoneTintMesh = new THREE.Mesh(geo, mat);
    this.zoneTintMesh.frustumCulled = false;
    this.scene.add(this.zoneTintMesh);
  }

  /** Per-frame: ensure each plot has a flag-pole marker; allocated plots dim + collapse. */
  private syncPlotMarkers(plots: Plot[]) {
    const sig = plots.map((p) => `${p.id}:${p.assignedTo || ""}`).join("|");
    if (sig === this.lastPlotSig) return;
    this.lastPlotSig = sig;
    const t = this.sim.state.terrain;
    const have = new Set<string>();
    for (const p of plots) {
      have.add(p.id);
      let entry = this.plotMeshes.get(p.id);
      if (!entry) {
        const poleGeo = new THREE.CylinderGeometry(0.04, 0.04, 1.2, 6);
        poleGeo.translate(0, 0.6, 0);
        const poleMat = new THREE.MeshStandardMaterial({
          color: 0xd6d6dc,
          roughness: 0.6,
        });
        const pole = new THREE.Mesh(poleGeo, poleMat);
        const flagGeo = new THREE.BoxGeometry(0.45, 0.28, 0.04);
        flagGeo.translate(0.2, 1.05, 0);
        const flagMat = new THREE.MeshStandardMaterial({
          color: VIBE_COLOR[p.vibe],
          roughness: 0.5,
          emissive: VIBE_COLOR[p.vibe],
          emissiveIntensity: 0.35,
        });
        const flag = new THREE.Mesh(flagGeo, flagMat);
        const group = new THREE.Group();
        group.add(pole);
        group.add(flag);
        const wx = p.x - t.size / 2;
        const wz = p.y - t.size / 2;
        const wy = Math.max(0, t.worldY(p.x, p.y));
        group.position.set(wx, wy, wz);
        this.plotMarkers.add(group);
        entry = { pole, flag, flagMat };
        this.plotMeshes.set(p.id, entry);
      }
      // Allocated plots: dim flag, drop emissive, half-height pole effect via scale.
      const taken = !!p.assignedTo;
      entry.flagMat.color.setHex(VIBE_COLOR[p.vibe]);
      entry.flagMat.emissiveIntensity = taken ? 0.05 : 0.35;
      entry.flagMat.opacity = taken ? 0.55 : 1;
      entry.flagMat.transparent = taken;
      entry.flag.scale.set(taken ? 0.6 : 1, taken ? 0.6 : 1, taken ? 0.6 : 1);
      entry.pole.scale.set(1, taken ? 0.55 : 1, 1);
    }
    // Drop markers whose plot is gone (game reset).
    for (const [id, entry] of this.plotMeshes) {
      if (!have.has(id)) {
        const group = entry.pole.parent;
        if (group && group.parent) group.parent.remove(group);
        this.plotMeshes.delete(id);
      }
    }
  }

  /** Rebuild the unique settler homes (cheap; only on a new registration). */
  private rebuildSettlerHomes() {
    for (const c of [...this.settlerGroup.children])
      this.settlerGroup.remove(c);
    const s = this.sim.state;
    const t = s.terrain;
    for (const settler of s.settlers) {
      const home = this.buildHouseMesh(settler.house);
      home.position.set(
        this.wx(settler.x),
        Math.max(0, t.worldY(settler.x, settler.y)),
        this.wz(settler.y),
      );
      this.settlerGroup.add(home);
    }
  }

  /** Turn a HouseSpec (the AI's plan) into a one-off 3D house. */
  /** RETIRED (see docs/research/2026-06-02-land-organisation-and-roads.md). The scattered named-plot pads + straight spoke
   *  roads were the wrong paradigm — Caesar-III "settler walks to a human-marked far plot" — and the spokes ran straight over
   *  terrain and water heedless of the land. The replacement is a land-suitability metadata layer + a planner-driven, compact,
   *  least-cost road skeleton (roads-first, then parcels, then lots). Kept as a no-op so nothing renders until that lands. */
  private buildPlotPads(_plots: Plot[]) {
    if (this.plotPadGroup.children.length > 0) {
      for (const ch of [...this.plotPadGroup.children]) {
        this.plotPadGroup.remove(ch);
        const m = ch as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if (m.material) (m.material as THREE.Material).dispose();
      }
    }
    this.lastPadSig = "retired";
    return;
    // eslint-disable-next-line no-unreachable
    const plots = _plots;
    const sig = plots.map((p) => `${p.id}:${p.w || 1}x${p.h || 1}`).join("|");
    if (sig === this.lastPadSig) return;
    this.lastPadSig = sig;
    const t = this.sim.state.terrain;
    for (const ch of [...this.plotPadGroup.children]) {
      this.plotPadGroup.remove(ch);
      const m = ch as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) (m.material as THREE.Material).dispose();
    }
    const lx = t.landing.x,
      ly = t.landing.y;
    const padMat = new THREE.MeshStandardMaterial({
      color: 0x9a948c,
      roughness: 0.9,
      metalness: 0,
    }); // poured-deck concrete
    const kerbMat = new THREE.MeshStandardMaterial({
      color: 0xbfc6c9,
      roughness: 0.8,
    });
    // one merged ribbon for all the spoke roads (draped over the terrain)
    const surf: number[] = [];
    const triPush = (p: number[], q: number[], r: number[]) =>
      surf.push(p[0]!, p[1]!, p[2]!, q[0]!, q[1]!, q[2]!, r[0]!, r[1]!, r[2]!);
    const quad = (a: number[], b: number[], c: number[], d: number[]) => {
      triPush(a, c, b);
      triPush(b, c, d);
    };
    for (const p of plots) {
      const w = Math.max(1, p.w || 1),
        h = Math.max(1, p.h || 1);
      const hx = (w - 1) / 2,
        hy = (h - 1) / 2;
      // leveled foundation height: sit at the highest corner of the lot so it cuts uphill and fills downhill
      let padY = 0;
      for (let yy = p.y - hy; yy <= p.y + hy; yy++)
        for (let xx = p.x - hx; xx <= p.x + hx; xx++)
          padY = Math.max(
            padY,
            Math.max(0, t.worldY(Math.round(xx), Math.round(yy))),
          );
      // the kerb (a hair larger + lower) frames the pad
      const kerb = new THREE.Mesh(
        new THREE.BoxGeometry(w + 0.4, 0.16, h + 0.4),
        kerbMat,
      );
      kerb.position.set(this.wx(p.x), padY + 0.02, this.wz(p.y));
      kerb.receiveShadow = true;
      this.plotPadGroup.add(kerb);
      const pad = new THREE.Mesh(new THREE.BoxGeometry(w, 0.22, h), padMat);
      pad.position.set(this.wx(p.x), padY + 0.06, this.wz(p.y));
      pad.receiveShadow = true;
      this.plotPadGroup.add(pad);
      // spoke road from the colony core to this plot, draped, ~0.8 wide
      const dx = p.x - lx,
        dy = p.y - ly;
      const steps = Math.max(1, Math.round(Math.hypot(dx, dy)));
      const nl = Math.hypot(dx, dy) || 1;
      const ox = (dy / nl) * 0.4,
        oy = (-dx / nl) * 0.4; // perpendicular half-width
      for (let s = 0; s < steps; s++) {
        const fx0 = lx + dx * (s / steps),
          fy0 = ly + dy * (s / steps);
        const fx1 = lx + dx * ((s + 1) / steps),
          fy1 = ly + dy * ((s + 1) / steps);
        if (
          t.isWater(Math.round(fx0), Math.round(fy0)) ||
          t.isWater(Math.round(fx1), Math.round(fy1))
        )
          continue; // a road never paves over open water — it breaks at the shore (ground units obey the physics of the world)
        const h0 =
          Math.max(0, t.worldY(Math.round(fx0), Math.round(fy0))) + 0.06;
        const h1 =
          Math.max(0, t.worldY(Math.round(fx1), Math.round(fy1))) + 0.06;
        quad(
          [this.wx(fx0) + ox, h0, this.wz(fy0) + oy],
          [this.wx(fx0) - ox, h0, this.wz(fy0) - oy],
          [this.wx(fx1) + ox, h1, this.wz(fy1) + oy],
          [this.wx(fx1) - ox, h1, this.wz(fy1) - oy],
        );
      }
    }
    if (surf.length) {
      const sg = new THREE.BufferGeometry();
      sg.setAttribute("position", new THREE.Float32BufferAttribute(surf, 3));
      sg.computeVertexNormals();
      const spoke = new THREE.Mesh(
        sg,
        new THREE.MeshStandardMaterial({
          color: 0x2b2b30,
          roughness: 0.95,
          side: THREE.DoubleSide,
        }),
      );
      spoke.frustumCulled = false;
      this.plotPadGroup.add(spoke);
    }
  }

  private buildHouseMesh(h: HouseSpec): THREE.Object3D {
    const g = new THREE.Group();
    const wallMat = new THREE.MeshStandardMaterial({
      color: h.wallColor,
      roughness: 0.82,
    });
    const roofMat = new THREE.MeshStandardMaterial({
      color: h.roofColor,
      roughness: 0.7,
    });
    const bodyH = h.floors * h.storeyH;
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(h.w, bodyH, h.d),
      wallMat,
    );
    body.position.y = bodyH / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);
    if (h.wing) {
      const wing = new THREE.Mesh(
        new THREE.BoxGeometry(h.w * 0.55, bodyH * 0.8, h.d * 0.6),
        wallMat,
      );
      wing.position.set(h.w * 0.5, bodyH * 0.4, h.d * 0.18);
      wing.castShadow = true;
      g.add(wing);
    }
    if (h.roof === "flat") {
      const r = new THREE.Mesh(
        new THREE.BoxGeometry(h.w * 1.06, 0.08, h.d * 1.06),
        roofMat,
      );
      r.position.y = bodyH + 0.04;
      g.add(r);
    } else {
      const rad = Math.max(h.w, h.d) * 0.72;
      const ph = Math.max(0.18, h.roofPitch * rad);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(rad, ph, 4), roofMat);
      cone.rotation.y = Math.PI / 4;
      cone.position.y = bodyH + ph / 2;
      if (h.roof === "gable") cone.scale.set(0.78, 1, 1.3);
      cone.castShadow = true;
      g.add(cone);
    }
    if (h.chimney) {
      const ch = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.42, 0.1),
        new THREE.MeshStandardMaterial({ color: 0x6a5a4a }),
      );
      ch.position.set(h.w * 0.28, bodyH + 0.28, h.d * 0.18);
      g.add(ch);
    }
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.3, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x4a3b2a }),
    );
    door.position.set(0, 0.15, h.d / 2 + 0.01);
    g.add(door);
    if (h.porch) {
      const porch = new THREE.Mesh(
        new THREE.BoxGeometry(h.w * 0.7, 0.05, 0.28),
        roofMat,
      );
      porch.position.set(0, Math.min(bodyH, 0.45), h.d / 2 + 0.12);
      g.add(porch);
    }
    return g;
  }

  private smoothRoadY(x: number, y: number): number {
    const t = this.sim.state.terrain;
    const cl = (v: number) => Math.max(0, Math.min(t.size - 1, v));
    // BILINEAR terrain sample at a CONTINUOUS position — the key to a smooth road. Sampling rounded
    // integer cells made the height a step function (flat within a cell, a riser at every boundary), so
    // on any slope the road terraced into little stairs (the operator's "stepways"). Interpolating gives
    // a height that varies continuously with position, so the surface ramps instead of stepping.
    const bil = (fx: number, fy: number): number => {
      const x0 = Math.floor(fx),
        y0 = Math.floor(fy),
        tx = fx - x0,
        ty = fy - y0;
      const a = t.worldY(cl(x0), cl(y0)),
        b = t.worldY(cl(x0 + 1), cl(y0));
      const c = t.worldY(cl(x0), cl(y0 + 1)),
        d = t.worldY(cl(x0 + 1), cl(y0 + 1));
      return (
        a * (1 - tx) * (1 - ty) +
        b * tx * (1 - ty) +
        c * (1 - tx) * ty +
        d * tx * ty
      );
    };
    // Still take the MAX over the ~4-wide carriageway footprint so the surface rides ABOVE the ground
    // (no terrain poking up through the asphalt). Because the samples are bilinear and the centre moves
    // continuously, this max is a continuous (step-free) function — smooth AND above-terrain.
    let mx = 0;
    for (let dx = -2; dx <= 2; dx += 0.5)
      for (let dy = -2; dy <= 2; dy += 0.5) {
        const h = bil(x + dx, y + dy);
        if (h > mx) mx = h;
      }
    return mx;
  }

  /** Smooth ground height (bilinear terrain) for things that should FOLLOW the grade, not ride above it
   *  like a road — e.g. homestead pads. Kept separate from smoothRoadY (which maxes over the carriageway
   *  to clear the asphalt) so a pad never floats up on the road-clearance height. */
  private groundY(x: number, y: number): number {
    const t = this.sim.state.terrain;
    const cl = (v: number) => Math.max(0, Math.min(t.size - 1, v));
    const x0 = Math.floor(x),
      y0 = Math.floor(y),
      tx = x - x0,
      ty = y - y0;
    const a = t.worldY(cl(x0), cl(y0)),
      b = t.worldY(cl(x0 + 1), cl(y0));
    const c = t.worldY(cl(x0), cl(y0 + 1)),
      d = t.worldY(cl(x0 + 1), cl(y0 + 1));
    return Math.max(
      0,
      a * (1 - tx) * (1 - ty) +
        b * tx * (1 - ty) +
        c * (1 - tx) * ty +
        d * tx * ty,
    );
  }

  /** Spec 088 — the height of the WALKABLE surface at a cell: the road ribbon top when it's a road cell,
   *  otherwise the bare terrain. Citizens (incl. Joe), the first-person eye and props stand on this, so
   *  nobody sinks under the raised road ribbon when they're on a road. */
  private surfaceY(x: number, y: number): number {
    const rx = Math.round(x),
      ry = Math.round(y);
    // Raise to the ribbon top ONLY where the ribbon actually is (the trunk + carriage roads), so a
    // citizen stands ON the road surface and never sinks under it — and never floats on a road cell the
    // ribbon doesn't reach (the per-cell gap-fill fragments are negligible disconnected stubs).
    if (this.roadRibbonCells?.has(`${rx},${ry}`))
      return Math.max(0, this.smoothRoadY(x, y)) + ROAD_RIBBON_LIFT;
    // Spec 093 — a cell under a house footprint is VISUALLY cut to the house's flat pad, so anything that
    // stands on the ground there (a citizen home inside the house, a lamp post) must stand on the pad too,
    // not at the natural worldY it would otherwise float above. Sim worldY is unchanged; this is purely
    // where the renderer plants things on the visible surface.
    const lvl = this.terrainLevel.get(ry * this.sim.state.terrain.size + rx);
    if (lvl !== undefined) return Math.max(0, lvl);
    return Math.max(0, this.sim.state.terrain.worldY(rx, ry));
  }

  // Spec 088 — roads render ENTIRELY as the smooth RIBBON (setRoadWays / buildRoadRibbons). The old
  // per-cell quad surface is retired: an axis-aligned square per cell can never be smooth, so any road
  // cell the ribbon's smoothed centre-line didn't cover read as a jagged STAIRCASE fringe beside the
  // smooth band — exactly the look the operator rejected ("wow those corners", the gap-fill experiment).
  // The ribbon alone reads as clean, continuous roads with lane lines. The road DATA (s.roads/roadKind)
  // is untouched, so traffic, the bus and the rally still drive the cells underneath. This just empties
  // the legacy per-cell meshes (kept so the scene graph + materials stay stable across a road change).
  private rebuildRoads() {
    const empty = (mesh: THREE.Mesh) => {
      const geo = mesh.geometry as THREE.BufferGeometry;
      geo.setAttribute("position", new THREE.Float32BufferAttribute([], 3));
      geo.computeVertexNormals();
    };
    for (const m of [
      this.roadSurfaceMesh,
      this.roadShoulderMesh,
      this.roadLineMesh,
      this.avenueSurfaceMesh,
      this.avenueKerbMesh,
    ])
      empty(m);
  }

  private updateColonyLayer() {
    const s = this.sim.state;
    const t = s.terrain;
    if (s.settlers.length !== this.lastSettlerCount) {
      this.rebuildSettlerHomes();
      this.lastSettlerCount = s.settlers.length;
    }
    // roads drape on the terrain; rebuild the ribbon on ANY network mutation (spec 084 S1 — a
    // length check missed equal-length purge-then-lay mutations and drew roads that were gone)
    if (s.roadsVersion !== this.lastRoadsVersion) {
      this.rebuildRoads();
      this.lastRoadsVersion = s.roadsVersion;
    }
    // as the cleared footprint (roads + buildings + worksites) changes, re-clear the trees from it and refresh the
    // pavement the ambient pedestrians stroll along.
    const folSig =
      s.roads.length * 100003 +
      s.buildings.length * 101 +
      s.jobs.length +
      (s.cityPlan ? s.cityPlan.plots.length * 7 : 0);
    if (folSig !== this.lastFoliageSig) {
      this.buildFoliage();
      this.roadCells = s.roads.map((r) => ({ x: r.x, y: r.y }));
      this.lastFoliageSig = folSig;
    }
    const rn = s.roads.length;
    // plot markers reflect allocation changes (allocated → dim flag, lowered pole)
    if (s.cityPlan) {
      this.syncPlotMarkers(s.cityPlan.plots);
      this.buildPlotPads(s.cityPlan.plots); // sized foundations + spoke roads to the marked plots
    }

    const col = new THREE.Color();
    const cap = COLONY.build.maxBuildings + 8;
    // Spec 011 — when the liveability overlay is on AND a survey office is up, tint homes by wellbeing.
    const liveOn = this.liveabilityOn && surveyAvailable(s);
    let bi = 0;
    for (const b of s.buildings) {
      if (bi >= cap) break;
      this.dummy.position.set(
        this.wx(b.x),
        Math.max(0, t.worldY(b.x, b.y)),
        this.wz(b.y),
      );
      this.dummy.scale.set(1, Math.max(0.15, b.artifact.height), 1);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.updateMatrix();
      this.bldgMesh.setMatrixAt(bi, this.dummy.matrix);
      if (liveOn && b.artifact.kind === "habitat")
        col.setHex(liveabilityTint(homeLiveability(s, b)));
      else col.setHex(b.artifact.color);
      this.bldgMesh.setColorAt(bi, col);
      bi++;
    }
    const car = s.structures.find((st) => st.kind === "caravan")!;
    let ci = 0;
    for (const j of s.jobs) {
      if (bi < cap) {
        const phase = Math.max(0, (j.progress - 0.25) / 0.75); // rises only after the crew arrives
        this.dummy.position.set(
          this.wx(j.x),
          Math.max(0, t.worldY(j.x, j.y)),
          this.wz(j.y),
        );
        this.dummy.scale.set(1, Math.max(0.04, j.artifact.height * phase), 1);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.updateMatrix();
        this.bldgMesh.setMatrixAt(bi, this.dummy.matrix);
        col.setHex(j.artifact.color).multiplyScalar(0.55); // under construction = darker
        this.bldgMesh.setColorAt(bi, col);
        bi++;
      }
      // crew truck drives caravan -> site ALONG THE ROADS over the first quarter, then parks
      if (ci < cap) {
        const drive = Math.min(1, j.progress / 0.25);
        let cx: number, cy: number, heading: number;
        const path = j.path;
        if (path && path.length > 0) {
          const W = t.size;
          const fpos = drive * path.length;
          const i0 = Math.min(path.length - 1, Math.floor(fpos));
          const a = path[i0]!;
          const b = path[Math.min(path.length - 1, i0 + 1)]!;
          const frac = fpos - i0;
          const ax = (a % W) + 0.5,
            ay = ((a / W) | 0) + 0.5;
          const bx = (b % W) + 0.5,
            by = ((b / W) | 0) + 0.5;
          cx = ax + (bx - ax) * frac;
          cy = ay + (by - ay) * frac;
          heading =
            Math.hypot(bx - ax, by - ay) > 1e-4
              ? Math.atan2(by - ay, bx - ax)
              : 0;
        } else {
          cx = car.x + (j.x - car.x) * drive;
          cy = car.y + (j.y - car.y) * drive;
          heading = Math.atan2(j.y - car.y, j.x - car.x);
        }
        this.dummy.position.set(
          this.wx(cx),
          this.smoothRoadY(cx, cy) + 0.18,
          this.wz(cy),
        );
        this.dummy.scale.set(1, 1, 1);
        this.dummy.rotation.set(0, -heading, 0);
        this.dummy.updateMatrix();
        this.crewMesh.setMatrixAt(ci, this.dummy.matrix);
        ci++;
      }
    }
    this.bldgMesh.count = bi;
    this.bldgMesh.instanceMatrix.needsUpdate = true;
    if (this.bldgMesh.instanceColor)
      this.bldgMesh.instanceColor.needsUpdate = true;
    this.crewMesh.count = ci;
    this.crewMesh.instanceMatrix.needsUpdate = true;

    // street lights at grid intersections (where both road lines cross). Stand each on the VERGE beside
    // the road, never on the carriageway: search outward for the nearest cell the road ribbon does NOT
    // cover and plant the lamp there at ground height (surfaceY). The old code put it on the road cell at
    // smoothRoadY — on the asphalt and 0.18 below the ribbon top, so the pole speared up through the road.
    const B = COLONY.build.block;
    const g = gridOrigin(s);
    const ribbon = this.roadRibbonCells;
    const onRibbon = (x: number, y: number) =>
      !!ribbon && ribbon.has(`${x},${y}`);
    let li = 0;
    for (let i = 0; i < rn; i++) {
      if (li >= 360) break;
      const r = s.roads[i]!;
      if (
        (((r.x - g.x) % B) + B) % B !== 0 ||
        (((r.y - g.y) % B) + B) % B !== 0
      )
        continue;
      // nearest off-ribbon cell within a short reach; skip the lamp entirely if hemmed in by road
      let lx = r.x,
        ly = r.y,
        found = false;
      for (let rad = 1; rad <= 3 && !found; rad++) {
        for (let dx = -rad; dx <= rad && !found; dx++)
          for (let dy = -rad; dy <= rad; dy++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue; // walk the ring at this radius
            if (!onRibbon(r.x + dx, r.y + dy)) {
              lx = r.x + dx;
              ly = r.y + dy;
              found = true;
              break;
            }
          }
      }
      if (!found) continue;
      this.dummy.position.set(this.wx(lx), this.surfaceY(lx, ly), this.wz(ly));
      this.dummy.scale.set(1, 1, 1);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.updateMatrix();
      this.streetPostMesh.setMatrixAt(li, this.dummy.matrix);
      this.streetHeadMesh.setMatrixAt(li, this.dummy.matrix);
      li++;
    }
    this.streetPostMesh.count = li;
    this.streetHeadMesh.count = li;
    this.streetPostMesh.instanceMatrix.needsUpdate = true;
    this.streetHeadMesh.instanceMatrix.needsUpdate = true;

    // cars — South African rules: keep LEFT. Driver's-left of heading h is (sin h, -cos h)
    // in lot coords, so a car heading south (+y) sits on the east (+x) side, i.e. its left.
    // The sim ticks at 6 Hz; we exponentially smooth each car's position + heading toward the
    // sim state every frame so motion is fluid at 60 fps and turns (with the lane offset) ease
    // instead of snapping a car sideways across the road at every corner.
    const carCol = new THREE.Color();
    const off = COLONY.traffic.laneOffset;
    const cn = Math.min(s.cars.length, COLONY.traffic.maxCars + 4);
    this.carsMesh.count = cn;
    const carNow = performance.now();
    const carDt = this.lastCarT
      ? Math.min(0.05, (carNow - this.lastCarT) / 1000)
      : 1 / 60;
    this.lastCarT = carNow;
    const aPos = 1 - Math.exp(-carDt * 16); // position catch-up (fast, ~1 frame lag)
    const aHed = 1 - Math.exp(-carDt * 9); // heading ease (slower, smooth turns)
    const liveCars = new Set<number>();
    for (let i = 0; i < cn; i++) {
      const v = s.cars[i]!;
      liveCars.add(v.id);
      let e = this.carRender.get(v.id);
      if (!e) {
        e = { x: v.x, y: v.y, h: v.heading };
        this.carRender.set(v.id, e);
      }
      // A re-route can jump a car a long way; snap rather than glide it across the map.
      if (Math.hypot(v.x - e.x, v.y - e.y) > 3) {
        e.x = v.x;
        e.y = v.y;
        e.h = v.heading;
      }
      e.x += (v.x - e.x) * aPos;
      e.y += (v.y - e.y) * aPos;
      let dh = v.heading - e.h;
      dh -= Math.round(dh / (Math.PI * 2)) * (Math.PI * 2); // wrap to [-PI, PI]
      e.h += dh * aHed;
      const lx = e.x + Math.sin(e.h) * off;
      const ly = e.y - Math.cos(e.h) * off;
      this.dummy.position.set(
        this.wx(lx),
        this.smoothRoadY(e.x, e.y) + 0.12,
        this.wz(ly),
      );
      this.dummy.rotation.set(0, -e.h, 0);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      this.carsMesh.setMatrixAt(i, this.dummy.matrix);
      carCol.setHex(v.color);
      this.carsMesh.setColorAt(i, carCol);
    }
    // Drop smoothing state for any car that is no longer present.
    if (this.carRender.size > cn) {
      for (const id of this.carRender.keys())
        if (!liveCars.has(id)) this.carRender.delete(id);
    }
    this.carsMesh.instanceMatrix.needsUpdate = true;
    if (this.carsMesh.instanceColor)
      this.carsMesh.instanceColor.needsUpdate = true;

    // day/night emissive: lamps glow and building windows light up after dark
    const night = 1 - s.clock.daylight;
    (
      this.streetHeadMesh.material as THREE.MeshStandardMaterial
    ).emissiveIntensity = 0.2 + night * 1.4;
    const bmat = this.bldgMesh.material as THREE.MeshStandardMaterial;
    bmat.emissive.setHex(0xffd9a0);
    bmat.emissiveIntensity = night * 0.4;
    // Cars glow softly after dark so night traffic reads as moving lights flowing along the roads.
    const cmat = this.carsMesh.material as THREE.MeshStandardMaterial;
    cmat.emissive.setHex(0xfff0d0);
    cmat.emissiveIntensity = night * 0.5;
    // Spec 079 — the commercial signage glows day and night, and flares brighter after dark so the
    // market strip becomes the lit heart of the city at dusk (the concept-art look).
    this.commercialLabelNight = night;
    for (const sm of this.commercialSignMats)
      sm.emissiveIntensity = 0.7 + night * 0.9;
    if (this.commercialMallFloorMat)
      this.commercialMallFloorMat.emissiveIntensity =
        mallAnchorNightFloorEmissive(s.clock.daylight);
    for (const fm of this.commercialGarageFloorMats)
      fm.emissiveIntensity = garageAnchorNightFloorEmissive(s.clock.daylight);
    for (const fm of this.commercialFloorMats)
      fm.emissiveIntensity = commercialShopNightFloorEmissive(s.clock.daylight);
    this.applyCommercialLabelVisibility();
  }

  frame() {
    if (this.disposed) return;
    this.updateDayNight();
    this.updateCommercialBusinessLabels();
    // Spec 084 S5 — staged terrain recolor: at most 8 dirty chunks repaint per frame.
    this.chunkedTerrain.recolor(
      (i, out) => this.colorFor(this.view, i, out),
      8,
    );
    this.updateColonyLayer();
    this.updatePedestrians();
    this.updateTarentaal();
    this.updateArtifacts();
    this.updatePorters(); // spec 073 — goods piled at the sheds + porter carts on the roads
    this.updateAvatars(); // P1 — the named citizen avatars at their live roster positions
    this.updateNeighborhood(); // spec 075 — lot pads + voxel homes
    if (this.beaconMat) {
      const blink = Math.max(0, Math.sin((performance.now() / 1000) * 2.4));
      this.beaconMat.emissiveIntensity = 0.35 + blink * blink * 2.6;
    }
    this.shoreProps?.update(this.sim.state.clock.daylight, performance.now());
    this.venueProps?.update(this.sim.state.clock.daylight, performance.now());
    this.gltfProps?.update(this.sim.state.clock.daylight);
    if (this.raceLayer && this.raceState)
      this.raceLayer.update(this.raceState, performance.now());
    this.busLayer?.update(performance.now()); // spec 088 — the bus drives its loop between the hoods
    this.updateOcean(performance.now()); // spec 090 — gentle swells roll across the living sea
    this.foam?.update(performance.now()); // spec 091 — the shoreline surf breathes
    const fsh = this.foliageWindMat?.userData.shader as
      | { uniforms: { uTime: { value: number } } }
      | undefined;
    if (fsh) fsh.uniforms.uTime.value = performance.now() / 1000; // spec 092 — trees sway in the wind
    this.clouds?.update(performance.now()); // spec 092 — clouds drift across the sky
    this.ambient?.update(performance.now()); // spec 092 — gulls glide over the sea
    if (this.fpCitizenId && this.avatarSource) {
      // P1 — first-person: park the camera at the citizen's eye and look down their heading. OrbitControls is off.
      const a = this.avatarSource().find((x) => x.id === this.fpCitizenId);
      if (a) {
        const isCrab = a.kind === "crab"; // spec 078 — Joe sees the world from down at crab height
        // stand the eye on the road SURFACE when on a road, so Joe is never looking up through the road
        const eye = this.surfaceY(a.x, a.y) + (isCrab ? CRAB_EYE : 1.6);
        this.camera.position.set(this.wx(a.x), eye, this.wz(a.y));
        const lookPitch = a.lookPitch ?? 0;
        const horizontal = Math.cos(lookPitch) * 4;
        const lx = a.x + Math.cos(a.heading) * horizontal,
          ly = a.y + Math.sin(a.heading) * horizontal;
        const lyW =
          this.surfaceY(lx, ly) +
          (isCrab ? CRAB_EYE - 0.05 : 1.2) +
          Math.sin(lookPitch) * 4;
        this.camera.lookAt(this.wx(lx), lyW, this.wz(ly));
        this.camera.updateMatrixWorld();
      } else {
        this.exitFirstPerson(); // the citizen vanished — fall back to orbit
      }
    } else if (this.raceCamActive && this.raceState) {
      this.updateRaceCamera();
    } else {
      if (this.cinematic) this.updateCinematic();
      this.controls.update();
    }
    this.composer.render();
  }

  setRaceState(race: RaceState | null): void {
    if (!race || race.mode === "idle") {
      this.clearRaceLayer();
      this.raceState = null;
      this.raceCamActive = false;
      this.raceRestorePending = false;
      if (!this.fpCitizenId) {
        this.controls.enabled = true;
        this.applyPreset("district");
      }
      return;
    }
    if (!this.raceLayer || this.raceState?.track !== race.track) {
      this.clearRaceLayer();
      this.raceLayer = buildRaceLayer({
        terrain: this.sim.state.terrain,
        track: race.track,
        wx: (x) => this.wx(x),
        wz: (y) => this.wz(y),
        roadSurfaceY: (x, y) => this.surfaceY(x, y),
      });
      if (this.raceLayer) this.scene.add(this.raceLayer.group);
    }
    this.raceState = race;
    this.raceCamActive = race.mode === "countdown" || race.mode === "running";
    this.controls.enabled = !this.raceCamActive && !this.fpCitizenId;
    if (this.raceCamActive) this.raceRestorePending = false;
    if (race.mode === "finished" && !this.raceRestorePending) {
      this.raceRestorePending = true;
      this.applyPreset("district");
    }
  }

  private clearRaceLayer(): void {
    this.raceLayer?.dispose();
    this.raceLayer = null;
  }

  private updateRaceCamera(): void {
    const race = this.raceState;
    if (!race) return;
    const t = this.sim.state.terrain;
    const c = race.car;
    const ground = Math.max(0, t.worldY(Math.round(c.x), Math.round(c.y)));
    const target = new THREE.Vector3(this.wx(c.x), ground + 0.7, this.wz(c.y));
    const behind = new THREE.Vector3(
      this.wx(c.x - Math.cos(c.heading) * 7.5),
      ground + 5.8 + Math.min(3.5, Math.abs(c.speed) * 0.25),
      this.wz(c.y - Math.sin(c.heading) * 7.5),
    );
    this.camera.position.lerp(behind, 0.16);
    this.controls.target.lerp(target, 0.22);
    this.camera.lookAt(this.controls.target);
    this.camera.updateMatrixWorld();
  }

  /** Toggle the TV-mode cinematic fly-around. Camera slowly orbits + breathes around the landing
   *  site so the city + landscape become a moving postcard while music plays. */
  setCinematic(on: boolean): void {
    if (on === this.cinematic) return;
    this.cinematic = on;
    if (on) this.cinematicT0 = performance.now();
  }

  /** Render a fresh frame and return it as a PNG data URL — used by the HUD snapshot button. */
  capturePNG(): string {
    this.composer.render();
    return this.renderer.domElement.toDataURL("image/png");
  }

  /** Spec 074 — the citizen's VISION. Drop the camera to standing eye height (1.6) at the citizen's home cell, face the
   *  nearest road, render one frame, and return what they see as a PNG data URL. The live orbit pose is saved and restored,
   *  so the operator's view is untouched. This is the image the governor loop pairs with the bot's words to decide what the
   *  colony changes for the people who live in it. home + look are grid cells (the runtime resolves them from the roster). */
  firstPersonPNG(
    home: { x: number; y: number },
    look: { x: number; y: number },
  ): string {
    const t = this.sim.state.terrain;
    const savedPos = this.camera.position.clone();
    const savedTarget = this.controls.target.clone();
    const EYE = 1.6;
    const hy =
      Math.max(0, t.worldY(Math.round(home.x), Math.round(home.y))) + EYE;
    this.camera.position.set(this.wx(home.x), hy, this.wz(home.y));
    const ly =
      Math.max(0, t.worldY(Math.round(look.x), Math.round(look.y))) + 1.0; // look at head height down the street
    this.camera.lookAt(this.wx(look.x), ly, this.wz(look.y));
    this.camera.updateMatrixWorld();
    this.composer.render();
    const url = this.renderer.domElement.toDataURL("image/png");
    // restore the operator's orbit pose exactly
    this.camera.position.copy(savedPos);
    this.controls.target.copy(savedTarget);
    this.controls.update();
    this.composer.render();
    return url;
  }

  private pedOnLand(x: number, y: number): boolean {
    const t = this.sim.state.terrain;
    const ix = Math.round(x),
      iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= t.size || iy >= t.size) return false;
    return !t.isWater(ix, iy);
  }

  /** Pick a pedestrian's next stroll target: a nearby road cell (so they keep to the pavement), nudged a little to the
   *  kerb so they don't all walk the centre line. Falls back to a gentle wander near the landing before any streets exist. */
  private pickPedTarget(
    px: number,
    py: number,
    lx: number,
    ly: number,
  ): { x: number; y: number } {
    const rc = this.roadCells;
    if (rc.length) {
      let near = rc.filter((c) => {
        const dd = Math.hypot(c.x - px, c.y - py);
        return dd > 1.5 && dd < 16;
      });
      if (!near.length) near = rc;
      const c = near[(Math.random() * near.length) | 0]!;
      return {
        x: c.x + (Math.random() - 0.5) * 0.5,
        y: c.y + (Math.random() - 0.5) * 0.5,
      };
    }
    for (let tries = 0; tries < 8; tries++) {
      const ang =
        Math.atan2(ly - py, lx - px) + (Math.random() - 0.5) * Math.PI * 1.6;
      const step = 3 + Math.random() * 6;
      const nx = px + Math.cos(ang) * step;
      const ny = py + Math.sin(ang) * step;
      if (this.pedOnLand(nx, ny) && Math.hypot(nx - lx, ny - ly) < 18)
        return { x: nx, y: ny };
    }
    return { x: px, y: py };
  }

  /** Seed a POOL of figures on land near the landing; how many are actually shown tracks the real colonist count (see
   *  updatePedestrians), so the crowd is the colony's own people — not a fixed decorative droid army. */
  private initPedestrians() {
    const t = this.sim.state.terrain;
    const lx = t.landing.x,
      ly = t.landing.y;
    const PED_COLORS = [
      0xe06a4d, 0x4d8fe0, 0xe6c84d, 0x57b86a, 0xc9c2b6, 0xb47ad6,
    ];
    const col = new THREE.Color();
    this.peds = [];
    let guard = 0;
    while (this.peds.length < 28 && guard++ < 800) {
      const a = Math.random() * Math.PI * 2;
      const r = 2 + Math.random() * 14;
      const x = lx + Math.cos(a) * r;
      const y = ly + Math.sin(a) * r;
      if (!this.pedOnLand(x, y)) continue;
      this.peds.push({
        x,
        y,
        tx: x,
        ty: y,
        spd: 0.5 + Math.random() * 0.7,
        phase: Math.random() * Math.PI * 2,
      });
    }
    this.peds.forEach((_, idx) => {
      col.setHex(PED_COLORS[idx % PED_COLORS.length]!);
      this.pedMesh.setColorAt(idx, col);
    });
    this.pedMesh.count = this.peds.length;
    if (this.pedMesh.instanceColor)
      this.pedMesh.instanceColor.needsUpdate = true;
  }

  /** Per-frame: stroll each visible pedestrian toward a nearby land target. The visible count tracks the REAL colonist
   *  population (capped to the pool), so the streets are as busy as the colony actually is — these are its people. */
  private updatePedestrians() {
    if (!this.pedMesh || this.peds.length === 0) return;
    const t = this.sim.state.terrain;
    const lx = t.landing.x,
      ly = t.landing.y;
    const now = performance.now();
    const dt = this.lastPedT
      ? Math.min(0.05, (now - this.lastPedT) / 1000)
      : 1 / 60;
    this.lastPedT = now;
    const want = Math.max(
      0,
      Math.min(this.peds.length, Math.round(this.sim.state.colonists)),
    ); // one figure per real colonist
    for (let i = 0; i < want; i++) {
      const p = this.peds[i]!;
      let dx = p.tx - p.x,
        dy = p.ty - p.y;
      let d = Math.hypot(dx, dy);
      if (d < 0.4) {
        const next = this.pickPedTarget(p.x, p.y, lx, ly);
        p.tx = next.x;
        p.ty = next.y;
        dx = p.tx - p.x;
        dy = p.ty - p.y;
        d = Math.hypot(dx, dy);
      }
      if (d > 1e-3) {
        const move = Math.min(d, p.spd * dt);
        p.x += (dx / d) * move;
        p.y += (dy / d) * move;
        p.phase += dt * 8;
      }
      const heading = Math.atan2(dy, dx);
      const bob = Math.abs(Math.sin(p.phase)) * 0.05;
      const wy = Math.max(0, t.worldY(Math.round(p.x), Math.round(p.y)));
      this.dummy.position.set(this.wx(p.x), wy + bob, this.wz(p.y));
      this.dummy.rotation.set(0, -heading + Math.PI / 2, 0);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      this.pedMesh.setMatrixAt(i, this.dummy.matrix);
      this.pedHeadMesh.setMatrixAt(i, this.dummy.matrix); // the head rides the same transform, baked above the body
    }
    this.pedMesh.count = want;
    this.pedMesh.instanceMatrix.needsUpdate = true;
    this.pedHeadMesh.count = want;
    this.pedHeadMesh.instanceMatrix.needsUpdate = true;
  }

  /** The tarentaal are not renderer-only ambience: positions come from the deterministic ColonySim tick. */
  private updateTarentaal(): void {
    const birds = this.sim.state.tarentaal;
    let adultCount = 0;
    let chickCount = 0;
    for (const bird of birds) {
      const mesh =
        bird.age === "adult"
          ? this.tarentaalAdultMesh
          : this.tarentaalChickMesh;
      const idx = bird.age === "adult" ? adultCount++ : chickCount++;
      this.placeTarentaal(mesh, idx, bird);
    }
    this.tarentaalAdultMesh.count = adultCount;
    this.tarentaalChickMesh.count = chickCount;
    this.tarentaalAdultMesh.instanceMatrix.needsUpdate = true;
    this.tarentaalChickMesh.instanceMatrix.needsUpdate = true;
  }

  private placeTarentaal(
    mesh: THREE.InstancedMesh,
    idx: number,
    bird: TarentaalBird,
  ): void {
    const stride = bird.behavior === "chase" ? 1.18 : 1;
    const bob = bird.behavior === "chase" ? 0.035 : 0.01;
    this.dummy.position.set(
      this.wx(bird.x),
      this.surfaceY(bird.x, bird.y) + bob,
      this.wz(bird.y),
    );
    this.dummy.rotation.set(0, -bird.heading, 0);
    this.dummy.scale.set(stride, 1, stride);
    this.dummy.updateMatrix();
    mesh.setMatrixAt(idx, this.dummy.matrix);
  }

  /** Deterministic furniture / civic-art catalog instances come from ColonySim, not renderer randomness. */
  private updateArtifacts(): void {
    const { counts, renderable, unknown, overflow } =
      summarizeRenderableArtifacts(this.sim.state.artifacts, this.artifactCap);

    const placed: Record<ArtifactKind, number> = {
      bench: 0,
      lamppost: 0,
      planter: 0,
      fountain: 0,
      shade_tree: 0,
      notice_board: 0,
      wayfinder: 0,
    };
    for (const item of renderable) {
      const mesh = this.artifactMeshes[item.kind];
      const idx = placed[item.kind]++;
      this.placeArtifact(mesh, idx, item);
    }
    if ((unknown > 0 || overflow > 0) && import.meta.env.DEV) {
      console.warn(
        `[citylife] artifact render drop: ${unknown} unknown kinds + ${overflow} over cap DROPPED — renderer only draws the seeded prop catalog for now`,
      );
    }
    for (const [kind, mesh] of Object.entries(this.artifactMeshes) as [
      ArtifactKind,
      THREE.InstancedMesh,
    ][]) {
      mesh.count = counts[kind];
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private placeArtifact(
    mesh: THREE.InstancedMesh,
    idx: number,
    item: VisualArtifact,
  ): void {
    this.dummy.position.set(
      this.wx(item.x),
      this.surfaceY(item.x, item.y) + 0.015,
      this.wz(item.y),
    );
    this.dummy.rotation.set(0, -item.rot, 0);
    this.dummy.scale.set(item.footprint.w, 1, item.footprint.h);
    this.dummy.updateMatrix();
    mesh.setMatrixAt(idx, this.dummy.matrix);
  }

  /** P1 — the runtime supplies the live citizen avatar list (positions from the roster, decorated with isOperator). */
  setAvatarSource(fn: () => AvatarView[]): void {
    this.avatarSource = fn;
  }

  /** S3 — read-only rally presence from uiState.rally.presentCitizens. Until the car lane lands that
   *  additive field, callers pass an empty list and the renderer draws no social nameplates. */
  setRallyPresentCitizens(citizens: RallyPresentCitizenView[]): void {
    const safeCitizens = citizens.filter(
      (c) => isPublicSafe(c.id) && isPublicSafe(c.displayName),
    );
    this.rallyPresentCitizenIds = new Set(safeCitizens.map((c) => c.id));
    const wanted = new Map(safeCitizens.map((c) => [c.id, c.displayName]));
    for (const [id, plate] of [...this.rallyNameplates]) {
      if (!wanted.has(id)) this.disposeRallyNameplate(id, plate);
    }
    for (const [id, displayName] of wanted) {
      const plate = this.rallyNameplates.get(id);
      if (!plate)
        this.rallyNameplates.set(id, this.makeRallyNameplate(displayName));
      else if (plate.sprite.name !== displayName) {
        this.disposeRallyNameplate(id, plate);
        this.rallyNameplates.set(id, this.makeRallyNameplate(displayName));
      }
    }
  }

  /** Spec 075 — hand the renderer the neighbourhood (by reference); it draws the lot pads + voxel homes,
   *  rebuilding only when a lot's owned/built state changes. */
  setNeighborhood(n: Neighborhood): void {
    this.neighborhood = n;
    this.lastNbhdSig = ""; // force a rebuild on the next frame
    // Spec 093 — level/dry the terrain for the already-built founders NOW, during setup, so the terrain's
    // ONE boot build already carries their pads. Otherwise buildTerrain draws natural terrain and the
    // first frame's relevelTerrain rebuilds it, popping the founder pads in a frame late. Guarded on
    // terrainMat so it is a no-op if the terrain has not been built yet (the frame loop then handles it).
    if (this.terrainMat) this.relevelTerrain();
    // Re-clear foliage now that the homestead parcels (and the fully-built roadSet) are known, so no trees
    // remain on lots/houses/roads. Called once at setup, so the extra deterministic rebuild is cheap.
    this.buildFoliage();
  }

  /** Spec 079 P0 — hand the renderer the surveyed commercial district; it raises a neon market stall
   *  on every shop plot. Rebuilt once here (the survey is static for the world's lifetime). */
  setCommercialDistrict(d: CommercialDistrict | null | undefined): void {
    this.commercialDistrict = d ?? undefined;
    // Dry the commercial land FIRST (raises coastal shop pads clear of the sea), then build the shops
    // so they seat on the dried surface (buildCommercialDistrict reads surfaceY). Order matters: the
    // dried heights land in terrainLevel here, and the shop seat reads them on the next line.
    if (this.terrainMat) this.relevelTerrain();
    this.buildCommercialDistrict();
    this.buildFoliage(); // re-clear foliage so no trees stand on the commercial plots
  }

  /** Spec 088 — hand the renderer the road centre-lines; it lays a SMOOTH ribbon surface (Chaikin-
   *  smoothed, width-extruded, draped) along each, just above the per-cell road base so roads read as
   *  smooth instead of a per-cell staircase. Traffic/bus/rally still use the cell roads underneath. */
  setRoadWays(ways: RoadWay[] | null | undefined): void {
    if (this.roadRibbonGroup) {
      this.roadRibbonGroup.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mt = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mt)) mt.forEach((x) => x.dispose());
        else if (mt) mt.dispose();
      });
      this.roadRibbonGroup.parent?.remove(this.roadRibbonGroup);
      this.roadRibbonGroup = null;
    }
    this.roadRibbonCells = null;
    if (!ways || ways.length === 0) {
      if (this.terrainMat) this.relevelTerrain();
      return;
    }
    const built = buildRoadRibbons(ways, {
      terrain: this.sim.state.terrain,
      wx: (x) => this.wx(x),
      wz: (y) => this.wz(y),
      roadY: (x, y) => this.smoothRoadY(x, y),
    });
    this.roadRibbonGroup = built.group;
    this.roadRibbonCells = built.cells;
    this.scene.add(this.roadRibbonGroup);
    // Spec 095 — the ribbon cells just changed; regrade the ground up to the new road (render-only).
    if (this.terrainMat) this.relevelTerrain();
  }

  /** Spec 088 — hand the renderer the bus route; it raises the stop markers and a coach that drives the
   *  loop between the hoods (a render-loop vehicle, advanced on wall-clock dt, not the sim). */
  setBusRoute(route: BusRoute | null | undefined): void {
    this.busLayer?.dispose();
    this.busLayer = null;
    if (!route) return;
    this.busLayer = buildBusLayer({
      terrain: this.sim.state.terrain,
      route,
      wx: (x) => this.wx(x),
      wz: (y) => this.wz(y),
      roadY: (x, y) => this.smoothRoadY(x, y),
    });
    if (this.busLayer) this.scene.add(this.busLayer.group);
  }

  private operatorCarGroup: THREE.Group | null = null;

  /** Spec 096 — park the signed-in player's car in the world (the land-next-to-your-car vision). Rebuilt
   *  on change (operator set, parts mounted or unmounted); null clears it. Render-only, additive. */
  setOperatorCar(
    spec: CarSpec | null,
    cell: { x: number; y: number } | null,
  ): void {
    if (this.operatorCarGroup) {
      this.operatorCarGroup.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else if (mat) mat.dispose();
      });
      this.scene.remove(this.operatorCarGroup);
      this.operatorCarGroup = null;
    }
    if (!spec || !cell) return;
    const g = buildCarMesh(spec);
    g.position.set(
      this.wx(cell.x),
      this.surfaceY(cell.x, cell.y),
      this.wz(cell.y),
    );
    this.operatorCarGroup = g;
    this.scene.add(g);
  }

  // The neon palette for the strip — saturated signage that pops against the calm residential teal.
  private static readonly NEON = [
    0xff2d95, 0x18e0ff, 0xffc233, 0x7bff4d, 0xb24dff, 0xff6a3d,
  ];

  /** Spec 106 — turn the reserved mallPad into the first visible anchor: a deterministic flat-roofed
   * shell seated on the dried commercial surface, with a night-emissive plaza/floor slab. */
  private buildMallAnchorShell(d: CommercialDistrict): void {
    const model = buildMallAnchorShellModel(d.mallPad, (x, y) =>
      this.surfaceY(x, y),
    );
    const g = new THREE.Group();
    g.name = "commercialDistrict.mallPad.mallAnchorShell";
    g.userData.kind = model.kind;
    g.position.set(
      this.wx(model.center.x),
      model.baseY,
      this.wz(model.center.y),
    );

    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x1b2938,
      roughness: 0.58,
      metalness: 0.05,
      emissive: 0x31d6ff,
      emissiveIntensity: model.nightFloor.emissiveIntensity.day,
      transparent: true,
      opacity: 0.82,
    });
    this.commercialMallFloorMat = floorMat;
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(model.nightFloor.w, 0.05, model.nightFloor.d),
      floorMat,
    );
    floor.name = "mallAnchorNightFloor";
    floor.position.y = model.nightFloor.y;
    floor.receiveShadow = true;

    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x465169,
      roughness: 0.72,
      metalness: 0.08,
      emissive: 0x102040,
      emissiveIntensity: 0.08,
    });
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(model.body.w, model.body.h, model.body.d),
      wallMat,
    );
    body.name = "mallAnchorMainBody";
    body.position.y = model.body.y;
    body.castShadow = true;
    body.receiveShadow = true;

    const wingMat = new THREE.MeshStandardMaterial({
      color: 0x384258,
      roughness: 0.76,
      metalness: 0.06,
    });
    for (const sx of [-1, 1]) {
      const wing = new THREE.Mesh(
        new THREE.BoxGeometry(model.wing.w, model.wing.h, model.wing.d),
        wingMat,
      );
      wing.name = sx < 0 ? "mallAnchorWestWing" : "mallAnchorEastWing";
      wing.position.set(sx * model.wing.xOffset, model.wing.y, 0.2);
      wing.castShadow = true;
      wing.receiveShadow = true;
      g.add(wing);
    }

    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(model.roof.w, model.roof.h, model.roof.d),
      new THREE.MeshStandardMaterial({
        color: 0x202633,
        roughness: 0.84,
        metalness: 0.04,
      }),
    );
    roof.name = "mallAnchorFlatRoof";
    roof.position.y = model.roof.y;
    roof.castShadow = true;

    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x8bdcff,
      roughness: 0.24,
      metalness: 0.15,
      emissive: 0x5ed7ff,
      emissiveIntensity: 0.42,
    });
    for (const sx of [-model.body.w * 0.24, 0, model.body.w * 0.24]) {
      const pane = new THREE.Mesh(
        new THREE.BoxGeometry(model.body.w * 0.18, model.body.h * 0.45, 0.06),
        glassMat,
      );
      pane.name = "mallAnchorStorefrontPane";
      pane.position.set(sx, model.body.h * 0.46, -model.body.d / 2 - 0.035);
      g.add(pane);
    }

    const canopy = new THREE.Mesh(
      new THREE.BoxGeometry(
        model.entranceCanopy.w,
        model.entranceCanopy.h,
        model.entranceCanopy.d,
      ),
      new THREE.MeshStandardMaterial({
        color: 0x31d6ff,
        emissive: 0x31d6ff,
        emissiveIntensity: 0.62,
        roughness: 0.35,
      }),
    );
    canopy.name = "mallAnchorEntranceCanopy";
    canopy.position.set(
      0,
      model.entranceCanopy.y,
      model.entranceCanopy.zOffset,
    );
    canopy.castShadow = true;

    g.add(floor, body, roof, canopy);
    this.commercialGroup.add(g);
  }

  private buildGarageAnchorShell(d: CommercialDistrict): void {
    if (!d.garagePad) return;
    const model = buildGarageAnchorShellModel(d.garagePad, (x, y) =>
      this.surfaceY(x, y),
    );
    const g = new THREE.Group();
    g.name = "commercialDistrict.garagePad.garageAnchorShell";
    g.userData = {
      kind: model.kind,
      publicName: model.publicName,
      isPublicSafe: model.isPublicSafe,
      facingAngle: model.facingAngle,
      roadTarget: d.garagePad.roadTarget,
    };
    g.position.set(
      this.wx(model.center.x),
      model.baseY,
      this.wz(model.center.y),
    );
    g.rotation.y = model.facingAngle;

    const floorMat = new THREE.MeshStandardMaterial({
      color: 0xffb24a,
      emissive: 0xff9f2f,
      emissiveIntensity: garageAnchorNightFloorEmissive(
        this.sim.state.clock.daylight,
      ),
      roughness: 0.52,
      transparent: true,
      opacity: 0.54,
    });
    this.commercialGarageFloorMats.push(floorMat);
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(model.nightFloor.w, 0.04, model.nightFloor.d),
      floorMat,
    );
    floor.name = "garageAnchorNightFloor";
    floor.position.y = model.nightFloor.y;

    const forecourtMat = new THREE.MeshStandardMaterial({
      color: 0x4c5262,
      roughness: 0.68,
      metalness: 0.02,
      emissive: 0xff9f2f,
      emissiveIntensity:
        garageAnchorNightFloorEmissive(this.sim.state.clock.daylight) * 0.58,
    });
    this.commercialGarageFloorMats.push(forecourtMat);
    const forecourt = new THREE.Mesh(
      new THREE.BoxGeometry(model.forecourt.w, 0.035, model.forecourt.d),
      forecourtMat,
    );
    forecourt.name = "garageAnchorRoadFacingForecourt";
    forecourt.position.set(0, model.forecourt.y, model.forecourt.frontOffset);
    forecourt.receiveShadow = true;

    const forecourtLane = new THREE.Group();
    forecourtLane.name = "garageAnchorForecourtWarmLaneStrips";
    const laneMat = new THREE.MeshStandardMaterial({
      color: 0xffcf74,
      emissive: 0xffa13a,
      emissiveIntensity: 0.58,
      roughness: 0.34,
    });
    for (const x of [-model.forecourt.w * 0.22, model.forecourt.w * 0.22]) {
      const lane = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.035, model.forecourt.d * 0.82),
        laneMat,
      );
      lane.name = `garageAnchorForecourtWarmLaneStrip.${x < 0 ? "left" : "right"}`;
      lane.position.set(
        x,
        model.forecourt.y + 0.03,
        model.forecourt.frontOffset,
      );
      forecourtLane.add(lane);
    }

    const showroom = new THREE.Mesh(
      new THREE.BoxGeometry(
        model.showroom.w,
        model.showroom.h,
        model.showroom.d,
      ),
      new THREE.MeshStandardMaterial({
        // Spec 109/110 — COOL glazing (not a warm frosted cube): low-opacity blue-teal glass with a
        // metallic sheen reads against the warm sign/forecourt for material contrast, and the dark
        // interior box below gives it depth so it reads as glass with a lit showroom behind it.
        color: 0x8fd2e6,
        roughness: 0.05,
        metalness: 0.28,
        emissive: 0x123642,
        emissiveIntensity: 0.16,
        transparent: true,
        opacity: 0.38,
      }),
    );
    showroom.name = "garageAnchorGlassShowroom";
    showroom.position.set(model.showroom.x, model.showroom.y, model.showroom.z);
    showroom.castShadow = true;
    showroom.receiveShadow = true;

    // Dark lit interior behind the glass so the showroom reads as glazing with depth (not a frosted
    // cube). Warm interior glow at night via the night-floor emissive helper.
    const showroomInteriorMat = new THREE.MeshStandardMaterial({
      color: 0x14202c,
      roughness: 0.85,
      emissive: 0x3a2a12,
      emissiveIntensity: 0.12,
    });
    const showroomInterior = new THREE.Mesh(
      new THREE.BoxGeometry(
        model.showroom.w * 0.9,
        model.showroom.h * 0.86,
        model.showroom.d * 0.9,
      ),
      showroomInteriorMat,
    );
    showroomInterior.name = "garageAnchorShowroomInterior";
    showroomInterior.position.set(
      model.showroom.x,
      model.showroom.y * 0.96,
      model.showroom.z,
    );

    const showroomFront = new THREE.Mesh(
      new THREE.BoxGeometry(
        model.showroom.w * 0.84,
        model.showroom.h * 0.58,
        0.08,
      ),
      new THREE.MeshStandardMaterial({
        color: 0xffd3a0,
        roughness: 0.08,
        metalness: 0.04,
        emissive: 0xffb24a,
        emissiveIntensity: 0.58,
        transparent: true,
        opacity: 0.8,
      }),
    );
    showroomFront.name = "garageAnchorGlassShowroomFront";
    showroomFront.position.set(
      model.showroom.x,
      model.showroom.h * 0.54,
      model.showroom.z + model.showroom.d / 2 + 0.06,
    );

    const showroomHeader = new THREE.Mesh(
      new THREE.BoxGeometry(model.showroom.w * 0.9, 0.32, 0.14),
      new THREE.MeshStandardMaterial({
        color: 0xffb24a,
        emissive: 0xff8f2f,
        emissiveIntensity: 0.65,
        roughness: 0.36,
      }),
    );
    showroomHeader.name = "garageAnchorShowroomHeaderSign";
    showroomHeader.position.set(
      model.showroom.x,
      model.showroom.h + 0.12,
      model.showroom.z + model.showroom.d / 2 + 0.08,
    );

    const showroomCarSilhouette = new THREE.Group();
    showroomCarSilhouette.name = "garageAnchorShowroomFrontCarSilhouette";
    showroomCarSilhouette.position.set(
      model.showroom.x,
      model.showroom.h * 0.43,
      model.showroom.z + model.showroom.d / 2 + 0.13,
    );
    const silhouetteMat = new THREE.MeshStandardMaterial({
      color: 0x6fe7ff,
      emissive: 0x35d8ff,
      emissiveIntensity: 0.78,
      roughness: 0.18,
      transparent: true,
      opacity: 0.88,
    });
    const silhouetteBody = new THREE.Mesh(
      new THREE.BoxGeometry(model.showroom.w * 0.44, 0.13, 0.04),
      silhouetteMat,
    );
    silhouetteBody.name = "garageAnchorShowroomFrontCarSilhouette.body";
    const silhouetteCab = new THREE.Mesh(
      new THREE.BoxGeometry(model.showroom.w * 0.18, 0.17, 0.045),
      silhouetteMat,
    );
    silhouetteCab.name = "garageAnchorShowroomFrontCarSilhouette.cab";
    silhouetteCab.position.y = 0.14;
    showroomCarSilhouette.add(silhouetteBody, silhouetteCab);

    const showroomCarGlow = new THREE.Group();
    showroomCarGlow.name = "garageAnchorShowroomCarGlow";
    showroomCarGlow.position.set(
      model.showroom.x - model.showroom.w * 0.03,
      0.16,
      model.showroom.z + model.showroom.d * 0.26,
    );
    const showroomCarBody = new THREE.Mesh(
      new THREE.BoxGeometry(1.18, 0.24, 0.54),
      new THREE.MeshStandardMaterial({
        color: 0xff6f3a,
        roughness: 0.42,
        emissive: 0xff6f3a,
        emissiveIntensity: 0.38,
      }),
    );
    showroomCarBody.name = "garageAnchorShowroomCarGlow.body";
    showroomCarBody.position.y = 0.2;
    const showroomCarCab = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.25, 0.4),
      new THREE.MeshStandardMaterial({
        color: 0xffe3b8,
        roughness: 0.12,
        emissive: 0xffc47a,
        emissiveIntensity: 0.5,
        transparent: true,
        opacity: 0.82,
      }),
    );
    showroomCarCab.name = "garageAnchorShowroomCarGlow.cab";
    showroomCarCab.position.set(-0.08, 0.42, 0);
    const showroomUnderGlow = new THREE.Mesh(
      new THREE.BoxGeometry(1.38, 0.035, 0.68),
      new THREE.MeshStandardMaterial({
        color: 0xffb24a,
        emissive: 0xff8f2f,
        emissiveIntensity: 0.9,
        transparent: true,
        opacity: 0.7,
      }),
    );
    showroomUnderGlow.name = "garageAnchorShowroomCarUnderGlow";
    showroomUnderGlow.position.y = 0.04;
    showroomCarGlow.add(showroomUnderGlow, showroomCarBody, showroomCarCab);

    const service = new THREE.Mesh(
      new THREE.BoxGeometry(
        model.serviceBay.w,
        model.serviceBay.h,
        model.serviceBay.d,
      ),
      new THREE.MeshStandardMaterial({
        color: 0x46505d,
        roughness: 0.78,
        metalness: 0.08,
        emissive: 0x121a24,
        emissiveIntensity: 0.08,
      }),
    );
    service.name = "garageAnchorServiceBayBlock";
    service.position.set(
      model.serviceBay.x,
      model.serviceBay.y,
      model.serviceBay.z,
    );
    service.castShadow = true;
    service.receiveShadow = true;

    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(
        model.footprint.w * 0.86,
        0.16,
        // overhang the road frontage so the canted roof reads as a canopy, not a lid
        model.footprint.d * 0.78,
      ),
      new THREE.MeshStandardMaterial({
        color: 0x303845,
        roughness: 0.82,
        metalness: 0.06,
      }),
    );
    roof.name = "garageAnchorGraphiteFlatRoofCanopy";
    roof.position.set(0.12, model.serviceBay.h + 0.16, 0.02);
    // Spec 110 — MONO-SLOPE the roof (tilt toward the road) so the garage silhouette is no longer a flat
    // box lid; the canted plane + the cool glass below are the two non-orthogonal moves that break the
    // "detailed box" read the design critique flagged.
    roof.rotation.x = -0.19;
    roof.castShadow = true;

    const wrenchGroup = new THREE.Group();
    wrenchGroup.name = "garageAnchorRooftopWrenchEmblem";
    wrenchGroup.position.set(
      model.serviceBay.x + model.serviceBay.w * 0.04,
      model.serviceBay.h + 0.27,
      model.serviceBay.z - model.serviceBay.d * 0.04,
    );
    wrenchGroup.rotation.y = -0.28;
    const wrenchMat = new THREE.MeshStandardMaterial({
      color: 0x6fe7ff,
      emissive: 0x26c6ff,
      emissiveIntensity: 0.48,
      roughness: 0.28,
    });
    const wrenchHandle = new THREE.Mesh(
      new THREE.BoxGeometry(1.25, 0.08, 0.16),
      wrenchMat,
    );
    wrenchHandle.name = "garageAnchorRooftopWrenchHandle";
    const wrenchJaw = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.08, 0.48),
      wrenchMat,
    );
    wrenchJaw.name = "garageAnchorRooftopWrenchJaw";
    wrenchJaw.position.x = 0.63;
    wrenchGroup.add(wrenchHandle, wrenchJaw);

    const doorMat = new THREE.MeshStandardMaterial({
      color: 0xd8e4ee,
      roughness: 0.5,
      metalness: 0.22,
      emissive: 0xffc36b,
      emissiveIntensity: 0.22,
    });
    const openBayIndex = 1; // Spec 110 — the road-facing middle bay is OPEN (a real recessed cavity you
    // can drive into); the other two stay closed. +z is the road frontage (group rotated by facingAngle).
    const bayFaceZ = model.serviceBay.z + model.serviceBay.d / 2 + 0.045;
    for (let i = 0; i < model.serviceBay.doorCount; i++) {
      const sx =
        model.serviceBay.x +
        (i - (model.serviceBay.doorCount - 1) / 2) *
          (model.serviceBay.bayDoorW * 1.25);
      const open = i === openBayIndex;
      const door = new THREE.Mesh(
        new THREE.BoxGeometry(
          model.serviceBay.bayDoorW,
          open ? model.serviceBay.h * 0.14 : model.serviceBay.h * 0.68,
          0.075,
        ),
        doorMat,
      );
      door.name = `garageAnchorRollupDoor.${i + 1}`;
      door.position.set(
        sx,
        open ? model.serviceBay.h * 0.88 : model.serviceBay.h * 0.39,
        bayFaceZ,
      );
      g.add(door);
      if (open) {
        // recessed dark cavity set INTO the shed (a real opening, not a lifted door over a solid wall)
        const cavity = new THREE.Mesh(
          new THREE.BoxGeometry(
            model.serviceBay.bayDoorW * 1.05,
            model.serviceBay.h * 0.72,
            model.serviceBay.d * 0.52,
          ),
          new THREE.MeshStandardMaterial({
            color: 0x0a0f15,
            roughness: 0.95,
            emissive: 0x2b3a4a,
            emissiveIntensity: 0.18,
          }),
        );
        cavity.name = "garageAnchorOpenBayInterior";
        cavity.position.set(
          sx,
          model.serviceBay.h * 0.36,
          bayFaceZ - model.serviceBay.d * 0.27,
        );
        g.add(cavity);
        // apron/ramp continuing out of the bay toward the road — reads as drive-into-able and is the
        // corner-aligned approach the free-roam car will use (true drive-through gated on the Codex
        // carSpec hook; this lays the road-facing path + visual now).
        const apronMat = new THREE.MeshStandardMaterial({
          color: 0x3a3f4a,
          roughness: 0.7,
          emissive: 0xff9f2f,
          emissiveIntensity:
            garageAnchorNightFloorEmissive(this.sim.state.clock.daylight) * 0.5,
        });
        this.commercialGarageFloorMats.push(apronMat);
        const apron = new THREE.Mesh(
          new THREE.BoxGeometry(
            model.serviceBay.bayDoorW * 1.35,
            0.04,
            model.serviceBay.d * 0.85,
          ),
          apronMat,
        );
        apron.name = "garageAnchorDriveInApronRamp";
        apron.position.set(
          sx,
          model.nightFloor.y + 0.02,
          bayFaceZ + model.serviceBay.d * 0.42,
        );
        g.add(apron);
      }
      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(
          model.serviceBay.bayDoorW * 1.14,
          model.serviceBay.h * 0.77,
          0.04,
        ),
        new THREE.MeshStandardMaterial({
          color: 0xffb24a,
          emissive: 0xff8f2f,
          emissiveIntensity: 0.38,
          roughness: 0.36,
        }),
      );
      frame.name = `garageAnchorRollupDoorFrame.${i + 1}`;
      frame.position.set(
        door.position.x,
        door.position.y,
        door.position.z - 0.018,
      );
      g.add(frame);
      for (let slat = 1; slat <= 5 && !open; slat++) {
        const rib = new THREE.Mesh(
          new THREE.BoxGeometry(model.serviceBay.bayDoorW * 0.96, 0.025, 0.075),
          new THREE.MeshStandardMaterial({ color: 0x8fa1ad, roughness: 0.45 }),
        );
        rib.name = `garageAnchorDoorSlat.${i + 1}.${slat}`;
        rib.position.set(
          door.position.x,
          door.position.y + (slat - 3) * 0.25,
          door.position.z + 0.02,
        );
        g.add(rib);
      }
    }

    const pylonMat = new THREE.MeshStandardMaterial({
      color: 0xffb24a,
      emissive: 0xff8f2f,
      emissiveIntensity: 0.85,
      roughness: 0.32,
    });
    const pylon = new THREE.Mesh(
      new THREE.BoxGeometry(model.pylon.w, model.pylon.h, model.pylon.d),
      pylonMat,
    );
    pylon.name = "garageAnchorCornerPylonSign";
    pylon.position.set(model.pylon.x, model.pylon.y, model.pylon.z);
    pylon.castShadow = true;

    const pylonCap = new THREE.Mesh(
      new THREE.BoxGeometry(model.pylon.w * 2.35, 0.9, model.pylon.d * 1.35),
      pylonMat,
    );
    pylonCap.name = "garageAnchorPylonLightBox";
    pylonCap.position.set(model.pylon.x, model.pylon.h + 0.28, model.pylon.z);

    const pylonCyanPanel = new THREE.Mesh(
      new THREE.BoxGeometry(model.pylon.w * 1.45, 0.12, model.pylon.d * 1.52),
      new THREE.MeshStandardMaterial({
        color: 0x79edff,
        emissive: 0x35d8ff,
        emissiveIntensity: 0.74,
        roughness: 0.24,
      }),
    );
    pylonCyanPanel.name = "garageAnchorPylonCyanEdgePanel";
    pylonCyanPanel.position.set(
      model.pylon.x,
      model.pylon.h + 0.78,
      model.pylon.z,
    );

    const pylonRoadFace = new THREE.Mesh(
      new THREE.BoxGeometry(model.pylon.w * 1.9, model.pylon.h * 0.34, 0.08),
      new THREE.MeshStandardMaterial({
        color: 0xffcf74,
        emissive: 0xff9f2f,
        emissiveIntensity: 0.9,
        roughness: 0.26,
      }),
    );
    pylonRoadFace.name = "garageAnchorRoadFacingPylonSignFace";
    pylonRoadFace.position.set(
      model.pylon.x,
      model.pylon.h * 0.74,
      model.pylon.z + model.pylon.d * 0.78,
    );

    for (const [i, car] of model.displayCars.entries()) {
      const cg = new THREE.Group();
      cg.name = `garageAnchorDisplayCar.${i + 1}`;
      cg.position.set(car.x, 0.08, car.z);
      cg.rotation.y = car.rot;
      cg.scale.setScalar(car.scale);
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(1.15, 0.22, 0.56),
        new THREE.MeshStandardMaterial({
          color: i === 0 ? 0x31d6ff : 0xff6b4a,
          roughness: 0.5,
        }),
      );
      body.position.y = 0.22;
      const cab = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.24, 0.42),
        new THREE.MeshStandardMaterial({
          color: 0xb9f1ff,
          emissive: 0x1f7d99,
          emissiveIntensity: 0.18,
        }),
      );
      cab.position.set(-0.05, 0.43, 0);
      const underGlow = new THREE.Mesh(
        new THREE.BoxGeometry(1.26, 0.025, 0.62),
        new THREE.MeshStandardMaterial({
          color: 0xffb24a,
          emissive: 0xff8f2f,
          emissiveIntensity: 0.62,
          transparent: true,
          opacity: 0.7,
        }),
      );
      underGlow.name = `garageAnchorDisplayCarUnderGlow.${i + 1}`;
      underGlow.position.y = 0.035;
      cg.add(underGlow, body, cab);
      g.add(cg);
    }

    g.add(
      floor,
      forecourt,
      forecourtLane,
      showroomInterior,
      showroom,
      showroomFront,
      showroomHeader,
      showroomCarSilhouette,
      showroomCarGlow,
      service,
      roof,
      wrenchGroup,
      pylon,
      pylonCap,
      pylonCyanPanel,
      pylonRoadFace,
    );
    this.commercialGroup.add(g);
  }

  /** Raise a vibrant neon market stall on each surveyed shop plot: a dark counter body, a glowing
   *  awning canopy, and a bright signage panel facing the street. Disposes any prior build first. */
  private buildCommercialDistrict(): void {
    // Tear down a previous build (geometry + materials) so re-survey/reload never leaks GPU memory.
    for (const child of this.commercialGroup.children) {
      child.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const disposeMat = (x: THREE.Material) => {
          (x as THREE.MeshStandardMaterial).map?.dispose();
          x.dispose();
        }; // free the board CanvasTextures too
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach(disposeMat);
        else if (mat) disposeMat(mat);
      });
    }
    this.commercialGroup.clear();
    this.commercialSignMats = [];
    this.commercialMallFloorMat = null;
    this.commercialGarageFloorMats = [];
    this.commercialFloorMats = [];
    this.commercialLabelMats = [];
    this.scene.add(this.commercialGroup);
    const d = this.commercialDistrict;
    if (!d) return;
    const t = this.sim.state.terrain;

    this.buildMallAnchorShell(d);
    this.buildGarageAnchorShell(d);

    d.parcels.forEach((p, i) => {
      // Spec 079 — each plot fronts a real kooker app: its business sets the neon palette, a rooftop
      // emblem, and (the Nearest bar) a counter + stools where bots can sit. Plots stay for-sale.
      const biz = p.business ? BUSINESSES[p.business] : undefined;
      const neon =
        biz?.palette ?? PlanetRenderer.NEON[i % PlanetRenderer.NEON.length]!;
      const massing = commercialShopMassing(p, biz, i);
      const wallH = massing.wallHeight;
      const bodyW = massing.bodyW;
      const bodyD = massing.bodyD;
      const cx = p.x + (p.w - 1) / 2;
      const cy = p.y + (p.h - 1) / 2;
      // Sit the shop on the LOWEST corner of its footprint so no edge floats over sloped/coastal
      // ground; the uphill terrain just buries into the solid body, and the foundation plinth below
      // fills the slope gap. (Was the centre height, which left the downhill side floating.)
      let loY = Infinity,
        hiY = 0,
        rawLoY = Infinity;
      for (const fx of [p.x, p.x + p.w - 1])
        for (const fy of [p.y, p.y + p.h - 1]) {
          // Seat on the DRIED/levelled surface (surfaceY), not raw worldY — a coastal pad is raised
          // clear of the sea in relevelTerrain, so the shop lifts with it instead of seating underwater.
          const h = this.surfaceY(fx, fy);
          const rawH = t.worldY(fx, fy);
          if (h < loY) loY = h;
          if (h > hiY) hiY = h;
          if (rawH < rawLoY) rawLoY = rawH;
        }
      const baseY = loY;
      const coastalDriedSeat = rawLoY < RENDER_DRY_FLOOR;
      const front = -p.side; // +z when the plot fronts the street to its -y side

      const g = new THREE.Group();
      g.name = `commercialDistrict.${p.id}.${biz?.id ?? "open"}`;
      g.userData = {
        parcelId: p.id,
        businessId: biz?.id,
        businessName: biz?.name,
        massing: massing.signatureKey,
      };
      g.position.set(this.wx(cx), baseY, this.wz(cy));

      // Foundation plinth — inland/sloped shops still get a deep fill body. Coastal DRY seats already own
      // a flat render pad plus the Spec 105 terrain apron, so a full-depth dark plinth reads as the exact
      // black vertical side/floating table we are removing. Keep those coastal plinths thin and let the
      // blended terrain do the visual grounding.
      const foundH = coastalDriedSeat ? 0.22 : hiY - loY + 0.7;
      const found = new THREE.Mesh(
        new THREE.BoxGeometry(bodyW * 1.02, foundH, bodyD * 1.02),
        new THREE.MeshStandardMaterial({
          color: coastalDriedSeat ? 0x536b3a : 0x2a2f38,
          roughness: 0.9,
        }),
      );
      found.position.y = -foundH / 2 + 0.02;
      found.castShadow = true;
      g.add(found);

      const floorMat = new THREE.MeshStandardMaterial({
        color: neon,
        emissive: neon,
        emissiveIntensity: commercialShopNightFloorEmissive(
          this.sim.state.clock.daylight,
        ),
        roughness: 0.55,
        transparent: true,
        opacity: 0.52,
      });
      const floor = new THREE.Mesh(
        new THREE.BoxGeometry(bodyW * 1.12, 0.035, bodyD * 1.12),
        floorMat,
      );
      floor.name = "commercialShopNightFloor";
      floor.position.y = 0.04;
      this.commercialFloorMats.push(floorMat);
      g.add(floor);

      // Body — inland plots keep the dark slate shopfront; coastal dried seats use a colour-matched wall
      // band so night views show grounded shop mass instead of a black tabletop silhouette.
      const coastalWall = new THREE.Color(neon).lerp(
        new THREE.Color(0x536b3a),
        0.45,
      );
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(bodyW, wallH, bodyD),
        new THREE.MeshStandardMaterial({
          color: coastalDriedSeat ? coastalWall : 0x2b3040,
          roughness: 0.7,
          metalness: coastalDriedSeat ? 0.04 : 0.1,
          emissive: coastalDriedSeat ? coastalWall : 0x000000,
          emissiveIntensity: coastalDriedSeat ? 0.12 : 0,
        }),
      );
      body.name = "commercialShopBody";
      body.position.y = wallH / 2;
      body.castShadow = true;

      // Roof form — per-business massing turns adjacent shops into distinct silhouettes instead of
      // one flat box recoloured.
      const roof = this.buildCommercialShopRoof(
        massing,
        neon,
        coastalDriedSeat,
      );
      roof.name = `commercialShopRoof.${massing.roofForm}`;
      roof.position.y = wallH + massing.roofRise / 2;

      // Awning — a glowing neon canopy slightly oversailing the body.
      const canopy = new THREE.Mesh(
        new THREE.BoxGeometry(bodyW * massing.roofOverhang, 0.16, bodyD * 0.42),
        new THREE.MeshStandardMaterial({
          color: neon,
          roughness: 0.4,
          emissive: neon,
          emissiveIntensity: 0.45,
        }),
      );
      canopy.name = "commercialShopCanopy";
      canopy.position.y = wallH * 0.86;
      canopy.position.z = front * (bodyD / 2 + 0.22);
      canopy.castShadow = true;

      // Signage — a bright panel standing above the STREET-FACING front edge.
      const frontZ = front * (bodyD / 2 + 0.12);
      const signMat = new THREE.MeshStandardMaterial({
        color: neon,
        emissive: neon,
        emissiveIntensity: 0.7,
        roughness: 0.3,
      });
      const sign = new THREE.Mesh(
        new THREE.BoxGeometry(bodyW * massing.signWidthScale, 0.5, 0.1),
        signMat,
      );
      sign.name = "commercialShopSign";
      sign.position.set(0, wallH + massing.roofRise + 0.34, frontZ);
      this.commercialSignMats.push(signMat);
      g.add(body, roof, canopy, sign);

      // Storefront detail (spec 092) — a warm-lit window band flanking a recessed door, awning support
      // posts, and a couple of goods crates, so each shop reads as an OPEN business rather than a plain
      // neon box. Windows glow warm (interior light) against the cool slate body + the neon sign.
      const faceZ = front * (bodyD / 2 + 0.04);
      const glassMat = new THREE.MeshStandardMaterial({
        color: 0xffe6b0,
        emissive: 0xffca78,
        emissiveIntensity: 0.6,
        roughness: 0.3,
      });
      const winW = bodyW * Math.max(0.14, 0.62 / massing.windowCount),
        winH = wallH * 0.46;
      for (let wi = 0; wi < massing.windowCount; wi++) {
        const center = (massing.windowCount - 1) / 2;
        const sx = (wi - center) * (bodyW * 0.18);
        const win = new THREE.Mesh(
          new THREE.BoxGeometry(winW, winH, 0.06),
          glassMat,
        );
        win.position.set(sx, wallH * 0.52, faceZ);
        g.add(win);
      }
      const door = new THREE.Mesh(
        new THREE.BoxGeometry(bodyW * 0.2, wallH * 0.66, 0.08),
        new THREE.MeshStandardMaterial({
          color: 0x15181f,
          roughness: 0.6,
          metalness: 0.2,
        }),
      );
      door.position.set(0, wallH * 0.33, faceZ);
      g.add(door);
      // Awning posts + goods crates only where there's no bar counter (the seating shops fill the front).
      if (!biz?.seating) {
        const postMat = new THREE.MeshStandardMaterial({
          color: 0x20242c,
          roughness: 0.6,
          metalness: 0.3,
        });
        for (const sx of [-bodyW * 0.5, bodyW * 0.5]) {
          const post = new THREE.Mesh(
            new THREE.CylinderGeometry(0.05, 0.05, wallH + 0.06, 8),
            postMat,
          );
          post.position.set(sx, (wallH + 0.06) / 2, front * (bodyD / 2 + 0.5));
          post.castShadow = true;
          g.add(post);
        }
        const crateMat = new THREE.MeshStandardMaterial({
          color: 0x7a5a36,
          roughness: 0.9,
        });
        for (let k = 0; k < 2; k++) {
          const cs = 0.32 + k * 0.06;
          const crate = new THREE.Mesh(
            new THREE.BoxGeometry(cs, cs, cs),
            crateMat,
          );
          crate.position.set(
            -bodyW * 0.42 + k * 0.1,
            cs / 2,
            front * (bodyD / 2 + 0.42 - k * 0.18),
          );
          crate.castShadow = true;
          g.add(crate);
        }
      }

      // Rooftop emblem — a distinct shape per business so the app reads at a glance.
      if (biz) {
        const em = this.makeBusinessEmblem(biz.emblem, neon);
        em.position.y = wallH + 0.5;
        g.add(em);
      }

      // The bar's seating: a counter + stools on the street side. The stools are left empty here —
      // real citizens walk over and occupy them after dark (runtime.wanderIdleCitizens), so we must
      // NOT draw static patron spheres or they'd double up with the live bots taking the seats.
      if (biz?.seating) {
        const counter = new THREE.Mesh(
          new THREE.BoxGeometry(bodyW * 0.9, 0.5, 0.22),
          new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.85 }),
        );
        counter.position.set(0, 0.25, front * (bodyD / 2 + 0.45));
        counter.castShadow = true;
        g.add(counter);
        const stoolMat = new THREE.MeshStandardMaterial({
          color: 0x3a3f4a,
          roughness: 0.7,
        });
        const n = 3;
        for (let k = 0; k < n; k++) {
          const sx = (k - (n - 1) / 2) * ((bodyW * 0.9) / n);
          const stool = new THREE.Mesh(
            new THREE.CylinderGeometry(0.09, 0.09, 0.42, 10),
            stoolMat,
          );
          stool.position.set(sx, 0.21, front * (bodyD / 2 + 0.78));
          stool.castShadow = true;
          g.add(stool);
        }
        // Joe the Crab tends the Nearest — the signature "Joe at the bar" look from the concept image:
        // his headset, eyes and claws clear the counter as he serves the patrons across it. A static
        // prop reusing the founder crab geometry; he stands on a hidden duckboard riser behind the
        // counter and faces the street side. (Citizen-Joe is separate; this is the bar's mascot keeper.)
        const riser = 0.36;
        const board = new THREE.Mesh(
          new THREE.BoxGeometry(bodyW * 0.5, riser, 0.32),
          new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.9 }),
        );
        board.position.set(0, riser / 2, front * (bodyD / 2 + 0.18));
        g.add(board);
        const keeper = new THREE.Mesh(
          this.makeCrabGeometry(),
          new THREE.MeshStandardMaterial({
            vertexColors: true,
            flatShading: true,
            roughness: 0.6,
            metalness: 0.05,
          }),
        );
        keeper.scale.setScalar(1.25);
        keeper.position.set(0, riser, front * (bodyD / 2 + 0.18));
        if (front < 0) keeper.rotation.y = Math.PI; // the crab faces +z by default; turn him to face the street side
        keeper.castShadow = true;
        g.add(keeper);
      }

      // Signature props give each marquee app a distinct, recognisable place (the bar's radar dish +
      // vials + bar-chart, Sprout's plants, Sportifine's pitch, Chef Ott's market awning + crates).
      if (biz) g.add(this.buildBusinessProps(biz, bodyW, bodyD, wallH, front));

      this.commercialGroup.add(g);
    });

    for (const label of surveyBusinessLabels(d)) {
      const plate = this.makeCommercialBusinessLabel(label);
      if (plate) this.commercialGroup.add(plate);
    }

    // 086-P1 polish — a seaside PROMENADE: warm lamp posts line the high street on alternating verges,
    // glowing after dark so the coastal strip by the lighthouse reads as a lit boardwalk. Cheap static
    // posts; the head emissive stays below the bloom threshold (warmth, not a halo). Disposed with the
    // group on rebuild like every other commercial mesh.
    const street = d.street;
    if (street.length > 0) {
      const poleMat = new THREE.MeshStandardMaterial({
        color: 0x2f343d,
        roughness: 0.7,
      });
      const headMat = new THREE.MeshStandardMaterial({
        color: 0xffe6b0,
        emissive: 0xffd9a0,
        emissiveIntensity: 0.82,
        roughness: 0.4,
      }); // warm, but under the 0.9 bloom threshold
      for (let i = 0; i < street.length; i += 5) {
        const c = street[i]!;
        const by = Math.max(0, t.worldY(Math.round(c.x), Math.round(c.y)));
        const side = Math.floor(i / 5) % 2 === 0 ? 1 : -1; // alternate verges down the strip
        const lamp = new THREE.Group();
        lamp.position.set(this.wx(c.x), by, this.wz(c.y + side * 1.4));
        const pole = new THREE.Mesh(
          new THREE.CylinderGeometry(0.04, 0.05, 1.4, 6),
          poleMat,
        );
        pole.position.y = 0.7;
        pole.castShadow = true;
        const arm = new THREE.Mesh(
          new THREE.BoxGeometry(0.04, 0.04, 0.3),
          poleMat,
        );
        arm.position.set(0, 1.4, side * 0.15);
        const head = new THREE.Mesh(
          new THREE.SphereGeometry(0.11, 8, 6),
          headMat,
        );
        head.position.set(0, 1.38, side * 0.3);
        lamp.add(pole, arm, head);
        this.commercialGroup.add(lamp);
      }
      // promenade FURNITURE between the lamps — a few benches + leafy planters on the verges so the
      // strip feels strolled, not just lit. Placed on a different phase/offset from the lamps.
      const woodMat = new THREE.MeshStandardMaterial({
        color: 0x6b4a2f,
        roughness: 0.85,
      });
      const legMat = new THREE.MeshStandardMaterial({
        color: 0x3a3f4a,
        roughness: 0.7,
      });
      const planterMat = new THREE.MeshStandardMaterial({
        color: 0x8a6a44,
        roughness: 0.9,
      });
      const leafMat = new THREE.MeshStandardMaterial({
        color: 0x3fae5a,
        roughness: 0.8,
      });
      for (let i = 3; i < street.length; i += 8) {
        const c = street[i]!;
        const by = Math.max(0, t.worldY(Math.round(c.x), Math.round(c.y)));
        const side = Math.floor(i / 8) % 2 === 0 ? -1 : 1; // opposite phase to the lamps
        const fz = this.wz(c.y + side * 1.5);
        // a bench facing the street (backrest on the verge side)
        const bench = new THREE.Group();
        bench.position.set(this.wx(c.x), by, fz);
        const seat = new THREE.Mesh(
          new THREE.BoxGeometry(0.6, 0.05, 0.22),
          woodMat,
        );
        seat.position.y = 0.2;
        seat.castShadow = true;
        const back = new THREE.Mesh(
          new THREE.BoxGeometry(0.6, 0.18, 0.04),
          woodMat,
        );
        back.position.set(0, 0.3, side * 0.09);
        for (const lx of [-0.24, 0.24]) {
          const leg = new THREE.Mesh(
            new THREE.BoxGeometry(0.05, 0.2, 0.18),
            legMat,
          );
          leg.position.set(lx, 0.1, 0);
          bench.add(leg);
        }
        bench.add(seat, back);
        this.commercialGroup.add(bench);
        // a leafy planter just along from the bench
        const planter = new THREE.Group();
        planter.position.set(this.wx(c.x + 1.1), by, fz);
        const tub = new THREE.Mesh(
          new THREE.CylinderGeometry(0.14, 0.11, 0.2, 10),
          planterMat,
        );
        tub.position.y = 0.1;
        tub.castShadow = true;
        const bush = new THREE.Mesh(
          new THREE.SphereGeometry(0.15, 8, 7),
          leafMat,
        );
        bush.position.y = 0.3;
        planter.add(tub, bush);
        this.commercialGroup.add(planter);
      }
      // Spec 081 P0 — AD BOARDS at the strip approaches. Each board is a post pair + frame + a screen
      // plane carrying a CanvasTexture painted by adCanvas (a deterministic poster for one real shop, or
      // the welcome PSA when none). Placement is the pure surveyBillboards (collision-checked against
      // roads + shop footprints); the screen faces inward down the strip and glows softly after dark
      // (emissive under the bloom threshold). Disposed with the group — texture too (see the teardown).
      const boardBlocked = new Set<string>(this.sim.state.roadSet);
      for (const p of d.parcels)
        for (let yy = p.y; yy < p.y + p.h; yy++)
          for (let xx = p.x; xx < p.x + p.w; xx++)
            boardBlocked.add(`${xx},${yy}`);
      const shopById = new Map(d.parcels.map((p) => [p.id, p]));
      const postMat = new THREE.MeshStandardMaterial({
        color: 0x3a3f4a,
        roughness: 0.7,
      });
      for (const site of surveyBillboards(d, t, boardBlocked)) {
        const by = Math.max(
          0,
          t.worldY(Math.round(site.x), Math.round(site.y)),
        );
        const grp = new THREE.Group();
        grp.position.set(this.wx(site.x), by, this.wz(site.y));
        grp.rotation.y = site.faceX === 1 ? Math.PI / 2 : -Math.PI / 2; // a +z plane turned to face along the street
        for (const px of [-0.7, 0.7]) {
          const post = new THREE.Mesh(
            new THREE.CylinderGeometry(0.05, 0.06, 1.8, 6),
            postMat,
          );
          post.position.set(px, 0.9, 0);
          post.castShadow = true;
          grp.add(post);
        }
        const frame = new THREE.Mesh(
          new THREE.BoxGeometry(1.95, 1.32, 0.12),
          postMat,
        );
        frame.position.set(0, 2.1, 0);
        frame.castShadow = true;
        grp.add(frame);
        const shop = site.shopId ? shopById.get(site.shopId) : undefined;
        const cv = document.createElement("canvas");
        cv.width = 256;
        cv.height = 160;
        const ctx = cv.getContext("2d");
        if (ctx)
          paintPoster(ctx, posterModel(shop?.business), cv.width, cv.height);
        const tex = new THREE.CanvasTexture(cv);
        const screen = new THREE.Mesh(
          new THREE.PlaneGeometry(1.78, 1.12),
          new THREE.MeshStandardMaterial({
            map: tex,
            emissive: 0xffffff,
            emissiveMap: tex,
            emissiveIntensity: 0.35,
            roughness: 0.6,
          }),
        );
        screen.position.set(0, 2.1, 0.07);
        grp.add(screen);
        this.commercialGroup.add(grp);
      }
    }
  }

  private applyCommercialLabelVisibility() {
    const night = this.commercialLabelNight;
    for (const entry of this.commercialLabelMats) {
      const opacity = labelOpacityForVisibility(
        entry.model,
        entry.visibilityOpacity,
        night,
      );
      entry.sprite.opacity = opacity.spriteOpacity;
      entry.floor.opacity = opacity.floorOpacity;
    }
  }

  private updateCommercialBusinessLabels() {
    if (this.commercialLabelMats.length === 0) return;
    const width = Math.max(1, this.renderer.domElement.clientWidth);
    const height = Math.max(1, this.renderer.domElement.clientHeight);
    const candidates: BusinessLabelDeclutterInput[] = [];
    const occluders = this.commercialLabelOccluders();
    for (const entry of this.commercialLabelMats) {
      entry.group.getWorldPosition(this.commercialLabelWorld);
      this.commercialLabelProjection
        .copy(this.commercialLabelWorld)
        .project(this.camera);
      const distance = this.camera.position.distanceTo(
        this.commercialLabelWorld,
      );
      candidates.push({
        label: entry.model,
        screenX: (this.commercialLabelProjection.x + 1) * 0.5 * width,
        screenY: (1 - this.commercialLabelProjection.y) * 0.5 * height,
        distance,
        occluded:
          this.commercialLabelProjection.z < -1 ||
          this.commercialLabelProjection.z > 1 ||
          Math.abs(this.commercialLabelProjection.x) >
            BUSINESS_LABEL_VIEWPORT_NDC_LIMIT ||
          Math.abs(this.commercialLabelProjection.y) >
            BUSINESS_LABEL_VIEWPORT_NDC_LIMIT ||
          this.commercialLabelOccluded(occluders, distance),
      });
    }
    const visibility = declutterBusinessLabels(candidates);
    for (const entry of this.commercialLabelMats) {
      const state = visibility.find(
        (item) => item.shopId === entry.model.shopId,
      );
      entry.group.visible = Boolean(state?.visible);
      entry.visibilityOpacity = state?.visible ? state.opacity : 0;
    }
    this.applyCommercialLabelVisibility();
  }

  private commercialLabelOccluders() {
    const occluders: THREE.Object3D[] = [];
    this.scene.traverse((object) => {
      if (object.type !== "Mesh") return;
      if (this.isCommercialLabelObject(object)) return;
      occluders.push(object);
    });
    return occluders;
  }

  private commercialLabelOccluded(
    occluders: readonly THREE.Object3D[],
    distance: number,
  ) {
    if (distance <= 1.4 || occluders.length === 0) return false;
    this.commercialLabelDirection
      .copy(this.commercialLabelWorld)
      .sub(this.camera.position)
      .normalize();
    this.commercialLabelRaycaster.set(
      this.camera.position,
      this.commercialLabelDirection,
    );
    this.commercialLabelRaycaster.far = Math.max(0.1, distance - 1.2);
    return (
      this.commercialLabelRaycaster.intersectObjects([...occluders], false)
        .length > 0
    );
  }

  private isCommercialLabelObject(object: THREE.Object3D) {
    for (
      let cursor: THREE.Object3D | null = object;
      cursor;
      cursor = cursor.parent
    ) {
      if (cursor.name.startsWith("commercial-label-")) return true;
    }
    return false;
  }

  private makeCommercialBusinessLabel(
    label: BusinessLabel,
  ): THREE.Object3D | null {
    if (!isPublicSafe(label.text)) return null;
    const group = new THREE.Group();
    group.name = `commercial-label-${label.shopId}`;
    group.position.set(
      this.wx(label.x),
      this.surfaceY(label.x, label.y) + label.height,
      this.wz(label.y),
    );

    const cv = document.createElement("canvas");
    cv.width = 512;
    cv.height = 160;
    const ctx = cv.getContext("2d");
    if (!ctx) return null;
    const accent = `#${label.color.toString(16).padStart(6, "0")}`;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = "rgba(5, 8, 18, 0.86)";
    ctx.fillRect(18, 22, cv.width - 36, cv.height - 44);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 8;
    ctx.strokeRect(22, 26, cv.width - 44, cv.height - 52);
    ctx.fillStyle = accent;
    ctx.fillRect(42, 122, cv.width - 84, 8);
    ctx.fillStyle = "#fff5d6";
    ctx.font = "700 38px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = accent;
    ctx.shadowBlur = 14;
    ctx.fillText(label.text, cv.width / 2, cv.height / 2, cv.width - 78);
    ctx.shadowBlur = 0;

    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const spriteMat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      opacity: label.nightEmissiveFloor,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(4.8, 1.55, 1);
    sprite.name = label.text;
    sprite.renderOrder = 30;

    const floorMat = new THREE.MeshBasicMaterial({
      color: label.color,
      transparent: true,
      opacity: label.nightEmissiveFloor * 0.28,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1.25, 24), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.72;
    floor.renderOrder = 29;
    group.add(floor, sprite);
    this.commercialLabelMats.push({
      group,
      sprite: spriteMat,
      floor: floorMat,
      model: label,
      visibilityOpacity: 1,
    });
    return group;
  }

  /** Signature props for a marquee storefront, positioned relative to its plot centre. `front` is the
   *  +z/-z direction of the street the plot faces. Keeps each app's site recognisable from afar. */
  private buildBusinessProps(
    biz: Business,
    bodyW: number,
    bodyD: number,
    wallH: number,
    front: number,
  ): THREE.Object3D {
    const grp = new THREE.Group();
    const glow = (hex: number, ei = 0.5) =>
      new THREE.MeshStandardMaterial({
        color: hex,
        emissive: hex,
        emissiveIntensity: ei,
        roughness: 0.4,
      });
    const matte = (hex: number) =>
      new THREE.MeshStandardMaterial({ color: hex, roughness: 0.8 });
    const frontZ = front * (bodyD / 2);
    if (biz.id === "nearest_bar") {
      const mast = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, 1.0, 6),
        matte(0x9aa3b2),
      );
      mast.position.set(bodyW * 0.35, wallH + 0.5, -frontZ * 0.6);
      const dish = new THREE.Mesh(
        new THREE.ConeGeometry(0.32, 0.2, 18, 1, true),
        glow(biz.palette, 0.7),
      );
      dish.position.set(bodyW * 0.35, wallH + 1.05, -frontZ * 0.6);
      dish.rotation.x = Math.PI * 0.8;
      grp.add(mast, dish);
      const vials = [0xff2d95, 0x18e0ff, 0xffc233, 0x7bff4d];
      vials.forEach((cv, k) => {
        const v = new THREE.Mesh(
          new THREE.CylinderGeometry(0.05, 0.05, 0.3, 8),
          glow(cv, 0.85),
        );
        v.position.set((k - 1.5) * 0.18, wallH + 0.25, frontZ * 0.6);
        grp.add(v);
      });
      [0.3, 0.5, 0.4, 0.6].forEach((h, k) => {
        const b = new THREE.Mesh(
          new THREE.BoxGeometry(0.08, h, 0.06),
          glow(biz.palette, 0.6),
        );
        b.position.set(
          -bodyW * 0.5 - 0.16,
          wallH * 0.4 + h / 2,
          (k - 1.5) * 0.12,
        );
        grp.add(b);
      });
    } else if (biz.id === "sprout_nursery") {
      // A lush little nursery: a terracotta planter trough of flowering sprouts, potted bushes flanking
      // the door, a leafy trellis arch over the entrance, and shrubs on the roof.
      const leaf = matte(0x3fae5a),
        leafDk = matte(0x2f8f49),
        terra = matte(0xb5663a);
      const blooms = [0xff7eb6, 0xffd23f, 0xf6f6f6, 0xff5ca8, 0x7bd0ff];
      const trough = new THREE.Mesh(
        new THREE.BoxGeometry(bodyW * 0.9, 0.16, 0.26),
        terra,
      );
      trough.position.set(0, 0.08, frontZ + front * 0.55);
      grp.add(trough);
      for (let k = 0; k < 5; k++) {
        const stem = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.34, 7), leaf);
        stem.position.set((k - 2) * 0.28, 0.32, frontZ + front * 0.55);
        grp.add(stem);
        const bloom = new THREE.Mesh(
          new THREE.SphereGeometry(0.07, 8, 6),
          glow(blooms[k % blooms.length]!, 0.3),
        );
        bloom.position.set((k - 2) * 0.28, 0.52, frontZ + front * 0.55);
        grp.add(bloom);
      }
      for (const sx of [-bodyW * 0.34, bodyW * 0.34]) {
        const pot = new THREE.Mesh(
          new THREE.CylinderGeometry(0.12, 0.09, 0.18, 10),
          terra,
        );
        pot.position.set(sx, 0.09, frontZ + front * 0.3);
        grp.add(pot);
        const bush = new THREE.Mesh(
          new THREE.SphereGeometry(0.16, 8, 7),
          leafDk,
        );
        bush.position.set(sx, 0.28, frontZ + front * 0.3);
        grp.add(bush);
      }
      const archMat = matte(0xd8d2c4);
      for (const sx of [-0.5, 0.5]) {
        const post = new THREE.Mesh(
          new THREE.BoxGeometry(0.05, 0.9, 0.05),
          archMat,
        );
        post.position.set(sx, 0.45, frontZ + front * 0.15);
        grp.add(post);
      }
      const archTop = new THREE.Mesh(
        new THREE.BoxGeometry(1.05, 0.05, 0.05),
        archMat,
      );
      archTop.position.set(0, 0.9, frontZ + front * 0.15);
      grp.add(archTop);
      for (let k = 0; k < 4; k++) {
        const vine = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), leaf);
        vine.position.set((k - 1.5) * 0.3, 0.88, frontZ + front * 0.15);
        grp.add(vine);
      }
      for (const sx of [-bodyW * 0.3, bodyW * 0.3]) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 7), leafDk);
        s.position.set(sx, wallH + 0.2, -frontZ * 0.3);
        grp.add(s);
      }
    } else if (biz.id === "sportifine_club") {
      // A proper club: a green pitch with goal + ball, two floodlight poles, a stepped grandstand and a
      // corner flag in the club colour.
      const pitch = new THREE.Mesh(
        new THREE.BoxGeometry(bodyW * 0.9, 0.04, 1.2),
        matte(0x2e8b3e),
      );
      pitch.position.set(0, 0.02, frontZ + front * 0.85);
      grp.add(pitch);
      const postMat = glow(0xf6f6f6, 0.2);
      const gl = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.5, 0.05),
        postMat,
      );
      gl.position.set(-0.4, 0.25, frontZ + front * 1.35);
      const gr = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.5, 0.05),
        postMat,
      );
      gr.position.set(0.4, 0.25, frontZ + front * 1.35);
      const gt = new THREE.Mesh(
        new THREE.BoxGeometry(0.85, 0.05, 0.05),
        postMat,
      );
      gt.position.set(0, 0.5, frontZ + front * 1.35);
      const ball = new THREE.Mesh(
        new THREE.SphereGeometry(0.1, 10, 8),
        matte(0xf0f0f0),
      );
      ball.position.set(0.1, 0.1, frontZ + front * 0.5);
      grp.add(gl, gr, gt, ball);
      const poleMat = matte(0x9aa3b2);
      for (const sx of [-bodyW * 0.45, bodyW * 0.45]) {
        const pole = new THREE.Mesh(
          new THREE.CylinderGeometry(0.03, 0.03, 1.2, 6),
          poleMat,
        );
        pole.position.set(sx, 0.6, frontZ + front * 1.25);
        grp.add(pole);
        const lamp = new THREE.Mesh(
          new THREE.BoxGeometry(0.22, 0.1, 0.06),
          glow(0xfff3c0, 0.7),
        );
        lamp.position.set(sx, 1.18, frontZ + front * 1.25);
        grp.add(lamp);
      }
      const standMat = matte(biz.palette);
      for (let s = 0; s < 3; s++) {
        const step = new THREE.Mesh(
          new THREE.BoxGeometry(0.7, 0.12, 0.18),
          standMat,
        );
        step.position.set(
          -bodyW * 0.5 - 0.25,
          0.06 + s * 0.12,
          frontZ + front * (0.5 + s * 0.18),
        );
        grp.add(step);
      }
      const flagPole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.015, 0.015, 0.4, 5),
        poleMat,
      );
      flagPole.position.set(bodyW * 0.4, 0.2, frontZ + front * 0.45);
      grp.add(flagPole);
      const flag = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.1, 0.02),
        glow(biz.palette, 0.5),
      );
      flag.position.set(bodyW * 0.4 + 0.09, 0.34, frontZ + front * 0.45);
      grp.add(flag);
    } else if (biz.id === "chef_market") {
      // A restaurant-market: a striped awning, a produce stall, a glowing grill under a smoking chimney,
      // an outdoor bistro table, and a kettlebell — the nod to the chef app's exercise side.
      const wood = matte(0x9c6b3f);
      const awning = new THREE.Mesh(
        new THREE.BoxGeometry(bodyW * 1.1, 0.08, 0.7),
        glow(0xff6a3d, 0.4),
      );
      awning.position.set(0, wallH * 0.82, frontZ + front * 0.35);
      awning.rotation.x = front * 0.25;
      grp.add(awning);
      const produce = [0xe23b2f, 0x7bff4d, 0xffc233];
      for (let k = 0; k < 3; k++) {
        const cr = new THREE.Mesh(
          new THREE.BoxGeometry(0.22, 0.22, 0.22),
          wood,
        );
        cr.position.set((k - 1) * 0.32, 0.11, frontZ + front * 0.7);
        grp.add(cr);
        for (let j = 0; j < 3; j++) {
          const f = new THREE.Mesh(
            new THREE.SphereGeometry(0.05, 6, 5),
            matte(produce[k % 3]!),
          );
          f.position.set(
            (k - 1) * 0.32 + (j - 1) * 0.06,
            0.25,
            frontZ + front * 0.7,
          );
          grp.add(f);
        }
      }
      const grill = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, 0.18, 0.26),
        matte(0x3a3f4a),
      );
      grill.position.set(bodyW * 0.32, 0.12, frontZ + front * 0.55);
      grp.add(grill);
      const embers = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.04, 0.22),
        glow(0xff5a1f, 0.7),
      );
      embers.position.set(bodyW * 0.32, 0.22, frontZ + front * 0.55);
      grp.add(embers);
      const chimney = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.07, 0.4, 8),
        matte(0x5a5f6a),
      );
      chimney.position.set(-bodyW * 0.3, wallH + 0.2, -frontZ * 0.4);
      grp.add(chimney);
      for (let k = 0; k < 3; k++) {
        const puff = new THREE.Mesh(
          new THREE.SphereGeometry(0.08 + k * 0.02, 6, 5),
          matte(0xcfd3da),
        );
        puff.position.set(-bodyW * 0.3, wallH + 0.5 + k * 0.18, -frontZ * 0.4);
        grp.add(puff);
      }
      const table = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.16, 0.04, 12),
        wood,
      );
      table.position.set(-bodyW * 0.32, 0.34, frontZ + front * 0.7);
      const leg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.03, 0.34, 6),
        matte(0x5a5f6a),
      );
      leg.position.set(-bodyW * 0.32, 0.17, frontZ + front * 0.7);
      grp.add(table, leg);
      for (const sx of [-0.22, 0.22]) {
        const stool = new THREE.Mesh(
          new THREE.CylinderGeometry(0.07, 0.07, 0.26, 8),
          matte(0x3a3f4a),
        );
        stool.position.set(-bodyW * 0.32 + sx, 0.13, frontZ + front * 0.72);
        grp.add(stool);
      }
      const kb = new THREE.Mesh(
        new THREE.SphereGeometry(0.1, 8, 7),
        matte(0x2b3040),
      );
      kb.position.set(bodyW * 0.34, 0.1, frontZ + front * 0.88);
      const handle = new THREE.Mesh(
        new THREE.TorusGeometry(0.05, 0.015, 6, 10, Math.PI),
        matte(0x2b3040),
      );
      handle.position.set(bodyW * 0.34, 0.18, frontZ + front * 0.88);
      grp.add(kb, handle);
    } else {
      const featureMat = glow(biz.palette, 0.55);
      const sideX = bodyW * 0.38;
      if (biz.id === "citylife_garage") {
        const bay = new THREE.Mesh(
          new THREE.BoxGeometry(bodyW * 0.46, 0.72, 0.08),
          matte(0x1d222b),
        );
        bay.position.set(0, 0.36, frontZ + front * 0.12);
        const wrench = new THREE.Mesh(
          new THREE.BoxGeometry(0.54, 0.08, 0.08),
          featureMat,
        );
        wrench.position.set(sideX, wallH + 0.18, frontZ * 0.2);
        grp.add(bay, wrench);
      } else if (biz.id === "mojojo_records") {
        const disc = new THREE.Mesh(
          new THREE.TorusGeometry(0.24, 0.055, 10, 18),
          featureMat,
        );
        disc.position.set(-sideX, wallH + 0.12, frontZ * 0.2);
        disc.rotation.x = Math.PI / 2;
        const booth = new THREE.Mesh(
          new THREE.BoxGeometry(0.5, 0.28, 0.32),
          matte(0x20242c),
        );
        booth.position.set(0, 0.14, frontZ + front * 0.58);
        grp.add(disc, booth);
      } else if (biz.id === "classifieds_arcade") {
        for (const sx of [-0.28, 0, 0.28]) {
          const board = new THREE.Mesh(
            new THREE.BoxGeometry(0.2, 0.34, 0.05),
            featureMat,
          );
          board.position.set(sx, wallH * 0.52, frontZ + front * 0.12);
          grp.add(board);
        }
      } else if (biz.id === "ledger_exchange") {
        const counter = new THREE.Mesh(
          new THREE.BoxGeometry(bodyW * 0.62, 0.26, 0.28),
          matte(0x4d3b1f),
        );
        counter.position.set(0, 0.13, frontZ + front * 0.52);
        const coin = new THREE.Mesh(
          new THREE.CylinderGeometry(0.16, 0.16, 0.04, 18),
          featureMat,
        );
        coin.position.set(sideX, wallH + 0.2, frontZ * 0.2);
        coin.rotation.x = Math.PI / 2;
        grp.add(counter, coin);
      } else if (biz.id === "tarentaal_tours") {
        const perch = new THREE.Mesh(
          new THREE.CylinderGeometry(0.025, 0.025, 0.7, 6),
          matte(0x9a7a4a),
        );
        perch.position.set(-sideX, 0.35, frontZ + front * 0.55);
        const bird = new THREE.Mesh(
          new THREE.SphereGeometry(0.14, 8, 7),
          featureMat,
        );
        bird.position.set(-sideX, 0.76, frontZ + front * 0.55);
        grp.add(perch, bird);
      } else if (biz.id === "builder_studio") {
        const frameA = new THREE.Mesh(
          new THREE.BoxGeometry(0.08, 0.9, 0.06),
          featureMat,
        );
        frameA.position.set(-0.38, 0.45, frontZ + front * 0.18);
        const frameB = frameA.clone();
        frameB.position.x = 0.38;
        const lintel = new THREE.Mesh(
          new THREE.BoxGeometry(0.84, 0.08, 0.06),
          featureMat,
        );
        lintel.position.set(0, 0.88, frontZ + front * 0.18);
        grp.add(frameA, frameB, lintel);
      } else {
        const marker = new THREE.Mesh(
          new THREE.BoxGeometry(0.36, 0.24, 0.1),
          featureMat,
        );
        marker.position.set(sideX, wallH + 0.18, frontZ * 0.2);
        grp.add(marker);
      }
    }
    return grp;
  }

  private buildCommercialShopRoof(
    massing: CommercialShopMassing,
    neon: number,
    coastalDriedSeat: boolean,
  ): THREE.Mesh {
    const mat = new THREE.MeshStandardMaterial({
      color: coastalDriedSeat
        ? new THREE.Color(neon).lerp(new THREE.Color(0x536b3a), 0.3)
        : neon,
      emissive: neon,
      emissiveIntensity: 0.16,
      roughness: 0.55,
      metalness: 0.06,
    });
    const w = massing.bodyW * massing.roofOverhang;
    const d = massing.bodyD * massing.roofOverhang;
    if (massing.roofForm === "gable") {
      const roof = new THREE.Mesh(
        new THREE.ConeGeometry(w * 0.55, massing.roofRise, 4),
        mat,
      );
      roof.rotation.y = Math.PI / 4;
      roof.scale.z = d / w;
      return roof;
    }
    if (massing.roofForm === "mono") {
      const roof = new THREE.Mesh(
        new THREE.BoxGeometry(w, massing.roofRise, d),
        mat,
      );
      roof.rotation.z = 0.08;
      return roof;
    }
    if (massing.roofForm === "sawtooth") {
      const roof = new THREE.Mesh(
        new THREE.BoxGeometry(w, massing.roofRise, d),
        mat,
      );
      roof.rotation.z = -0.08;
      return roof;
    }
    if (massing.roofForm === "greenhouse")
      return new THREE.Mesh(
        new THREE.SphereGeometry(
          Math.min(w, d) * 0.42,
          16,
          8,
          0,
          Math.PI * 2,
          0,
          Math.PI / 2,
        ),
        mat,
      );
    if (massing.roofForm === "arena") {
      const roof = new THREE.Mesh(
        new THREE.CylinderGeometry(w * 0.48, w * 0.55, massing.roofRise, 18),
        mat,
      );
      roof.scale.z = d / w;
      return roof;
    }
    if (massing.roofForm === "market-canopy") {
      const roof = new THREE.Mesh(
        new THREE.BoxGeometry(w * 1.08, massing.roofRise, d * 0.7),
        mat,
      );
      roof.rotation.x = 0.12;
      return roof;
    }
    if (massing.roofForm === "tower-cap")
      return new THREE.Mesh(
        new THREE.CylinderGeometry(w * 0.28, w * 0.38, massing.roofRise, 8),
        mat,
      );
    return new THREE.Mesh(new THREE.BoxGeometry(w, massing.roofRise, d), mat);
  }

  /** A small, distinctive rooftop emblem per business kind (positioned at the group origin by the
   *  caller). Glows in the business palette so each storefront reads from District view. */
  private makeBusinessEmblem(emblem: Emblem, neon: number): THREE.Object3D {
    const glow = (hex: number, ei = 0.5) =>
      new THREE.MeshStandardMaterial({
        color: hex,
        emissive: hex,
        emissiveIntensity: ei,
        roughness: 0.4,
      });
    if (emblem === "dish") {
      const grp = new THREE.Group();
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.03, 0.22, 6),
        new THREE.MeshStandardMaterial({ color: 0x9aa3b2 }),
      );
      post.position.y = 0.11;
      const dish = new THREE.Mesh(
        new THREE.ConeGeometry(0.18, 0.12, 16, 1, true),
        glow(neon, 0.65),
      );
      dish.position.y = 0.3;
      dish.rotation.x = Math.PI * 0.85;
      grp.add(post, dish);
      return grp;
    }
    if (emblem === "leaf") {
      const m = new THREE.Mesh(
        new THREE.ConeGeometry(0.12, 0.3, 7),
        glow(0x49c46a, 0.35),
      );
      m.position.y = 0.15;
      return m;
    }
    if (emblem === "ball") {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.14, 10, 8),
        new THREE.MeshStandardMaterial({ color: 0xf6f6f6, roughness: 0.5 }),
      );
      m.position.y = 0.14;
      return m;
    }
    if (emblem === "pot") {
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.07, 0.16, 10),
        glow(neon, 0.4),
      );
      m.position.y = 0.08;
      return m;
    }
    if (emblem === "crate") {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, 0.2, 0.2),
        glow(neon, 0.35),
      );
      m.position.y = 0.1;
      return m;
    }
    if (emblem === "garage") {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(0.26, 0.18, 0.08),
        glow(neon, 0.55),
      );
      m.position.y = 0.12;
      return m;
    }
    if (emblem === "record") {
      const m = new THREE.Mesh(
        new THREE.TorusGeometry(0.13, 0.035, 8, 16),
        glow(neon, 0.65),
      );
      m.position.y = 0.13;
      return m;
    }
    if (emblem === "board") {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(0.24, 0.18, 0.04),
        glow(neon, 0.6),
      );
      m.position.y = 0.12;
      return m;
    }
    if (emblem === "coin") {
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 0.04, 18),
        glow(neon, 0.55),
      );
      m.rotation.x = Math.PI / 2;
      m.position.y = 0.12;
      return m;
    }
    if (emblem === "bird") {
      const m = new THREE.Mesh(
        new THREE.ConeGeometry(0.12, 0.24, 5),
        glow(neon, 0.5),
      );
      m.position.y = 0.14;
      return m;
    }
    if (emblem === "frame") {
      const m = new THREE.Mesh(
        new THREE.TorusGeometry(0.13, 0.02, 4, 4),
        glow(neon, 0.55),
      );
      m.position.y = 0.14;
      return m;
    }
    const tag = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.14, 0.04),
      glow(neon, 0.6),
    );
    tag.position.y = 0.1;
    return tag;
  }

  /** Spec 076 — draw the homestead neighbourhood: the spine carriageway + verge ribbon, then each
   *  bordered parcel (zone ground pads + fence ring + driveway always; the worked farm crops, garden
   *  beds, trees and the set-back voxel house once built). Rebuilt only when the signature changes. */
  private updateNeighborhood() {
    if (!this.neighborhood || !this.lotPadMesh || !this.voxelMesh) return;
    const n = this.neighborhood;
    const lots = n.parcels;
    // Spec 077 — the blueprint is part of the signature so a newly authored/edited script triggers a rebuild.
    const sig =
      lots
        .map(
          (l) =>
            `${l.id}:${l.ownerCitizenId ? 1 : 0}:${l.built ? 1 : 0}:${l.blueprint ?? ""}`,
        )
        .join("|") + `#${n.carriage.length}`;
    if (sig === this.lastNbhdSig) return;
    this.lastNbhdSig = sig;
    // Spec 093 — a newly built (or re-footprinted) house levels the terrain under it; rebuild the
    // terrain mesh before the pads/voxels so the cut pad is in place this same frame.
    this.relevelTerrain();
    const t = this.sim.state.terrain;
    const col = new THREE.Color();
    const BH = 0.56; // block height (the box geometry's y size)
    // SMOOTHED per-cell ground (5-point average): tiles follow the land's grade without per-cell
    // flutter. The old single leveled height per homestead left the downhill half of a sloped parcel
    // floating in the air (operator feedback) — now only the house keeps a leveled foundation.
    // Spec 093 — a cell the terrain mesh was levelled/dried (relevelTerrain) reads its pad/veg/fence
    // height from that SAME map, so the decoration rides the cut terrain instead of the raw worldY it
    // would otherwise float above or sink under (single source of truth with the mesh + avatars).
    const gy = (x: number, y: number) => {
      const lvl = this.terrainLevel.get(Math.round(y) * t.size + Math.round(x));
      return lvl !== undefined ? lvl : this.groundY(x, y);
    };
    const PAD_DEPTH = 0.6; // must match padGeo's y size

    let p = 0; // pad instance index
    let v = 0; // voxel instance index
    // A ground tile spanning a rect (min-corner zx,zy, size zw x zd) whose TOP face sits at hOff above
    // the ground. The deep body sinks into the terrain. `groundY`, when given, levels the tile on a
    // fixed foundation height (the house slab) instead of sampling the smoothed per-cell terrain.
    let padOverflow = 0,
      voxOverflow = 0; // spec 084 S1 — silent cap truncation hid missing scenery
    const padRect = (
      zx: number,
      zy: number,
      zw: number,
      zd: number,
      hOff: number,
      color: number,
      groundY?: number,
    ) => {
      if (p >= PAD_CAP) {
        padOverflow++;
        return;
      }
      const cx = zx + (zw - 1) / 2,
        cy = zy + (zd - 1) / 2;
      this.dummy.position.set(
        this.wx(cx),
        (groundY ?? gy(cx, cy)) + hOff - PAD_DEPTH / 2,
        this.wz(cy),
      );
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(zw, 1, zd);
      this.dummy.updateMatrix();
      this.lotPadMesh.setMatrixAt(p, this.dummy.matrix);
      col.setHex(color);
      this.lotPadMesh.setColorAt(p, col);
      p++;
    };
    const padCell = (
      x: number,
      y: number,
      hOff: number,
      color: number,
      groundY?: number,
    ) => padRect(x, y, 1, 1, hOff, color, groundY);
    // A scaled cube at cell (x,y) whose bottom rests on the ground (or the given foundation) + zBase.
    const block = (
      x: number,
      y: number,
      sx: number,
      sy: number,
      sz: number,
      zBase: number,
      color: number,
      groundY?: number,
    ) => {
      if (v >= VOX_CAP) {
        voxOverflow++;
        return;
      }
      this.dummy.position.set(
        this.wx(x),
        (groundY ?? gy(x, y)) + zBase + (BH * sy) / 2,
        this.wz(y),
      );
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(sx, sy, sz);
      this.dummy.updateMatrix();
      this.voxelMesh.setMatrixAt(v, this.dummy.matrix);
      col.setHex(color);
      this.voxelMesh.setColorAt(v, col);
      v++;
    };

    // ── the spine verge: the grass kerb strip beside the avenue. The carriageway itself is now a
    // real AVENUE in state.roads (spec 084 S3) — rebuildRoads draws its asphalt, kerbs and dashes.
    for (const c of n.verge) padCell(c.x, c.y, 0.045, 0x5d7a3c);

    // ── each homestead parcel ──
    for (const lot of lots) {
      const fenceColor =
        lot.fenceType === "hedge"
          ? BLOCK_COLOR.hedge
          : lot.fenceType === "wall"
            ? BLOCK_COLOR.stone
            : BLOCK_COLOR.fence;
      // The HOUSE keeps one leveled foundation height (a real slab); everything else — garden, farm,
      // driveway, fence — follows the smoothed per-cell terrain like real fields and paths do. The old
      // single homestead height left the downhill half of a sloped parcel hanging in the air.
      const hcx = lot.houseZone.x + (lot.houseZone.w - 1) / 2,
        hcy = lot.houseZone.y + (lot.houseZone.d - 1) / 2;
      const py = gy(hcx, hcy);
      // surveyed homestead ground (drawn whether or not it is built, so the borders read immediately).
      // Distinct pad heights (garden < farm < house < driveway) avoid coplanar z-fighting.
      padRect(
        lot.houseZone.x,
        lot.houseZone.y,
        lot.houseZone.w,
        lot.houseZone.d,
        0.05,
        lot.built ? 0x6b5a44 : 0x5c5140,
        py,
      );
      for (let yy = lot.garden.y; yy < lot.garden.y + lot.garden.d; yy++)
        for (let xx = lot.garden.x; xx < lot.garden.x + lot.garden.w; xx++)
          padCell(xx, yy, 0.038, 0x4f6f33);
      for (let yy = lot.farm.y; yy < lot.farm.y + lot.farm.d; yy++)
        for (let xx = lot.farm.x; xx < lot.farm.x + lot.farm.w; xx++)
          padCell(xx, yy, 0.044, 0x6e4a30);
      for (const d of lot.driveway) padCell(d.x, d.y, 0.056, BLOCK_COLOR.path);
      padCell(lot.gate.x, lot.gate.y, 0.056, BLOCK_COLOR.path);
      // the visible parcel border — a fence/hedge/wall ring riding the land, raised clear of the pads
      for (const f of lot.fence)
        block(f.x, f.y, 0.26, 0.9, 0.26, 0.06, fenceColor);

      // Spec 084 S1 — houses rebuild PER LOT: one accepted blueprint recompiles ONE micro-grid, not
      // every house in the street (the old wholesale mergedHouseGroup teardown made each save pay
      // for the whole neighborhood). Keyed on exactly what the compiled mesh depends on.
      const doorDir = streetDoorDir(lot); // single source — only the no-blueprint fallback uses it
      const houseKey = lot.built ? `${lot.blueprint ?? ""}~${py}` : "";
      if (this.lotHouseKey.get(lot.id) !== houseKey) {
        const old = this.mergedHouseGroup.getObjectByName(lot.id) as
          | THREE.Mesh
          | undefined;
        if (old) {
          this.mergedHouseGroup.remove(old);
          old.geometry?.dispose();
        }
        if (lot.built) {
          // Spec 077 — every built house raises a FANCY BRICK home through the merged greedy-meshed
          // path: an authored blueprint when the parcel carries one, else the deterministic
          // defaultBlueprint from the house seed, with the masonry banding baked into vertex colours.
          this.addMergedHouse(
            lot.id,
            lot.houseZone,
            lot.blueprint ??
              defaultBlueprint(lot.houseSeed, doorDir, lot.houseZone.w),
            lot.houseSeed,
            py,
          );
        }
        this.lotHouseKey.set(lot.id, houseKey);
      }

      if (!lot.built) continue;
      // worked homestead: farm furrows (alternating crop colour by row) riding their own field cells
      for (let yy = lot.farm.y; yy < lot.farm.y + lot.farm.d; yy++) {
        for (let xx = lot.farm.x; xx < lot.farm.x + lot.farm.w; xx++) {
          block(
            xx,
            yy,
            0.82,
            0.5,
            0.82,
            0.05,
            yy % 2 === 0 ? BLOCK_COLOR.crop : BLOCK_COLOR.cropAlt,
          );
        }
      }
      // Spec 094 — custom gardens: planted ROWS cycling a per-lot flower palette (so every garden looks
      // different) instead of one flat green checker. Flowers bloom a touch taller than the veg rows;
      // alternate columns stay open as little paths between the beds. The corner tree + well stay below.
      const GARDEN_FLOWERS = [
        0xd0587a, 0xe8b84a, 0x9a78d8, 0xe87a5a, 0xe0dce8, 0xd85a5a,
      ];
      let gs = lot.houseSeed | 0; // mix in the lot id so neighbouring gardens differ even on a shared seed
      for (let ci = 0; ci < lot.id.length; ci++)
        gs = (gs * 31 + lot.id.charCodeAt(ci)) | 0;
      gs = gs >>> 0;
      const bedPalette = [
        GARDEN_FLOWERS[gs % GARDEN_FLOWERS.length]!,
        GARDEN_FLOWERS[((gs >> 4) + 2) % GARDEN_FLOWERS.length]!,
        BLOCK_COLOR.crop,
        GARDEN_FLOWERS[((gs >> 8) + 4) % GARDEN_FLOWERS.length]!,
        BLOCK_COLOR.cropAlt,
      ];
      let grow = 0;
      for (
        let yy = lot.garden.y;
        yy < lot.garden.y + lot.garden.d;
        yy++, grow++
      ) {
        const bedColor = bedPalette[grow % bedPalette.length]!;
        const veg =
          bedColor === BLOCK_COLOR.crop || bedColor === BLOCK_COLOR.cropAlt;
        for (let xx = lot.garden.x; xx < lot.garden.x + lot.garden.w; xx++) {
          if ((xx + grow) % 2 === 0)
            block(xx, yy, 0.72, veg ? 0.36 : 0.55, 0.72, 0.05, bedColor);
        }
      }
      // a fruit tree at one garden corner + a well at the other
      const tx = lot.garden.x,
        ty = lot.garden.y;
      block(tx, ty, 0.28, 1.1, 0.28, 0.05, BLOCK_COLOR.trunk);
      block(tx, ty, 0.95, 0.95, 0.95, 0.05 + BH * 1.1, BLOCK_COLOR.leaf);
      block(
        lot.garden.x + lot.garden.w - 1,
        lot.garden.y + lot.garden.d - 1,
        0.6,
        0.7,
        0.6,
        0.05,
        BLOCK_COLOR.well,
      );
    }

    if ((padOverflow > 0 || voxOverflow > 0) && import.meta.env.DEV) {
      console.warn(
        `[citylife] instance caps hit: ${padOverflow} pads + ${voxOverflow} voxels DROPPED — scenery is silently missing; raise PAD_CAP/VOX_CAP (spec 084 S1)`,
      );
    }
    this.lotPadMesh.count = p;
    this.lotPadMesh.instanceMatrix.needsUpdate = true;
    if (this.lotPadMesh.instanceColor)
      this.lotPadMesh.instanceColor.needsUpdate = true;
    this.voxelMesh.count = v;
    this.voxelMesh.instanceMatrix.needsUpdate = true;
    if (this.voxelMesh.instanceColor)
      this.voxelMesh.instanceColor.needsUpdate = true;
  }

  /** Spec 077 P2 — compile a blueprint to its micro-occupancy, greedy-mesh it to ONE merged BufferGeometry,
   *  and parent it at the house-zone's min-corner. The mesh is built in tile-local units (small vertex
   *  coordinates): each micro-block is 1/n of a plot cell across, voxelY tall, so a 2-storey home is a
   *  sensible height. The merged geometry reads as fancy brick masonry — the per-course tint banding is
   *  carried in the vertex colours and the flat per-quad normals keep every face crisp. */
  private addMergedHouse(
    lotId: string,
    zone: Zone,
    script: string,
    seed: number,
    groundY: number,
  ): void {
    let compiled;
    try {
      compiled = compileBlueprint(script, { w: zone.w, d: zone.d, seed });
    } catch {
      return; // a malformed script never crashes the renderer — the lot simply draws no house
    }
    const { geometry } = greedyMesh(compiled.blocks, {
      n: compiled.n,
      cell: 1,
      voxelY: VOXEL_Y,
    });
    // Spec 092 — per-house colour variety: lerp the masonry vertex colours toward a deterministic tint
    // from the house seed, so homes span a palette instead of all reading as the same red brick. A
    // partial lerp keeps the per-course banding. Deterministic (seed-driven), render-only.
    const cAttr = geometry.getAttribute("color") as
      | THREE.BufferAttribute
      | undefined;
    if (cAttr) {
      const tint = new THREE.Color(
        HOUSE_TINTS[
          ((seed % HOUSE_TINTS.length) + HOUSE_TINTS.length) %
            HOUSE_TINTS.length
        ]!,
      );
      const a = cAttr.array as Float32Array;
      const k = 0.42;
      for (let i = 0; i < a.length; i += 3) {
        const r = a[i]!,
          g = a[i + 1]!,
          b = a[i + 2]!;
        // The spec-092 tint is for the MASONRY course only — a mid/light warm reddish-brown (r > g > b,
        // and not too dark). Leave COOL / amenity colours alone (pool water, glass rails, plants, blue
        // furniture) so a pool reads as blue water, and leave DARK warm wood alone (the front door, dark
        // beams) so the door reads as a door against the brick instead of lerping into it. Brick, tile and
        // trim are mid/light warm, so the banded shell still varies per house.
        if (!(r > g && g > b) || r < 0.2) continue;
        a[i] = r * (1 - k) + tint.r * k;
        a[i + 1] = g * (1 - k) + tint.g * k;
        a[i + 2] = b * (1 - k) + tint.b * k;
      }
      cAttr.needsUpdate = true;
    }
    const mesh = new THREE.Mesh(geometry, this.mergedHouseMat);
    mesh.name = lotId; // the per-lot incremental rebuild finds + disposes it by name (spec 084 S1)
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    // Parent at the house-zone's min-corner: cell `zone.x` spans world [wx(zone.x)-0.5, +0.5], and the mesh's
    // local origin is the micro-grid corner, so offset by half a cell to seat it flush on the zone.
    mesh.position.set(
      this.wx(zone.x) - 0.5,
      groundY + 0.05,
      this.wz(zone.y) - 0.5,
    );
    this.mergedHouseGroup.add(mesh);
  }

  /** P1 — step the camera INTO a citizen for a live first-person view (the operator looking through their bot's
   *  eyes). OrbitControls is suspended while active; frame() parks the camera at eye height on the live avatar. */
  enterFirstPerson(citizenId: string): void {
    this.fpCitizenId = citizenId;
    this.controls.enabled = false;
  }
  /** P1 — leave first-person and restore the orbit camera. */
  exitFirstPerson(): void {
    if (this.fpCitizenId === null) return;
    this.fpCitizenId = null;
    this.controls.enabled = true;
  }
  get firstPersonCitizen(): string | null {
    return this.fpCitizenId;
  }

  /** Spec 078 — build Joe the Crab as ONE merged, vertex-coloured BufferGeometry (so a single
   *  vertexColors + flatShading material draws him). Local space: origin at the ground plane, FRONT = +Z
   *  (the shared avatar heading rotation then faces his eyes + claws down his travel direction). Locked to
   *  his portrait: an orange-red shell, two stalked eyes, two pincer claws, six legs, a blue-white headset
   *  with exactly one yellow lightning bolt on a single earcup. */
  private makeCrabGeometry(): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = [];
    const tint = new THREE.Color();
    const add = (
      g: THREE.BufferGeometry,
      hex: number,
      pos: [number, number, number],
      rot?: [number, number, number],
      scale?: [number, number, number],
    ) => {
      if (scale) g.scale(scale[0], scale[1], scale[2]);
      if (rot) {
        g.rotateX(rot[0]);
        g.rotateY(rot[1]);
        g.rotateZ(rot[2]);
      }
      g.translate(pos[0], pos[1], pos[2]);
      const count = g.attributes.position!.count;
      const colors = new Float32Array(count * 3);
      tint.setHex(hex);
      for (let i = 0; i < count; i++) {
        colors[i * 3] = tint.r;
        colors[i * 3 + 1] = tint.g;
        colors[i * 3 + 2] = tint.b;
      }
      g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      parts.push(g);
    };
    const SHELL = 0xe2562f,
      SHELL_DK = 0xc23f1f,
      EYE_W = 0xf6f6f6,
      EYE_P = 0x101010;
    const BAND = 0xdfe7f2,
      CUP = 0x2f6fd0,
      BOLT = 0xf4c020;
    // shell — a flattened dome, wider across (x) than deep (z)
    add(
      new THREE.SphereGeometry(0.3, 14, 10),
      SHELL,
      [0, 0.26, 0],
      undefined,
      [1.25, 0.6, 1.0],
    );
    // eyes — two forward stalks (+z) each capped with a white eyeball + dark pupil
    for (const s of [-1, 1]) {
      add(
        new THREE.CylinderGeometry(0.024, 0.024, 0.16, 6),
        SHELL_DK,
        [s * 0.12, 0.36, 0.18],
        [0.55, 0, 0],
      );
      add(new THREE.SphereGeometry(0.062, 8, 6), EYE_W, [s * 0.12, 0.46, 0.25]);
      add(new THREE.SphereGeometry(0.03, 6, 6), EYE_P, [s * 0.12, 0.47, 0.3]);
    }
    // claws — an upper arm reaching forward-out + a two-prong pincer (mirrored)
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(0.1, 0.1, 0.26), SHELL, [s * 0.3, 0.18, 0.22]);
      add(new THREE.BoxGeometry(0.12, 0.16, 0.12), SHELL, [s * 0.34, 0.2, 0.4]);
      add(new THREE.BoxGeometry(0.05, 0.05, 0.16), SHELL_DK, [
        s * 0.34,
        0.26,
        0.5,
      ]);
      add(new THREE.BoxGeometry(0.05, 0.05, 0.13), SHELL_DK, [
        s * 0.34,
        0.16,
        0.49,
      ]);
    }
    // legs — three per side, thin cylinders splayed down-out to the ground
    for (const s of [-1, 1]) {
      for (const dz of [-0.16, 0.02, 0.18]) {
        add(
          new THREE.CylinderGeometry(0.02, 0.02, 0.26, 5),
          SHELL_DK,
          [s * 0.34, 0.1, dz],
          [0, 0, s * 0.95],
        );
      }
    }
    // headset — an ELLIPTICAL band that hugs the flattened shell side-to-side (a circular torus
    // arched too high and sat narrower than the head, so it read as a floating ring with the earcups
    // buried). Scaled to the shell's own [1.25, 0.6] profile so its ends meet the earcups on the
    // sides and its crown rests just over the dome.
    add(
      new THREE.TorusGeometry(0.3, 0.038, 8, 22, Math.PI),
      BAND,
      [0, 0.26, 0],
      undefined,
      [1.25, 0.68, 1.0],
    );
    // earcups — chunky discs seated ON the sides of the head (x just past the shell edge), facing out
    for (const s of [-1, 1])
      add(
        new THREE.CylinderGeometry(0.1, 0.1, 0.07, 16),
        CUP,
        [s * 0.38, 0.26, 0.02],
        [0, 0, Math.PI / 2],
      );
    // exactly ONE yellow lightning accent on the +x earcup's OUTER face (matches his portrait)
    add(
      new THREE.BoxGeometry(0.022, 0.13, 0.06),
      BOLT,
      [0.42, 0.27, 0.02],
      [0, 0, 0.4],
    );
    const merged = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    return merged;
  }

  private makeRallyNameplate(displayName: string) {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 72;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "rgba(5, 8, 18, 0.82)";
      ctx.strokeStyle = "rgba(255, 226, 120, 0.96)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(8, 10, 240, 48, 18);
      ctx.fill();
      ctx.stroke();
      ctx.font = "700 28px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowColor = "rgba(255, 226, 120, 0.95)";
      ctx.shadowBlur = 12;
      ctx.fillStyle = "#fff1a8";
      ctx.fillText(displayName.split(" ")[0] ?? displayName, 128, 35, 220);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.name = displayName;
    sprite.scale.set(1.8, 0.5, 1);
    sprite.renderOrder = 20;
    const floorMaterial = new THREE.MeshBasicMaterial({
      color: 0xffdf70,
      transparent: true,
      opacity: 0.32,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
    });
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(0.48, 24),
      floorMaterial,
    );
    floor.rotation.x = -Math.PI / 2;
    floor.renderOrder = 19;
    const group = new THREE.Group();
    group.add(floor);
    group.add(sprite);
    this.rallyNameplateGroup.add(group);
    return { group, sprite, texture, material, floor, floorMaterial };
  }

  private disposeRallyNameplate(
    id: string,
    plate: {
      group: THREE.Group;
      sprite: THREE.Sprite;
      texture: THREE.CanvasTexture;
      material: THREE.SpriteMaterial;
      floor: THREE.Mesh;
      floorMaterial: THREE.MeshBasicMaterial;
    },
  ): void {
    this.rallyNameplateGroup.remove(plate.group);
    plate.texture.dispose();
    plate.material.dispose();
    plate.floor.geometry.dispose();
    plate.floorMaterial.dispose();
    this.rallyNameplates.delete(id);
  }

  /** P1 — draw the citizen avatars at their live roster positions. The one the operator owns glows cyan; the
   *  citizen currently being stepped-into is hidden (the camera is inside it). Spec 078 — citizens whose
   *  kind is 'crab' (Joe) draw into the crab mesh instead of the human capsule + head. */
  private updateAvatars() {
    if (
      !this.avatarMesh ||
      !this.avatarHeadMesh ||
      !this.crabMesh ||
      !this.avatarSource
    )
      return;
    const list = this.avatarSource();
    for (const plate of this.rallyNameplates.values())
      plate.group.visible = false;
    const t = this.sim.state.terrain;
    const n = Math.min(list.length, 64);
    const col = new THREE.Color();
    let drawn = 0,
      crab = 0;
    for (let i = 0; i < n; i++) {
      const a = list[i]!;
      if (a.id === this.fpCitizenId) continue; // hide the avatar we are looking out of
      const wy = this.surfaceY(a.x, a.y); // stand ON the road ribbon when on a road, not under it
      this.dummy.position.set(this.wx(a.x), wy, this.wz(a.y));
      this.dummy.rotation.set(0, -a.heading + Math.PI / 2, 0);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      if (a.kind === "crab") {
        this.crabMesh.setMatrixAt(crab, this.dummy.matrix);
        crab++;
      } else {
        this.avatarMesh.setMatrixAt(drawn, this.dummy.matrix);
        this.avatarHeadMesh.setMatrixAt(drawn, this.dummy.matrix);
        col.setHex(a.isOperator ? 0x66e0ff : a.hasPod ? 0x9f86d8 : 0xc0b0e0);
        this.avatarMesh.setColorAt(drawn, col);
        drawn++;
      }
      const plate = this.rallyPresentCitizenIds.has(a.id)
        ? this.rallyNameplates.get(a.id)
        : undefined;
      if (plate) {
        const night = 1 - this.sim.state.clock.daylight;
        plate.group.visible = true;
        plate.group.position.set(this.wx(a.x), wy + 1.25, this.wz(a.y));
        plate.floor.position.set(0, -1.22, 0);
        plate.floorMaterial.opacity = 0.18 + night * 0.42;
        plate.material.opacity = 0.72 + night * 0.28;
      }
    }
    this.avatarMesh.count = drawn;
    this.avatarMesh.instanceMatrix.needsUpdate = true;
    if (this.avatarMesh.instanceColor)
      this.avatarMesh.instanceColor.needsUpdate = true;
    this.avatarHeadMesh.count = drawn;
    this.avatarHeadMesh.instanceMatrix.needsUpdate = true;
    this.crabMesh.count = crab;
    this.crabMesh.instanceMatrix.needsUpdate = true;
  }

  /** Spec 073 — the Porter Sheds made visible: goods pile up as crates (materials) + sacks (food) beside each shed, growing and
   *  shrinking with the LIVE stock, and porter handcarts run the road network while a shed is staffed. Never on water. Inert with no shed. */
  private updatePorters() {
    if (!this.porterPileMesh || !this.porterCartMesh) return;
    const s = this.sim.state;
    const t = s.terrain;
    const sheds = s.buildings.filter((b) => b.artifact.kind === "porter");
    if (sheds.length === 0) {
      if (this.porterPileMesh.count !== 0) {
        this.porterPileMesh.count = 0;
        this.porterPileMesh.instanceMatrix.needsUpdate = true;
      }
      if (this.porterCartMesh.count !== 0) {
        this.porterCartMesh.count = 0;
        this.porterCartMesh.instanceMatrix.needsUpdate = true;
      }
      this.porterCarts = [];
      return;
    }
    // ---- piles: crates of materials + sacks of food at each shed, quantised to the live stock (grow + shrink) ----
    const col = new THREE.Color();
    const matUnits = Math.min(
      COLONY.build.pileMaxUnits,
      Math.floor((s.materials ?? 0) / COLONY.build.pilePerMaterials),
    );
    const foodUnits = Math.min(
      COLONY.build.pileMaxUnits,
      Math.floor((s.food ?? 0) / COLONY.build.pilePerFood),
    );
    let pi = 0;
    for (const shed of sheds) {
      const baseY = Math.max(0, t.worldY(shed.x, shed.y)) + 0.02;
      const lay = (units: number, ox: number, hex: number) => {
        for (let u = 0; u < units && pi < 320; u++) {
          const gx = u % 3,
            gz = (u / 3) | 0;
          this.dummy.position.set(
            this.wx(shed.x) + ox + gx * 0.36,
            baseY,
            this.wz(shed.y) + 0.7 + gz * 0.36,
          );
          this.dummy.rotation.set(0, 0, 0);
          this.dummy.scale.set(1, 1, 1);
          this.dummy.updateMatrix();
          this.porterPileMesh.setMatrixAt(pi, this.dummy.matrix);
          col.setHex(hex);
          this.porterPileMesh.setColorAt(pi, col);
          pi++;
        }
      };
      lay(matUnits, -1.45, 0x8a6a3a); // materials crates (brown) to the left of the shed
      lay(foodUnits, 0.45, 0xcbb486); // food sacks (tan) to the right
    }
    this.porterPileMesh.count = pi;
    this.porterPileMesh.instanceMatrix.needsUpdate = true;
    if (this.porterPileMesh.instanceColor)
      this.porterPileMesh.instanceColor.needsUpdate = true;
    // ---- carts: porter handcarts running the roads near the sheds, only while staffed (never over water) ----
    const status = porterStatus(s);
    const want = status.working ? Math.min(28, status.porters) : 0;
    while (this.porterCarts.length < want) {
      const shed = sheds[this.porterCarts.length % sheds.length]!;
      this.porterCarts.push({
        x: shed.x,
        y: shed.y,
        tx: shed.x,
        ty: shed.y,
        spd: 0.6 + Math.random() * 0.5,
      });
    }
    if (this.porterCarts.length > want) this.porterCarts.length = want;
    const now = performance.now();
    const dt = this.lastPorterT
      ? Math.min(0.05, (now - this.lastPorterT) / 1000)
      : 1 / 60;
    this.lastPorterT = now;
    let ci = 0;
    for (const cart of this.porterCarts) {
      let dx = cart.tx - cart.x,
        dy = cart.ty - cart.y,
        d = Math.hypot(dx, dy);
      if (d < 0.4) {
        const next = this.pickPedTarget(
          cart.x,
          cart.y,
          t.landing.x,
          t.landing.y,
        ); // a nearby road cell — pickPedTarget keeps to the pavement, never water
        cart.tx = next.x;
        cart.ty = next.y;
        dx = cart.tx - cart.x;
        dy = cart.ty - cart.y;
        d = Math.hypot(dx, dy);
      }
      if (d > 1e-3) {
        const move = Math.min(d, cart.spd * dt);
        cart.x += (dx / d) * move;
        cart.y += (dy / d) * move;
      }
      const heading = Math.atan2(dy, dx);
      const wy = Math.max(0, t.worldY(Math.round(cart.x), Math.round(cart.y)));
      this.dummy.position.set(this.wx(cart.x), wy + 0.05, this.wz(cart.y));
      this.dummy.rotation.set(0, -heading, 0);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      this.porterCartMesh.setMatrixAt(ci, this.dummy.matrix);
      ci++;
    }
    this.porterCartMesh.count = ci;
    this.porterCartMesh.instanceMatrix.needsUpdate = true;
  }

  private updateCinematic() {
    const t = this.sim.state.terrain;
    const cx = this.wx(t.landing.x);
    const cz = this.wz(t.landing.y);
    const cy = Math.max(0, t.worldY(t.landing.x, t.landing.y));
    // The camera continuously orbits the landing. Roughly every ~40s a cubic envelope pulls it way
    // back and up into a wide establishing shot of the whole island adrift in space, then eases back
    // down to street level — the Dark City money shot, on a loop.
    const T = (performance.now() - this.cinematicT0) / 1000;
    const angle = (T / 90) * Math.PI * 2;
    const wide = Math.pow(Math.sin(T * 0.1571) * 0.5 + 0.5, 3); // 0..1, mostly low with ~40s peaks
    const radius = 28 + Math.sin(T / 22) * 14 + wide * 120;
    const height = 12 + Math.sin(T / 15) * 8 + wide * 78;
    this.camera.position.set(
      cx + Math.cos(angle) * radius,
      cy + height,
      cz + Math.sin(angle) * radius,
    );
    this.controls.target.set(cx, cy + 1.2 + wide * 6, cz);
  }

  private onResize = () => this.resize();
  resize() {
    const rect = this.container.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.disposed = true;
    window.removeEventListener("resize", this.onResize);
    this.controls.dispose();
    this.composer.dispose();
    this.shoreProps?.dispose();
    this.venueProps?.dispose();
    this.gltfProps?.dispose();
    this.foam?.dispose();
    this.clouds?.dispose();
    this.ambient?.dispose();
    this.clearRaceLayer();
    for (const [id, plate] of [...this.rallyNameplates]) {
      this.disposeRallyNameplate(id, plate);
    }
    // Spec 093 — the chunk-grid geometries + the shared terrain material are app-side GL objects that
    // renderer.dispose() does NOT free; release them so a teardown/recreate (HMR, remount) doesn't leak.
    this.chunkedTerrain?.dispose();
    this.terrainMat?.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
