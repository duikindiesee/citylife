// Renders the alien planet: a flat playable terrain region sitting on the apex of a
// large sphere (the "ball"), with ocean, atmosphere, the landed seed, day/night, three
// camera presets (street/district/planet) and view modes (biome/buildable/elevation).
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { COLONY } from '../config'
import { BIOME_COLOR, Biome } from '../terrain'
import type { ColonySim, SeedStructure } from '../sim'
import type { HouseSpec } from '../house'
import { gridOrigin } from '../grid'
import { cellZone, ZONE_COLOR, VIBE_COLOR, type Plot } from '../cityPlan'
import { homeLiveability, surveyAvailable, liveabilityTint, porterStatus } from '../build'
import type { Neighborhood } from '../neighborhood'
import { buildVoxelHouse, BLOCK_COLOR, type VoxelHouse, type DoorDir } from '../voxelHouse'
import { compileBlueprint, VOXEL_Y } from '../houseBuilder'
import { greedyMesh } from './voxelMesh'
import { buildChunkedTerrain, type ChunkedTerrain } from './terrainChunks'
import { defaultBlueprint, streetDoorDir, type Zone } from '../neighborhood'
import { buildShoreProps, type ShorePropsLayer } from './shoreProps'

export type ViewMode = 'biome' | 'buildable' | 'elevation'
export type CameraPreset = 'street' | 'district' | 'planet'

/** P1 — one citizen avatar's live render state, supplied by the runtime each frame from the roster. */
export interface AvatarView {
  id: string
  displayName: string
  x: number
  y: number
  heading: number
  hasPod: boolean
  /** Spec 078 — body kind: humans draw as the capsule avatar, Joe the founder draws as the crab mesh. */
  kind: 'human' | 'crab'
  /** True for the avatar belonging to the logged-in operator (rendered highlighted). */
  isOperator: boolean
}

// Dark City: the colony floats on a slab of rock adrift in deep space. The "sky" is the void —
// dark even at midday — while a local sun still sweeps light across the island for day/night.
const SKY_DAY = new THREE.Color(0x0b1022)
const SKY_NIGHT = new THREE.Color(0x03040a)
const OCEAN = 0x143a4a
const SLAB_ROCK = 0x24242f
// Spec 078 — Joe the Crab's first-person eye height (low to the ground), vs 1.6 for the human avatars.
const CRAB_EYE = 0.42
// Spec 076 — instance caps for the homestead neighbourhood (zone pads + spine ribbon; voxel blocks
// for houses, fences, crops, garden beds and trees across a full band of large parcels).
// Spec 084 S6 — raised for the estate parcels (a GRAND lot alone pads its garden + farm + walkway
// cell by cell); the S1 dev-mode tripwires still warn the moment either cap drops scenery.
const PAD_CAP = 4096
const VOX_CAP = 24576

export class PlanetRenderer {
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private renderer: THREE.WebGLRenderer
  private composer!: EffectComposer
  private controls: OrbitControls
  private sun: THREE.DirectionalLight
  private hemi: THREE.HemisphereLight
  private chunkedTerrain!: ChunkedTerrain // spec 084 S5 — chunk grid, see terrainChunks.ts
  private roadSurfaceMesh!: THREE.Mesh
  private roadLineMesh!: THREE.Mesh
  // Spec 084 S3 — the paved avenue draws as its own asphalt ribbon with raised kerb strips, layered
  // on the same drape/relax/skirt pipeline as the packed-earth streets.
  private avenueSurfaceMesh!: THREE.Mesh
  private avenueKerbMesh!: THREE.Mesh
  private lastRoadsVersion = -1
  // Foliage is rebuilt as the colony grows so trees never sit under streets or buildings.
  private foliageMesh?: THREE.InstancedMesh
  private lastFoliageSig = -2
  // Road cells the ambient pedestrians stroll along (their pavement network), refreshed when roads grow.
  private roadCells: { x: number; y: number }[] = []
  // Sized plot foundations + the spoke roads that serve them from the colony core (the planned-settlement layer).
  private plotPadGroup = new THREE.Group()
  private lastPadSig = ''
  // Spec 073 — Porter Sheds: the economy embodied. Goods pile up as crates/sacks at each shed (growing + shrinking with the live
  // stock), and porter handcarts run the roads while the shed is staffed. Never on water.
  private porterPileMesh!: THREE.InstancedMesh
  private porterCartMesh!: THREE.InstancedMesh
  private porterCarts: { x: number; y: number; tx: number; ty: number; spd: number }[] = []
  private lastPorterT = 0
  // A head so the ambient figures read as little PEOPLE, not pills. The visible crowd is capped to the real colonist count
  // (they are the colony's actual people, not a decorative droid army) — the named-Hermes-citizen binding is the next step.
  private pedHeadMesh!: THREE.InstancedMesh
  private bldgMesh!: THREE.InstancedMesh
  private crewMesh!: THREE.InstancedMesh
  private streetPostMesh!: THREE.InstancedMesh
  private streetHeadMesh!: THREE.InstancedMesh
  private carsMesh!: THREE.InstancedMesh
  // Ambient pedestrians — renderer-only wandering figures near the settled ground; no sim impact.
  private pedMesh!: THREE.InstancedMesh
  private peds: { x: number; y: number; tx: number; ty: number; spd: number; phase: number }[] = []
  private lastPedT = 0
  // P1 — citizen AVATARS: the real, named Hermes citizens, drawn from the roster (distinct from the ambient
  // ped pool), movable by the bot, and steppable-into for a live first-person view.
  private avatarMesh!: THREE.InstancedMesh
  private avatarHeadMesh!: THREE.InstancedMesh
  // Spec 078 — Joe the Crab: one merged, vertex-coloured geometry instanced like the human avatars but
  // routed here by AvatarView.kind. Shares the roster + roam loop; only the body mesh + eye height differ.
  private crabMesh!: THREE.InstancedMesh
  private avatarSource?: () => AvatarView[]
  private fpCitizenId: string | null = null
  // Spec 075 — the buildable neighbourhood: lot pads + minecraft-style voxel homes.
  private neighborhood?: Neighborhood
  private lotPadMesh!: THREE.InstancedMesh
  private voxelMesh!: THREE.InstancedMesh
  private voxelCache = new Map<string, VoxelHouse>()
  // Spec 077 P2 — built houses that carry a blueprint render as ONE merged greedy-meshed BufferGeometry each
  // (fancy brick masonry, not minecraft cubes), parented in this group at a tile-local origin. Lots without
  // a blueprint keep the legacy per-block instanced path above. Rebuilt with the neighbourhood signature.
  private mergedHouseGroup = new THREE.Group()
  private mergedHouseMat!: THREE.MeshStandardMaterial
  private lastNbhdSig = ''
  // Spec 084 S1 — per-lot house mesh key (blueprint + foundation height) for incremental rebuilds.
  private lotHouseKey = new Map<string, string>()
  private settlerGroup = new THREE.Group()
  private lastSettlerCount = -1
  // City plan paint — translucent zone tints (residential / commercial / industrial / civic)
  // and named flag-pole markers at every plot. Both are built once from the terrain; the markers
  // dim and re-label as plots get allocated.
  private zoneTintMesh: THREE.Mesh | null = null
  private liveabilityOn = false // spec 011 — the overlay toggle now drives the liveability map
  private plotMarkers = new THREE.Group()
  private plotMeshes = new Map<string, { pole: THREE.Mesh; flag: THREE.Mesh; flagMat: THREE.MeshStandardMaterial }>()
  private lastPlotSig = ''
  private dummy = new THREE.Object3D()
  private clock = new THREE.Clock()
  private view: ViewMode = 'biome'
  private disposed = false
  // TV-mode cinematic fly-around — when on, the camera slowly orbits the landing site, drifts up
  // to look at the whole island, dives back to street level, and so on, in a 60-second loop.
  // Reads-only the wall-clock so it stays smooth even if the sim is paused.
  private cinematic = false
  private cinematicT0 = 0
  // Per-car smoothed render state (position + heading), so cars glide between the 6 Hz sim steps
  // and ease through turns instead of snapping their heading — and lane offset — at each corner.
  private carRender = new Map<number, { x: number; y: number; h: number }>()
  private lastCarT = 0
  // Pulsing red nav beacon at the rocket nose — material ref so frame() can blink it.
  private beaconMat: THREE.MeshStandardMaterial | null = null
  private shoreProps: ShorePropsLayer | null = null

  private N: number
  private R: number

  // camera tween
  private tweenT = 1
  private startPos = new THREE.Vector3()
  private startTarget = new THREE.Vector3()
  private endPos = new THREE.Vector3()
  private endTarget = new THREE.Vector3()

  constructor(
    private container: HTMLElement,
    private sim: ColonySim,
  ) {
    this.N = sim.state.terrain.size
    this.R = COLONY.world.planetRadius

    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    this.renderer.setPixelRatio(1)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.1
    container.appendChild(this.renderer.domElement)

    this.scene.background = SKY_DAY.clone()
    // Far plane must reach orbital distance or the planet view washes out to sky.
    this.scene.fog = new THREE.Fog(SKY_DAY.clone(), this.N * 1.5, this.R * 1.6)

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.5, 36000) // 084 S6 — covers maxDistance at planetRadius 4800

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.maxPolarAngle = Math.PI * 0.62
    this.controls.minDistance = 4
    this.controls.maxDistance = this.R * 2.6
    this.controls.target.set(0, 5, 0)

    this.hemi = new THREE.HemisphereLight(0xbfd6e6, 0x35324a, 0.8)
    this.scene.add(this.hemi)
    this.sun = new THREE.DirectionalLight(0xfff0d8, 1.7)
    this.sun.castShadow = true
    // Spec 084 S5 — the shadow frustum FOLLOWS the camera target (updateDayNight translates sun +
    // target together each frame) with a fixed half-extent, instead of covering the whole island:
    // 2048 texels over ~240 world units gives crisp house-contact shadows at any world size.
    this.sun.shadow.mapSize.set(2048, 2048)
    const d = Math.min(120, this.N * 0.7)
    this.sun.shadow.camera.left = -d
    this.sun.shadow.camera.right = d
    this.sun.shadow.camera.top = d
    this.sun.shadow.camera.bottom = -d
    this.sun.shadow.camera.far = this.N * 4
    this.scene.add(this.sun)
    this.scene.add(this.sun.target)

    this.buildPlanet()
    this.buildOcean()
    this.buildTerrain()
    this.buildFoliage()
    this.buildStructures()
    this.buildColonyLayer()
    this.setupComposer()

    this.applyPreset('district')
    window.addEventListener('resize', this.onResize)
    this.resize()
  }

  private wx(x: number) {
    return x - this.N / 2
  }
  private wz(y: number) {
    return y - this.N / 2
  }

  private setupComposer() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2())
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { samples: 2 })
    this.composer = new EffectComposer(this.renderer, target)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.32, 0.5, 0.9))
    this.composer.addPass(new OutputPass())
  }

  private buildPlanet() {
    // Dark City: a tapered slab of rock drops from just under the waterline into the void, so the
    // island clearly floats in space instead of sitting on a planet.
    const top = this.N * 0.72
    const base = this.N * 0.34
    const height = this.N * 1.05
    const rock = new THREE.Mesh(
      new THREE.CylinderGeometry(top, base, height, 9, 1),
      new THREE.MeshStandardMaterial({ color: SLAB_ROCK, roughness: 0.95, metalness: 0.08, flatShading: true }),
    )
    rock.position.set(0, -height / 2 - 0.4, 0)
    this.scene.add(rock)

    // Additive glow at the waterline so the island reads as a lit slab adrift in the dark — a tight
    // bright rim plus a taller, fainter halo that bleeds up into the void (Dark City energy).
    const rim = new THREE.Mesh(
      new THREE.CylinderGeometry(top * 1.01, top * 0.9, this.N * 0.06, 9, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x3aa6c8, transparent: true, opacity: 0.32, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
    )
    rim.position.set(0, -0.6, 0)
    this.scene.add(rim)
    const rimHalo = new THREE.Mesh(
      new THREE.CylinderGeometry(top * 1.09, top * 0.98, this.N * 0.17, 9, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x256b8a, transparent: true, opacity: 0.11, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
    )
    rimHalo.position.set(0, -0.36, 0)
    this.scene.add(rimHalo)

    // Starfield — two deterministic Fibonacci shells (fine dust + sparse bright stars), fog-disabled
    // so the void always reads as deep space. Both sit beyond the camera's max orbit distance, so you
    // never fly through them. Two layers give the void real depth instead of a flat scatter.
    const golden = Math.PI * (3 - Math.sqrt(5))
    const makeStars = (count: number, seed: number, rMin: number, rSpan: number, color: number, size: number, opacity: number) => {
      const sg = new THREE.BufferGeometry()
      const pos = new Float32Array(count * 3)
      for (let i = 0; i < count; i++) {
        const y = 1 - ((i + 0.5) / count) * 2
        const rad = Math.sqrt(Math.max(0, 1 - y * y))
        const theta = golden * (i + seed)
        const r = rMin + ((i * 131 + seed * 977) % rSpan)
        pos[i * 3] = Math.cos(theta) * rad * r
        pos[i * 3 + 1] = y * r
        pos[i * 3 + 2] = Math.sin(theta) * rad * r
      }
      sg.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      const points = new THREE.Points(
        sg,
        new THREE.PointsMaterial({ color, size, sizeAttenuation: true, fog: false, transparent: true, opacity, depthWrite: false }),
      )
      points.matrixAutoUpdate = false
      this.scene.add(points)
    }
    makeStars(2800, 0, 5000, 1700, 0x8d99c8, 4, 0.7) // fine dust
    makeStars(380, 7, 5200, 1500, 0xeef2ff, 11, 0.95) // sparse bright stars

    // A distant gas giant looming in the void — gives the deep-space backdrop depth and a focal
    // point. Lit by the same sun, so it shows a soft day/night terminator. Sits beyond the orbit cap.
    const giant = new THREE.Mesh(
      new THREE.SphereGeometry(760, 48, 32),
      new THREE.MeshStandardMaterial({ color: 0x4a5688, roughness: 1, metalness: 0, emissive: 0x1a2348, emissiveIntensity: 0.9, fog: false }),
    )
    giant.position.set(-1400, -100, -3400)
    this.scene.add(giant)
    const giantAtmo = new THREE.Mesh(
      new THREE.SphereGeometry(815, 40, 24),
      new THREE.MeshBasicMaterial({ color: 0x6f86c8, transparent: true, opacity: 0.22, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    )
    giantAtmo.position.copy(giant.position)
    this.scene.add(giantAtmo)
  }

  /** Scatter instanced foliage cones across the wooded land (dense in forest, sparse on plains), so
   *  the island reads as living terrain rather than flat colour. Deterministic placement (stable per
   *  seed); pure decoration with no sim or gameplay impact. */
  /** Build (or rebuild) the tree cover. Trees are kept OFF the streets, OFF every building/worksite (+ a one-cell
   *  verge), and OUT of the civic core, so the settled ground reads as a cleared, planned place — not a forest with
   *  roads bulldozed through it. Rebuilt as the colony grows (roads + buildings change). */
  private buildFoliage() {
    const s = this.sim.state
    const t = s.terrain
    const N = t.size
    const hash = (n: number) => ((n * 2654435761) >>> 0) / 4294967296
    const TREE_COLORS = [0x3f6b4a, 0x4f7d5a, 0x5b4a7d, 0x35633f]
    // Cells the colony has cleared: roads, buildings and worksites (each with a one-cell verge), plus the civic core.
    const cleared = new Set<number>()
    const mark = (cx: number, cy: number, rad: number) => {
      const ix = Math.round(cx), iy = Math.round(cy)
      for (let yy = iy - rad; yy <= iy + rad; yy++) for (let xx = ix - rad; xx <= ix + rad; xx++) {
        if (xx >= 0 && yy >= 0 && xx < N && yy < N) cleared.add(yy * N + xx)
      }
    }
    for (const r of s.roads) mark(r.x, r.y, 1)
    for (const b of s.buildings) mark(b.x, b.y, 1)
    for (const j of s.jobs) mark(j.x, j.y, 1)
    for (const st of s.structures) mark(st.x, st.y, 1) // the caravan/rocket + landmarks
    if (s.cityPlan) for (const p of s.cityPlan.plots) mark(p.x, p.y, Math.max(1, Math.ceil(Math.max(p.w || 1, p.h || 1) / 2))) // clear the lots + their verge
    mark(t.landing.x, t.landing.y, 4) // keep the colony heart clear
    const cells: number[] = []
    for (let i = 0; i < N * N; i++) {
      const b = t.biome[i]
      if (b !== Biome.Forest && b !== Biome.Plains) continue
      const x = i % N
      const y = (i / N) | 0
      if (t.isWater(x, y)) continue
      if (cleared.has(i)) continue // no trees on the streets or under the homes
      const p = b === Biome.Forest ? 0.5 : 0.08
      if (hash(i + 1) < p) cells.push(i)
    }
    // Replace any prior foliage mesh (this method is now a rebuild) — dispose the old GPU resources first.
    if (this.foliageMesh) {
      this.scene.remove(this.foliageMesh)
      this.foliageMesh.geometry.dispose()
      ;(this.foliageMesh.material as THREE.Material).dispose()
      this.foliageMesh = undefined
    }
    const cap = Math.min(cells.length, 6000) // spec 084 S5 — headroom for the 608 world's forests
    const geo = new THREE.ConeGeometry(0.42, 1.1, 6)
    geo.translate(0, 0.55, 0)
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, flatShading: true }), Math.max(1, cap))
    mesh.castShadow = true
    mesh.frustumCulled = false
    const col = new THREE.Color()
    let n = 0
    for (let k = 0; k < cells.length && n < cap; k++) {
      const i = cells[k]!
      const x = i % N
      const y = (i / N) | 0
      const h1 = hash(i * 7 + 3)
      const h2 = hash(i * 13 + 5)
      const wy = Math.max(0, t.worldY(x, y))
      const sc = 0.7 + h1 * 0.7
      this.dummy.position.set(this.wx(x) + (h1 - 0.5) * 0.7, wy, this.wz(y) + (h2 - 0.5) * 0.7)
      this.dummy.scale.set(sc, sc + h2 * 0.6, sc)
      this.dummy.rotation.set(0, h2 * Math.PI, 0)
      this.dummy.updateMatrix()
      mesh.setMatrixAt(n, this.dummy.matrix)
      col.setHex(TREE_COLORS[(i + x) % TREE_COLORS.length]!)
      mesh.setColorAt(n, col)
      n++
    }
    mesh.count = n
    this.foliageMesh = mesh
    this.scene.add(mesh)
  }

  private buildOcean() {
    // Water pooled on the slab — a disc meeting the rocky rim, not an endless sea to a horizon.
    const ocean = new THREE.Mesh(
      new THREE.CircleGeometry(this.N * 0.66, 72),
      new THREE.MeshStandardMaterial({ color: 0x17566f, roughness: 0.15, metalness: 0.45, transparent: true, opacity: 0.92 }),
    )
    ocean.rotation.x = -Math.PI / 2
    ocean.position.y = -0.05
    ocean.receiveShadow = true
    this.scene.add(ocean)
  }

  private colorFor(mode: ViewMode, i: number, out: THREE.Color): void {
    const t = this.sim.state.terrain
    if (mode === 'biome') {
      out.setHex(BIOME_COLOR[t.biome[i] as Biome])
    } else if (mode === 'buildable') {
      const b = t.buildable[i]!
      if (t.water[i] || t.elev[i]! < COLONY.world.seaLevel) out.setHex(0x163a4a)
      else out.setHex(b === 2 ? 0x4caf50 : b === 1 ? 0xe0c020 : 0xc0493f)
    } else {
      const g = 0.15 + t.elev[i]! * 0.85
      out.setRGB(g * 0.9, g, g * 0.95)
    }
  }

  private buildTerrain() {
    // Spec 084 S5 — the terrain is a chunk grid (per-chunk frustum culling + one-time analytic
    // normals + staged recolor); see terrainChunks.ts for why each matters at the 608 world.
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.02, flatShading: false })
    this.chunkedTerrain = buildChunkedTerrain(
      this.sim.state.terrain,
      (x) => this.wx(x),
      (y) => this.wz(y),
      (i, out) => this.colorFor(this.view, i, out),
      mat,
    )
    this.scene.add(this.chunkedTerrain.group)
  }

  setView(mode: ViewMode) {
    this.view = mode
    // Spec 084 S5 — recoloring is STAGED: chunks go dirty here and frame() repaints a few per
    // frame, so a view toggle never stalls (the old full-grid rewrite froze a frame at scale).
    this.chunkedTerrain.markAllDirty()
  }

  /** Show or hide the city-plan overlay (zone tints + plot flag-poles). */
  setZonesVisible(v: boolean) {
    // Spec 011 — repurposed: drives the liveability overlay (homes tinted by wellbeing). The old static
    // zone tints + named-plot flags are retired, so they stay hidden regardless of the toggle.
    this.liveabilityOn = v
    if (this.zoneTintMesh) this.zoneTintMesh.visible = false
    this.plotMarkers.visible = false
  }

  private buildStructures() {
    const t = this.sim.state.terrain
    const group = new THREE.Group()
    for (const s of this.sim.state.structures) {
      if (s.kind === 'lighthouse') continue
      const mesh = this.makeStructure(s)
      const baseY = Math.max(0.05, t.worldY(s.x, s.y))
      mesh.position.set(this.wx(s.x), baseY, this.wz(s.y))
      mesh.castShadow = true
      group.add(mesh)
    }
    this.scene.add(group)
    this.shoreProps = buildShoreProps({
      terrain: t,
      structures: this.sim.state.structures,
      roadSet: this.sim.state.roadSet,
      occupied: this.sim.state.occupied,
      wx: (x) => this.wx(x),
      wz: (y) => this.wz(y),
    })
    if (this.shoreProps) this.scene.add(this.shoreProps.group)
  }

  private makeStructure(s: SeedStructure): THREE.Object3D {
    const g = new THREE.Group()
    if (s.kind === 'caravan') {
      const body = new THREE.Mesh(new THREE.BoxGeometry(3, 1.5, 1.7), new THREE.MeshStandardMaterial({ color: 0xe9e4d6, roughness: 0.7 }))
      body.position.y = 1
      body.castShadow = true
      const roof = new THREE.Mesh(new THREE.BoxGeometry(3.05, 0.3, 1.75), new THREE.MeshStandardMaterial({ color: 0xb24a3a, roughness: 0.6 }))
      roof.position.y = 1.85
      g.add(body, roof)
    } else if (s.kind === 'solar') {
      const post1 = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.9), new THREE.MeshStandardMaterial({ color: 0x444 }))
      post1.position.set(-0.8, 0.45, 0)
      const post2 = post1.clone()
      post2.position.x = 0.8
      const panel = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.09, 1.5), new THREE.MeshStandardMaterial({ color: 0x16335a, roughness: 0.25, metalness: 0.5, emissive: 0x0a1830, emissiveIntensity: 0.5 }))
      panel.position.y = 0.95
      panel.rotation.x = -0.5
      panel.castShadow = true
      g.add(post1, post2, panel)
    } else if (s.kind === 'battery') {
      const box = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.3, 0.9), new THREE.MeshStandardMaterial({ color: 0x5a6270, roughness: 0.6 }))
      box.position.y = 0.65
      const cap = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.18, 0.95), new THREE.MeshStandardMaterial({ color: 0x39d353, emissive: 0x1f8a2f, emissiveIntensity: 0.6 }))
      cap.position.y = 1.4
      box.castShadow = true
      g.add(box, cap)
    } else if (s.kind === 'rocket') {
      // rocket / dropship (landed)
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 5, 16), new THREE.MeshStandardMaterial({ color: 0xdfe3e9, roughness: 0.4, metalness: 0.3 }))
      body.position.y = 2.5
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2, 16), new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.5 }))
      nose.position.y = 6
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.4, 1.2), new THREE.MeshStandardMaterial({ color: 0xb0b6bf }))
      fin.position.set(0, 0.9, 0)
      body.castShadow = true
      nose.castShadow = true
      // Pulsing red nav beacon just above the nose — the landed dropship still has power.
      const beaconMat = new THREE.MeshStandardMaterial({ color: 0xff6a55, emissive: 0xff2a18, emissiveIntensity: 1.5 })
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), beaconMat)
      beacon.position.y = 7.25
      this.beaconMat = beaconMat
      g.add(body, nose, fin, beacon)
    }
    return g
  }

  // ── camera presets ──
  private presetPose(p: CameraPreset): { pos: THREE.Vector3; target: THREE.Vector3 } {
    const t = this.sim.state.terrain
    const L = new THREE.Vector3(this.wx(t.landing.x), Math.max(0, t.worldY(t.landing.x, t.landing.y)), this.wz(t.landing.y))
    if (p === 'street') {
      return { pos: L.clone().add(new THREE.Vector3(16, 11, 20)), target: L.clone().add(new THREE.Vector3(0, 2, 0)) }
    }
    if (p === 'district') {
      // Spec 084 S5 — frame the NEIGHBORHOOD (derived from its bounding box), not a hardcoded
      // point that only happened to work at the 192 world.
      const lots = this.neighborhood?.parcels ?? []
      if (lots.length > 0) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        for (const l of lots) {
          minX = Math.min(minX, l.x - l.w / 2); maxX = Math.max(maxX, l.x + l.w / 2)
          minY = Math.min(minY, l.y - l.h / 2); maxY = Math.max(maxY, l.y + l.h / 2)
        }
        const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
        const span = Math.max(maxX - minX, maxY - minY, 24)
        const c = new THREE.Vector3(this.wx(cx), Math.max(0, t.worldY(Math.round(cx), Math.round(cy))), this.wz(cy))
        return { pos: c.clone().add(new THREE.Vector3(span * 0.9, span * 1.1, span * 1.5)), target: c.clone().add(new THREE.Vector3(0, 4, 0)) }
      }
      return { pos: new THREE.Vector3(95, 105, 150), target: new THREE.Vector3(0, 5, 0) }
    }
    // planet — orbital framing: your colony region with the planet curving away behind it
    return { pos: new THREE.Vector3(0, this.N * 2.4, this.N * 3.4), target: new THREE.Vector3(0, 0, 0) }
  }

  applyPreset(p: CameraPreset) {
    const pose = this.presetPose(p)
    this.camera.position.copy(pose.pos)
    this.controls.target.copy(pose.target)
    this.controls.update()
  }

  private updateDayNight() {
    const d = this.sim.state.clock.daylight
    const { hour, minute } = this.sim.state.clock
    const sky = SKY_NIGHT.clone().lerp(SKY_DAY, d)
    ;(this.scene.background as THREE.Color).copy(sky)
    ;(this.scene.fog as THREE.Fog).color.copy(sky)
    this.hemi.intensity = 0.35 + d * 0.65
    this.sun.intensity = 0.18 + d * 1.7
    const t = hour + minute / 60
    const ang = ((t - 6) / 12) * Math.PI
    const r = this.N * 1.1
    // Spec 084 S5 — sun + target translate TOGETHER to the orbit target: the light DIRECTION (and
    // so all shading) is unchanged, but the fixed-extent shadow frustum now sits wherever the
    // player is looking instead of being pinned to the island centre.
    const c = this.controls.target
    this.sun.position.set(c.x + Math.cos(ang) * r, Math.max(6, Math.sin(ang) * r), c.z + this.N * 0.25)
    this.sun.target.position.set(c.x, 0, c.z)
  }

  private buildColonyLayer() {
    // Roads drape on the terrain (elevation-compatible): a continuous PACKED-EARTH ribbon with a
    // dashed centre line, rebuilt as the network grows. Warm gravel-earth, not an asphalt-black gash,
    // so the network sits in the landscape like the residential lane does.
    this.roadSurfaceMesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      // A faint warm emissive keeps the bed readable under the void sky — without it the earth tone
      // crushes to a black gash on the shadow side, which is what the operator flagged.
      new THREE.MeshStandardMaterial({ color: 0x7a6750, roughness: 1, metalness: 0, side: THREE.DoubleSide, emissive: 0x4a3c2c, emissiveIntensity: 0.32 }),
    )
    this.roadSurfaceMesh.frustumCulled = false
    this.scene.add(this.roadSurfaceMesh)
    this.roadLineMesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial({ color: 0xd8c879, roughness: 0.8, metalness: 0, emissive: 0x2a2410, emissiveIntensity: 0.3, side: THREE.DoubleSide }),
    )
    this.roadLineMesh.frustumCulled = false
    this.scene.add(this.roadLineMesh)
    // Spec 084 S3 — the AVENUE: smooth asphalt (a faint cool emissive keeps it readable under the
    // void sky without crushing to black) and pale concrete kerb strips along its boundary edges.
    this.avenueSurfaceMesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial({ color: 0x4a4a52, roughness: 0.92, metalness: 0, side: THREE.DoubleSide, emissive: 0x23232b, emissiveIntensity: 0.35 }),
    )
    this.avenueSurfaceMesh.frustumCulled = false
    this.scene.add(this.avenueSurfaceMesh)
    this.avenueKerbMesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial({ color: 0x9a9aa2, roughness: 0.85, metalness: 0, side: THREE.DoubleSide, emissive: 0x3c3c42, emissiveIntensity: 0.3 }),
    )
    this.avenueKerbMesh.frustumCulled = false
    this.scene.add(this.avenueKerbMesh)

    // Building = body box + a low hipped roof merged into one geometry, so each instance reads as a
    // structure with a roof instead of a plain block. The roof scales with the building height.
    const bBody = new THREE.BoxGeometry(0.82, 1, 0.82)
    bBody.translate(0, 0.5, 0)
    const bRoof = new THREE.ConeGeometry(0.64, 0.4, 4)
    bRoof.rotateY(Math.PI / 4)
    bRoof.translate(0, 1.2, 0)
    const bGeo = mergeGeometries([bBody, bRoof])!
    this.bldgMesh = new THREE.InstancedMesh(bGeo, new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.03, flatShading: true }), COLONY.build.maxBuildings + 8)
    this.bldgMesh.count = 0
    this.bldgMesh.castShadow = true
    this.bldgMesh.frustumCulled = false
    this.scene.add(this.bldgMesh)

    const crewGeo = new THREE.BoxGeometry(0.5, 0.3, 0.32)
    this.crewMesh = new THREE.InstancedMesh(crewGeo, new THREE.MeshStandardMaterial({ color: 0xf2a23a, roughness: 0.5, metalness: 0.2 }), COLONY.build.maxBuildings + 8)
    this.crewMesh.count = 0
    this.crewMesh.castShadow = true
    this.crewMesh.frustumCulled = false
    this.scene.add(this.crewMesh)

    // Ambient pedestrians strolling the settled ground near the landing — the colony feels lived-in.
    const pedGeo = new THREE.CapsuleGeometry(0.13, 0.34, 3, 6)
    pedGeo.translate(0, 0.33, 0)
    this.pedMesh = new THREE.InstancedMesh(pedGeo, new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.05 }), 28)
    this.pedMesh.castShadow = true
    this.pedMesh.frustumCulled = false
    this.scene.add(this.pedMesh)
    // a head atop each body so the figures read as people (same instance transform, head baked above the body)
    const pedHeadGeo = new THREE.SphereGeometry(0.1, 8, 6)
    pedHeadGeo.translate(0, 0.72, 0)
    this.pedHeadMesh = new THREE.InstancedMesh(pedHeadGeo, new THREE.MeshStandardMaterial({ color: 0xe0b48a, roughness: 0.85 }), 28)
    this.pedHeadMesh.count = 0
    this.pedHeadMesh.castShadow = true
    this.pedHeadMesh.frustumCulled = false
    this.scene.add(this.pedHeadMesh)
    this.initPedestrians()

    // P1 — citizen avatars: a touch taller + glowing so the real, named citizens stand out from the ambient crowd.
    const AV_CAP = 64
    const avGeo = new THREE.CapsuleGeometry(0.16, 0.44, 4, 8)
    avGeo.translate(0, 0.4, 0)
    this.avatarMesh = new THREE.InstancedMesh(avGeo, new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.1, emissive: 0x2a2050, emissiveIntensity: 0.5 }), AV_CAP)
    this.avatarMesh.count = 0
    this.avatarMesh.castShadow = true
    this.avatarMesh.frustumCulled = false
    this.scene.add(this.avatarMesh)
    const avHeadGeo = new THREE.SphereGeometry(0.12, 10, 8)
    avHeadGeo.translate(0, 0.86, 0)
    this.avatarHeadMesh = new THREE.InstancedMesh(avHeadGeo, new THREE.MeshStandardMaterial({ color: 0xe8c49a, roughness: 0.8 }), AV_CAP)
    this.avatarHeadMesh.count = 0
    this.avatarHeadMesh.castShadow = true
    this.avatarHeadMesh.frustumCulled = false
    this.scene.add(this.avatarHeadMesh)
    // Spec 078 — Joe the Crab's body: one merged, vertex-coloured geometry drawn by a single material.
    const crabGeo = this.makeCrabGeometry()
    this.crabMesh = new THREE.InstancedMesh(crabGeo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.6, metalness: 0.05 }), AV_CAP)
    this.crabMesh.count = 0
    this.crabMesh.castShadow = true
    this.crabMesh.frustumCulled = false
    this.scene.add(this.crabMesh)

    // Spec 076 — homestead ground tiles (zone pads + the spine carriageway/verge) + voxel blocks
    // (the house, fences, farm crops, garden beds, trees). Caps raised for the larger parcels.
    // Deep pads: the tile body extends well below its top face, so on sloped ground the sides reach
    // down into the terrain — adjacent stepped tiles read as one merged surface and a tile edge over a
    // dip reads as built-up earth, never a floating wafer (operator feedback).
    const padGeo = new THREE.BoxGeometry(1, 0.6, 1)
    this.lotPadMesh = new THREE.InstancedMesh(padGeo, new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 }), PAD_CAP)
    this.lotPadMesh.count = 0
    this.lotPadMesh.receiveShadow = true
    this.lotPadMesh.frustumCulled = false
    this.scene.add(this.lotPadMesh)
    const blockGeo = new THREE.BoxGeometry(0.96, 0.56, 0.96)
    this.voxelMesh = new THREE.InstancedMesh(blockGeo, new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.02, flatShading: true }), VOX_CAP)
    this.voxelMesh.count = 0
    this.voxelMesh.castShadow = true
    this.voxelMesh.receiveShadow = true
    this.voxelMesh.frustumCulled = false
    this.scene.add(this.voxelMesh)
    // Spec 077 P2 — the merged greedy-meshed brick houses. One shared vertex-colour material (the brick
    // banding lives in the per-vertex colours), flat-shaded so each merged quad reads as a crisp masonry
    // face. Slightly rougher than the instanced blocks so the surface reads as fired brick.
    this.mergedHouseMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.02, flatShading: true })
    this.mergedHouseGroup.frustumCulled = false
    this.scene.add(this.mergedHouseGroup)

    // Spec 073 — goods piled at the Porter Sheds (crates + sacks), and the porter handcarts on the roads.
    const crateGeo = new THREE.BoxGeometry(0.34, 0.34, 0.34)
    crateGeo.translate(0, 0.17, 0)
    this.porterPileMesh = new THREE.InstancedMesh(crateGeo, new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, flatShading: true }), 320)
    this.porterPileMesh.count = 0
    this.porterPileMesh.castShadow = true
    this.porterPileMesh.frustumCulled = false
    this.scene.add(this.porterPileMesh)
    const cartGeo = new THREE.BoxGeometry(0.42, 0.22, 0.3)
    cartGeo.translate(0, 0.14, 0)
    this.porterCartMesh = new THREE.InstancedMesh(cartGeo, new THREE.MeshStandardMaterial({ color: 0x9a7a4a, roughness: 0.6, metalness: 0.1 }), 28)
    this.porterCartMesh.count = 0
    this.porterCartMesh.castShadow = true
    this.porterCartMesh.frustumCulled = false
    this.scene.add(this.porterCartMesh)

    // street lights at grid intersections
    const lightCap = 360
    const postGeo = new THREE.CylinderGeometry(0.04, 0.05, 0.9, 5)
    postGeo.translate(0, 0.45, 0)
    this.streetPostMesh = new THREE.InstancedMesh(postGeo, new THREE.MeshStandardMaterial({ color: 0x2a2a30 }), lightCap)
    this.streetPostMesh.count = 0
    this.streetPostMesh.frustumCulled = false
    this.scene.add(this.streetPostMesh)
    const headGeo = new THREE.BoxGeometry(0.16, 0.12, 0.16)
    headGeo.translate(0, 0.93, 0)
    this.streetHeadMesh = new THREE.InstancedMesh(headGeo, new THREE.MeshStandardMaterial({ color: 0xfff0c0, emissive: 0xffd58a, emissiveIntensity: 0.4 }), lightCap)
    this.streetHeadMesh.count = 0
    this.streetHeadMesh.frustumCulled = false
    this.scene.add(this.streetHeadMesh)

    const carGeo = new THREE.BoxGeometry(0.36, 0.16, 0.2) // length along +X
    this.carsMesh = new THREE.InstancedMesh(carGeo, new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.25 }), COLONY.traffic.maxCars + 4)
    this.carsMesh.count = 0
    this.carsMesh.castShadow = true
    this.carsMesh.frustumCulled = false
    this.scene.add(this.carsMesh)

    this.scene.add(this.settlerGroup) // unique KOOKER-settler homes live here
    this.scene.add(this.plotMarkers) // city-plan flag poles, one per plot
    this.scene.add(this.plotPadGroup) // sized plot foundations + their spoke roads

    // Zone tint: paint each land cell within the city's reach with its surveyed zone colour. The
    // residential arc (north + west), commercial arc (east), industrial arc (south), and civic
    // centre become visible as soft, translucent ground colour, so the patrol bot's allocations
    // and the player's first-person walk both have a *visible* city plan to land on.
    this.buildZoneTint()
  }

  /** One-time: build the translucent zone-tint mesh from the terrain. Cells off the plan get no quad. */
  private buildZoneTint() {
    const t = this.sim.state.terrain
    const landing = t.landing
    const positions: number[] = []
    const colors: number[] = []
    const tri = (a: number[], b: number[], c: number[], col: THREE.Color) => {
      positions.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, c[0]!, c[1]!, c[2]!)
      for (let i = 0; i < 3; i++) colors.push(col.r, col.g, col.b)
    }
    const col = new THREE.Color()
    const LIFT = 0.03 // just above the terrain, just below the road
    for (let y = 0; y < t.size; y++) {
      for (let x = 0; x < t.size; x++) {
        if (t.isWater(x, y)) continue
        const z = cellZone(landing, x, y)
        if (!z) continue
        col.setHex(ZONE_COLOR[z])
        // Quad covering the cell footprint, draped on the terrain by sampling corner heights.
        const cornerH = (gx: number, gy: number) => {
          const cl = (v: number) => Math.max(0, Math.min(t.size - 1, v))
          return Math.max(
            0,
            (t.worldY(cl(gx - 1), cl(gy - 1)) +
              t.worldY(cl(gx), cl(gy - 1)) +
              t.worldY(cl(gx - 1), cl(gy)) +
              t.worldY(cl(gx), cl(gy))) /
              4,
          )
        }
        const wx = (gx: number) => gx - t.size / 2
        const wz = (gy: number) => gy - t.size / 2
        const A = [wx(x) - 0.5, cornerH(x, y) + LIFT, wz(y) - 0.5]
        const B = [wx(x) + 0.5, cornerH(x + 1, y) + LIFT, wz(y) - 0.5]
        const C = [wx(x) - 0.5, cornerH(x, y + 1) + LIFT, wz(y) + 0.5]
        const D = [wx(x) + 0.5, cornerH(x + 1, y + 1) + LIFT, wz(y) + 0.5]
        tri(A, C, B, col)
        tri(B, C, D, col)
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    geo.computeVertexNormals()
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.36, side: THREE.DoubleSide, depthWrite: false })
    this.zoneTintMesh = new THREE.Mesh(geo, mat)
    this.zoneTintMesh.frustumCulled = false
    this.scene.add(this.zoneTintMesh)
  }

  /** Per-frame: ensure each plot has a flag-pole marker; allocated plots dim + collapse. */
  private syncPlotMarkers(plots: Plot[]) {
    const sig = plots.map((p) => `${p.id}:${p.assignedTo || ''}`).join('|')
    if (sig === this.lastPlotSig) return
    this.lastPlotSig = sig
    const t = this.sim.state.terrain
    const have = new Set<string>()
    for (const p of plots) {
      have.add(p.id)
      let entry = this.plotMeshes.get(p.id)
      if (!entry) {
        const poleGeo = new THREE.CylinderGeometry(0.04, 0.04, 1.2, 6)
        poleGeo.translate(0, 0.6, 0)
        const poleMat = new THREE.MeshStandardMaterial({ color: 0xd6d6dc, roughness: 0.6 })
        const pole = new THREE.Mesh(poleGeo, poleMat)
        const flagGeo = new THREE.BoxGeometry(0.45, 0.28, 0.04)
        flagGeo.translate(0.2, 1.05, 0)
        const flagMat = new THREE.MeshStandardMaterial({ color: VIBE_COLOR[p.vibe], roughness: 0.5, emissive: VIBE_COLOR[p.vibe], emissiveIntensity: 0.35 })
        const flag = new THREE.Mesh(flagGeo, flagMat)
        const group = new THREE.Group()
        group.add(pole)
        group.add(flag)
        const wx = p.x - t.size / 2
        const wz = p.y - t.size / 2
        const wy = Math.max(0, t.worldY(p.x, p.y))
        group.position.set(wx, wy, wz)
        this.plotMarkers.add(group)
        entry = { pole, flag, flagMat }
        this.plotMeshes.set(p.id, entry)
      }
      // Allocated plots: dim flag, drop emissive, half-height pole effect via scale.
      const taken = !!p.assignedTo
      entry.flagMat.color.setHex(VIBE_COLOR[p.vibe])
      entry.flagMat.emissiveIntensity = taken ? 0.05 : 0.35
      entry.flagMat.opacity = taken ? 0.55 : 1
      entry.flagMat.transparent = taken
      entry.flag.scale.set(taken ? 0.6 : 1, taken ? 0.6 : 1, taken ? 0.6 : 1)
      entry.pole.scale.set(1, taken ? 0.55 : 1, 1)
    }
    // Drop markers whose plot is gone (game reset).
    for (const [id, entry] of this.plotMeshes) {
      if (!have.has(id)) {
        const group = entry.pole.parent
        if (group && group.parent) group.parent.remove(group)
        this.plotMeshes.delete(id)
      }
    }
  }

  /** Rebuild the unique settler homes (cheap; only on a new registration). */
  private rebuildSettlerHomes() {
    for (const c of [...this.settlerGroup.children]) this.settlerGroup.remove(c)
    const s = this.sim.state
    const t = s.terrain
    for (const settler of s.settlers) {
      const home = this.buildHouseMesh(settler.house)
      home.position.set(this.wx(settler.x), Math.max(0, t.worldY(settler.x, settler.y)), this.wz(settler.y))
      this.settlerGroup.add(home)
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
        this.plotPadGroup.remove(ch)
        const m = ch as THREE.Mesh
        if (m.geometry) m.geometry.dispose()
        if (m.material) (m.material as THREE.Material).dispose()
      }
    }
    this.lastPadSig = 'retired'
    return
    // eslint-disable-next-line no-unreachable
    const plots = _plots
    const sig = plots.map((p) => `${p.id}:${p.w || 1}x${p.h || 1}`).join('|')
    if (sig === this.lastPadSig) return
    this.lastPadSig = sig
    const t = this.sim.state.terrain
    for (const ch of [...this.plotPadGroup.children]) {
      this.plotPadGroup.remove(ch)
      const m = ch as THREE.Mesh
      if (m.geometry) m.geometry.dispose()
      if (m.material) (m.material as THREE.Material).dispose()
    }
    const lx = t.landing.x, ly = t.landing.y
    const padMat = new THREE.MeshStandardMaterial({ color: 0x9a948c, roughness: 0.9, metalness: 0 }) // poured-deck concrete
    const kerbMat = new THREE.MeshStandardMaterial({ color: 0xbfc6c9, roughness: 0.8 })
    // one merged ribbon for all the spoke roads (draped over the terrain)
    const surf: number[] = []
    const triPush = (p: number[], q: number[], r: number[]) => surf.push(p[0]!, p[1]!, p[2]!, q[0]!, q[1]!, q[2]!, r[0]!, r[1]!, r[2]!)
    const quad = (a: number[], b: number[], c: number[], d: number[]) => { triPush(a, c, b); triPush(b, c, d) }
    for (const p of plots) {
      const w = Math.max(1, p.w || 1), h = Math.max(1, p.h || 1)
      const hx = (w - 1) / 2, hy = (h - 1) / 2
      // leveled foundation height: sit at the highest corner of the lot so it cuts uphill and fills downhill
      let padY = 0
      for (let yy = p.y - hy; yy <= p.y + hy; yy++) for (let xx = p.x - hx; xx <= p.x + hx; xx++) padY = Math.max(padY, Math.max(0, t.worldY(Math.round(xx), Math.round(yy))))
      // the kerb (a hair larger + lower) frames the pad
      const kerb = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.16, h + 0.4), kerbMat)
      kerb.position.set(this.wx(p.x), padY + 0.02, this.wz(p.y))
      kerb.receiveShadow = true
      this.plotPadGroup.add(kerb)
      const pad = new THREE.Mesh(new THREE.BoxGeometry(w, 0.22, h), padMat)
      pad.position.set(this.wx(p.x), padY + 0.06, this.wz(p.y))
      pad.receiveShadow = true
      this.plotPadGroup.add(pad)
      // spoke road from the colony core to this plot, draped, ~0.8 wide
      const dx = p.x - lx, dy = p.y - ly
      const steps = Math.max(1, Math.round(Math.hypot(dx, dy)))
      const nl = Math.hypot(dx, dy) || 1
      const ox = (dy / nl) * 0.4, oy = (-dx / nl) * 0.4 // perpendicular half-width
      for (let s = 0; s < steps; s++) {
        const fx0 = lx + dx * (s / steps), fy0 = ly + dy * (s / steps)
        const fx1 = lx + dx * ((s + 1) / steps), fy1 = ly + dy * ((s + 1) / steps)
        if (t.isWater(Math.round(fx0), Math.round(fy0)) || t.isWater(Math.round(fx1), Math.round(fy1))) continue // a road never paves over open water — it breaks at the shore (ground units obey the physics of the world)
        const h0 = Math.max(0, t.worldY(Math.round(fx0), Math.round(fy0))) + 0.06
        const h1 = Math.max(0, t.worldY(Math.round(fx1), Math.round(fy1))) + 0.06
        quad(
          [this.wx(fx0) + ox, h0, this.wz(fy0) + oy],
          [this.wx(fx0) - ox, h0, this.wz(fy0) - oy],
          [this.wx(fx1) + ox, h1, this.wz(fy1) + oy],
          [this.wx(fx1) - ox, h1, this.wz(fy1) - oy],
        )
      }
    }
    if (surf.length) {
      const sg = new THREE.BufferGeometry()
      sg.setAttribute('position', new THREE.Float32BufferAttribute(surf, 3))
      sg.computeVertexNormals()
      const spoke = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ color: 0x2b2b30, roughness: 0.95, side: THREE.DoubleSide }))
      spoke.frustumCulled = false
      this.plotPadGroup.add(spoke)
    }
  }

  private buildHouseMesh(h: HouseSpec): THREE.Object3D {
    const g = new THREE.Group()
    const wallMat = new THREE.MeshStandardMaterial({ color: h.wallColor, roughness: 0.82 })
    const roofMat = new THREE.MeshStandardMaterial({ color: h.roofColor, roughness: 0.7 })
    const bodyH = h.floors * h.storeyH
    const body = new THREE.Mesh(new THREE.BoxGeometry(h.w, bodyH, h.d), wallMat)
    body.position.y = bodyH / 2
    body.castShadow = true
    body.receiveShadow = true
    g.add(body)
    if (h.wing) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(h.w * 0.55, bodyH * 0.8, h.d * 0.6), wallMat)
      wing.position.set(h.w * 0.5, bodyH * 0.4, h.d * 0.18)
      wing.castShadow = true
      g.add(wing)
    }
    if (h.roof === 'flat') {
      const r = new THREE.Mesh(new THREE.BoxGeometry(h.w * 1.06, 0.08, h.d * 1.06), roofMat)
      r.position.y = bodyH + 0.04
      g.add(r)
    } else {
      const rad = Math.max(h.w, h.d) * 0.72
      const ph = Math.max(0.18, h.roofPitch * rad)
      const cone = new THREE.Mesh(new THREE.ConeGeometry(rad, ph, 4), roofMat)
      cone.rotation.y = Math.PI / 4
      cone.position.y = bodyH + ph / 2
      if (h.roof === 'gable') cone.scale.set(0.78, 1, 1.3)
      cone.castShadow = true
      g.add(cone)
    }
    if (h.chimney) {
      const ch = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.42, 0.1), new THREE.MeshStandardMaterial({ color: 0x6a5a4a }))
      ch.position.set(h.w * 0.28, bodyH + 0.28, h.d * 0.18)
      g.add(ch)
    }
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.3, 0.05), new THREE.MeshStandardMaterial({ color: 0x4a3b2a }))
    door.position.set(0, 0.15, h.d / 2 + 0.01)
    g.add(door)
    if (h.porch) {
      const porch = new THREE.Mesh(new THREE.BoxGeometry(h.w * 0.7, 0.05, 0.28), roofMat)
      porch.position.set(0, Math.min(bodyH, 0.45), h.d / 2 + 0.12)
      g.add(porch)
    }
    return g
  }

  private smoothRoadY(x: number, y: number): number {
    const t = this.sim.state.terrain
    const cl = (v: number) => Math.max(0, Math.min(t.size - 1, v))
    return (t.worldY(x, y) + t.worldY(cl(x + 1), y) + t.worldY(cl(x - 1), y) + t.worldY(x, cl(y + 1)) + t.worldY(x, cl(y - 1))) / 5
  }

  // Terrain height at a grid corner = mean of the 4 cells meeting there. Adjacent road cells
  // share corners, so the draped ribbon stays continuous (no stair-steps) and ramps over slopes.
  private cornerY(gx: number, gy: number): number {
    const t = this.sim.state.terrain
    const cl = (v: number) => Math.max(0, Math.min(t.size - 1, v))
    const avg =
      (t.worldY(cl(gx - 1), cl(gy - 1)) + t.worldY(cl(gx), cl(gy - 1)) + t.worldY(cl(gx - 1), cl(gy)) + t.worldY(cl(gx), cl(gy))) / 4
    // Clamp to the sea plane: at the coast some of the 4 corner cells are below sea level (ocean),
    // which would otherwise pull the road corner into the water visually.
    return Math.max(0, avg)
  }

  // Rebuild road geometry: packed-earth quads draped on the terrain + dashed centre lines.
  // Two things keep the ribbon reading as a GRADED ROADBED instead of a floating plank (the operator's
  // complaint): (1) shared corner heights are RELAXED toward their road-network neighbours, so grades
  // ease in and out smoothly; (2) every boundary edge gets an embankment SKIRT dropping toward the
  // ground, so wherever the bed bridges a hollow it reads as built-up earthworks, never floating.
  private rebuildRoads() {
    const s = this.sim.state
    const g = gridOrigin(s)
    const B = COLONY.build.block
    const LIFT = 0.05
    const SKIRT = 0.9 // embankment depth below the bed edge
    const surf: number[] = []
    const line: number[] = []
    // Spec 084 S3 — the avenue gets its own asphalt surface + kerb strips; streets keep the earth bed.
    const surfA: number[] = []
    const kerb: number[] = []
    const tri = (arr: number[], a: number[], b: number[], c: number[]) => arr.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, c[0]!, c[1]!, c[2]!)
    const quad = (arr: number[], a: number[], b: number[], c: number[], d: number[]) => { tri(arr, a, c, b); tri(arr, b, c, d) }
    const roadKey = (x: number, y: number) => `${x},${y}`
    const roadSet = new Set(s.roads.map((r) => roadKey(r.x, r.y)))
    // 1) collect every unique corner of the network with its terrain-sampled base height
    const ck = (gx: number, gy: number) => `${gx},${gy}`
    const heights = new Map<string, number>()
    for (const r of s.roads) {
      for (const [gx, gy] of [[r.x, r.y], [r.x + 1, r.y], [r.x, r.y + 1], [r.x + 1, r.y + 1]] as const) {
        const k = ck(gx, gy)
        if (!heights.has(k)) heights.set(k, this.cornerY(gx, gy))
      }
    }
    // 2) relax each corner toward its network neighbours — two passes ease the grade transitions
    for (let pass = 0; pass < 2; pass++) {
      const next = new Map<string, number>()
      for (const [k, h] of heights) {
        const [gx, gy] = k.split(',').map(Number) as [number, number]
        let sum = 0, n = 0
        for (const [nx, ny] of [[gx + 1, gy], [gx - 1, gy], [gx, gy + 1], [gx, gy - 1]] as const) {
          const nh = heights.get(ck(nx, ny))
          if (nh !== undefined) { sum += nh; n++ }
        }
        next.set(k, n > 0 ? h * 0.5 + (sum / n) * 0.5 : h)
      }
      for (const [k, h] of next) heights.set(k, h)
    }
    const cornerAt = (gx: number, gy: number): number[] => [this.wx(gx) - 0.5, (heights.get(ck(gx, gy)) ?? this.cornerY(gx, gy)) + LIFT, this.wz(gy) - 0.5]
    // 3) surface + skirts, split per road kind (spec 084 S3)
    const isAvenue = (x: number, y: number) => s.roadKind.get(roadKey(x, y)) === 'avenue'
    for (const r of s.roads) {
      const x = r.x, y = r.y
      const avenue = (r.kind ?? 'street') === 'avenue'
      const bed = avenue ? surfA : surf
      const c00 = cornerAt(x, y), c10 = cornerAt(x + 1, y), c01 = cornerAt(x, y + 1), c11 = cornerAt(x + 1, y + 1)
      quad(bed, c00, c10, c01, c11)
      const drop = (p: number[]): number[] => [p[0]!, p[1]! - SKIRT, p[2]!]
      // a skirt on every edge not shared with another road cell
      if (!roadSet.has(roadKey(x, y - 1))) quad(bed, c00, c10, drop(c00), drop(c10))
      if (!roadSet.has(roadKey(x, y + 1))) quad(bed, c01, c11, drop(c01), drop(c11))
      if (!roadSet.has(roadKey(x - 1, y))) quad(bed, c00, c01, drop(c00), drop(c01))
      if (!roadSet.has(roadKey(x + 1, y))) quad(bed, c10, c11, drop(c10), drop(c11))
      const lift = (p: number[], dx: number, dz: number): number[] => [p[0]! + dx, p[1]! + 0.045, p[2]! + dz]
      if (avenue) {
        // KERBS: a raised concrete strip along every edge not shared with another avenue cell.
        if (!isAvenue(x, y - 1)) quad(kerb, lift(c00, 0, 0), lift(c10, 0, 0), lift(c00, 0, 0.16), lift(c10, 0, 0.16))
        if (!isAvenue(x, y + 1)) quad(kerb, lift(c01, 0, -0.16), lift(c11, 0, -0.16), lift(c01, 0, 0), lift(c11, 0, 0))
        if (!isAvenue(x - 1, y)) quad(kerb, lift(c00, 0, 0), lift(c00, 0.16, 0), lift(c01, 0, 0), lift(c01, 0.16, 0))
        if (!isAvenue(x + 1, y)) quad(kerb, lift(c10, -0.16, 0), lift(c10, 0, 0), lift(c11, -0.16, 0), lift(c11, 0, 0))
        // CENTRE DASHES: every other cell, oriented along the run (the avenue bends with terrain).
        if ((x + y) % 2 === 0) {
          const h = (c00[1]! + c10[1]! + c01[1]! + c11[1]!) / 4 + 0.03
          const wx = this.wx(x), wz = this.wz(y)
          const runX = isAvenue(x - 1, y) || isAvenue(x + 1, y)
          if (runX) quad(line, [wx - 0.3, h, wz - 0.05], [wx + 0.3, h, wz - 0.05], [wx - 0.3, h, wz + 0.05], [wx + 0.3, h, wz + 0.05])
          else quad(line, [wx - 0.05, h, wz - 0.3], [wx + 0.05, h, wz - 0.3], [wx - 0.05, h, wz + 0.3], [wx + 0.05, h, wz + 0.3])
        }
        continue
      }
      const onV = ((((x - g.x) % B) + B) % B) === 0 // on a north-south grid line
      const onH = ((((y - g.y) % B) + B) % B) === 0 // on an east-west grid line
      if (onV === onH) continue // intersection or off-grid fill -> no centre dash
      const h = (c00[1]! + c10[1]! + c01[1]! + c11[1]!) / 4 + 0.03
      const wx = this.wx(x), wz = this.wz(y)
      if (onV) quad(line, [wx - 0.05, h, wz - 0.3], [wx + 0.05, h, wz - 0.3], [wx - 0.05, h, wz + 0.3], [wx + 0.05, h, wz + 0.3])
      else quad(line, [wx - 0.3, h, wz - 0.05], [wx + 0.3, h, wz - 0.05], [wx - 0.3, h, wz + 0.05], [wx + 0.3, h, wz + 0.05])
    }
    const setPos = (mesh: THREE.Mesh, arr: number[]) => {
      const geo = mesh.geometry as THREE.BufferGeometry
      geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3))
      geo.computeVertexNormals()
    }
    setPos(this.roadSurfaceMesh, surf)
    setPos(this.roadLineMesh, line)
    setPos(this.avenueSurfaceMesh, surfA)
    setPos(this.avenueKerbMesh, kerb)
  }

  private updateColonyLayer() {
    const s = this.sim.state
    const t = s.terrain
    if (s.settlers.length !== this.lastSettlerCount) {
      this.rebuildSettlerHomes()
      this.lastSettlerCount = s.settlers.length
    }
    // roads drape on the terrain; rebuild the ribbon on ANY network mutation (spec 084 S1 — a
    // length check missed equal-length purge-then-lay mutations and drew roads that were gone)
    if (s.roadsVersion !== this.lastRoadsVersion) {
      this.rebuildRoads()
      this.lastRoadsVersion = s.roadsVersion
    }
    // as the cleared footprint (roads + buildings + worksites) changes, re-clear the trees from it and refresh the
    // pavement the ambient pedestrians stroll along.
    const folSig = s.roads.length * 100003 + s.buildings.length * 101 + s.jobs.length + (s.cityPlan ? s.cityPlan.plots.length * 7 : 0)
    if (folSig !== this.lastFoliageSig) {
      this.buildFoliage()
      this.roadCells = s.roads.map((r) => ({ x: r.x, y: r.y }))
      this.lastFoliageSig = folSig
    }
    const rn = s.roads.length
    // plot markers reflect allocation changes (allocated → dim flag, lowered pole)
    if (s.cityPlan) {
      this.syncPlotMarkers(s.cityPlan.plots)
      this.buildPlotPads(s.cityPlan.plots) // sized foundations + spoke roads to the marked plots
    }

    const col = new THREE.Color()
    const cap = COLONY.build.maxBuildings + 8
    // Spec 011 — when the liveability overlay is on AND a survey office is up, tint homes by wellbeing.
    const liveOn = this.liveabilityOn && surveyAvailable(s)
    let bi = 0
    for (const b of s.buildings) {
      if (bi >= cap) break
      this.dummy.position.set(this.wx(b.x), Math.max(0, t.worldY(b.x, b.y)), this.wz(b.y))
      this.dummy.scale.set(1, Math.max(0.15, b.artifact.height), 1)
      this.dummy.rotation.set(0, 0, 0)
      this.dummy.updateMatrix()
      this.bldgMesh.setMatrixAt(bi, this.dummy.matrix)
      if (liveOn && b.artifact.kind === 'habitat') col.setHex(liveabilityTint(homeLiveability(s, b)))
      else col.setHex(b.artifact.color)
      this.bldgMesh.setColorAt(bi, col)
      bi++
    }
    const car = s.structures.find((st) => st.kind === 'caravan')!
    let ci = 0
    for (const j of s.jobs) {
      if (bi < cap) {
        const phase = Math.max(0, (j.progress - 0.25) / 0.75) // rises only after the crew arrives
        this.dummy.position.set(this.wx(j.x), Math.max(0, t.worldY(j.x, j.y)), this.wz(j.y))
        this.dummy.scale.set(1, Math.max(0.04, j.artifact.height * phase), 1)
        this.dummy.rotation.set(0, 0, 0)
        this.dummy.updateMatrix()
        this.bldgMesh.setMatrixAt(bi, this.dummy.matrix)
        col.setHex(j.artifact.color).multiplyScalar(0.55) // under construction = darker
        this.bldgMesh.setColorAt(bi, col)
        bi++
      }
      // crew truck drives caravan -> site ALONG THE ROADS over the first quarter, then parks
      if (ci < cap) {
        const drive = Math.min(1, j.progress / 0.25)
        let cx: number, cy: number, heading: number
        const path = j.path
        if (path && path.length > 0) {
          const W = t.size
          const fpos = drive * path.length
          const i0 = Math.min(path.length - 1, Math.floor(fpos))
          const a = path[i0]!
          const b = path[Math.min(path.length - 1, i0 + 1)]!
          const frac = fpos - i0
          const ax = (a % W) + 0.5, ay = ((a / W) | 0) + 0.5
          const bx = (b % W) + 0.5, by = ((b / W) | 0) + 0.5
          cx = ax + (bx - ax) * frac
          cy = ay + (by - ay) * frac
          heading = Math.hypot(bx - ax, by - ay) > 1e-4 ? Math.atan2(by - ay, bx - ax) : 0
        } else {
          cx = car.x + (j.x - car.x) * drive
          cy = car.y + (j.y - car.y) * drive
          heading = Math.atan2(j.y - car.y, j.x - car.x)
        }
        this.dummy.position.set(this.wx(cx), this.smoothRoadY(Math.round(cx), Math.round(cy)) + 0.18, this.wz(cy))
        this.dummy.scale.set(1, 1, 1)
        this.dummy.rotation.set(0, -heading, 0)
        this.dummy.updateMatrix()
        this.crewMesh.setMatrixAt(ci, this.dummy.matrix)
        ci++
      }
    }
    this.bldgMesh.count = bi
    this.bldgMesh.instanceMatrix.needsUpdate = true
    if (this.bldgMesh.instanceColor) this.bldgMesh.instanceColor.needsUpdate = true
    this.crewMesh.count = ci
    this.crewMesh.instanceMatrix.needsUpdate = true

    // street lights at grid intersections (where both road lines cross)
    const B = COLONY.build.block
    const g = gridOrigin(s)
    let li = 0
    for (let i = 0; i < rn; i++) {
      if (li >= 360) break
      const r = s.roads[i]!
      if (((((r.x - g.x) % B) + B) % B) !== 0 || ((((r.y - g.y) % B) + B) % B) !== 0) continue
      this.dummy.position.set(this.wx(r.x) + 0.45, this.smoothRoadY(r.x, r.y), this.wz(r.y) + 0.45)
      this.dummy.scale.set(1, 1, 1)
      this.dummy.rotation.set(0, 0, 0)
      this.dummy.updateMatrix()
      this.streetPostMesh.setMatrixAt(li, this.dummy.matrix)
      this.streetHeadMesh.setMatrixAt(li, this.dummy.matrix)
      li++
    }
    this.streetPostMesh.count = li
    this.streetHeadMesh.count = li
    this.streetPostMesh.instanceMatrix.needsUpdate = true
    this.streetHeadMesh.instanceMatrix.needsUpdate = true

    // cars — South African rules: keep LEFT. Driver's-left of heading h is (sin h, -cos h)
    // in lot coords, so a car heading south (+y) sits on the east (+x) side, i.e. its left.
    // The sim ticks at 6 Hz; we exponentially smooth each car's position + heading toward the
    // sim state every frame so motion is fluid at 60 fps and turns (with the lane offset) ease
    // instead of snapping a car sideways across the road at every corner.
    const carCol = new THREE.Color()
    const off = COLONY.traffic.laneOffset
    const cn = Math.min(s.cars.length, COLONY.traffic.maxCars + 4)
    this.carsMesh.count = cn
    const carNow = performance.now()
    const carDt = this.lastCarT ? Math.min(0.05, (carNow - this.lastCarT) / 1000) : 1 / 60
    this.lastCarT = carNow
    const aPos = 1 - Math.exp(-carDt * 16) // position catch-up (fast, ~1 frame lag)
    const aHed = 1 - Math.exp(-carDt * 9) // heading ease (slower, smooth turns)
    const liveCars = new Set<number>()
    for (let i = 0; i < cn; i++) {
      const v = s.cars[i]!
      liveCars.add(v.id)
      let e = this.carRender.get(v.id)
      if (!e) {
        e = { x: v.x, y: v.y, h: v.heading }
        this.carRender.set(v.id, e)
      }
      // A re-route can jump a car a long way; snap rather than glide it across the map.
      if (Math.hypot(v.x - e.x, v.y - e.y) > 3) {
        e.x = v.x
        e.y = v.y
        e.h = v.heading
      }
      e.x += (v.x - e.x) * aPos
      e.y += (v.y - e.y) * aPos
      let dh = v.heading - e.h
      dh -= Math.round(dh / (Math.PI * 2)) * (Math.PI * 2) // wrap to [-PI, PI]
      e.h += dh * aHed
      const lx = e.x + Math.sin(e.h) * off
      const ly = e.y - Math.cos(e.h) * off
      this.dummy.position.set(this.wx(lx), this.smoothRoadY(Math.round(e.x), Math.round(e.y)) + 0.12, this.wz(ly))
      this.dummy.rotation.set(0, -e.h, 0)
      this.dummy.scale.set(1, 1, 1)
      this.dummy.updateMatrix()
      this.carsMesh.setMatrixAt(i, this.dummy.matrix)
      carCol.setHex(v.color)
      this.carsMesh.setColorAt(i, carCol)
    }
    // Drop smoothing state for any car that is no longer present.
    if (this.carRender.size > cn) {
      for (const id of this.carRender.keys()) if (!liveCars.has(id)) this.carRender.delete(id)
    }
    this.carsMesh.instanceMatrix.needsUpdate = true
    if (this.carsMesh.instanceColor) this.carsMesh.instanceColor.needsUpdate = true

    // day/night emissive: lamps glow and building windows light up after dark
    const night = 1 - s.clock.daylight
    ;(this.streetHeadMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.2 + night * 1.4
    const bmat = this.bldgMesh.material as THREE.MeshStandardMaterial
    bmat.emissive.setHex(0xffd9a0)
    bmat.emissiveIntensity = night * 0.4
    // Cars glow softly after dark so night traffic reads as moving lights flowing along the roads.
    const cmat = this.carsMesh.material as THREE.MeshStandardMaterial
    cmat.emissive.setHex(0xfff0d0)
    cmat.emissiveIntensity = night * 0.5
  }

  frame() {
    if (this.disposed) return
    this.updateDayNight()
    // Spec 084 S5 — staged terrain recolor: at most 8 dirty chunks repaint per frame.
    this.chunkedTerrain.recolor((i, out) => this.colorFor(this.view, i, out), 8)
    this.updateColonyLayer()
    this.updatePedestrians()
    this.updatePorters() // spec 073 — goods piled at the sheds + porter carts on the roads
    this.updateAvatars() // P1 — the named citizen avatars at their live roster positions
    this.updateNeighborhood() // spec 075 — lot pads + voxel homes
    if (this.beaconMat) {
      const blink = Math.max(0, Math.sin((performance.now() / 1000) * 2.4))
      this.beaconMat.emissiveIntensity = 0.35 + blink * blink * 2.6
    }
    this.shoreProps?.update(this.sim.state.clock.daylight, performance.now())
    if (this.fpCitizenId && this.avatarSource) {
      // P1 — first-person: park the camera at the citizen's eye and look down their heading. OrbitControls is off.
      const a = this.avatarSource().find((x) => x.id === this.fpCitizenId)
      if (a) {
        const t = this.sim.state.terrain
        const isCrab = a.kind === 'crab' // spec 078 — Joe sees the world from down at crab height
        const eye = Math.max(0, t.worldY(Math.round(a.x), Math.round(a.y))) + (isCrab ? CRAB_EYE : 1.6)
        this.camera.position.set(this.wx(a.x), eye, this.wz(a.y))
        const lx = a.x + Math.cos(a.heading) * 4, ly = a.y + Math.sin(a.heading) * 4
        const lyW = Math.max(0, t.worldY(Math.round(lx), Math.round(ly))) + (isCrab ? CRAB_EYE - 0.05 : 1.2)
        this.camera.lookAt(this.wx(lx), lyW, this.wz(ly))
        this.camera.updateMatrixWorld()
      } else {
        this.exitFirstPerson() // the citizen vanished — fall back to orbit
      }
    } else {
      if (this.cinematic) this.updateCinematic()
      this.controls.update()
    }
    this.composer.render()
  }

  /** Toggle the TV-mode cinematic fly-around. Camera slowly orbits + breathes around the landing
   *  site so the city + landscape become a moving postcard while music plays. */
  setCinematic(on: boolean): void {
    if (on === this.cinematic) return
    this.cinematic = on
    if (on) this.cinematicT0 = performance.now()
  }

  /** Render a fresh frame and return it as a PNG data URL — used by the HUD snapshot button. */
  capturePNG(): string {
    this.composer.render()
    return this.renderer.domElement.toDataURL('image/png')
  }

  /** Spec 074 — the citizen's VISION. Drop the camera to standing eye height (1.6) at the citizen's home cell, face the
   *  nearest road, render one frame, and return what they see as a PNG data URL. The live orbit pose is saved and restored,
   *  so the operator's view is untouched. This is the image the governor loop pairs with the bot's words to decide what the
   *  colony changes for the people who live in it. home + look are grid cells (the runtime resolves them from the roster). */
  firstPersonPNG(home: { x: number; y: number }, look: { x: number; y: number }): string {
    const t = this.sim.state.terrain
    const savedPos = this.camera.position.clone()
    const savedTarget = this.controls.target.clone()
    const EYE = 1.6
    const hy = Math.max(0, t.worldY(Math.round(home.x), Math.round(home.y))) + EYE
    this.camera.position.set(this.wx(home.x), hy, this.wz(home.y))
    const ly = Math.max(0, t.worldY(Math.round(look.x), Math.round(look.y))) + 1.0 // look at head height down the street
    this.camera.lookAt(this.wx(look.x), ly, this.wz(look.y))
    this.camera.updateMatrixWorld()
    this.composer.render()
    const url = this.renderer.domElement.toDataURL('image/png')
    // restore the operator's orbit pose exactly
    this.camera.position.copy(savedPos)
    this.controls.target.copy(savedTarget)
    this.controls.update()
    this.composer.render()
    return url
  }

  private pedOnLand(x: number, y: number): boolean {
    const t = this.sim.state.terrain
    const ix = Math.round(x), iy = Math.round(y)
    if (ix < 0 || iy < 0 || ix >= t.size || iy >= t.size) return false
    return !t.isWater(ix, iy)
  }

  /** Pick a pedestrian's next stroll target: a nearby road cell (so they keep to the pavement), nudged a little to the
   *  kerb so they don't all walk the centre line. Falls back to a gentle wander near the landing before any streets exist. */
  private pickPedTarget(px: number, py: number, lx: number, ly: number): { x: number; y: number } {
    const rc = this.roadCells
    if (rc.length) {
      let near = rc.filter((c) => { const dd = Math.hypot(c.x - px, c.y - py); return dd > 1.5 && dd < 16 })
      if (!near.length) near = rc
      const c = near[(Math.random() * near.length) | 0]!
      return { x: c.x + (Math.random() - 0.5) * 0.5, y: c.y + (Math.random() - 0.5) * 0.5 }
    }
    for (let tries = 0; tries < 8; tries++) {
      const ang = Math.atan2(ly - py, lx - px) + (Math.random() - 0.5) * Math.PI * 1.6
      const step = 3 + Math.random() * 6
      const nx = px + Math.cos(ang) * step
      const ny = py + Math.sin(ang) * step
      if (this.pedOnLand(nx, ny) && Math.hypot(nx - lx, ny - ly) < 18) return { x: nx, y: ny }
    }
    return { x: px, y: py }
  }

  /** Seed a POOL of figures on land near the landing; how many are actually shown tracks the real colonist count (see
   *  updatePedestrians), so the crowd is the colony's own people — not a fixed decorative droid army. */
  private initPedestrians() {
    const t = this.sim.state.terrain
    const lx = t.landing.x, ly = t.landing.y
    const PED_COLORS = [0xe06a4d, 0x4d8fe0, 0xe6c84d, 0x57b86a, 0xc9c2b6, 0xb47ad6]
    const col = new THREE.Color()
    this.peds = []
    let guard = 0
    while (this.peds.length < 28 && guard++ < 800) {
      const a = Math.random() * Math.PI * 2
      const r = 2 + Math.random() * 14
      const x = lx + Math.cos(a) * r
      const y = ly + Math.sin(a) * r
      if (!this.pedOnLand(x, y)) continue
      this.peds.push({ x, y, tx: x, ty: y, spd: 0.5 + Math.random() * 0.7, phase: Math.random() * Math.PI * 2 })
    }
    this.peds.forEach((_, idx) => {
      col.setHex(PED_COLORS[idx % PED_COLORS.length]!)
      this.pedMesh.setColorAt(idx, col)
    })
    this.pedMesh.count = this.peds.length
    if (this.pedMesh.instanceColor) this.pedMesh.instanceColor.needsUpdate = true
  }

  /** Per-frame: stroll each visible pedestrian toward a nearby land target. The visible count tracks the REAL colonist
   *  population (capped to the pool), so the streets are as busy as the colony actually is — these are its people. */
  private updatePedestrians() {
    if (!this.pedMesh || this.peds.length === 0) return
    const t = this.sim.state.terrain
    const lx = t.landing.x, ly = t.landing.y
    const now = performance.now()
    const dt = this.lastPedT ? Math.min(0.05, (now - this.lastPedT) / 1000) : 1 / 60
    this.lastPedT = now
    const want = Math.max(0, Math.min(this.peds.length, Math.round(this.sim.state.colonists))) // one figure per real colonist
    for (let i = 0; i < want; i++) {
      const p = this.peds[i]!
      let dx = p.tx - p.x, dy = p.ty - p.y
      let d = Math.hypot(dx, dy)
      if (d < 0.4) {
        const next = this.pickPedTarget(p.x, p.y, lx, ly)
        p.tx = next.x
        p.ty = next.y
        dx = p.tx - p.x
        dy = p.ty - p.y
        d = Math.hypot(dx, dy)
      }
      if (d > 1e-3) {
        const move = Math.min(d, p.spd * dt)
        p.x += (dx / d) * move
        p.y += (dy / d) * move
        p.phase += dt * 8
      }
      const heading = Math.atan2(dy, dx)
      const bob = Math.abs(Math.sin(p.phase)) * 0.05
      const wy = Math.max(0, t.worldY(Math.round(p.x), Math.round(p.y)))
      this.dummy.position.set(this.wx(p.x), wy + bob, this.wz(p.y))
      this.dummy.rotation.set(0, -heading + Math.PI / 2, 0)
      this.dummy.scale.set(1, 1, 1)
      this.dummy.updateMatrix()
      this.pedMesh.setMatrixAt(i, this.dummy.matrix)
      this.pedHeadMesh.setMatrixAt(i, this.dummy.matrix) // the head rides the same transform, baked above the body
    }
    this.pedMesh.count = want
    this.pedMesh.instanceMatrix.needsUpdate = true
    this.pedHeadMesh.count = want
    this.pedHeadMesh.instanceMatrix.needsUpdate = true
  }

  /** P1 — the runtime supplies the live citizen avatar list (positions from the roster, decorated with isOperator). */
  setAvatarSource(fn: () => AvatarView[]): void {
    this.avatarSource = fn
  }

  /** Spec 075 — hand the renderer the neighbourhood (by reference); it draws the lot pads + voxel homes,
   *  rebuilding only when a lot's owned/built state changes. */
  setNeighborhood(n: Neighborhood): void {
    this.neighborhood = n
    this.lastNbhdSig = '' // force a rebuild on the next frame
  }

  /** Spec 076 — draw the homestead neighbourhood: the spine carriageway + verge ribbon, then each
   *  bordered parcel (zone ground pads + fence ring + driveway always; the worked farm crops, garden
   *  beds, trees and the set-back voxel house once built). Rebuilt only when the signature changes. */
  private updateNeighborhood() {
    if (!this.neighborhood || !this.lotPadMesh || !this.voxelMesh) return
    const n = this.neighborhood
    const lots = n.parcels
    // Spec 077 — the blueprint is part of the signature so a newly authored/edited script triggers a rebuild.
    const sig = lots.map((l) => `${l.id}:${l.ownerCitizenId ? 1 : 0}:${l.built ? 1 : 0}:${l.blueprint ?? ''}`).join('|') + `#${n.carriage.length}`
    if (sig === this.lastNbhdSig) return
    this.lastNbhdSig = sig
    const t = this.sim.state.terrain
    const col = new THREE.Color()
    const BH = 0.56 // block height (the box geometry's y size)
    // SMOOTHED per-cell ground (5-point average): tiles follow the land's grade without per-cell
    // flutter. The old single leveled height per homestead left the downhill half of a sloped parcel
    // floating in the air (operator feedback) — now only the house keeps a leveled foundation.
    const gy = (x: number, y: number) => Math.max(0, this.smoothRoadY(Math.round(x), Math.round(y)))
    const PAD_DEPTH = 0.6 // must match padGeo's y size

    let p = 0 // pad instance index
    let v = 0 // voxel instance index
    // A ground tile spanning a rect (min-corner zx,zy, size zw x zd) whose TOP face sits at hOff above
    // the ground. The deep body sinks into the terrain. `groundY`, when given, levels the tile on a
    // fixed foundation height (the house slab) instead of sampling the smoothed per-cell terrain.
    let padOverflow = 0, voxOverflow = 0 // spec 084 S1 — silent cap truncation hid missing scenery
    const padRect = (zx: number, zy: number, zw: number, zd: number, hOff: number, color: number, groundY?: number) => {
      if (p >= PAD_CAP) { padOverflow++; return }
      const cx = zx + (zw - 1) / 2, cy = zy + (zd - 1) / 2
      this.dummy.position.set(this.wx(cx), (groundY ?? gy(cx, cy)) + hOff - PAD_DEPTH / 2, this.wz(cy))
      this.dummy.rotation.set(0, 0, 0)
      this.dummy.scale.set(zw, 1, zd)
      this.dummy.updateMatrix()
      this.lotPadMesh.setMatrixAt(p, this.dummy.matrix)
      col.setHex(color)
      this.lotPadMesh.setColorAt(p, col)
      p++
    }
    const padCell = (x: number, y: number, hOff: number, color: number, groundY?: number) => padRect(x, y, 1, 1, hOff, color, groundY)
    // A scaled cube at cell (x,y) whose bottom rests on the ground (or the given foundation) + zBase.
    const block = (x: number, y: number, sx: number, sy: number, sz: number, zBase: number, color: number, groundY?: number) => {
      if (v >= VOX_CAP) { voxOverflow++; return }
      this.dummy.position.set(this.wx(x), (groundY ?? gy(x, y)) + zBase + (BH * sy) / 2, this.wz(y))
      this.dummy.rotation.set(0, 0, 0)
      this.dummy.scale.set(sx, sy, sz)
      this.dummy.updateMatrix()
      this.voxelMesh.setMatrixAt(v, this.dummy.matrix)
      col.setHex(color)
      this.voxelMesh.setColorAt(v, col)
      v++
    }

    // ── the spine verge: the grass kerb strip beside the avenue. The carriageway itself is now a
    // real AVENUE in state.roads (spec 084 S3) — rebuildRoads draws its asphalt, kerbs and dashes.
    for (const c of n.verge) padCell(c.x, c.y, 0.045, 0x5d7a3c)

    // ── each homestead parcel ──
    for (const lot of lots) {
      const fenceColor = lot.fenceType === 'hedge' ? BLOCK_COLOR.hedge : lot.fenceType === 'wall' ? BLOCK_COLOR.stone : BLOCK_COLOR.fence
      // The HOUSE keeps one leveled foundation height (a real slab); everything else — garden, farm,
      // driveway, fence — follows the smoothed per-cell terrain like real fields and paths do. The old
      // single homestead height left the downhill half of a sloped parcel hanging in the air.
      const hcx = lot.houseZone.x + (lot.houseZone.w - 1) / 2, hcy = lot.houseZone.y + (lot.houseZone.d - 1) / 2
      const py = gy(hcx, hcy)
      // surveyed homestead ground (drawn whether or not it is built, so the borders read immediately).
      // Distinct pad heights (garden < farm < house < driveway) avoid coplanar z-fighting.
      padRect(lot.houseZone.x, lot.houseZone.y, lot.houseZone.w, lot.houseZone.d, 0.05, lot.built ? 0x6b5a44 : 0x5c5140, py)
      for (let yy = lot.garden.y; yy < lot.garden.y + lot.garden.d; yy++) for (let xx = lot.garden.x; xx < lot.garden.x + lot.garden.w; xx++) padCell(xx, yy, 0.038, 0x4f6f33)
      for (let yy = lot.farm.y; yy < lot.farm.y + lot.farm.d; yy++) for (let xx = lot.farm.x; xx < lot.farm.x + lot.farm.w; xx++) padCell(xx, yy, 0.044, 0x6e4a30)
      for (const d of lot.driveway) padCell(d.x, d.y, 0.056, BLOCK_COLOR.path)
      padCell(lot.gate.x, lot.gate.y, 0.056, BLOCK_COLOR.path)
      // the visible parcel border — a fence/hedge/wall ring riding the land, raised clear of the pads
      for (const f of lot.fence) block(f.x, f.y, 0.26, 0.9, 0.26, 0.06, fenceColor)

      // Spec 084 S1 — houses rebuild PER LOT: one accepted blueprint recompiles ONE micro-grid, not
      // every house in the street (the old wholesale mergedHouseGroup teardown made each save pay
      // for the whole neighborhood). Keyed on exactly what the compiled mesh depends on.
      const doorDir = streetDoorDir(lot) // single source — only the no-blueprint fallback uses it
      const houseKey = lot.built ? `${lot.blueprint ?? ''}~${py}` : ''
      if (this.lotHouseKey.get(lot.id) !== houseKey) {
        const old = this.mergedHouseGroup.getObjectByName(lot.id) as THREE.Mesh | undefined
        if (old) {
          this.mergedHouseGroup.remove(old)
          old.geometry?.dispose()
        }
        if (lot.built) {
          // Spec 077 — every built house raises a FANCY BRICK home through the merged greedy-meshed
          // path: an authored blueprint when the parcel carries one, else the deterministic
          // defaultBlueprint from the house seed, with the masonry banding baked into vertex colours.
          this.addMergedHouse(lot.id, lot.houseZone, lot.blueprint ?? defaultBlueprint(lot.houseSeed, doorDir, lot.houseZone.w), lot.houseSeed, py)
        }
        this.lotHouseKey.set(lot.id, houseKey)
      }

      if (!lot.built) continue
      // worked homestead: farm furrows (alternating crop colour by row) riding their own field cells
      for (let yy = lot.farm.y; yy < lot.farm.y + lot.farm.d; yy++) {
        for (let xx = lot.farm.x; xx < lot.farm.x + lot.farm.w; xx++) {
          block(xx, yy, 0.82, 0.5, 0.82, 0.05, yy % 2 === 0 ? BLOCK_COLOR.crop : BLOCK_COLOR.cropAlt)
        }
      }
      // garden veg beds on alternate cells
      for (let yy = lot.garden.y; yy < lot.garden.y + lot.garden.d; yy++) {
        for (let xx = lot.garden.x; xx < lot.garden.x + lot.garden.w; xx++) {
          if ((xx + yy) % 2 === 0) block(xx, yy, 0.78, 0.38, 0.78, 0.05, BLOCK_COLOR.crop)
        }
      }
      // a fruit tree at one garden corner + a well at the other
      const tx = lot.garden.x, ty = lot.garden.y
      block(tx, ty, 0.28, 1.1, 0.28, 0.05, BLOCK_COLOR.trunk)
      block(tx, ty, 0.95, 0.95, 0.95, 0.05 + BH * 1.1, BLOCK_COLOR.leaf)
      block(lot.garden.x + lot.garden.w - 1, lot.garden.y + lot.garden.d - 1, 0.6, 0.7, 0.6, 0.05, BLOCK_COLOR.well)

    }

    if ((padOverflow > 0 || voxOverflow > 0) && import.meta.env.DEV) {
      console.warn(`[citylife] instance caps hit: ${padOverflow} pads + ${voxOverflow} voxels DROPPED — scenery is silently missing; raise PAD_CAP/VOX_CAP (spec 084 S1)`)
    }
    this.lotPadMesh.count = p
    this.lotPadMesh.instanceMatrix.needsUpdate = true
    if (this.lotPadMesh.instanceColor) this.lotPadMesh.instanceColor.needsUpdate = true
    this.voxelMesh.count = v
    this.voxelMesh.instanceMatrix.needsUpdate = true
    if (this.voxelMesh.instanceColor) this.voxelMesh.instanceColor.needsUpdate = true
  }

  /** Spec 077 P2 — compile a blueprint to its micro-occupancy, greedy-mesh it to ONE merged BufferGeometry,
   *  and parent it at the house-zone's min-corner. The mesh is built in tile-local units (small vertex
   *  coordinates): each micro-block is 1/n of a plot cell across, voxelY tall, so a 2-storey home is a
   *  sensible height. The merged geometry reads as fancy brick masonry — the per-course tint banding is
   *  carried in the vertex colours and the flat per-quad normals keep every face crisp. */
  private addMergedHouse(lotId: string, zone: Zone, script: string, seed: number, groundY: number): void {
    let compiled
    try {
      compiled = compileBlueprint(script, { w: zone.w, d: zone.d, seed })
    } catch {
      return // a malformed script never crashes the renderer — the lot simply draws no house
    }
    const { geometry } = greedyMesh(compiled.blocks, { n: compiled.n, cell: 1, voxelY: VOXEL_Y })
    const mesh = new THREE.Mesh(geometry, this.mergedHouseMat)
    mesh.name = lotId // the per-lot incremental rebuild finds + disposes it by name (spec 084 S1)
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.frustumCulled = false
    // Parent at the house-zone's min-corner: cell `zone.x` spans world [wx(zone.x)-0.5, +0.5], and the mesh's
    // local origin is the micro-grid corner, so offset by half a cell to seat it flush on the zone.
    mesh.position.set(this.wx(zone.x) - 0.5, groundY + 0.05, this.wz(zone.y) - 0.5)
    this.mergedHouseGroup.add(mesh)
  }

  /** P1 — step the camera INTO a citizen for a live first-person view (the operator looking through their bot's
   *  eyes). OrbitControls is suspended while active; frame() parks the camera at eye height on the live avatar. */
  enterFirstPerson(citizenId: string): void {
    this.fpCitizenId = citizenId
    this.controls.enabled = false
  }
  /** P1 — leave first-person and restore the orbit camera. */
  exitFirstPerson(): void {
    if (this.fpCitizenId === null) return
    this.fpCitizenId = null
    this.controls.enabled = true
  }
  get firstPersonCitizen(): string | null {
    return this.fpCitizenId
  }

  /** Spec 078 — build Joe the Crab as ONE merged, vertex-coloured BufferGeometry (so a single
   *  vertexColors + flatShading material draws him). Local space: origin at the ground plane, FRONT = +Z
   *  (the shared avatar heading rotation then faces his eyes + claws down his travel direction). Locked to
   *  his portrait: an orange-red shell, two stalked eyes, two pincer claws, six legs, a blue-white headset
   *  with exactly one yellow lightning bolt on a single earcup. */
  private makeCrabGeometry(): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = []
    const tint = new THREE.Color()
    const add = (
      g: THREE.BufferGeometry, hex: number,
      pos: [number, number, number], rot?: [number, number, number], scale?: [number, number, number],
    ) => {
      if (scale) g.scale(scale[0], scale[1], scale[2])
      if (rot) { g.rotateX(rot[0]); g.rotateY(rot[1]); g.rotateZ(rot[2]) }
      g.translate(pos[0], pos[1], pos[2])
      const count = g.attributes.position!.count
      const colors = new Float32Array(count * 3)
      tint.setHex(hex)
      for (let i = 0; i < count; i++) { colors[i * 3] = tint.r; colors[i * 3 + 1] = tint.g; colors[i * 3 + 2] = tint.b }
      g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
      parts.push(g)
    }
    const SHELL = 0xe2562f, SHELL_DK = 0xc23f1f, EYE_W = 0xf6f6f6, EYE_P = 0x101010
    const BAND = 0xdfe7f2, CUP = 0x2f6fd0, BOLT = 0xf4c020
    // shell — a flattened dome, wider across (x) than deep (z)
    add(new THREE.SphereGeometry(0.30, 14, 10), SHELL, [0, 0.26, 0], undefined, [1.25, 0.6, 1.0])
    // eyes — two forward stalks (+z) each capped with a white eyeball + dark pupil
    for (const s of [-1, 1]) {
      add(new THREE.CylinderGeometry(0.024, 0.024, 0.16, 6), SHELL_DK, [s * 0.12, 0.36, 0.18], [0.55, 0, 0])
      add(new THREE.SphereGeometry(0.062, 8, 6), EYE_W, [s * 0.12, 0.46, 0.25])
      add(new THREE.SphereGeometry(0.03, 6, 6), EYE_P, [s * 0.12, 0.47, 0.30])
    }
    // claws — an upper arm reaching forward-out + a two-prong pincer (mirrored)
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(0.10, 0.10, 0.26), SHELL, [s * 0.30, 0.18, 0.22])
      add(new THREE.BoxGeometry(0.12, 0.16, 0.12), SHELL, [s * 0.34, 0.20, 0.40])
      add(new THREE.BoxGeometry(0.05, 0.05, 0.16), SHELL_DK, [s * 0.34, 0.26, 0.50])
      add(new THREE.BoxGeometry(0.05, 0.05, 0.13), SHELL_DK, [s * 0.34, 0.16, 0.49])
    }
    // legs — three per side, thin cylinders splayed down-out to the ground
    for (const s of [-1, 1]) {
      for (const dz of [-0.16, 0.02, 0.18]) {
        add(new THREE.CylinderGeometry(0.02, 0.02, 0.26, 5), SHELL_DK, [s * 0.34, 0.10, dz], [0, 0, s * 0.95])
      }
    }
    // headset — a half-torus band arching over the top (side to side) + two earcups
    add(new THREE.TorusGeometry(0.28, 0.03, 6, 18, Math.PI), BAND, [0, 0.27, 0])
    for (const s of [-1, 1]) add(new THREE.CylinderGeometry(0.085, 0.085, 0.05, 14), CUP, [s * 0.28, 0.27, 0], [0, 0, Math.PI / 2])
    // exactly ONE yellow lightning accent, on the +x earcup only (matches his portrait)
    add(new THREE.BoxGeometry(0.05, 0.11, 0.025), BOLT, [0.32, 0.30, 0], [0, 0, 0.35])
    const merged = mergeGeometries(parts, false)
    for (const p of parts) p.dispose()
    return merged
  }

  /** P1 — draw the citizen avatars at their live roster positions. The one the operator owns glows cyan; the
   *  citizen currently being stepped-into is hidden (the camera is inside it). Spec 078 — citizens whose
   *  kind is 'crab' (Joe) draw into the crab mesh instead of the human capsule + head. */
  private updateAvatars() {
    if (!this.avatarMesh || !this.avatarHeadMesh || !this.crabMesh || !this.avatarSource) return
    const list = this.avatarSource()
    const t = this.sim.state.terrain
    const n = Math.min(list.length, 64)
    const col = new THREE.Color()
    let drawn = 0, crab = 0
    for (let i = 0; i < n; i++) {
      const a = list[i]!
      if (a.id === this.fpCitizenId) continue // hide the avatar we are looking out of
      const wy = Math.max(0, t.worldY(Math.round(a.x), Math.round(a.y)))
      this.dummy.position.set(this.wx(a.x), wy, this.wz(a.y))
      this.dummy.rotation.set(0, -a.heading + Math.PI / 2, 0)
      this.dummy.scale.set(1, 1, 1)
      this.dummy.updateMatrix()
      if (a.kind === 'crab') {
        this.crabMesh.setMatrixAt(crab, this.dummy.matrix)
        crab++
      } else {
        this.avatarMesh.setMatrixAt(drawn, this.dummy.matrix)
        this.avatarHeadMesh.setMatrixAt(drawn, this.dummy.matrix)
        col.setHex(a.isOperator ? 0x66e0ff : a.hasPod ? 0x9f86d8 : 0xc0b0e0)
        this.avatarMesh.setColorAt(drawn, col)
        drawn++
      }
    }
    this.avatarMesh.count = drawn
    this.avatarMesh.instanceMatrix.needsUpdate = true
    if (this.avatarMesh.instanceColor) this.avatarMesh.instanceColor.needsUpdate = true
    this.avatarHeadMesh.count = drawn
    this.avatarHeadMesh.instanceMatrix.needsUpdate = true
    this.crabMesh.count = crab
    this.crabMesh.instanceMatrix.needsUpdate = true
  }

  /** Spec 073 — the Porter Sheds made visible: goods pile up as crates (materials) + sacks (food) beside each shed, growing and
   *  shrinking with the LIVE stock, and porter handcarts run the road network while a shed is staffed. Never on water. Inert with no shed. */
  private updatePorters() {
    if (!this.porterPileMesh || !this.porterCartMesh) return
    const s = this.sim.state
    const t = s.terrain
    const sheds = s.buildings.filter((b) => b.artifact.kind === 'porter')
    if (sheds.length === 0) {
      if (this.porterPileMesh.count !== 0) { this.porterPileMesh.count = 0; this.porterPileMesh.instanceMatrix.needsUpdate = true }
      if (this.porterCartMesh.count !== 0) { this.porterCartMesh.count = 0; this.porterCartMesh.instanceMatrix.needsUpdate = true }
      this.porterCarts = []
      return
    }
    // ---- piles: crates of materials + sacks of food at each shed, quantised to the live stock (grow + shrink) ----
    const col = new THREE.Color()
    const matUnits = Math.min(COLONY.build.pileMaxUnits, Math.floor((s.materials ?? 0) / COLONY.build.pilePerMaterials))
    const foodUnits = Math.min(COLONY.build.pileMaxUnits, Math.floor((s.food ?? 0) / COLONY.build.pilePerFood))
    let pi = 0
    for (const shed of sheds) {
      const baseY = Math.max(0, t.worldY(shed.x, shed.y)) + 0.02
      const lay = (units: number, ox: number, hex: number) => {
        for (let u = 0; u < units && pi < 320; u++) {
          const gx = u % 3, gz = (u / 3) | 0
          this.dummy.position.set(this.wx(shed.x) + ox + gx * 0.36, baseY, this.wz(shed.y) + 0.7 + gz * 0.36)
          this.dummy.rotation.set(0, 0, 0)
          this.dummy.scale.set(1, 1, 1)
          this.dummy.updateMatrix()
          this.porterPileMesh.setMatrixAt(pi, this.dummy.matrix)
          col.setHex(hex)
          this.porterPileMesh.setColorAt(pi, col)
          pi++
        }
      }
      lay(matUnits, -1.45, 0x8a6a3a) // materials crates (brown) to the left of the shed
      lay(foodUnits, 0.45, 0xcbb486) // food sacks (tan) to the right
    }
    this.porterPileMesh.count = pi
    this.porterPileMesh.instanceMatrix.needsUpdate = true
    if (this.porterPileMesh.instanceColor) this.porterPileMesh.instanceColor.needsUpdate = true
    // ---- carts: porter handcarts running the roads near the sheds, only while staffed (never over water) ----
    const status = porterStatus(s)
    const want = status.working ? Math.min(28, status.porters) : 0
    while (this.porterCarts.length < want) {
      const shed = sheds[this.porterCarts.length % sheds.length]!
      this.porterCarts.push({ x: shed.x, y: shed.y, tx: shed.x, ty: shed.y, spd: 0.6 + Math.random() * 0.5 })
    }
    if (this.porterCarts.length > want) this.porterCarts.length = want
    const now = performance.now()
    const dt = this.lastPorterT ? Math.min(0.05, (now - this.lastPorterT) / 1000) : 1 / 60
    this.lastPorterT = now
    let ci = 0
    for (const cart of this.porterCarts) {
      let dx = cart.tx - cart.x, dy = cart.ty - cart.y, d = Math.hypot(dx, dy)
      if (d < 0.4) {
        const next = this.pickPedTarget(cart.x, cart.y, t.landing.x, t.landing.y) // a nearby road cell — pickPedTarget keeps to the pavement, never water
        cart.tx = next.x; cart.ty = next.y
        dx = cart.tx - cart.x; dy = cart.ty - cart.y; d = Math.hypot(dx, dy)
      }
      if (d > 1e-3) { const move = Math.min(d, cart.spd * dt); cart.x += (dx / d) * move; cart.y += (dy / d) * move }
      const heading = Math.atan2(dy, dx)
      const wy = Math.max(0, t.worldY(Math.round(cart.x), Math.round(cart.y)))
      this.dummy.position.set(this.wx(cart.x), wy + 0.05, this.wz(cart.y))
      this.dummy.rotation.set(0, -heading, 0)
      this.dummy.scale.set(1, 1, 1)
      this.dummy.updateMatrix()
      this.porterCartMesh.setMatrixAt(ci, this.dummy.matrix)
      ci++
    }
    this.porterCartMesh.count = ci
    this.porterCartMesh.instanceMatrix.needsUpdate = true
  }

  private updateCinematic() {
    const t = this.sim.state.terrain
    const cx = this.wx(t.landing.x)
    const cz = this.wz(t.landing.y)
    const cy = Math.max(0, t.worldY(t.landing.x, t.landing.y))
    // The camera continuously orbits the landing. Roughly every ~40s a cubic envelope pulls it way
    // back and up into a wide establishing shot of the whole island adrift in space, then eases back
    // down to street level — the Dark City money shot, on a loop.
    const T = (performance.now() - this.cinematicT0) / 1000
    const angle = (T / 90) * Math.PI * 2
    const wide = Math.pow(Math.sin(T * 0.1571) * 0.5 + 0.5, 3) // 0..1, mostly low with ~40s peaks
    const radius = 28 + Math.sin(T / 22) * 14 + wide * 120
    const height = 12 + Math.sin(T / 15) * 8 + wide * 78
    this.camera.position.set(cx + Math.cos(angle) * radius, cy + height, cz + Math.sin(angle) * radius)
    this.controls.target.set(cx, cy + 1.2 + wide * 6, cz)
  }

  private onResize = () => this.resize()
  resize() {
    const rect = this.container.getBoundingClientRect()
    const w = Math.max(1, rect.width)
    const h = Math.max(1, rect.height)
    this.renderer.setSize(w, h)
    this.composer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  dispose() {
    this.disposed = true
    window.removeEventListener('resize', this.onResize)
    this.controls.dispose()
    this.composer.dispose()
    this.shoreProps?.dispose()
    this.renderer.dispose()
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement)
    }
  }
}
