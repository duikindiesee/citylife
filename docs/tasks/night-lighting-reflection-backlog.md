# Night Lighting & Specular Reflection Task Backlog

- **Status:** recorded / backlog
- **Origin:** Operator feedback ("light reflects shitty here at night")
- **Context:** Player reported poor visual fidelity and harsh/unnatural light reflections during the night cycle in CityLife.

---

## 1. Problem Statement & Root Cause Analysis

During nighttime in CityLife (diurnal cycle hour ~20:00 to 05:00), dynamic point lights (showroom pavilion, streetlamps, vehicle headlights) and scene materials interact with post-processing tone mapping and bloom. Several factors contribute to poor nighttime reflection quality:

1. **Specular Hotspots & High Dynamic Range Blooming:** Point lights without quadratic distance attenuation or with excessive intensity create blown-out specular highlights on flat surfaces (roads, vehicle roofs, glass facades).
2. **Roughness and Material Calibration:** Standard Three.js `MeshStandardMaterial` / `MeshPhysicalMaterial` surfaces with low roughness (< 0.2) or unconstrained metalness produce sharp mirror-like reflections that clash with low-resolution cubemaps or missing local environment probes.
3. **Headlight & Ground Reflection Balancing:** Forward vehicle headlights projecting onto dark asphalt textures can create harsh white cones without smooth radial falloff or subtle ambient ground bounce.

---

## 2. Deliverable Tasks & Acceptance Criteria

### Task LIGHT-NIGHT-01: Night Road Surface Reflection Tuning

- **Scope:** Calibrate asphalt and road ribbon roughness, metalness, and bump map depth under nighttime directional and point illumination.
- **Acceptance Criteria:**
  - Night road surfaces maintain diffuse readability without blown-out specular glare patches.
  - Headlight cones project soft-edged radial gradients (`penumbra >= 0.6`).

### Task LIGHT-NIGHT-02: Showroom & Architecture Night Glare Damping

- **Scope:** Audit emission intensity, bloom threshold, and tone mapping parameters (`ACESFilmicToneMapping` exposure balance) in the night lighting configuration.
- **Acceptance Criteria:**
  - Glass curtain walls and ceiling lightboxes exhibit soft luminous diffusion rather than blinding bloom halos.
  - Interior floor reflections (terrazzo slab) maintain realistic Fresnel falloff.

### Task LIGHT-NIGHT-03: Vehicle Clearcoat & Environment Reflection Polish

- **Scope:** Ensure all drivable vehicle models (`karoo_kaap_gt`, `fiat_x19`, `karoo_vonk`, `modern_car`) utilize roughness >= 0.35 and physically balanced clearcoat under night streetlamps.
- **Acceptance Criteria:**
  - Clean ambient readability of vehicle contours from chase camera at night without single-pixel specular glitter.
