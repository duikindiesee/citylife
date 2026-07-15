import React, { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { ColonySim } from "../sim";
import type { BusRoute } from "../transit/busRoute";
import type { DepotSite, DepotLayout } from "../transit/busDepot";
import type { BusPose } from "../transit/busFleet";
import {
  buildBusLayer,
  buildStop,
  makeBusRig,
  BUS_ROAD_LIFT,
  type BusLayer,
  type BusRig,
} from "./busLayer";
import { buildBusDepotLayer } from "./busDepotLayer";
import { getSmoothRoadY } from "./roadSurface";
import { ROAD_RIBBON_LIFT } from "./roadRibbon";
import { RENDER_DRY_FLOOR } from "./useTerrainLeveling";
import { depotCutFillSeatY, depotPadHeightRange } from "../transit/busDepot";

// Spec 122/140 — the town bus render. With a depot (spec 149) this draws the FLEET: the runtime's
// dispatch machine says where every bus is (grid poses) and this component dresses those poses —
// road-clamped height, slope pitch, spinning wheels, sway, door light — plus the depot pad and the
// route stop markers. Without a depot (seed had no fit) it falls back to the legacy single
// self-driving coach (spec 122), so old seeds keep their bus.

interface R3FBusRuntime {
  busRoute?: BusRoute | null;
  busDepot?: { site: DepotSite; layout: DepotLayout } | null;
  busPoses?: () => BusPose[];
}

interface R3FBusProps {
  sim: ColonySim;
  runtime?: R3FBusRuntime | null;
}

export function R3FBus({ sim, runtime }: R3FBusProps) {
  const containerRef = useRef<THREE.Group>(null);
  const legacyRef = useRef<BusLayer | null>(null);
  const fleetRef = useRef<{
    group: THREE.Group;
    rigs: BusRig[];
    lastPose: (BusPose | null)[];
  } | null>(null);
  const builtRoute = useRef<BusRoute | null>(null);
  const builtDepot = useRef<{ site: DepotSite; layout: DepotLayout } | null>(
    null,
  );

  const world = useMemo(() => {
    const size = sim.state.terrain.size;
    return {
      wx: (x: number) => (x - size / 2) * 4,
      wz: (y: number) => (y - size / 2) * 4,
      // Spec 122 — ride the SAME surface the road tiles render on (getSmoothRoadY, the max
      // over a bilinear footprint), sampled at fractional path coords, so the coach sits on
      // the road on slopes instead of floating/sinking to the raw cell-center terrain.
      roadY: (x: number, y: number) =>
        Math.max(0, getSmoothRoadY(sim.state.terrain, x, y)),
    };
  }, [sim]);

  const clearLayers = () => {
    if (legacyRef.current) {
      containerRef.current?.remove(legacyRef.current.group);
      legacyRef.current.dispose();
      legacyRef.current = null;
    }
    if (fleetRef.current) {
      containerRef.current?.remove(fleetRef.current.group);
      fleetRef.current.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mt = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mt)) mt.forEach((x) => x.dispose());
        else if (mt) mt.dispose();
      });
      fleetRef.current = null;
    }
  };

  // Free the bus meshes on unmount.
  useEffect(() => () => clearLayers(), []);

  useFrame((state) => {
    const route = runtime?.busRoute ?? null;
    const depot = runtime?.busDepot ?? null;
    if (route !== builtRoute.current || depot !== builtDepot.current) {
      clearLayers();
      builtRoute.current = route;
      builtDepot.current = depot;
      if (route && containerRef.current) {
        if (depot && runtime?.busPoses) {
          // Fleet mode. Terrain leveling balances cut-and-fill at the natural pad mid-range; the
          // drive slab sits 0.12 m proud and extends below the lowest natural edge as a foundation.
          const { site, layout } = depot;
          const padSeat = depotCutFillSeatY(
            sim.state.terrain,
            site,
            RENDER_DRY_FLOOR,
          );
          const padTopY = padSeat + 0.12;
          const natural = depotPadHeightRange(sim.state.terrain, site);
          const foundationBottomY = Math.min(
            padSeat - 0.18,
            natural.min - 0.18,
          );
          const inPad = (x: number, y: number) =>
            x >= site.x - 0.6 &&
            x <= site.x + site.w - 0.4 &&
            y >= site.y - 0.6 &&
            y <= site.y + site.h - 0.4;
          const fleetRoadY = (x: number, y: number) =>
            inPad(x, y) ? padTopY - BUS_ROAD_LIFT : world.roadY(x, y);
          const group = new THREE.Group();
          group.name = "bus-fleet";
          group.add(
            buildBusDepotLayer({
              site,
              layout,
              wx: world.wx,
              wz: world.wz,
              padTopY,
              foundationBottomY,
              roadTopY:
                world.roadY(site.roadCell.x, site.roadCell.y) +
                ROAD_RIBBON_LIFT,
            }),
          );
          for (const s of route.stops)
            group.add(
              buildStop({ wx: world.wx, wz: world.wz, roadY: world.roadY }, s),
            );
          const poses = runtime.busPoses();
          const rigs: BusRig[] = [];
          for (let i = 0; i < poses.length; i++) {
            const rig = makeBusRig({
              wx: world.wx,
              wz: world.wz,
              roadY: fleetRoadY,
            });
            rig.group.name = `bus-coach-${i}`;
            rigs.push(rig);
            group.add(rig.group);
          }
          containerRef.current.add(group);
          fleetRef.current = { group, rigs, lastPose: poses.map(() => null) };
        } else {
          const layer = buildBusLayer({
            terrain: sim.state.terrain,
            route,
            wx: world.wx,
            wz: world.wz,
            roadY: world.roadY,
          });
          if (layer) {
            legacyRef.current = layer;
            containerRef.current.add(layer.group);
          }
        }
      }
    }
    if (fleetRef.current && runtime?.busPoses) {
      const fleet = fleetRef.current;
      const poses = runtime.busPoses();
      for (let i = 0; i < fleet.rigs.length && i < poses.length; i++) {
        const pose = poses[i]!;
        const prev = fleet.lastPose[i];
        // Signed ground covered since last frame drives wheel spin + sway (capped: a mode jump is
        // a teleport, not a burnout).
        const raw = prev ? Math.hypot(pose.x - prev.x, pose.y - prev.y) : 0;
        const dist = Math.min(2, raw) * (pose.reversing ? -1 : 1);
        fleet.rigs[i]!.place(pose.x, pose.y, pose.heading, dist);
        fleet.rigs[i]!.setDoors(pose.doorsOpen);
        fleet.lastPose[i] = pose;
      }
    }
    legacyRef.current?.update(state.clock.elapsedTime * 1000);
  });

  return <group ref={containerRef} name="bus" />;
}
