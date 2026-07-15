import React, { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { ColonySim } from "../sim";
import { buildRoadRibbons } from "./roadRibbon";
import { getSmoothRoadY } from "./roadSurface";
import { findJunctionZones, junctionFurniture } from "./roadJunctions";
import { attachCapPolys, buildJunctionCaps, CAP_LIFT } from "./junctionCap";
import { disposeDeep } from "./disposeDeep";
import { useSimSignal, type SimBridge } from "./useSimSignal";
import { roadwaySignature } from "./simSignals";
import { TrafficLight, StopSign } from "./roadFurniture";

// Spec 127/137 — the smooth ribbon road surface, ported from the legacy renderer (spec
// 088). The road CELL data is a deliberately ~3-cell-wide carriageway for traffic/pathing;
// the ribbon extrudes ONE terrain-draped strip per road centre-line (sim.state.roadWays),
// with dashes and edge lines baked into merged meshes.
//
// JUNCTIONS (spec 137): the spec-127 axis-aligned MAX-height box slab is gone — measured
// live it floated at every junction (corners with 1.2-2.1 m of air) and every arm stepped
// up onto it (worst 1.49 m), the same reverted-in-v2 "flat plateau with hard wedges".
// Junctions now get a DRAPED CAP: a convex arm-mouth hull, every vertex at
// roadY + CAP_LIFT through the ribbons' own sampler — it can neither float nor step, and
// its 25 mm constant separation (plus polygonOffset) kills the coplanar z-fight the slab
// existed to hide. Zebra crossings and stop bars are baked into one junction-paint mesh
// anchored at the arm MOUTHS; signals/signs stand on the verge from REAL arm headings.

interface R3FRoadRibbonsProps {
  sim: ColonySim;
  runtime?: SimBridge;
}

/** One junction-cap tarmac material, ribbon-identical so the cap tones and shadows like
 *  the road (the old slab's off-tone single-sided box read as an alien patch and stayed
 *  lit inside cast shadows). polygonOffset is depth-precision insurance at distance. */
const capMaterial = new THREE.MeshStandardMaterial({
  color: 0x595f6a,
  roughness: 0.92,
  metalness: 0.02,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -2,
});
const capPaintMaterial = new THREE.MeshStandardMaterial({
  color: 0xe8ecf2,
  roughness: 0.6,
  emissive: 0xb9c0cc,
  emissiveIntensity: 0.28,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -4,
});

const meshFrom = (positions: number[], mat: THREE.Material, name: string) => {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = name;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
};

export function R3FRoadRibbons({ sim, runtime }: R3FRoadRibbonsProps) {
  const sig = useSimSignal(runtime, () => roadwaySignature(sim.state));

  const built = useMemo(() => {
    const ways = sim.state.roadWays ?? [];
    if (!ways.length) return null;
    const terrain = sim.state.terrain;
    const N = terrain.size;
    const wx = (x: number) => (x - N / 2) * 4;
    const wz = (y: number) => (y - N / 2) * 4;
    const roadY = (x: number, y: number) => getSmoothRoadY(terrain, x, y);
    const opts = { terrain, wx, wz, roadY };
    // Zones FIRST (cap polygons attached), so the ribbon builder suppresses paint along
    // the exact cap footprint and the cap builder anchors zebras at the same mouths —
    // one boundary, no drift (the spec-127 JR dilation left a 16-20 m unmarked annulus).
    const publicWays = ways.filter((way) => way.source !== "depot-spur");
    const zones = attachCapPolys(findJunctionZones(publicWays));
    const { group } = buildRoadRibbons(ways, opts, zones);
    const caps = buildJunctionCaps(zones, opts);
    if (caps.surf.length)
      group.add(meshFrom(caps.surf, capMaterial, "RoadJunctionCaps"));
    if (caps.paint.length)
      group.add(meshFrom(caps.paint, capPaintMaterial, "RoadJunctionPaint"));
    // Furniture positions need a ground height for their pole bases: the local road
    // surface (they stand on the verge beside it, close enough at 25 mm resolution).
    const furniture = zones.flatMap((z, zi) =>
      junctionFurniture(z, publicWays).map((f, fi) => ({
        ...f,
        key: `f-${zi}-${fi}`,
        // deterministic per-junction signal phase offset so the whole city doesn't
        // blink in unison (hash of the zone centre)
        phase: (Math.abs(Math.sin(z.cx * 12.9898 + z.cy * 78.233)) * 16) % 16,
        wY: Math.max(0, roadY(f.x, f.y)) + CAP_LIFT,
      })),
    );
    return { group, furniture, wx, wz };
    // sig is the rebuild trigger for the mutable sim.state (dead-memo rule).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim, sig]);

  // Spec 119 — the superseded ribbon group (merged geometries + materials) must be
  // disposed on every rebuild and on unmount, or each road edit leaks its GPU buffers.
  useEffect(
    () => () => {
      if (built) disposeDeep(built.group);
    },
    [built],
  );

  if (!built) return null;
  const { wx, wz } = built;

  return (
    <group name="RoadRibbonsLayer">
      <primitive object={built.group} />
      <group name="RoadJunctions">
        {built.furniture.map((f) => {
          const pos: [number, number, number] = [wx(f.x), f.wY, wz(f.y)];
          if (f.kind === "light")
            return (
              <TrafficLight
                key={f.key}
                position={pos}
                rotationY={f.rotY}
                laneHalfM={f.laneHalfM}
                group={f.group ?? "A"}
                phase={f.phase}
              />
            );
          if (f.kind === "stopsign")
            return <StopSign key={f.key} position={pos} rotationY={f.rotY} />;
          return null;
        })}
      </group>
    </group>
  );
}
