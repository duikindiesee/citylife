import { useMemo, useRef } from "react";
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
}

export function R3FCameraDirector({ sim }: R3FCameraDirectorProps) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as {
    target?: THREE.Vector3;
    update?: () => void;
  } | null;
  const cinematicT0 = useRef<number | null>(null);
  const scratch = useMemo(
    () => ({ target: new THREE.Vector3(), behind: new THREE.Vector3() }),
    [],
  );

  useFrame(() => {
    const t = sim.state.terrain;
    const N = t.size;
    const wx = (x: number) => (x - N / 2) * 4;
    const wz = (y: number) => (y - N / 2) * 4;

    // --- cinematic orbit (owns the camera outright while active) ---
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

    // --- race chase cam (aerial modes only; FP keeps its own camera) ---
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
