import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { TarentaalBird } from "../tarentaal";

const TARANTAAL_ASSETS = {
  adult: "/assets/citylife/wildlife/tarentaal-adult.glb",
  chick: "/assets/citylife/wildlife/tarentaal-chick.glb",
} as const;

type Age = keyof typeof TARANTAAL_ASSETS;

export interface TarentaalGltfTemplate {
  scene: THREE.Group;
  clips: THREE.AnimationClip[];
}

interface BirdEntry {
  group: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  currentAction: string;
}

export function disposeTarentaalGltfTemplate(
  template: TarentaalGltfTemplate,
): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  template.scene.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const source = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of source) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
}

export interface TarentaalWorldPoint {
  x: number;
  y: number;
  z: number;
}

export class TarentaalGltfLayer {
  readonly group = new THREE.Group();
  private readonly templates = new Map<Age, TarentaalGltfTemplate>();
  private readonly birds = new Map<number, BirdEntry>();
  private disposed = false;

  constructor(private readonly scene: THREE.Scene) {
    this.group.name = "tarentaal-glb-flock";
    this.group.userData = { loaded: false, adultAsset: TARANTAAL_ASSETS.adult, chickAsset: TARANTAAL_ASSETS.chick };
    this.scene.add(this.group);
    void this.load();
  }

  get loaded(): boolean {
    return this.templates.size === 2;
  }

  private async load(): Promise<void> {
    const loader = new GLTFLoader();
    try {
      const [adultResult, chickResult] = await Promise.allSettled([
        loader.loadAsync(TARANTAAL_ASSETS.adult),
        loader.loadAsync(TARANTAAL_ASSETS.chick),
      ]);
      if (adultResult.status === "rejected" || chickResult.status === "rejected") {
        if (adultResult.status === "fulfilled")
          disposeTarentaalGltfTemplate({
            scene: adultResult.value.scene,
            clips: adultResult.value.animations,
          });
        if (chickResult.status === "fulfilled")
          disposeTarentaalGltfTemplate({
            scene: chickResult.value.scene,
            clips: chickResult.value.animations,
          });
        throw adultResult.status === "rejected"
          ? adultResult.reason
          : (chickResult as PromiseRejectedResult).reason;
      }
      const adult = adultResult.value;
      const chick = chickResult.value;
      if (this.disposed) {
        disposeTarentaalGltfTemplate({ scene: adult.scene, clips: adult.animations });
        disposeTarentaalGltfTemplate({ scene: chick.scene, clips: chick.animations });
        return;
      }
      this.templates.set("adult", { scene: adult.scene, clips: adult.animations });
      this.templates.set("chick", { scene: chick.scene, clips: chick.animations });
      this.group.userData.loaded = true;
      this.group.userData.adultClips = adult.animations.map((clip) => clip.name);
      this.group.userData.chickClips = chick.animations.map((clip) => clip.name);
    } catch (error) {
      this.group.userData.error = error instanceof Error ? error.message : String(error);
      console.warn("[citylife] tarentaal GLB load failed; retaining primitive fallback", error);
    }
  }

  update(
    flock: readonly TarentaalBird[],
    deltaSeconds: number,
    worldPoint: (bird: TarentaalBird) => TarentaalWorldPoint,
  ): boolean {
    if (!this.loaded) return false;
    const wanted = new Set(flock.map((bird) => bird.id));
    for (const [id, entry] of this.birds) {
      if (!wanted.has(id)) {
        entry.mixer.stopAllAction();
        this.group.remove(entry.group);
        this.birds.delete(id);
      }
    }
    for (const bird of flock) {
      const entry = this.birds.get(bird.id) ?? this.createBird(bird);
      const point = worldPoint(bird);
      entry.group.position.set(point.x, point.y, point.z);
      entry.group.rotation.y = -bird.heading;
      const scale = bird.age === "adult" ? 1 : 0.92;
      entry.group.scale.setScalar(scale);
      const prefix = bird.age === "adult" ? "Tarentaal" : "TarentaalChick";
      const wantedAction = `${prefix}_${bird.behavior === "chase" ? "chase" : "walk"}`;
      if (entry.currentAction !== wantedAction) this.play(entry, wantedAction);
      entry.mixer.update(Math.min(deltaSeconds, 0.1));
      entry.group.userData.currentAction = entry.currentAction;
      entry.group.userData.behavior = bird.behavior;
    }
    this.group.userData.count = this.birds.size;
    return true;
  }

  private createBird(bird: TarentaalBird): BirdEntry {
    const template = this.templates.get(bird.age)!;
    const group = template.scene.clone(true);
    group.name = `tarentaal-glb:${bird.id}`;
    group.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) {
        const mesh = node as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    const mixer = new THREE.AnimationMixer(group);
    const actions = new Map(template.clips.map((clip) => [clip.name, mixer.clipAction(clip)]));
    const prefix = bird.age === "adult" ? "Tarentaal" : "TarentaalChick";
    const entry = { group, mixer, actions, currentAction: "" };
    this.group.add(group);
    this.birds.set(bird.id, entry);
    this.play(entry, `${prefix}_idle`);
    return entry;
  }

  private play(entry: BirdEntry, name: string): void {
    const next = entry.actions.get(name);
    if (!next) return;
    const previous = entry.actions.get(entry.currentAction);
    if (previous && previous !== next) previous.fadeOut(0.12);
    next.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(0.12).play();
    entry.currentAction = name;
  }

  dispose(): void {
    this.disposed = true;
    for (const entry of this.birds.values()) {
      entry.mixer.stopAllAction();
      entry.mixer.uncacheRoot(entry.group);
    }
    this.birds.clear();
    this.group.clear();
    for (const template of this.templates.values()) disposeTarentaalGltfTemplate(template);
    this.templates.clear();
    this.scene.remove(this.group);
  }
}
