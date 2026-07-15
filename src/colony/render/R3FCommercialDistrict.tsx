import React, { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { ColonySim } from "../sim";
import {
  buildCommercialDistrictLayer,
  type CommercialDistrictLayer,
} from "./commercialDistrictLayer";
import { leveledWorldY } from "./terrainLeveling";
import { useSimSignal, type SimBridge } from "./useSimSignal";
import { commercialSignature } from "./simSignals";

// Spec 135 — the commercial district in v3. The runtime attaches the district on
// sim.state (spec 116 lineage) but nothing ever RENDERED it in R3F: the neon strip, the
// mall anchor, the garage anchor and the business labels were legacy-only — a graded road
// leading to an empty field. This mounts the extracted legacy layer verbatim and drives
// its per-frame life: sign glow flaring after dark, night floors, and the floating
// business labels with their screen projection + occlusion fade.

interface R3FCommercialDistrictProps {
  sim: ColonySim;
  runtime?: SimBridge;
  terrainLevel?: Map<number, number>;
}

export function R3FCommercialDistrict({
  sim,
  runtime,
  terrainLevel,
}: R3FCommercialDistrictProps) {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const sig = useSimSignal(runtime, () => commercialSignature(sim.state));
  // the layer bakes heights at build time; reads the freshest leveling through the ref
  const levelRef = useRef(terrainLevel);
  levelRef.current = terrainLevel;

  const layer = useMemo<CommercialDistrictLayer | null>(() => {
    const district = sim.state.commercialDistrict;
    if (!district) return null;
    const terrain = sim.state.terrain;
    const N = terrain.size;
    return buildCommercialDistrictLayer({
      state: sim.state,
      district,
      wx: (x) => (x - N / 2) * 4,
      wz: (y) => (y - N / 2) * 4,
      // the LEVELED surface (spec 134): pads and the coastal dry-blend already reshape the
      // ground the shops seat on
      surfaceY: (x, y) =>
        Math.max(
          0,
          leveledWorldY(
            terrain,
            levelRef.current,
            Math.round(x),
            Math.round(y),
          ),
        ),
    });
    // sig is the rebuild trigger for the mutable sim.state (dead-memo rule).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim, sig]);

  // Spec 119 — the superseded layer (geometry, materials, label CanvasTextures) is
  // disposed on every rebuild and on unmount.
  useEffect(
    () => () => {
      layer?.dispose();
    },
    [layer],
  );

  useFrame(() => {
    if (!layer) return;
    layer.update(sim.state.clock.daylight, camera, scene, gl.domElement);
  });

  if (!layer) return null;
  return <primitive object={layer.group} />;
}
