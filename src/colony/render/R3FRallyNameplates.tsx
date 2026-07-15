import React, { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { ColonySim } from "../sim";
import { useSimSignal, type SimBridge } from "./useSimSignal";
import { rallyPresenceSignature } from "./simSignals";
import type { AvatarRefs } from "./R3FAvatars";

// Spec 131 — rally nameplates (legacy S3/spec 097): citizens present at the hilltop Rally
// Point get a glowing name card floating over their head and a soft gold circle at their
// feet, brighter after dark. Presence flows ColonyApp -> setRallyPresentCitizens ->
// sim.state.rallyPresence (public-safe filtered at the bridge); positions come from the
// same live avatar source the avatar meshes draw from.

interface R3FRallyNameplatesProps {
  sim: ColonySim;
  runtime?: SimBridge;
  refs: AvatarRefs;
}

interface Plate {
  group: THREE.Group;
  sprite: THREE.Sprite;
  texture: THREE.CanvasTexture;
  material: THREE.SpriteMaterial;
  floor: THREE.Mesh;
  floorGeo: THREE.CircleGeometry;
  floorMaterial: THREE.MeshBasicMaterial;
}

/** Legacy-verbatim plate: a rounded dark card with a glowing gold first name. */
function makePlate(displayName: string): Plate {
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
  const floorGeo = new THREE.CircleGeometry(0.48, 24);
  const floor = new THREE.Mesh(floorGeo, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.renderOrder = 19;
  const group = new THREE.Group();
  group.name = "rally-nameplate";
  group.visible = false;
  group.add(floor);
  group.add(sprite);
  return { group, sprite, texture, material, floor, floorGeo, floorMaterial };
}

function disposePlate(p: Plate) {
  p.texture.dispose();
  p.material.dispose();
  p.floorGeo.dispose();
  p.floorMaterial.dispose();
}

export function R3FRallyNameplates({
  sim,
  runtime,
  refs,
}: R3FRallyNameplatesProps) {
  const sig = useSimSignal(runtime, () => rallyPresenceSignature(sim.state));
  const groupRef = useRef<THREE.Group>(null);

  const plates = useMemo(() => {
    const map = new Map<string, Plate>();
    for (const c of sim.state.rallyPresence ?? []) {
      map.set(c.id, makePlate(c.displayName));
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim, sig]);

  // mount the current plates under the layer group; dispose superseded sets (spec 119)
  useEffect(() => {
    const g = groupRef.current;
    if (!g) return;
    for (const p of plates.values()) g.add(p.group);
    return () => {
      for (const p of plates.values()) {
        g.remove(p.group);
        disposePlate(p);
      }
    };
  }, [plates]);

  useFrame(() => {
    if (plates.size === 0) return;
    // Reuse the list the avatar pass fetched this frame (verify F3) — only fall back to
    // the roster closure if the avatar layer hasn't run yet.
    const list =
      refs.lastList?.current ??
      (refs.source.current ? refs.source.current() : []);
    const t = sim.state.terrain;
    const N = t.size;
    const night = 1 - sim.state.clock.daylight;
    for (const p of plates.values()) p.group.visible = false;
    for (const a of list) {
      const plate = plates.get(a.id);
      if (!plate) continue;
      if (a.id === refs.fpCitizenId.current) continue; // never label the eyes we look out of
      const wy = Math.max(0, t.worldY(Math.round(a.x), Math.round(a.y)));
      plate.group.visible = true;
      plate.group.position.set((a.x - N / 2) * 4, wy + 1.25, (a.y - N / 2) * 4);
      plate.floor.position.set(0, -1.22, 0);
      plate.floorMaterial.opacity = 0.18 + night * 0.42;
      plate.material.opacity = 0.72 + night * 0.28;
    }
  });

  return <group ref={groupRef} name="rally-nameplates" />;
}
