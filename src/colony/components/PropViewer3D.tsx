// CITYLIFE.3D.VIEWER — Reusable PropViewer3D UI component.
// Renders single isolated GLB props or room mode placement layouts with accessible controls,
// reduced-motion support, mobile input handling, and robust load-error fallbacks.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  DEFAULT_CONTROLS_STATE,
  clampPropPolar,
  clampPropZoom,
  type PropPlacementSchema,
  type PropViewerControlsState,
  type PropViewerMode,
} from "./propViewerTypes";

export interface PropViewer3DProps {
  mode?: PropViewerMode;
  glbUrl?: string;
  nodeName?: string;
  placementJson?: PropPlacementSchema | null;
  placementUrl?: string;
  roomName?: string;
  controls?: PropViewerControlsState;
  onControlsChange?: (controls: PropViewerControlsState) => void;
  onError?: (error: Error) => void;
  onClose?: () => void;
  autoRotate?: boolean;
  reducedMotion?: boolean;
  ariaLabel?: string;
  style?: CSSProperties;
}

const containerStyle: CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  minHeight: 300,
  background: "#0d131d",
  borderRadius: 8,
  overflow: "hidden",
  outline: "none",
  userSelect: "none",
};

const errorBoxStyle: CSSProperties = {
  position: "absolute",
  inset: 16,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 12,
  padding: 24,
  background: "rgba(30, 16, 20, 0.95)",
  border: "1px solid #7a2d3a",
  borderRadius: 8,
  color: "#f8a0ac",
  fontFamily: "monospace",
  fontSize: 14,
  textAlign: "center",
  zIndex: 10,
};

const retryButtonStyle: CSSProperties = {
  padding: "8px 16px",
  fontSize: 13,
  fontWeight: 700,
  color: "#ffffff",
  background: "#9b3647",
  border: "1px solid #c85065",
  borderRadius: 6,
  cursor: "pointer",
};

export function PropViewer3D({
  mode = "prop",
  glbUrl = "/assets/citylife/props/hq-commons-pack.glb",
  nodeName = "Commons_Arcade",
  placementJson = null,
  placementUrl = "/assets/citylife/props/hq-commons-pack.placement.json",
  roomName = "arcade",
  controls: externalControls,
  onControlsChange,
  onError,
  onClose,
  autoRotate = false,
  reducedMotion: externalReducedMotion,
  ariaLabel = "Interactive 3D Prop Viewer",
  style,
}: PropViewer3DProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [internalControls, setInternalControls] =
    useState<PropViewerControlsState>(DEFAULT_CONTROLS_STATE);
  const activeControls = externalControls ?? internalControls;

  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [retryCount, setRetryCount] = useState<number>(0);
  const [activePlacement, setActivePlacement] =
    useState<PropPlacementSchema | null>(placementJson);

  // Ref to hold the current control values to prevent scene effect re-creation on every control change
  const controlsRef = useRef<PropViewerControlsState>(activeControls);
  useEffect(() => {
    controlsRef.current = activeControls;
  }, [activeControls]);

  // Ref to hold the latest onError callback to prevent scene effect re-creation when callback identity changes
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  // System reduced-motion preference check
  const [prefersReducedMotion, setPrefersReducedMotion] = useState<boolean>(
    () => {
      if (typeof externalReducedMotion === "boolean")
        return externalReducedMotion;
      if (typeof window !== "undefined" && window.matchMedia) {
        return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      }
      return false;
    },
  );

  useEffect(() => {
    if (typeof externalReducedMotion === "boolean") {
      setPrefersReducedMotion(externalReducedMotion);
      return;
    }
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const listener = (e: MediaQueryListEvent) =>
      setPrefersReducedMotion(e.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [externalReducedMotion]);

  const updateControls = useCallback(
    (updater: (prev: PropViewerControlsState) => PropViewerControlsState) => {
      const current = controlsRef.current;
      const next = updater(current);
      controlsRef.current = next;
      setInternalControls(next);
      onControlsChange?.(next);
    },
    [onControlsChange],
  );

  const handleRetry = useCallback(() => {
    setLoadError(null);
    setIsLoading(true);
    setRetryCount((prev) => prev + 1);
  }, []);

  // Fetch placement JSON in room mode if not provided directly
  useEffect(() => {
    if (mode !== "room") return;
    if (placementJson) {
      setActivePlacement(placementJson);
      return;
    }
    if (!placementUrl) return;

    let mounted = true;
    fetch(placementUrl)
      .then((res) => {
        if (!res.ok)
          throw new Error(`Failed to load placement JSON (${res.status})`);
        return res.json();
      })
      .then((json) => {
        if (mounted) setActivePlacement(json);
      })
      .catch((err) => {
        if (mounted) {
          const msg = err instanceof Error ? err.message : String(err);
          setLoadError(`Room layout error: ${msg}`);
          onErrorRef.current?.(err instanceof Error ? err : new Error(msg));
        }
      });

    return () => {
      mounted = false;
    };
  }, [mode, placementJson, placementUrl]);

  // Main 3D Canvas Lifecycle & Scene Setup
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    setIsLoading(true);
    setLoadError(null);

    let animationFrameId: number;
    let renderer: THREE.WebGLRenderer | null = null;
    let scene: THREE.Scene | null = null;
    let camera: THREE.PerspectiveCamera | null = null;
    let isDisposed = false;

    try {
      scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0d131d);

      const width = canvas.clientWidth || 600;
      const height = canvas.clientHeight || 400;

      camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);

      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
      });
      renderer.setSize(width, height, false);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

      // Lighting setup: studio lights
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
      scene.add(ambientLight);

      const keyLight = new THREE.DirectionalLight(0xfffaed, 1.4);
      keyLight.position.set(4, 8, 5);
      scene.add(keyLight);

      const fillLight = new THREE.DirectionalLight(0x8cb6e0, 0.6);
      fillLight.position.set(-5, 4, 3);
      scene.add(fillLight);

      const rimLight = new THREE.DirectionalLight(0xffffff, 0.8);
      rimLight.position.set(0, 6, -6);
      scene.add(rimLight);

      // Grid / Plinth floor
      const gridHelper = new THREE.GridHelper(12, 12, 0x3a5a7a, 0x1e2e3e);
      gridHelper.position.y = 0;
      scene.add(gridHelper);

      // Model container
      const modelGroup = new THREE.Group();
      scene.add(modelGroup);

      const loader = new GLTFLoader();
      const targetGlbUrl =
        mode === "room" && activePlacement?.asset.url
          ? activePlacement.asset.url
          : glbUrl;

      loader.load(
        targetGlbUrl,
        (gltf) => {
          if (isDisposed) return;
          setIsLoading(false);

          if (mode === "prop") {
            // Single Prop Mode: Find and isolate target prop node
            let foundNode: THREE.Object3D | null = null;

            if (nodeName) {
              gltf.scene.traverse((child) => {
                if (child.name === nodeName || child.name.includes(nodeName)) {
                  if (!foundNode) foundNode = child.clone(true);
                }
              });
            }

            // Fallback to entire scene if target node name is not found
            const objectToRender = foundNode ?? gltf.scene;

            // Center object at origin
            const bbox = new THREE.Box3().setFromObject(objectToRender);
            const center = bbox.getCenter(new THREE.Vector3());
            const minY = bbox.min.y;

            objectToRender.position.x -= center.x;
            objectToRender.position.y -= minY; // Sitting flush on grid (y=0)
            objectToRender.position.z -= center.z;

            modelGroup.add(objectToRender);
          } else {
            // Room Mode: Render placement.json driven room layout
            if (activePlacement && activePlacement.placements) {
              const roomPlacements = roomName
                ? activePlacement.placements.filter((p) => p.room === roomName)
                : activePlacement.placements;

              for (const p of roomPlacements) {
                let nodeMesh: THREE.Object3D | null = null;

                gltf.scene.traverse((child) => {
                  if (child.name === p.node || child.name.includes(p.node)) {
                    if (!nodeMesh) nodeMesh = child.clone(true);
                  }
                });

                if (nodeMesh) {
                  const nodeGroup = new THREE.Group();
                  nodeGroup.position.set(
                    p.position[0],
                    p.position[1],
                    p.position[2],
                  );
                  nodeGroup.rotation.y = p.yawRadians;

                  // Highlight selected prop if it matches nodeName
                  const targetObj = nodeMesh as THREE.Object3D;
                  if (
                    nodeName &&
                    (p.node === nodeName || p.node.includes(nodeName))
                  ) {
                    targetObj.traverse((m: THREE.Object3D) => {
                      if ((m as THREE.Mesh).isMesh) {
                        const mesh = m as THREE.Mesh;
                        if (mesh.material) {
                          const mat = (
                            Array.isArray(mesh.material)
                              ? mesh.material[0]
                              : mesh.material
                          ) as THREE.MeshStandardMaterial;
                          if (mat && mat.emissive) {
                            mat.emissive = new THREE.Color(0x3a7ab0);
                            mat.emissiveIntensity = 0.4;
                          }
                        }
                      }
                    });
                  }

                  nodeGroup.add(targetObj);
                  modelGroup.add(nodeGroup);
                }
              }
            } else {
              modelGroup.add(gltf.scene);
            }
          }
        },
        undefined,
        (err: unknown) => {
          if (isDisposed) return;
          setIsLoading(false);
          const errObj = err instanceof Error ? err : new Error(String(err));
          const errorMsg = `Asset load failure (${targetGlbUrl}): ${errObj.message}`;
          setLoadError(errorMsg);
          onErrorRef.current?.(errObj);
        },
      );

      // Render loop
      let lastTime = performance.now();
      const renderFrame = (now: number) => {
        if (isDisposed || !renderer || !scene || !camera) return;

        const delta = (now - lastTime) / 1000;
        lastTime = now;

        // Auto-rotation if enabled and not suppressed by reduced motion
        if (autoRotate && !prefersReducedMotion) {
          updateControls((prev) => ({
            ...prev,
            azimuth: prev.azimuth + delta * 0.4,
          }));
        }

        // Apply controls to camera position using truthful current control ref
        const { azimuth, polar, zoom, pan } = controlsRef.current;
        const clampedZoom = clampPropZoom(zoom);
        const clampedPolar = clampPropPolar(polar);

        const camX =
          pan[0] + Math.sin(azimuth) * Math.cos(clampedPolar) * clampedZoom;
        const camY = Math.max(
          0.2,
          pan[1] + Math.sin(clampedPolar) * clampedZoom + 0.9,
        );
        const camZ =
          Math.sin(azimuth + Math.PI / 2) *
          Math.cos(clampedPolar) *
          clampedZoom;

        camera.position.set(camX, camY, camZ);
        camera.lookAt(pan[0], 0.9 + pan[1], 0);

        renderer.render(scene, camera);
        animationFrameId = requestAnimationFrame(renderFrame);
      };

      animationFrameId = requestAnimationFrame(renderFrame);
    } catch (err) {
      setIsLoading(false);
      const msg = `WebGL Canvas initialization failed: ${err instanceof Error ? err.message : String(err)}`;
      setLoadError(msg);
      onErrorRef.current?.(err instanceof Error ? err : new Error(msg));
    }

    // Resize handler
    const handleResize = () => {
      if (!canvas || !renderer || !camera) return;
      const width = canvas.clientWidth || 600;
      const height = canvas.clientHeight || 400;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };

    window.addEventListener("resize", handleResize);

    return () => {
      isDisposed = true;
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", handleResize);

      if (scene) {
        scene.traverse((obj) => {
          if ((obj as THREE.Mesh).isMesh) {
            const mesh = obj as THREE.Mesh;
            mesh.geometry?.dispose();
            if (Array.isArray(mesh.material)) {
              mesh.material.forEach((m) => m.dispose());
            } else if (mesh.material) {
              mesh.material.dispose();
            }
          }
        });
      }

      if (renderer) {
        renderer.dispose();
        renderer.forceContextLoss();
      }
    };
  }, [
    glbUrl,
    nodeName,
    mode,
    activePlacement,
    roomName,
    autoRotate,
    prefersReducedMotion,
    retryCount,
  ]);

  // Touch & Pointer Gesture Controls
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const initialTouchDist = useRef<number | null>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
    isDragging.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    dragStart.current = { x: e.clientX, y: e.clientY };

    if (e.shiftKey || e.button === 2) {
      // Pan control
      updateControls((prev) => ({
        ...prev,
        pan: [prev.pan[0] - dx * 0.005, prev.pan[1] + dy * 0.005],
      }));
    } else {
      // Orbit control
      const step = prefersReducedMotion ? 0.003 : 0.006;
      updateControls((prev) => ({
        ...prev,
        azimuth: prev.azimuth - dx * step,
        polar: clampPropPolar(prev.polar + dy * step),
      }));
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    isDragging.current = false;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // Ignore pointer capture errors
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.25 : -0.25;
    updateControls((prev) => ({
      ...prev,
      zoom: clampPropZoom(prev.zoom + delta),
    }));
  };

  // Touch pinch to zoom handling
  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);

      if (initialTouchDist.current !== null) {
        const diff = initialTouchDist.current - dist;
        if (Math.abs(diff) > 5) {
          const delta = diff > 0 ? 0.15 : -0.15;
          updateControls((prev) => ({
            ...prev,
            zoom: clampPropZoom(prev.zoom + delta),
          }));
          initialTouchDist.current = dist;
        }
      } else {
        initialTouchDist.current = dist;
      }
    }
  };

  const handleTouchEnd = () => {
    initialTouchDist.current = null;
  };

  // Keyboard navigation & accessibility handlers
  const handleKeyDown = (e: React.KeyboardEvent) => {
    const stepAngle = prefersReducedMotion
      ? (15 * Math.PI) / 180
      : (8 * Math.PI) / 180;
    const stepZoom = 0.3;

    switch (e.key) {
      case "ArrowLeft":
        e.preventDefault();
        updateControls((prev) => ({
          ...prev,
          azimuth: prev.azimuth - stepAngle,
        }));
        break;
      case "ArrowRight":
        e.preventDefault();
        updateControls((prev) => ({
          ...prev,
          azimuth: prev.azimuth + stepAngle,
        }));
        break;
      case "ArrowUp":
        e.preventDefault();
        updateControls((prev) => ({
          ...prev,
          polar: clampPropPolar(prev.polar + stepAngle),
        }));
        break;
      case "ArrowDown":
        e.preventDefault();
        updateControls((prev) => ({
          ...prev,
          polar: clampPropPolar(prev.polar - stepAngle),
        }));
        break;
      case "+":
      case "=":
      case "PageUp":
        e.preventDefault();
        updateControls((prev) => ({
          ...prev,
          zoom: clampPropZoom(prev.zoom - stepZoom),
        }));
        break;
      case "-":
      case "_":
      case "PageDown":
        e.preventDefault();
        updateControls((prev) => ({
          ...prev,
          zoom: clampPropZoom(prev.zoom + stepZoom),
        }));
        break;
      case "r":
      case "R":
        e.preventDefault();
        updateControls(() => DEFAULT_CONTROLS_STATE);
        break;
      case "Escape":
        e.preventDefault();
        onClose?.();
        break;
    }
  };

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label={ariaLabel}
      tabIndex={0}
      style={{ ...containerStyle, ...style }}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onWheel={handleWheel}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      data-testid="prop-viewer-3d"
      data-mode={mode}
      data-node-name={nodeName}
      data-reduced-motion={prefersReducedMotion ? "true" : "false"}
    >
      {/* Loading Indicator */}
      {isLoading && !loadError && (
        <div
          data-testid="prop-viewer-loading"
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(13, 19, 29, 0.75)",
            color: "#7ab0d0",
            fontFamily: "monospace",
            fontSize: 13,
            zIndex: 5,
          }}
        >
          <span>Loading 3D Prop ({nodeName})...</span>
        </div>
      )}

      {/* Accessible Asset Load Error Fallback UI */}
      {loadError && (
        <div role="alert" data-testid="prop-viewer-error" style={errorBoxStyle}>
          <div style={{ fontSize: 22 }}>⚠️ 3D Asset Load Failure</div>
          <div>{loadError}</div>
          <div style={{ fontSize: 12, color: "#c8808a" }}>
            Target prop: <strong>{nodeName}</strong> ({glbUrl})
          </div>
          <button
            type="button"
            data-testid="prop-viewer-retry"
            style={retryButtonStyle}
            onClick={handleRetry}
          >
            Retry Loading Asset
          </button>
        </div>
      )}

      {/* 3D Canvas element */}
      <canvas
        ref={canvasRef}
        data-testid="prop-viewer-canvas"
        style={{
          width: "100%",
          height: "100%",
          display: loadError ? "none" : "block",
          cursor: "grab",
        }}
      />
    </div>
  );
}
