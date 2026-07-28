// Spec 158 — the renderer-side half of the perf instrumentation.
//
// Mounted inside <Physics> (so it can reach the Rapier world) and inside <Canvas> (so it can
// reach the WebGL renderer). Renders nothing. When the perf flag is off it mounts, sees no
// session, and returns immediately — no patching, no allocation, no cost.
//
// HOW THE FRAME IS SPLIT
//   frameMs  — start of frame N to start of frame N+1. What the player feels.
//   cpuMs    — start of frame to the first draw submission: every useFrame callback, the
//              physics step, the walker, the sim signals.
//   drawMs   — CPU time inside renderer.render (all passes summed; the post-processing
//              composer issues several per frame).
//   gpuMs    — GPU time for the main scene render, from EXT_disjoint_timer_query_webgl2.
//   physicsMs— Rapier world.step, measured by wrapping the world's own step method.
//
// A frame where cpuMs+drawMs is small but frameMs is large is GPU/present bound; a frame
// where cpuMs dominates is CPU bound. That derivation is what answers candidate 1 of the
// investigation, and it works even where the timer-query extension is unavailable.

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { useRapier } from "@react-three/rapier";
import { perfSession, installPerfGlobal } from "../perf/perfSession";
import { GpuFrameTimer } from "../perf/gpuTimer";
import { emptySample, type FrameSample } from "../perf/perfMonitor";
import type { TraceFrame } from "../perf/movementTrace";

interface RenderInfoLike {
  calls: number;
  triangles: number;
}

export function R3FPerfProbe() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const rapier = useRapier();

  const sample = useRef<FrameSample>(emptySample());
  const lastFrameStart = useRef(0);
  const frameStartAt = useRef(0);
  const preDrawMs = useRef(0);
  const drawMs = useRef(0);
  const physicsMs = useRef(0);
  const renderInfo = useRef<RenderInfoLike>({ calls: 0, triangles: 0 });
  const shadowPass = useRef(false);
  const gpuTimer = useRef<GpuFrameTimer | null>(null);
  const framesSinceCensus = useRef(0);

  // --- Patch the renderer's draw submission -------------------------------------------
  useEffect(() => {
    const session = perfSession();
    if (!session) return;
    installPerfGlobal();
    session.sceneRoot = scene as unknown as never;
    // Dynamic import so the HUD's React tree is a separate chunk that a production session
    // never downloads.
    void import("../perf/PerfHudOverlay").then((m) => m.mountPerfHud());

    const context = gl.getContext();
    const timer = new GpuFrameTimer(
      typeof WebGL2RenderingContext !== "undefined" &&
        context instanceof WebGL2RenderingContext
        ? context
        : null,
    );
    gpuTimer.current = timer;
    session.gpuAvailable = timer.available;

    const originalRender = gl.render.bind(gl);
    let firstRenderOfFrame = true;
    const patched = (
      renderScene: THREE.Object3D,
      renderCamera: THREE.Camera,
    ) => {
      // three re-renders the shadow map only on frames where needsUpdate was set; capture the
      // flag BEFORE the render clears it, or every frame looks like a shadow frame.
      const t0 = performance.now();
      if (firstRenderOfFrame) {
        // three re-renders the shadow map only on frames where needsUpdate was set; capture
        // the flag BEFORE the render clears it, or every frame looks like a shadow frame.
        shadowPass.current = gl.shadowMap.needsUpdate;
        // MEASURED, not derived: the JS the frame ran before it asked for any pixels.
        preDrawMs.current = t0 - frameStartAt.current;
        timer.begin();
      }
      originalRender(renderScene, renderCamera);
      if (firstRenderOfFrame) {
        timer.end();
        firstRenderOfFrame = false;
      }
      drawMs.current += performance.now() - t0;
      renderInfo.current.calls += gl.info.render.calls;
      renderInfo.current.triangles += gl.info.render.triangles;
    };
    (gl as unknown as { render: typeof patched }).render = patched;
    (patched as unknown as { __perfResetFrame: () => void }).__perfResetFrame =
      () => {
        firstRenderOfFrame = true;
      };

    return () => {
      (gl as unknown as { render: typeof originalRender }).render =
        originalRender;
      timer.dispose();
      gpuTimer.current = null;
      if (session.sceneRoot === (scene as unknown as never))
        session.sceneRoot = null;
    };
  }, [gl, scene]);

  // --- Patch the Rapier step ------------------------------------------------------------
  useEffect(() => {
    const session = perfSession();
    if (!session) return;
    const world = rapier?.world as unknown as
      { step: (...args: unknown[]) => unknown } | undefined;
    if (!world || typeof world.step !== "function") return;
    const originalStep = world.step.bind(world);
    world.step = (...args: unknown[]) => {
      const t0 = performance.now();
      const out = originalStep(...args);
      physicsMs.current += performance.now() - t0;
      return out;
    };
    return () => {
      world.step = originalStep;
    };
  }, [rapier]);

  // --- Keyboard toggle -------------------------------------------------------------------
  useEffect(() => {
    const session = perfSession();
    if (!session || typeof window === "undefined") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.code === "F9") {
        event.preventDefault();
        session.toggleHud();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // --- Frame start: close out the previous frame -----------------------------------------
  // Priority is negative so this runs before every other useFrame callback in the tree; the
  // sample it closes is therefore the complete previous frame.
  useFrame(() => {
    const session = perfSession();
    if (!session) return;
    const now = performance.now();
    const previousStart = lastFrameStart.current;
    lastFrameStart.current = now;
    // Stamp the start of THIS frame; the patched render measures back to it.
    frameStartAt.current = now;

    if (previousStart > 0) {
      const s = sample.current;
      s.t = now;
      s.frameMs = now - previousStart;
      s.drawMs = drawMs.current;
      s.cpuMs = preDrawMs.current;
      s.gpuMs = gpuTimer.current?.read() ?? -1;
      s.physicsMs = physicsMs.current;
      s.drawCalls = renderInfo.current.calls;
      s.triangles = renderInfo.current.triangles;
      s.shadowPass = shadowPass.current;

      let pose: Omit<TraceFrame, "t"> | null = null;
      if (session.recorder.recording) {
        const euler = new THREE.Euler().setFromQuaternion(
          camera.quaternion,
          "YXZ",
        );
        pose = {
          x: camera.position.x,
          y: camera.position.y,
          z: camera.position.z,
          yaw: euler.y,
          pitch: euler.x,
          input: {
            forward: false,
            backward: false,
            left: false,
            right: false,
            sprint: false,
          },
          frameMs: s.frameMs,
          cpuMs: s.cpuMs,
          drawMs: s.drawMs,
          gpuMs: s.gpuMs,
          drawCalls: s.drawCalls,
          triangles: s.triangles,
        };
      }
      session.onFrame(s, pose);

      if (session.hudVisible && ++framesSinceCensus.current >= 60) {
        framesSinceCensus.current = 0;
        session.census();
        session.emit();
      } else if (session.hudVisible && framesSinceCensus.current % 10 === 0) {
        session.emit();
      }
    }

    // A frame that never drew must not report the previous frame's pre-draw time.
    preDrawMs.current = 0;
    drawMs.current = 0;
    physicsMs.current = 0;
    renderInfo.current.calls = 0;
    renderInfo.current.triangles = 0;
    shadowPass.current = false;
    const reset = (gl.render as unknown as { __perfResetFrame?: () => void })
      .__perfResetFrame;
    if (reset) reset();
  }, -1000);

  return null;
}
