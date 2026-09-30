import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import type { ColonySim } from "../sim";
import { useRoadNetwork } from "../stores/useRoadNetwork";

// Spec 131 — the two legacy camera behaviors the R3F port dropped:
//
// RACE CHASE CAM (legacy updateRaceCamera): while a rally race is counting down or running,
// the aerial camera glides behind the player's car — low, slightly above, pulling higher
// with speed. Engages only when the aerial MapControls own the camera (builder/world view);
// the first-person controller keeps its own eyes.
//
// CINEMATIC ORBIT (legacy updateCinematic): the TV-mode fly-around behind the login screen
// (CinematicBackdrop -> runtime.setCinematicOnly -> sim.state.cinematic). The camera orbits
// the landing site, and roughly every ~40s a cubic envelope pulls it way back and up into a
// wide establishing shot of the whole island, then eases back to street level.

interface R3FCameraDirectorProps {
  sim: ColonySim;
  runtime?: unknown;
}

export function R3FCameraDirector({ sim, runtime }: R3FCameraDirectorProps) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as {
    target?: THREE.Vector3;
    update?: () => void;
  } | null;
  const cinematicT0 = useRef<number | null>(null);
  const scratch = useMemo(
    () => ({
      target: new THREE.Vector3(),
      behind: new THREE.Vector3(),
      lookAhead: new THREE.Vector3(),
    }),
    [],
  );

  // Spec 176: Boot cinematic sequence state
  const bootInitialized = useRef(false);
  const bootMode = useRef<"none" | "road_flythrough" | "car_descent">("none");
  const bootStartMs = useRef(0);
  const bootSpline = useRef<THREE.CatmullRomCurve3 | null>(null);
  const bootLookTarget = useRef(new THREE.Vector3());

  // Allow clicking or pressing any key to skip the boot cinematic
  useEffect(() => {
    const handleSkip = () => {
      if (bootMode.current !== "none") {
        bootMode.current = "none";
        const rt = runtime as { bootCinematicActive?: boolean } | null;
        if (rt) rt.bootCinematicActive = false;
      }
    };
    window.addEventListener("pointerdown", handleSkip);
    window.addEventListener("keydown", handleSkip);
    return () => {
      window.removeEventListener("pointerdown", handleSkip);
      window.removeEventListener("keydown", handleSkip);
    };
  }, [runtime]);

  useFrame(() => {
    const t = sim.state.terrain;
    const N = t.size;
    const wx = (x: number) => (x - N / 2) * 4;
    const wz = (y: number) => (y - N / 2) * 4;
    const rt = runtime as {
      bootCinematicActive?: boolean;
      hasOwnedCar?: () => boolean;
      getOwnedDrivePose?: () => {
        x: number;
        y: number;
        heading: number;
        speed: number;
      } | null;
      teleportFirstPerson?: (x: number, y: number) => void;
      fpCameraCell?: { x: number; y: number } | null;
    } | null;

    // --- 1. cinematic orbit (owns camera during login screen backdrop) ---
    if (sim.state.cinematic) {
      if (cinematicT0.current === null) cinematicT0.current = performance.now();
      const T = (performance.now() - cinematicT0.current) / 1000;
      const cx = wx(t.landing.x);
      const cz = wz(t.landing.y);
      const cy = Math.max(0, t.worldY(t.landing.x, t.landing.y));
      const angle = (T / 90) * Math.PI * 2;
      const wide = Math.pow(Math.sin(T * 0.1571) * 0.5 + 0.5, 3);
      const radius = 28 + Math.sin(T / 22) * 14 + wide * 120;
      const height = 12 + Math.sin(T / 15) * 8 + wide * 78;
      camera.position.set(
        cx + Math.cos(angle) * radius,
        cy + height,
        cz + Math.sin(angle) * radius,
      );
      scratch.target.set(cx, cy + 1.2 + wide * 6, cz);
      if (controls?.target) controls.target.copy(scratch.target);
      camera.lookAt(scratch.target);
      return;
    }
    cinematicT0.current = null;

    // --- 2. Spec 176: Start-of-Game Boot Cinematic ---
    // If not yet initialized and the world is active (not login cinematic), engage boot sequence
    if (!bootInitialized.current) {
      bootInitialized.current = true;
      const driving = rt?.getOwnedDrivePose?.();
      const hasCar = !!driving || !!rt?.hasOwnedCar?.();

      if (hasCar) {
        bootMode.current = "car_descent";
        bootStartMs.current = performance.now();
        if (rt) rt.bootCinematicActive = true;
      } else {
        bootMode.current = "road_flythrough";
        bootStartMs.current = performance.now();
        if (rt) rt.bootCinematicActive = true;

        // Build CatmullRom3 road spline towards the illuminated garage/showroom
        const district = sim.state.commercialDistrict;
        const garagePad = district?.garagePad;
        const pts: THREE.Vector3[] = [];

        // Point 0: Scenic elevated establishing shot overlooking the road network
        const startX = t.landing.x;
        const startY = t.landing.y;
        pts.push(
          new THREE.Vector3(
            wx(startX),
            Math.max(0, t.worldY(startX, startY)) + 16,
            wz(startY) + 20,
          ),
        );

        // Intermediary road waypoints along the street towards the garage
        if (district?.street && district.street.length > 0) {
          const step = Math.max(1, Math.floor(district.street.length / 4));
          for (let i = 0; i < district.street.length; i += step) {
            const cell = district.street[i]!;
            const y = Math.max(0, t.worldY(cell.x, cell.y)) + 3.8;
            pts.push(new THREE.Vector3(wx(cell.x), y, wz(cell.y)));
          }
        }

        // Final approach: Facing the illuminated showroom facade
        if (garagePad) {
          const hubX = garagePad.x + (garagePad.w - 1) / 2;
          const hubY = garagePad.y + (garagePad.h - 1) / 2;
          const facing = garagePad.facingAngle;
          const approachX = hubX + Math.sin(facing) * 7.5;
          const approachY = hubY + Math.cos(facing) * 7.5;
          const ground = Math.max(0, t.worldY(approachX, approachY)) + 2.8;

          pts.push(new THREE.Vector3(wx(approachX), ground, wz(approachY)));
          bootLookTarget.current.set(
            wx(hubX - garagePad.w * 0.15),
            ground - 0.8,
            wz(hubY),
          );
        } else {
          pts.push(new THREE.Vector3(wx(startX), 8, wz(startY)));
        }

        if (pts.length >= 2) {
          try {
            bootSpline.current = new THREE.CatmullRomCurve3(pts);
          } catch {
            bootMode.current = "none";
            if (rt) rt.bootCinematicActive = false;
          }
        } else {
          bootMode.current = "none";
          if (rt) rt.bootCinematicActive = false;
        }
      }
    }

    // Execute active boot cinematic
    if (bootMode.current === "car_descent") {
      const driving = rt?.getOwnedDrivePose?.();
      if (!driving) {
        bootMode.current = "none";
        if (rt) rt.bootCinematicActive = false;
      } else {
        const elapsed = performance.now() - bootStartMs.current;
        const dur = 2200;
        const progress = Math.min(1, elapsed / dur);
        // Cubic ease-out
        const ease = 1 - Math.pow(1 - progress, 3);

        const groundY = Math.max(
          0,
          t.worldY(Math.round(driving.x), Math.round(driving.y)),
        );
        const carWx = wx(driving.x);
        const carWz = wz(driving.y);

        // High 3/4 aerial start position
        const startCamX = carWx - Math.cos(driving.heading - 0.65) * 20;
        const startCamY = groundY + 14;
        const startCamZ = carWz - Math.sin(driving.heading - 0.65) * 20;

        // Final chase camera position behind vehicle
        const targetCamX = carWx - Math.cos(driving.heading) * 6.2;
        const targetCamY = groundY + 2.4;
        const targetCamZ = carWz - Math.sin(driving.heading) * 6.2;

        camera.position.set(
          THREE.MathUtils.lerp(startCamX, targetCamX, ease),
          THREE.MathUtils.lerp(startCamY, targetCamY, ease),
          THREE.MathUtils.lerp(startCamZ, targetCamZ, ease),
        );

        scratch.target.set(
          carWx + Math.cos(driving.heading) * 4 * ease,
          groundY + 0.8 + 0.4 * ease,
          carWz + Math.sin(driving.heading) * 4 * ease,
        );
        camera.lookAt(scratch.target);

        if (progress >= 1) {
          bootMode.current = "none";
          if (rt) rt.bootCinematicActive = false;
        }
        return;
      }
    } else if (bootMode.current === "road_flythrough") {
      const spline = bootSpline.current;
      if (!spline) {
        bootMode.current = "none";
        if (rt) rt.bootCinematicActive = false;
      } else {
        try {
          const elapsed = performance.now() - bootStartMs.current;
          const dur = 4200;
          const progress = Math.min(1, elapsed / dur);
          // Smooth sine ease in/out
          const ease = 0.5 - 0.5 * Math.cos(progress * Math.PI);

          const pos = spline.getPointAt(ease);
          if (pos && !isNaN(pos.x)) {
            camera.position.copy(pos);
          }

          // Lookahead along the curve tangent; in the last 25%, transition smoothly towards showroom hero car
          const lookAheadProgress = Math.min(1, ease + 0.06);
          const lookAheadPoint = spline.getPointAt(lookAheadProgress);
          if (lookAheadPoint && !isNaN(lookAheadPoint.x)) {
            if (progress > 0.75) {
              const blend = (progress - 0.75) / 0.25;
              scratch.target.lerpVectors(
                lookAheadPoint,
                bootLookTarget.current,
                blend,
              );
            } else {
              scratch.target.copy(lookAheadPoint);
            }
            camera.lookAt(scratch.target);
          }

          if (progress >= 1) {
            bootMode.current = "none";
            if (rt) {
              rt.bootCinematicActive = false;
              const garagePad = sim.state.commercialDistrict?.garagePad;
              if (garagePad) {
                const hubX = garagePad.x + (garagePad.w - 1) / 2;
                const hubY = garagePad.y + (garagePad.h - 1) / 2;
                rt.fpCameraCell = { x: hubX, y: hubY };
                if (rt.teleportFirstPerson) {
                  const arrivalX = garagePad.roadTarget.x;
                  const arrivalY = garagePad.roadTarget.y;
                  rt.teleportFirstPerson(arrivalX, arrivalY);
                }
              }
            }
          }
        } catch {
          bootMode.current = "none";
          if (rt) rt.bootCinematicActive = false;
        }
        return;
      }
    }

    // --- 3. race chase cam (aerial modes only; FP keeps its own camera) ---
    const race = sim.state.raceState;
    if (!race || race.mode === "idle") return;
    const { builderActive, worldViewActive } = useRoadNetwork.getState();
    if (!builderActive && !worldViewActive) return;
    const c = race.car;
    const ground = Math.max(0, t.worldY(Math.round(c.x), Math.round(c.y)));
    scratch.target.set(wx(c.x), ground + 0.7, wz(c.y));
    scratch.behind.set(
      wx(c.x - Math.cos(c.heading) * 7.5),
      ground + 5.8 + Math.min(3.5, Math.abs(c.speed) * 0.25),
      wz(c.y - Math.sin(c.heading) * 7.5),
    );
    camera.position.lerp(scratch.behind, 0.16);
    if (controls?.target) {
      controls.target.lerp(scratch.target, 0.22);
      camera.lookAt(controls.target);
    } else {
      camera.lookAt(scratch.target);
    }
    camera.updateMatrixWorld();
  });

  return null;
}
