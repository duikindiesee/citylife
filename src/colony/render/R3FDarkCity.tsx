import React, { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { ColonySim } from "../sim";
import { buildDarkCity } from "./darkCity";
import { disposeDeep } from "./disposeDeep";
import { useRoadNetwork } from "../stores/useRoadNetwork";

// Spec 136 — the Dark City dressing: the rock slab under the island, the cyan waterline
// rim, the starfields and the blue gas giant. Built once from the terrain's world width,
// disposed on unmount (spec 119), mounted at boot stage 2 (spec 117) so the cosmos never
// blocks the first paint. The waterline rim is a NIGHT feature: its additive cylinders
// blow out into a white wall against the bright day sky (the legacy sky was void-dark
// even by day), so its opacity follows the night factor per frame.

const RIM_BASE_OPACITY = 0.32;
const HALO_BASE_OPACITY = 0.11;

export function R3FDarkCity({ sim }: { sim: ColonySim }) {
  const group = useMemo(() => buildDarkCity(sim.state.terrain.size * 4), [sim]);
  useEffect(() => () => disposeDeep(group), [group]);

  const mats = useMemo<{
    rim: THREE.MeshBasicMaterial | null;
    halo: THREE.MeshBasicMaterial | null;
  }>(() => {
    const found: {
      rim: THREE.MeshBasicMaterial | null;
      halo: THREE.MeshBasicMaterial | null;
    } = {
      rim: null,
      halo: null,
    };
    group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (o.name === "darkCity-rim")
        found.rim = m.material as THREE.MeshBasicMaterial;
      if (o.name === "darkCity-rim-halo")
        found.halo = m.material as THREE.MeshBasicMaterial;
    });
    return found;
  }, [group]);

  const nightRef = useRef(-1);
  useFrame(() => {
    // the same clock treatment as DayNightCycle: the builder forces noon (spec 131), the
    // world view does not (spec 136 — the night vista lives there)
    const { builderActive } = useRoadNetwork.getState();
    const time = builderActive
      ? 12
      : sim.state.clock.hour + sim.state.clock.minute / 60;
    let dayFactor = 0;
    if (time > 5 && time < 7) dayFactor = (time - 5) / 2;
    else if (time >= 7 && time <= 17) dayFactor = 1;
    else if (time > 17 && time < 19) dayFactor = 1 - (time - 17) / 2;
    const night = 1 - dayFactor;
    if (Math.abs(night - nightRef.current) < 0.01) return;
    nightRef.current = night;
    if (mats.rim) mats.rim.opacity = RIM_BASE_OPACITY * (0.08 + 0.92 * night);
    if (mats.halo)
      mats.halo.opacity = HALO_BASE_OPACITY * (0.08 + 0.92 * night);
  });

  return <primitive object={group} />;
}
