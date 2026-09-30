# 173 — Glass Showroom, Car Paint Customization, Mobile Racing Controls, and Desert Night Lighting

Status: implemented and verified in cluster.
Branch: `antigravity/1907c3ce-a1d0-4134-8c15-7c436d33550d-raceable-roads`

## Player contract

1. **Architectural Glass Showroom (Gearbox Auto Hub)**:
   - When driving or walking past the auto dealership in the commercial district, players see an architectural glass pavilion with crystal-clear transparent glass walls (`opacity: 0.16`, `metalness: 0.75`), steel structural mullions, a polished interior stone floor, back feature wall, ceiling canopy, and 4 recessed LED downlights.
   - The centerpiece is an illuminated rotating turntable plinth with a glowing golden neon ring displaying real 3D hero vehicles (`Karoo Kaap GT-V8` and `Karoo X19 Targa`), replacing placeholder block models.

2. **Car Paint Selection & Persistence**:
   - In the showroom overlay and vehicle inspection, players can customize car paint across 8 authentic South African and racing finishes: Alpine White, Speed Yellow, Midnight Blue, Kalahari Sand, Track Red, British Racing Green, Karoo Bronze, and Stealth Black.
   - The chosen paint dynamically colorizes body panels, cabin/roof elements, and accents on both the turntable plinth and the driving vehicle model.
   - Selected paint is persisted in `localStorage` under `citylife:car-spec:<citizenId>` and sent to `runtime.acquireCar`, ensuring the purchased vehicle remembers its paint job across reloads and sessions.

3. **Mobile-First Dual-Thumb Driving Controls**:
   - Mobile and touch devices use a best-practice split ergonomic layout:
     - **Bottom-Left Thumb**: Large steering paddles for Left (◀) and Right (▶) with glowing cyan borders and tactile press animations.
     - **Bottom-Right Thumb**: Drive pedals with prominent Throttle (▲ GAS), Brake (■ BRAKE), and Reverse (▼ REV).
     - **Center HUD**: Speedometer badge indicating road state (`🏎️ HIGHWAY` / `🏜️ OFF-ROAD` with speed in km/h) and a clean "Park & Exit" button.
   - Multi-touch pointer capture prevents missed taps, while desktop keyboard controls (WASD, Arrows, Space) remain fully active.

4. **Authentic Desert Ecology (Kokerboom Only)**:
   - All generic cone foliage (`R3FFoliage`) is removed, keeping exclusively authentic protected *Aloe dichotoma* (quiver trees / kokerbome) across dunes and rocky ground (`RARITY = 320`).

5. **Realistic Ground Textures**:
   - Terrain chunk geometries feature continuous `uv` buffer coordinates across chunk boundaries.
   - Procedural desert textures provide fine sand micro-grit, wind ripple striations, and pebble detail, with a tactile bump map (`bumpScale: 0.08`) that enriches terrain shading under sunlight and headlights.

6. **Vehicle Night Lighting & Road Clearance**:
   - The player's vehicle features dual high-intensity forward spotlights (headlights) projecting 48m beams onto the road, forward tarmac wash, ruby red rear taillights, glowing lenses, and soft ambient vehicle body fill.
   - Road surface checks (`isRoadSurface` / `isPointOnRoadSurface`) ensure cars cruise at full highway speed across road ribbons, carriageways, verges, and junctions without invisible collision barriers or parcel setbacks.

## Verification

- `npm run typecheck`: clean (0 errors).
- `npx vitest run`: 74/74 passing across 9 test suites covering owned driving, showroom interior, garage landmark, kokerboom ecology, and road clearance.
- Production build: `vite build` completed in ~0.9s.
- Public safety: `npm run validate` and `npm run public-safety` passed.
