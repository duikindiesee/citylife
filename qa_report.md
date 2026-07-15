# QA and Hardening Report: R3F Render Port

## Executive Summary

The newly ported R3F features in `src/colony/render/` exhibit a mix of solid porting logic but critical misunderstandings of React reactivity and React Three Fiber (R3F) performance best practices. The most severe issue is the complete lack of component re-rendering when the mutable `sim.state` changes. Additionally, there are severe CPU bottlenecks in the ocean wave implementation and potential memory leaks in the foliage implementation.

## 1. Reactivity & State Management (Critical)

- **The "Dead Memo" Anti-Pattern:** Components like `ZoneManager`, `R3FFoliage`, and hooks like `useTerrainLeveling` rely on `useMemo` dependency arrays containing properties of the mutable `sim.state` object (e.g., `[sim.state.roadsVersion]`). However, these components are _never_ triggered to re-render when `sim` mutates because `sim` is a stable class instance. Without a state manager (e.g., Zustand) or `useSyncExternalStore` bridging the mutable class to React, the R3F components will only ever render their initial state and never update.
- **`DayNightCycle` Over-rendering:** `DayNightCycle` uses a `setInterval` that calls `setTime` every 1 second. This triggers a full React re-render of the Sky, Lights, and Fog every second. In R3F, continuous animations like day/night transitions should be handled inside a `useFrame` loop by mutating Three.js object references directly (e.g., `lightRef.current.position.set(...)`), rather than causing React reconciliations every second.

## 2. Performance Bottlenecks

- **CPU-bound Ocean Waves (`R3FOcean.tsx`):** The ocean animates by iterating over 3600 vertices of a `RingGeometry` on _every single frame_ in `useFrame`, calculating sine waves, updating positions, and calling `computeVertexNormals()`. This is incredibly expensive and will tank the framerate.
  - **Fix:** Ocean waves must be moved to the GPU using a vertex shader (e.g., via `onBeforeCompile` on a `MeshStandardMaterial` or a custom `ShaderMaterial`).
- **Memory Leaks in Foliage (`R3FFoliage.tsx`):** `new THREE.ConeGeometry` and `new THREE.MeshStandardMaterial` are instantiated inside a `useMemo`. If `sim.state.roadsVersion` ever actually triggers a re-render, the old geometry and material are never `.dispose()`'d, leaking GPU memory.
  - **Fix:** Define `<coneGeometry>` inside the JSX, or explicitly dispose of resources in a `useEffect` cleanup block if instantiated in useMemo.

## 3. TypeScript & React Warnings

- **Missing Reactivity Keys:** In `useTerrainLeveling.ts`, `roadRibbonCells` is typed as a `Set<string>`. Passing a mutable `Set` as a `useMemo` dependency will not trigger recalculations if the `Set` instance doesn't change, or will over-trigger if a new `Set` is passed every time.
- **Untyped Mock Methods:** `PlanetRenderer.ts` (the legacy entry point that was converted to host R3F) contains numerous `(...args: any[]) {}` mocks (e.g., `setOperatorCar`, `firstPersonPNG`). These bypass TypeScript entirely and should be given proper signatures even if they are currently no-ops.
- **Bypassing Type Safety:** In `R3FFoliage.tsx`, `(mat as any).userData.shader = shader;` is used. This should be properly typed via interface augmentation or at least commented as `@ts-expect-error` to avoid silent type breakages.
- **`createRoot` Disposal:** `PlanetRenderer` calls `createRoot(container)` but doesn't clean up the DOM container fully (only `this.root.unmount()`). While not strictly a warning, lingering DOM nodes or event listeners on the container could cause issues.

## 4. Logic Comparison (Legacy vs R3F)

- **Terrain Leveling (`useTerrainLeveling.ts`):** The logic successfully mirrors the legacy `relevelTerrain` and `gradeRoadsInto` functions. It accurately reproduces the `s * s * (3 - 2 * s)` smoothstep skirt grading for neighborhood pads and commercial districts.
- **Terrain Chunks (`R3FTerrain.tsx`):** Porting to use `buildChunkedTerrain` with vertex colors correctly mimics the legacy approach. The elevation/moisture jitter logic is preserved and functional.
