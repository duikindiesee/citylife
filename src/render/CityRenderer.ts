// Imperative three.js renderer (behind a simple interface so it can be upgraded later).
// Reads sim.state directly each frame — no serialization, since everything is one thread.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { CONFIG } from "../engine/config";
import { junctionTiles } from "../engine/logistics";
import type { Simulation } from "../engine/simulation";
import type { ZoneType } from "../engine/types";

const ZONE_COLOR: Record<ZoneType, number> = {
  residential: 0xe6cda2,
  commercial: 0x74c0e0,
  industrial: 0xcf9162,
  park: 0x6fae5f,
  road: 0x44444c,
  empty: 0x8a8a8a,
};

const SKY_DAY = new THREE.Color(0xa8d8ec);
const SKY_NIGHT = new THREE.Color(0x0a1230);
const SUN_DAY = new THREE.Color(0xfff2d6);
const tmpColor = new THREE.Color();

// An open "dollhouse": floor + high back wall + medium side walls + LOW front wall,
// and no roof — so you can see the people standing inside. Unit height (scaled per building).
function makeDollhouseGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const floor = new THREE.BoxGeometry(0.86, 0.06, 0.86);
  floor.translate(0, 0.03, 0);
  parts.push(floor);
  const back = new THREE.BoxGeometry(0.86, 1.0, 0.08);
  back.translate(0, 0.5, -0.39);
  parts.push(back);
  const left = new THREE.BoxGeometry(0.08, 0.62, 0.86);
  left.translate(-0.39, 0.31, 0);
  parts.push(left);
  const right = new THREE.BoxGeometry(0.08, 0.62, 0.86);
  right.translate(0.39, 0.31, 0);
  parts.push(right);
  const front = new THREE.BoxGeometry(0.86, 0.2, 0.08);
  front.translate(0, 0.1, 0.39);
  parts.push(front);
  return mergeGeometries(parts, false) ?? floor;
}

export class CityRenderer {
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private composer!: EffectComposer;
  private controls: OrbitControls;
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;

  private buildings!: THREE.InstancedMesh;
  private citizens!: THREE.InstancedMesh;
  private roads!: THREE.InstancedMesh;
  private vehicles!: THREE.InstancedMesh;
  private cargo!: THREE.InstancedMesh;
  private lightHeads!: THREE.InstancedMesh;
  private water!: THREE.Mesh;
  private waterGeo!: THREE.PlaneGeometry;

  private dummy = new THREE.Object3D();
  private clock = new THREE.Clock();
  private w: number;
  private h: number;
  private disposed = false;

  constructor(
    private container: HTMLElement,
    private sim: Simulation,
  ) {
    this.w = sim.state.width;
    this.h = sim.state.height;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    container.appendChild(this.renderer.domElement);

    this.scene.background = SKY_DAY.clone();
    this.scene.fog = new THREE.Fog(
      SKY_DAY.clone(),
      this.w * 0.95,
      this.w * 2.6,
    );

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    // Closer, lower 3/4 view so you can see into the houses, watch people, and follow cars.
    this.camera.position.set(this.w * 0.3, this.w * 0.34, this.h * 0.46);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 4;
    this.controls.maxDistance = this.w * 2.2;

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x4a5a3a, 0.7);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(SUN_DAY.clone(), 1.7);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const d = this.w * 0.8;
    this.sun.shadow.camera.left = -d;
    this.sun.shadow.camera.right = d;
    this.sun.shadow.camera.top = d;
    this.sun.shadow.camera.bottom = -d;
    this.sun.shadow.camera.far = this.w * 4;
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.buildGround();
    this.buildWater();
    this.buildRoads();
    this.buildBuildings();
    this.buildTrees();
    this.buildCitizens();
    this.buildVehicles();
    this.buildTrafficLights();
    this.setupComposer();

    window.addEventListener("resize", this.onResize);
    this.resize();
  }

  private lotToWorldX(x: number) {
    return x - this.w / 2;
  }
  private lotToWorldZ(y: number) {
    return y - this.h / 2;
  }

  private setupComposer() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(size.x, size.y),
      0.55,
      0.5,
      0.82,
    );
    this.composer.addPass(bloom);
    this.composer.addPass(new OutputPass());
  }

  private buildGround() {
    const geo = new THREE.PlaneGeometry(this.w + 8, this.h + 8);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x83bf66,
      roughness: 1,
    });
    const ground = new THREE.Mesh(geo, mat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(-0.5, -0.02, -0.5);
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  private buildWater() {
    // A coastline to the south of the city.
    this.waterGeo = new THREE.PlaneGeometry(this.w + 80, 60, 40, 24);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x2f7fb5,
      roughness: 0.15,
      metalness: 0.35,
      transparent: true,
      opacity: 0.92,
    });
    this.water = new THREE.Mesh(this.waterGeo, mat);
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.set(-0.5, -0.08, this.h / 2 + 27);
    this.scene.add(this.water);
  }

  private buildRoads() {
    const s = this.sim.state;
    const tiles: number[] = [];
    for (let i = 0; i < s.zones.length; i++)
      if (s.zones[i] === 5) tiles.push(i);
    const geo = new THREE.BoxGeometry(1, 0.06, 1);
    const mat = new THREE.MeshStandardMaterial({
      color: ZONE_COLOR.road,
      roughness: 0.95,
    });
    this.roads = new THREE.InstancedMesh(geo, mat, Math.max(1, tiles.length));
    this.roads.receiveShadow = true;
    tiles.forEach((idx, i) => {
      const x = idx % this.w;
      const y = Math.floor(idx / this.w);
      this.dummy.position.set(this.lotToWorldX(x), 0.03, this.lotToWorldZ(y));
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      this.roads.setMatrixAt(i, this.dummy.matrix);
    });
    this.roads.instanceMatrix.needsUpdate = true;
    this.scene.add(this.roads);
  }

  private buildBuildings() {
    const geo = makeDollhouseGeometry();
    const mat = new THREE.MeshStandardMaterial({
      roughness: 0.8,
      metalness: 0.03,
    });
    this.buildings = new THREE.InstancedMesh(
      geo,
      mat,
      Math.max(1, this.sim.state.buildings.length),
    );
    this.buildings.castShadow = true;
    this.buildings.receiveShadow = true;
    this.scene.add(this.buildings);
    this.refreshBuildings();
  }

  refreshBuildings() {
    const s = this.sim.state;
    const color = new THREE.Color();
    this.buildings.count = s.buildings.length;
    s.buildings.forEach((b, i) => {
      this.dummy.position.set(this.lotToWorldX(b.x), 0, this.lotToWorldZ(b.y));
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(1, Math.max(0.2, b.height), 1);
      this.dummy.updateMatrix();
      this.buildings.setMatrixAt(i, this.dummy.matrix);
      color.setHex(ZONE_COLOR[b.zone]);
      const j = (b.id % 7) / 7;
      color.offsetHSL(0, 0, (j - 0.5) * 0.08);
      this.buildings.setColorAt(i, color);
    });
    this.buildings.instanceMatrix.needsUpdate = true;
    if (this.buildings.instanceColor)
      this.buildings.instanceColor.needsUpdate = true;
  }

  private buildTrees() {
    const s = this.sim.state;
    const spots: { x: number; z: number }[] = [];
    for (const b of s.buildings)
      if (b.zone === "park")
        spots.push({ x: this.lotToWorldX(b.x), z: this.lotToWorldZ(b.y) });
    // decorative perimeter ring
    for (let x = -this.w / 2 - 2; x <= this.w / 2 + 2; x += 2.4) {
      spots.push({ x, z: -this.h / 2 - 2 });
      spots.push({ x, z: this.h / 2 + 2 });
    }
    for (let z = -this.h / 2 - 2; z <= this.h / 2 + 2; z += 2.4) {
      spots.push({ x: -this.w / 2 - 2, z });
      spots.push({ x: this.w / 2 + 2, z });
    }
    const n = Math.max(1, spots.length);

    const trunkGeo = new THREE.CylinderGeometry(0.05, 0.07, 0.4, 5);
    trunkGeo.translate(0, 0.2, 0);
    const trunk = new THREE.InstancedMesh(
      trunkGeo,
      new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 1 }),
      n,
    );
    const foliageGeo = new THREE.ConeGeometry(0.36, 0.85, 7);
    foliageGeo.translate(0, 0.78, 0);
    const foliage = new THREE.InstancedMesh(
      foliageGeo,
      new THREE.MeshStandardMaterial({ color: 0x3f8f4a, roughness: 0.9 }),
      n,
    );
    foliage.castShadow = true;

    const fcolor = new THREE.Color();
    spots.forEach((p, i) => {
      const scale = 0.8 + ((i * 37) % 10) / 18;
      this.dummy.position.set(p.x, 0, p.z);
      this.dummy.rotation.set(0, (i * 1.7) % Math.PI, 0);
      this.dummy.scale.setScalar(scale);
      this.dummy.updateMatrix();
      trunk.setMatrixAt(i, this.dummy.matrix);
      foliage.setMatrixAt(i, this.dummy.matrix);
      fcolor
        .setHex(0x3f8f4a)
        .offsetHSL(0, 0, (((i * 13) % 10) / 10 - 0.5) * 0.1);
      foliage.setColorAt(i, fcolor);
    });
    trunk.instanceMatrix.needsUpdate = true;
    foliage.instanceMatrix.needsUpdate = true;
    this.scene.add(trunk);
    this.scene.add(foliage);
  }

  private buildCitizens() {
    const geo = new THREE.BoxGeometry(0.24, 0.6, 0.24);
    geo.translate(0, 0.3, 0);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.6 });
    this.citizens = new THREE.InstancedMesh(geo, mat, CONFIG.population.max);
    this.citizens.castShadow = true;
    this.citizens.frustumCulled = false;
    this.scene.add(this.citizens);
  }

  private buildVehicles() {
    const cap = CONFIG.logistics.cars + CONFIG.logistics.trucks + 2;
    const body = new THREE.BoxGeometry(0.5, 0.18, 0.26); // length along +X
    const bmat = new THREE.MeshStandardMaterial({
      roughness: 0.45,
      metalness: 0.25,
    });
    this.vehicles = new THREE.InstancedMesh(body, bmat, cap);
    this.vehicles.castShadow = true;
    this.vehicles.frustumCulled = false;
    this.scene.add(this.vehicles);

    const cargoGeo = new THREE.BoxGeometry(0.32, 0.24, 0.26);
    const cmat = new THREE.MeshStandardMaterial({
      color: 0x9a6b3b,
      roughness: 0.8,
    });
    this.cargo = new THREE.InstancedMesh(
      cargoGeo,
      cmat,
      CONFIG.logistics.trucks + 2,
    );
    this.cargo.castShadow = true;
    this.cargo.frustumCulled = false;
    this.scene.add(this.cargo);
  }

  private buildTrafficLights() {
    const tiles = junctionTiles(this.sim.state);
    const n = Math.max(1, tiles.length);
    const postGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.6, 5);
    postGeo.translate(0, 0.3, 0);
    const post = new THREE.InstancedMesh(
      postGeo,
      new THREE.MeshStandardMaterial({ color: 0x2a2a30 }),
      n,
    );
    const headGeo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
    headGeo.translate(0, 0.66, 0);
    this.lightHeads = new THREE.InstancedMesh(
      headGeo,
      new THREE.MeshStandardMaterial({ emissiveIntensity: 1 }),
      n,
    );

    tiles.forEach((idx, i) => {
      const x = this.lotToWorldX(idx % this.w) + 0.42;
      const z = this.lotToWorldZ(Math.floor(idx / this.w)) + 0.42;
      this.dummy.position.set(x, 0, z);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      post.setMatrixAt(i, this.dummy.matrix);
      this.lightHeads.setMatrixAt(i, this.dummy.matrix);
    });
    post.instanceMatrix.needsUpdate = true;
    this.lightHeads.instanceMatrix.needsUpdate = true;
    this.scene.add(post);
    this.scene.add(this.lightHeads);
    this.lightHeads.userData.tiles = tiles;
  }

  private updateCitizens() {
    const s = this.sim.state;
    const n = Math.min(s.citizens.length, CONFIG.population.max);
    this.citizens.count = n;
    for (let i = 0; i < n; i++) {
      const c = s.citizens[i]!;
      // spread housemates so several are visible standing inside one house
      const ox = (((c.id * 7) % 5) - 2) * 0.13;
      const oz = (((c.id * 11) % 5) - 2) * 0.13;
      this.dummy.position.set(
        this.lotToWorldX(c.x) + ox,
        0.0,
        this.lotToWorldZ(c.y) + oz,
      );
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      this.citizens.setMatrixAt(i, this.dummy.matrix);
      tmpColor.setHSL(0.0 + (c.happiness / 100) * 0.33, 0.6, 0.5);
      this.citizens.setColorAt(i, tmpColor);
    }
    this.citizens.instanceMatrix.needsUpdate = true;
    if (this.citizens.instanceColor)
      this.citizens.instanceColor.needsUpdate = true;
  }

  private updateVehicles() {
    const s = this.sim.state;
    this.vehicles.count = s.vehicles.length;
    let cargoN = 0;
    for (let i = 0; i < s.vehicles.length; i++) {
      const v = s.vehicles[i]!;
      const truck = v.kind === "truck";
      const sx = truck ? 1.5 : 1;
      const sy = truck ? 1.7 : 1;
      const sz = truck ? 1.3 : 1;
      const y = 0.09 * sy + 0.06;
      this.dummy.position.set(this.lotToWorldX(v.x), y, this.lotToWorldZ(v.y));
      this.dummy.rotation.set(0, -v.heading, 0);
      this.dummy.scale.set(sx, sy, sz);
      this.dummy.updateMatrix();
      this.vehicles.setMatrixAt(i, this.dummy.matrix);
      tmpColor.setHex(v.color);
      this.vehicles.setColorAt(i, tmpColor);

      if (truck && v.cargo > 0) {
        this.dummy.position.set(
          this.lotToWorldX(v.x),
          y + 0.22,
          this.lotToWorldZ(v.y),
        );
        this.dummy.rotation.set(0, -v.heading, 0);
        this.dummy.scale.set(1, 1, 1);
        this.dummy.updateMatrix();
        this.cargo.setMatrixAt(cargoN, this.dummy.matrix);
        cargoN++;
      }
    }
    this.cargo.count = cargoN;
    this.vehicles.instanceMatrix.needsUpdate = true;
    this.cargo.instanceMatrix.needsUpdate = true;
    if (this.vehicles.instanceColor)
      this.vehicles.instanceColor.needsUpdate = true;
  }

  private updateTrafficLights() {
    const tiles: number[] = this.lightHeads.userData.tiles ?? [];
    const phase =
      Math.floor(this.sim.state.tick / CONFIG.logistics.lightPeriodTicks) % 2;
    const green = new THREE.Color(0x39d353);
    const red = new THREE.Color(0xe0473d);
    for (let i = 0; i < tiles.length; i++) {
      const tx = tiles[i]! % this.w;
      const parity = (tx + phase) % 2;
      this.lightHeads.setColorAt(i, parity === 0 ? green : red);
    }
    if (this.lightHeads.instanceColor)
      this.lightHeads.instanceColor.needsUpdate = true;
    const mat = this.lightHeads.material as THREE.MeshStandardMaterial;
    mat.emissive = new THREE.Color(0xffffff);
    mat.emissiveIntensity = 0.0; // color comes from instanceColor; keep glow subtle
  }

  private updateWater(t: number) {
    const pos = this.waterGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      pos.setZ(
        i,
        Math.sin(x * 0.25 + t * 1.3) * 0.12 + Math.cos(y * 0.3 + t) * 0.1,
      );
    }
    pos.needsUpdate = true;
  }

  private updateDayNight() {
    const { hour, minute } = this.sim.state.clock;
    const t = hour + minute / 60;
    const daylight = Math.max(0, Math.sin(((t - 6) / 13) * Math.PI));

    const sky = SKY_NIGHT.clone().lerp(SKY_DAY, daylight);
    (this.scene.background as THREE.Color).copy(sky);
    (this.scene.fog as THREE.Fog).color.copy(sky);

    this.hemi.intensity = 0.5 + daylight * 0.5;
    this.sun.intensity = 0.25 + daylight * 1.5;
    this.sun.color.copy(new THREE.Color(0xffb070).lerp(SUN_DAY, daylight));

    const ang = ((t - 6) / 12) * Math.PI;
    const r = this.w * 1.1;
    this.sun.position.set(
      Math.cos(ang) * r,
      Math.max(4, Math.sin(ang) * r),
      this.h * 0.3,
    );
    this.sun.target.position.set(0, 0, 0);
  }

  frame() {
    if (this.disposed) return;
    const t = this.clock.getElapsedTime();
    this.updateDayNight();
    this.updateCitizens();
    this.updateVehicles();
    this.updateTrafficLights();
    this.updateWater(t);
    this.controls.update();
    this.composer.render();
  }

  private onResize = () => this.resize();

  resize() {
    const rect = this.container.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.disposed = true;
    window.removeEventListener("resize", this.onResize);
    this.controls.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
