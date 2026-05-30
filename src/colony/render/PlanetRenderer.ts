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

export type ViewMode = 'biome' | 'buildable' | 'elevation'
export type CameraPreset = 'street' | 'district' | 'planet'

const SKY_DAY = new THREE.Color(0x9ec3d6)
const SKY_NIGHT = new THREE.Color(0x080b1e)
const OCEAN = 0x143a4a

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
  private roadsMesh!: THREE.InstancedMesh
  private bldgMesh!: THREE.InstancedMesh
  private crewMesh!: THREE.InstancedMesh
  private streetPostMesh!: THREE.InstancedMesh
  private streetHeadMesh!: THREE.InstancedMesh
  private dummy = new THREE.Object3D()
  private clock = new THREE.Clock()
  private view: ViewMode = 'biome'
  private disposed = false

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

    this.renderer = new THREE.WebGLRenderer({ antialias: true })
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
    this.controls.maxPolarAngle = Math.PI * 0.495
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
    // The ball: a big sphere whose apex is at the origin, where the flat region sits.
    const planet = new THREE.Mesh(
      new THREE.SphereGeometry(this.R, 72, 54),
      new THREE.MeshStandardMaterial({ color: OCEAN, roughness: 0.85, metalness: 0.05 }),
    )
    planet.position.set(0, -this.R, 0)
    planet.receiveShadow = false
    this.scene.add(planet)

    // Atmosphere glow.
    const atmo = new THREE.Mesh(
      new THREE.SphereGeometry(this.R * 1.05, 40, 28),
      new THREE.MeshBasicMaterial({ color: 0x8fcfff, transparent: true, opacity: 0.1, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false }),
    )
    atmo.position.set(0, -this.R, 0)
    this.scene.add(atmo)
  }

  private buildOcean() {
    const ocean = new THREE.Mesh(
      new THREE.PlaneGeometry(this.N * 1.04, this.N * 1.04),
      new THREE.MeshStandardMaterial({ color: 0x1c6a82, roughness: 0.12, metalness: 0.4, transparent: true, opacity: 0.9 }),
    )
    ocean.rotation.x = -Math.PI / 2
    ocean.position.y = 0
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
    const roadGeo = new THREE.BoxGeometry(1, 0.08, 1)
    this.roadsMesh = new THREE.InstancedMesh(roadGeo, new THREE.MeshStandardMaterial({ color: 0x4a4a52, roughness: 0.95 }), 3200)
    this.roadsMesh.count = 0
    this.roadsMesh.frustumCulled = false
    this.scene.add(this.roadsMesh)

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
  }

  private smoothRoadY(x: number, y: number): number {
    const t = this.sim.state.terrain
    const cl = (v: number) => Math.max(0, Math.min(t.size - 1, v))
    return (t.worldY(x, y) + t.worldY(cl(x + 1), y) + t.worldY(cl(x - 1), y) + t.worldY(x, cl(y + 1)) + t.worldY(x, cl(y - 1))) / 5
  }

  private updateColonyLayer() {
    const s = this.sim.state
    const t = s.terrain
    const rn = Math.min(s.roads.length, 3200)
    this.roadsMesh.count = rn
    for (let i = 0; i < rn; i++) {
      const r = s.roads[i]!
      // smoothed height ramps roads over slopes instead of stair-stepping per cell
      this.dummy.position.set(this.wx(r.x), this.smoothRoadY(r.x, r.y) + 0.03, this.wz(r.y))
      this.dummy.scale.set(1, 1, 1)
      this.dummy.rotation.set(0, 0, 0)
      this.dummy.updateMatrix()
      this.roadsMesh.setMatrixAt(i, this.dummy.matrix)
    }
    this.roadsMesh.instanceMatrix.needsUpdate = true

    const col = new THREE.Color()
    const cap = COLONY.build.maxBuildings + 8
    let bi = 0
    for (const b of s.buildings) {
      if (bi >= cap) break
      this.dummy.position.set(this.wx(b.x), t.worldY(b.x, b.y), this.wz(b.y))
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
        this.dummy.position.set(this.wx(j.x), t.worldY(j.x, j.y), this.wz(j.y))
        this.dummy.scale.set(1, Math.max(0.04, j.artifact.height * phase), 1)
        this.dummy.rotation.set(0, 0, 0)
        this.dummy.updateMatrix()
        this.bldgMesh.setMatrixAt(bi, this.dummy.matrix)
        col.setHex(j.artifact.color).multiplyScalar(0.55) // under construction = darker
        this.bldgMesh.setColorAt(bi, col)
        bi++
      }
      // crew truck drives caravan -> site over the first quarter, then parks on site
      if (ci < cap) {
        const drive = Math.min(1, j.progress / 0.25)
        const cx = car.x + (j.x - car.x) * drive
        const cy = car.y + (j.y - car.y) * drive
        const heading = Math.atan2(j.y - car.y, j.x - car.x)
        this.dummy.position.set(this.wx(cx), t.worldY(Math.round(cx), Math.round(cy)) + 0.18, this.wz(cy))
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
    let li = 0
    for (let i = 0; i < rn; i++) {
      if (li >= 360) break
      const r = s.roads[i]!
      if (((((r.x - car.x) % B) + B) % B) !== 0 || ((((r.y - car.y) % B) + B) % B) !== 0) continue
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
    this.controls.update()
    this.composer.render()
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
