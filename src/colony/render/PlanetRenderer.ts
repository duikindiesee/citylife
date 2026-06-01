// Renders the alien planet: a flat playable terrain region sitting on the apex of a
// large sphere (the "ball"), with ocean, atmosphere, the landed seed, day/night, three
// camera presets (street/district/planet) and view modes (biome/buildable/elevation).
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { COLONY } from '../config'
import { BIOME_COLOR, Biome } from '../terrain'
import type { ColonySim, SeedStructure } from '../sim'
import type { HouseSpec } from '../house'
import { gridOrigin } from '../grid'
import { cellZone, ZONE_COLOR, VIBE_COLOR, type Plot } from '../cityPlan'

export type ViewMode = 'biome' | 'buildable' | 'elevation'
export type CameraPreset = 'street' | 'district' | 'planet'

// Dark City: the colony floats on a slab of rock adrift in deep space. The "sky" is the void —
// dark even at midday — while a local sun still sweeps light across the island for day/night.
const SKY_DAY = new THREE.Color(0x0b1022)
const SKY_NIGHT = new THREE.Color(0x03040a)
const OCEAN = 0x143a4a
const SLAB_ROCK = 0x24242f

export class PlanetRenderer {
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private renderer: THREE.WebGLRenderer
  private composer!: EffectComposer
  private controls: OrbitControls
  private sun: THREE.DirectionalLight
  private hemi: THREE.HemisphereLight
  private terrainMesh!: THREE.Mesh
  private terrainGeo!: THREE.BufferGeometry
  private roadSurfaceMesh!: THREE.Mesh
  private roadLineMesh!: THREE.Mesh
  private lastRoadCount = -1
  private bldgMesh!: THREE.InstancedMesh
  private crewMesh!: THREE.InstancedMesh
  private streetPostMesh!: THREE.InstancedMesh
  private streetHeadMesh!: THREE.InstancedMesh
  private carsMesh!: THREE.InstancedMesh
  // Ambient pedestrians — renderer-only wandering figures near the settled ground; no sim impact.
  private pedMesh!: THREE.InstancedMesh
  private peds: { x: number; y: number; tx: number; ty: number; spd: number; phase: number }[] = []
  private lastPedT = 0
  private settlerGroup = new THREE.Group()
  private lastSettlerCount = -1
  // City plan paint — translucent zone tints (residential / commercial / industrial / civic)
  // and named flag-pole markers at every plot. Both are built once from the terrain; the markers
  // dim and re-label as plots get allocated.
  private zoneTintMesh: THREE.Mesh | null = null
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

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.5, 12000)

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
    this.sun.shadow.mapSize.set(1024, 1024)
    const d = this.N * 0.7
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
    const N = this.N
    const t = this.sim.state.terrain
    const verts = new Float32Array(N * N * 3)
    const colors = new Float32Array(N * N * 3)
    const col = new THREE.Color()
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const i = y * N + x
        verts[i * 3] = this.wx(x)
        verts[i * 3 + 1] = t.worldY(x, y)
        verts[i * 3 + 2] = this.wz(y)
        this.colorFor(this.view, i, col)
        colors[i * 3] = col.r
        colors[i * 3 + 1] = col.g
        colors[i * 3 + 2] = col.b
      }
    }
    const indices: number[] = []
    for (let y = 0; y < N - 1; y++) {
      for (let x = 0; x < N - 1; x++) {
        const a = y * N + x
        const b = a + 1
        const c = a + N
        const d = c + 1
        indices.push(a, c, b, b, c, d)
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geo.setIndex(indices)
    geo.computeVertexNormals()
    this.terrainGeo = geo
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.02, flatShading: false })
    this.terrainMesh = new THREE.Mesh(geo, mat)
    this.terrainMesh.receiveShadow = true
    this.terrainMesh.castShadow = false // big mesh self-shadowing is costly + low-value
    this.scene.add(this.terrainMesh)
  }

  setView(mode: ViewMode) {
    this.view = mode
    const N = this.N
    const colorAttr = this.terrainGeo.getAttribute('color') as THREE.BufferAttribute
    const col = new THREE.Color()
    for (let i = 0; i < N * N; i++) {
      this.colorFor(mode, i, col)
      colorAttr.setXYZ(i, col.r, col.g, col.b)
    }
    colorAttr.needsUpdate = true
  }

  /** Show or hide the city-plan overlay (zone tints + plot flag-poles). */
  setZonesVisible(v: boolean) {
    if (this.zoneTintMesh) this.zoneTintMesh.visible = v
    this.plotMarkers.visible = v
  }

  private buildStructures() {
    const t = this.sim.state.terrain
    const group = new THREE.Group()
    for (const s of this.sim.state.structures) {
      const mesh = this.makeStructure(s)
      const baseY = Math.max(0.05, t.worldY(s.x, s.y))
      mesh.position.set(this.wx(s.x), baseY, this.wz(s.y))
      mesh.castShadow = true
      group.add(mesh)
    }
    this.scene.add(group)
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
    } else {
      // rocket / dropship (landed)
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 5, 16), new THREE.MeshStandardMaterial({ color: 0xdfe3e9, roughness: 0.4, metalness: 0.3 }))
      body.position.y = 2.5
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2, 16), new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.5 }))
      nose.position.y = 6
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.4, 1.2), new THREE.MeshStandardMaterial({ color: 0xb0b6bf }))
      fin.position.set(0, 0.9, 0)
      body.castShadow = true
      nose.castShadow = true
      g.add(body, nose, fin)
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
    this.sun.position.set(Math.cos(ang) * r, Math.max(6, Math.sin(ang) * r), this.N * 0.25)
    this.sun.target.position.set(0, 0, 0)
  }

  private buildColonyLayer() {
    // Roads drape on the terrain (elevation-compatible): a continuous asphalt ribbon with a
    // dashed centre line, rebuilt as the network grows. Shared corner heights => no stair-steps.
    this.roadSurfaceMesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial({ color: 0x2e2e34, roughness: 1, metalness: 0, side: THREE.DoubleSide }),
    )
    this.roadSurfaceMesh.frustumCulled = false
    this.scene.add(this.roadSurfaceMesh)
    this.roadLineMesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial({ color: 0xd8c879, roughness: 0.8, metalness: 0, emissive: 0x2a2410, emissiveIntensity: 0.3, side: THREE.DoubleSide }),
    )
    this.roadLineMesh.frustumCulled = false
    this.scene.add(this.roadLineMesh)

    const bGeo = new THREE.BoxGeometry(0.82, 1, 0.82)
    bGeo.translate(0, 0.5, 0)
    this.bldgMesh = new THREE.InstancedMesh(bGeo, new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.03 }), COLONY.build.maxBuildings + 8)
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
    this.initPedestrians()

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

  // Rebuild road geometry: asphalt quads draped on the terrain + dashed centre lines.
  private rebuildRoads() {
    const s = this.sim.state
    const g = gridOrigin(s)
    const B = COLONY.build.block
    const LIFT = 0.05
    const surf: number[] = []
    const line: number[] = []
    const tri = (arr: number[], a: number[], b: number[], c: number[]) => arr.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, c[0]!, c[1]!, c[2]!)
    const quad = (arr: number[], a: number[], b: number[], c: number[], d: number[]) => { tri(arr, a, c, b); tri(arr, b, c, d) }
    const corner = (gx: number, gy: number): number[] => [this.wx(gx) - 0.5, this.cornerY(gx, gy) + LIFT, this.wz(gy) - 0.5]
    for (const r of s.roads) {
      const x = r.x, y = r.y
      quad(surf, corner(x, y), corner(x + 1, y), corner(x, y + 1), corner(x + 1, y + 1))
      const onV = ((((x - g.x) % B) + B) % B) === 0 // on a north-south grid line
      const onH = ((((y - g.y) % B) + B) % B) === 0 // on an east-west grid line
      if (onV === onH) continue // intersection or off-grid fill -> no centre dash
      const h = this.smoothRoadY(x, y) + LIFT + 0.03
      const wx = this.wx(x), wz = this.wz(y)
      if (onV) quad(line, [wx - 0.05, h, wz - 0.3], [wx + 0.05, h, wz - 0.3], [wx - 0.05, h, wz + 0.3], [wx + 0.05, h, wz + 0.3])
      else quad(line, [wx - 0.3, h, wz - 0.05], [wx + 0.3, h, wz - 0.05], [wx - 0.3, h, wz + 0.05], [wx + 0.3, h, wz + 0.05])
    }
    const sg = this.roadSurfaceMesh.geometry as THREE.BufferGeometry
    sg.setAttribute('position', new THREE.Float32BufferAttribute(surf, 3))
    sg.computeVertexNormals()
    const lg = this.roadLineMesh.geometry as THREE.BufferGeometry
    lg.setAttribute('position', new THREE.Float32BufferAttribute(line, 3))
    lg.computeVertexNormals()
  }

  private updateColonyLayer() {
    const s = this.sim.state
    const t = s.terrain
    if (s.settlers.length !== this.lastSettlerCount) {
      this.rebuildSettlerHomes()
      this.lastSettlerCount = s.settlers.length
    }
    // roads drape on the terrain; rebuild the ribbon only when the network grows
    if (s.roads.length !== this.lastRoadCount) {
      this.rebuildRoads()
      this.lastRoadCount = s.roads.length
    }
    const rn = s.roads.length
    // plot markers reflect allocation changes (allocated → dim flag, lowered pole)
    if (s.cityPlan) this.syncPlotMarkers(s.cityPlan.plots)

    const col = new THREE.Color()
    const cap = COLONY.build.maxBuildings + 8
    let bi = 0
    for (const b of s.buildings) {
      if (bi >= cap) break
      this.dummy.position.set(this.wx(b.x), Math.max(0, t.worldY(b.x, b.y)), this.wz(b.y))
      this.dummy.scale.set(1, Math.max(0.15, b.artifact.height), 1)
      this.dummy.rotation.set(0, 0, 0)
      this.dummy.updateMatrix()
      this.bldgMesh.setMatrixAt(bi, this.dummy.matrix)
      col.setHex(b.artifact.color)
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
  }

  frame() {
    if (this.disposed) return
    this.updateDayNight()
    this.updateColonyLayer()
    this.updatePedestrians()
    if (this.cinematic) this.updateCinematic()
    this.controls.update()
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

  private pedOnLand(x: number, y: number): boolean {
    const t = this.sim.state.terrain
    const ix = Math.round(x), iy = Math.round(y)
    if (ix < 0 || iy < 0 || ix >= t.size || iy >= t.size) return false
    return !t.isWater(ix, iy)
  }

  /** Seed ~16 wandering pedestrians on land within walking distance of the landing site. */
  private initPedestrians() {
    const t = this.sim.state.terrain
    const lx = t.landing.x, ly = t.landing.y
    const PED_COLORS = [0xe06a4d, 0x4d8fe0, 0xe6c84d, 0x57b86a, 0xc9c2b6, 0xb47ad6]
    const col = new THREE.Color()
    this.peds = []
    let guard = 0
    while (this.peds.length < 16 && guard++ < 500) {
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

  /** Per-frame: stroll each pedestrian toward a nearby land target, picking a new one on arrival. */
  private updatePedestrians() {
    if (!this.pedMesh || this.peds.length === 0) return
    const t = this.sim.state.terrain
    const lx = t.landing.x, ly = t.landing.y
    const now = performance.now()
    const dt = this.lastPedT ? Math.min(0.05, (now - this.lastPedT) / 1000) : 1 / 60
    this.lastPedT = now
    for (let i = 0; i < this.peds.length; i++) {
      const p = this.peds[i]!
      let dx = p.tx - p.x, dy = p.ty - p.y
      let d = Math.hypot(dx, dy)
      if (d < 0.4) {
        for (let tries = 0; tries < 8; tries++) {
          const ang = Math.atan2(ly - p.y, lx - p.x) + (Math.random() - 0.5) * Math.PI * 1.6
          const step = 3 + Math.random() * 6
          const nx = p.x + Math.cos(ang) * step
          const ny = p.y + Math.sin(ang) * step
          if (this.pedOnLand(nx, ny) && Math.hypot(nx - lx, ny - ly) < 18) {
            p.tx = nx
            p.ty = ny
            break
          }
        }
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
    }
    this.pedMesh.instanceMatrix.needsUpdate = true
  }

  private updateCinematic() {
    const t = this.sim.state.terrain
    const cx = this.wx(t.landing.x)
    const cz = this.wz(t.landing.y)
    const cy = Math.max(0, t.worldY(t.landing.x, t.landing.y))
    // 90 sec loop: angle drifts continuously; radius + height breathe with two slow sines.
    const T = (performance.now() - this.cinematicT0) / 1000
    const angle = (T / 90) * Math.PI * 2
    const radiusBase = 30
    const radius = radiusBase + Math.sin(T / 28) * 22 // 8..52 ish
    const height = 14 + Math.sin(T / 17) * 11 // 3..25
    this.camera.position.set(cx + Math.cos(angle) * radius, cy + height, cz + Math.sin(angle) * radius)
    this.controls.target.set(cx, cy + 1.2, cz)
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
    this.renderer.dispose()
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement)
    }
  }
}
