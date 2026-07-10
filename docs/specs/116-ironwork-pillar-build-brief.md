# Ironwork Pillar (spec 116) — build brief: design, geometry, placement, ship path

# The Ironwork Pillar — "The Escapement"

*A monument for Landing One, honouring the two builders — Irwin of CityLife/Kooker and Riaan the Wizard of IronworkAI/NightGuard — and the craft they share: worlds built by fleets of unseen intelligences, held honest by a human hand on a gate.*

---

## The story

At midnight, Landing One is trued.

Nobody sees it happen. A floor that had settled crooked is flush by morning. A road remembers its line. A gauge that drifted all week reads clean again. The colony wakes into a world that is slightly more correct than the one it went to sleep in, and nobody says thank you, because almost nobody knows.

Hennerik Vos knows. He keeps the small clocks at the Watch Nook, and he reads the night gauges, and he has stood on the dark gantries at 00:00 and *heard* it — a vast, patient grinding somewhere under the deck, like the whole island clearing its throat. His proposal to the council is simple: stop pretending it isn't there. Build the pillar over the works. Grate the pit so the light shows and the machine doesn't. And put a wheel in the iron with two hands on it, so every child in the colony can watch the world get built the only way a world should be built: **one reviewed tooth at a time.**

This is Dark City's midnight — vast machinery beneath the streets, a city retuned by hidden hands — with the horror surgically removed and replaced by the Faith planet's serenity from Stargate Universe: the intelligence under the grate is immense, older than the colony, and *benevolent*. You never see the machine. You see its warm light through the bars, and the slow shadows of gear teeth passing beneath, and you feel what the colonists feel: not dread. Awe, and the strange comfort of being *minded*.

## The form — bottom to top

The Pillar stands on its own 3x3-cell plot, flattened to the slope (pitch only, roll locked to zero, per the Constitution). Every mass is axis-aligned; the only curved forms are cylinders and annuli, exactly the primitive vocabulary Joe the Crab and the lighthouse already use. It is a tower you see **through** — a gantry, not an obelisk.

**1. The Undercroft.** A square opening rimmed by a heavy riveted iron curb, spanned by a 90-degree grate of parallel box bars. Under the grate: a breathing amber glow (`0xffc568`, kin to the lighthouse lantern's `0xffc467` — the same warm light family the colony already trusts at night) and slow-sliding shadow bars — gear teeth passing beneath. The machine is never shown. Only its light. Rust drip-lines (`0x7a4a2e`) stain the curb where a century of condensation has run — and around the curb, **three or four half-buried iron fragments**: a quarter of an older brass wheel sunk flat in the ground, a rivet-studded plate, a sheared column stub, a lost hook. The works are older than Landing One. The colony did not build the machine; it built the *window*.

**2. The Frame.** Three stepped open box-frame tiers — 3x3 cells, then 2x2, then a square mast — each tier four corner columns studded with rivet nubs, tied by horizontal ring beams. Cold blue-grey structural iron (`0x3d4450`) with shadow-dark faces (`0x262b34`). At tier two, two gantry arms cantilever out at exactly 90 degrees to each other, north and east, each trailing a chain and a brass hook **frozen mid-lift** — the tower is still building the town around it, and always will be. Recessed channels run up the inner face of each corner column; at night, thin warm seams of light (`0xffe9b0`) live inside them — light kept *inside* the iron, one seam lit per completed build stage. The accumulated work of many agents, always channelled.

**3. The Escapement.** Between tiers two and three sits the one glinting non-iron mass: a fat horizontal brass ring (`0xb98c3a`) with twelve dark slot windows. Above it, two axis-aligned pallet fingers reach down from a cross-bar, north and south, seating **alternately** into the slots — an anchor escapement, the real horological mechanism that keeps a clock's stored power from running away by releasing the wheel one tooth at a time. This is the entire philosophy cast in brass. *Nothing ships unreviewed.* Two pallets, entry and exit, alternately holding the same wheel: two builders, two fleets, one craft.

The pallets carry **maker marks**, asymmetric and canon-anchored:

- **North — the Kooker hand.** Warm working iron `0x3a3f47` (the rally signpost's own iron), a copper cap, and Joe the Crab's yellow bolt `0xf4c020` stamped as the maker's signature. Amber-lit tip (`0xffb020`). The hearth. Irwin.
- **South — the NightGuard hand.** Blued gun-metal `0x2f3a4d`, silver rivets `0xb0b6bf` (the dropship's own fin silver), a barred-keyhole glyph, a cool seam `0xdfe7f2` (the exact cool white of Joe's headset band — NightGuard's light already lives in the world's palette). Moon-silver tip (`0xcfd8e6`, emissive `0x9fc4ff`). The night watch. Riaan the Wizard, who minds his own town beyond the dark the same way — gated, and held.

The two hands **mesh like interleaved fingers on the one wheel** — while one holds, the other releases, and the wheel cannot turn unless both take their turn. That meshing is the handshake. A passer-by can be told the whole story in one sentence: *two makers, two marks, one wheel.*

**4. The Crown.** No spike. No sky-beam. A square iron lantern cage with a calm warm-white core — and the cage is **held, not seated**: four iron fingers overhang its rim and grip it, with a visible gap of clear air between the cage and the capital plate below. The review gate as a hand that has not signed off, and never fully will. Above, four L-shaped corner shutters form a sky iris that slides open — pure axis-aligned translation — only during the midnight Retune.

## The Midnight Retune

Every sim-midnight, the hands trust what they reviewed, and the works free-run for one hour. The escapement ring spins smoothly instead of ticking. The undercroft glow rises and the shadow bars double their pace. The crown iris slides open to the sky. One pulse of brightness climbs the corner seams, bottom to top. At 01:00 the iris closes, the glow settles, and the ring lands — exactly, deterministically — on its pure resting tooth for the new hour, and goes back to ticking.

Dark City's re-tuning, turned from horror into civic ritual: the colony can set its life by it. And underneath the poetry, the engineering is honest: the resting tooth index is a **pure function of the sim day and hour** (the hashCell idiom), the sim sees only a snap at 00:00 and a snap at 01:00, and the whole smooth hour in between is presentation-only easing on the wall clock. Freeze every animation and the monument still reads completely — a ticking clock is a bonus; a *held* clock is the point.

## By day, by night

**Day:** cold iron against the sky, rust at the beam ends, one brass glint at the wheel. The frozen hooks and the see-through frame give it a worker's unfinished-world character — scaffolding for a town that is still becoming. The buried fragments read as archaeology.

**Night:** the undercroft becomes a warm hearth sunk in the ground, shadow teeth crossing its light. The corner seams glow. The two pallet tips read amber and moon-silver against the dark — the only two coloured lights on the tower, one of ours, one of the Wizard's. No saturated sci-fi cyan or magenta anywhere; the palette holds the SimCity-BuildIt warmth the world is built on.

## What it is not

Not a lone gradient obelisk. Not a sky beam. No floating rings, no hologram. Its identity is **negative space and implication** — a tower you see through, a machine you never see at all, and one honest moving part whose real-world function *is* the philosophy being honoured. Nothing else in the world ticks.

## Its place in the world

The Horizon Spire (033) taught Landing One to want something bigger than survival. The Ironwork Pillar teaches it something quieter and stranger: that its world is *minded*. It is also the first grand monument to fully honour the Visual Artifact Standard — it renders from its first stage, stage by stage, and its silhouette growing over the works is the colony watching its own philosophy get built. For Irwin and Riaan it is the tribute in permanent form: iron meeting light, two fleets under two gates, and a wheel that turns only when both hands agree.

*"This place isn't magic. It's minded. Nothing moves unheld."* — Hennerik Vos

---

# v3 geometry sketch — `ironworkPillarProps.ts` + PlanetRenderer wiring

**Architecture (the concept-2 graft):** a dedicated module, NOT a new branch in the 238KB structure factory.

```
src/colony/render/ironworkPillarProps.ts     — new, self-contained
src/colony/render/PlanetRenderer.ts          — 4 small touches (skip / build / update / dispose)
src/colony/sim.ts                            — StructureKind + "ironworkPillar", findIronworkPillarSite
```

## Layer contract (shoreProps/venueProps idiom, + the sim clock)

```ts
export interface IronworkPillarLayer {
  group: THREE.Group;                                        // name: "Ironwork Pillar"
  update(daylight: number, timeMs: number,
         clock: { day: number; hour: number; minute: number }): void;
  dispose(): void;
}

export function buildIronworkPillarProps(opts: {
  terrain: Terrain;
  structures: readonly SeedStructure[];   // finds s.kind === "ironworkPillar"
  stage: number;                          // 0..3 — 0 returns null (zero geometry)
  wx: (x: number) => number;
  wz: (y: number) => number;
}): IronworkPillarLayer | null;
```

## Pure functions (exported for Vitest — the concept-2 determinism graft)

```ts
// hashCell — the exact Math.imul mix from shoreProps.ts:335 (copied locally or exported from there)
export const PILLAR_TEETH = 12;                                   // 30 degrees per tooth
export function restingToothIndex(day: number, hour: number): number {
  const phase = Math.floor(hashCell(day, 0, 0x116) * PILLAR_TEETH); // each day gets its own phase
  return (hour * 7 + phase) % PILLAR_TEETH;   // stride 7 coprime with 12 -> cycles all 12 states
}
export function undercroftBarPhase(day: number, hour: number): number {
  return hashCell(day, hour, 0x9a1);          // 0..1 — where the shadow bars REST this hour
}
export function isRetuneHour(hour: number): boolean { return hour === 0; }
```
The sim-visible state is only ever these pure values. Everything smooth is `timeMs` easing that must LAND on the pure value at each hour boundary. No `Math.random`, no `Date.now`.

## Palette (vertex colours + kept-ref emissives — every hex canon-anchored)

```
IRON       0x3d4450   structural iron          RUST      0x7a4a2e   beam ends, curb drips
IRON_DK    0x262b34   rivets, grate, shadows   BRASS     0xb98c3a   ring, hooks, pallet tips
KOOKER_IRON 0x3a3f47  north pallet+column (= rally signpost pole, PlanetRenderer.ts:1424)
COPPER     0xb0653a   north pallet cap         BOLT      0xf4c020   Joe's bolt (crab, :5504)
NG_BLUED   0x2f3a4d   south pallet+column      NG_SILVER 0xb0b6bf   south rivets (= rocket fin, :1393)
NG_SEAM    0xdfe7f2   south cool seam (= Joe's headset band, :5502)
GLOW_WARM  0xffc568   undercroft + crown core (kin to lighthouse lantern 0xffc467)
SEAM       0xffe9b0   corner light channels
PALLET_AMBER emissive 0xffb020   PALLET_SILVER 0xcfd8e6, emissive 0x9fc4ff
NO saturated sci-fi cyan/magenta anywhere.
```

## Static iron — ONE merged vertex-coloured BufferGeometry

Built with the exact `add(g, hex, pos, rot?, scale?)` helper pattern of `makeCrabGeometry` (PlanetRenderer.ts:5473-5497): per-part `Float32BufferAttribute` colours, `mergeGeometries(parts, false)`, one `MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.7, metalness: 0.25 })`, `castShadow = true`. Local origin = plot centre at ground; footprint 3x3 cells; ALL boxes axis-aligned (rot only for cylinder axis flips of PI/2 — never a diagonal member, nothing rolls). Terrain untouched — the pit is an illusion (dark interior + glow + sliding shadows), seated at `baseY = max(0.05, terrain.worldY(s.x, s.y))` like every structure (PlanetRenderer.ts:1287). Geometry emitted per stage:

**Stage 1 — Undercroft Collar** (`mesh.name = "pillar-iron-s1"`):
- Curb: 4 boxes `[3.0, 0.3, 0.35]` forming a square ring (outer edge x/z ±1.5), IRON; rivet nubs `0.06^3` IRON_DK every 0.5 along the top; RUST drip boxes `[0.1, 0.18, 0.04]` on outer faces.
- Grate: 7 bars `[0.12, 0.08, 2.6]` at y 0.34, spanning N-S, 0.36 apart, IRON_DK.
- Pit shaft illusion: interior floor box `[2.5, 0.05, 2.5]` at y 0.06, IRON_DK (near-black reads as depth).
- Buried fragments (deterministic, from `hashCell(day-independent site salts)` offsets around the curb, skipping the approach cell): a quarter `TorusGeometry(0.7, 0.12, 6, 8, PI/2)` lying FLAT (rotX -PI/2, axis-aligned), half-sunk at y -0.04, weathered BRASS→RUST; a rivet plate `[0.8, 0.1, 0.5]` sunk to y 0.02; a column stub `CylinderGeometry(0.14, 0.14, 0.3)` at y 0.05; a lost brass hook (two small boxes). The works are older than Landing One.

**Stage 2 — Iron Frame** (`"pillar-iron-s2"`, replaces s1 mesh, includes all of s1):
- Tier 1: 4 corner columns `[0.28, 2.6, 0.28]` at (±1.3, ±1.3), y 0.3→2.9; ring beams `[2.9, 0.2, 0.2]` at top; rivet nubs.
- Tier 2: 4 columns `[0.24, 2.4, 0.24]` at (±0.9, ±0.9), y 2.9→5.3; ring beams; recessed seam channels (0.06-deep IRON_DK grooves) up each column's inner corner.
- Gantry arms N and E at y 4.9: beam `[0.22, 0.26, 2.2]` cantilevered past the frame, RUST at the free end; chain = 4 stacked `CylinderGeometry(0.03, 0.03, 0.18)` links descending; hook = two BRASS boxes in an L. Frozen mid-lift, forever.
- Escapement cross-bar `[2.0, 0.18, 0.18]` spanning N-S at y 6.1 (carries the pallets).
- Tier 3 mast: 4 columns `[0.18, 2.4, 0.18]` at (±0.55, ±0.55), y 5.9→8.3; ring beams.
- MAKER MARKS on the two pallet-side tier-2 columns: north face plate `[0.2, 0.5, 0.05]` KOOKER_IRON + COPPER cap + a tiny BOLT zigzag (two offset boxes, Joe's signature); south plate NG_BLUED + 4 NG_SILVER rivet nubs + a barred-keyhole glyph (NG_SILVER ring `TorusGeometry(0.07, 0.02)` flat on the plate + a bar box below).

**Stage 3 — Lantern Crown** (`"pillar-iron-s3"`, includes s1+s2):
- Capital plate `[1.4, 0.12, 1.4]` at y 8.3.
- HELD, NOT SEATED (the concept-2 graft): 4 iron fingers — vertical bars `[0.1, 0.9, 0.1]` at the plate corners with inward L-tips `[0.1, 0.1, 0.3]` overhanging the cage rim. The lantern cage (12 edge boxes `0.08` thick forming a 0.9 cube frame, IRON) floats with a visible 0.08 air gap above the plate, gripped by the fingers. The review gate as a hand that won't sign off.

## Dynamic parts — kept-ref meshes (the `beaconMat` pattern, PlanetRenderer.ts:1399/2768)

~13 small meshes, each named:
1. `pillar-escapement-ring` — `CylinderGeometry(1.05, 1.05, 0.38, 24)` BRASS at y 5.6, with 12 IRON_DK slot boxes `[0.14, 0.2, 0.1]` merged onto the rim at 30-degree spacing (they rotate WITH the ring). Rotation about Y only — yaw never breaks the orthogonal silhouette (Constitution-safe, same axis freedom as the lighthouse beam pivot, shoreProps.ts:52).
2. `pillar-pallet-north` — box finger `[0.16, 0.5, 0.6]` under the cross-bar at z -0.8: KOOKER_IRON body, COPPER cap, BRASS tip, emissive PALLET_AMBER 0xffb020.
3. `pillar-pallet-south` — mirror at z +0.8: NG_BLUED body, NG_SILVER rivets, BRASS tip, colour 0xcfd8e6 emissive 0x9fc4ff. The two mesh alternately into the same slots — the literal handshake.
4. `pillar-undercroft-glow` — plane `[2.3, 2.3]` at y 0.12, `MeshStandardMaterial({ emissive: 0xffc568 })`, kept mat ref for breathing.
5. `pillar-undercroft-bars` — a Group of 5 IRON_DK boxes `[0.4, 0.05, 2.4]` at y 0.22 (between glow and grate), translating on X, wrapped modulo 0.9 spacing.
6-9. `pillar-iris-ne/nw/se/sw` — four L-shutters (two merged boxes each) on the cage top, sliding OUTWARD on pure X/Z translation (±0.35) during the Retune.
10-13. `pillar-seam-n/e/s/w` — thin strips `[0.05, tierHeight, 0.02]` in the corner channels, emissive SEAM 0xffe9b0; seams lit = completed stage count.
14. `pillar-crown-core` — box `0.5^3` inside the cage, emissive GLOW_WARM.

## `update(daylight, timeMs, clock)` — presentation only

- **(a) Tick:** target yaw = `restingToothIndex(clock.day, clock.hour) * PI/6`. Between hours the ring shows eased sub-tick snaps every ~6 s on `timeMs` toward the target, always LANDING on the pure index by the hour boundary. Frozen = pure index. A visible TICK.
- **(b) Pallets:** counterphase 0.06 dips synced to the tick phase — entry holds while exit releases.
- **(c) Undercroft:** glow `emissiveIntensity = 0.55 + night * 0.5 + breathe(8s) * 0.25` (day-night rule); bar group rests at `undercroftBarPhase(day, hour)`, slides on `timeMs` within the hour.
- **(d) MIDNIGHT RETUNE — snap-first:** `isRetuneHour(clock.hour)` (read from the same snapshot clock the day/night pass already uses at PlanetRenderer.ts:2726 — replay-safe): ring free-runs smoothly (`timeMs` yaw), glow rises to ~1.6x, bars double speed, iris shutters ease OPEN (their pure target is open during hour 0, closed otherwise — the sim-visible state is binary and pure), one brightness pulse climbs seams bottom-to-top. At hour 1 everything eases back and the ring lands on `restingToothIndex(day, 1)`.
- **(e) Hooks:** barely-perceptible pendulum sway, phase from `hashCell(site.x, site.y, salt)` — seed-phased, never random.
- Seams + pallet tips scale with `night = 1 - daylight` so the tribute reads after dark.

## PlanetRenderer wiring (4 touches)

1. **Skip** (line 1285): `if (s.kind === "lighthouse" || s.kind === "ironworkPillar") continue;`
2. **Build** (beside venueProps, ~1302): `this.ironworkProps = buildIronworkPillarProps({ terrain: t, structures: this.sim.state.structures, stage: this.sim.state.pillarStage ?? 0, wx, wz }); if (this.ironworkProps) this.scene.add(this.ironworkProps.group);`
3. **Update** (frame(), beside line 2773): `this.ironworkProps?.update(this.sim.state.clock.daylight, performance.now(), this.sim.state.clock);` plus a stage watch: if `this.sim.state.pillarStage !== this.ironworkStage`, dispose + rebuild the layer (the spec-084 named-mesh rebuild pattern) — the silhouette grows 1 → 3 live.
4. **Dispose** (renderer teardown, ~5865): `this.ironworkProps?.dispose();`

## sim.ts touches

- `StructureKind` union (line 25) + `"ironworkPillar"`.
- `findIronworkPillarSite(terrain, { used })` after the rally site (line 477): 3x3 buildable on-land cells, modest slope, near the landing block, scored with the deterministic tie-break idiom of `findRallyOverlookSite` (score, then lowest y, then lowest x); pushes the structure + reserves the 3x3 plot and a 1-cell halo so the road-setback invariant (114) holds by construction and no road/parcel ever claims it (115 keeps it off water by the buildable mask).

## Budget

One merged static draw call + ~13 tiny dynamic meshes and 3 kept material refs — cheaper than the crab crowd, trivial on the 4 GB target. Total height ~9.3 units over a 3x3-cell plot: taller than the lighthouse, humbler than a skyline — a campanile, not a skyscraper.

---

## v2 town-engine placement (the live :5188 Landing One world — src/colony)

**Site.** Chosen once, deterministically, at founding: `findIronworkPillarSite(terrain, { used })` runs after the rally overlook in the `ColonySim` constructor (sim.ts:477), so it avoids the caravan block, lighthouse and rally via `used`. Criteria: a 3x3 buildable on-land plot, modest slope (pitch-only flatten, roll locked 0), within reach of the landing block but off the spec-084 avenue, never straddling a road (the judge's explicit exclusion). The plot + one-cell halo are reserved in `state.occupied`, so spec 114's no-floor-touches-road invariant holds by construction and later parcel/road growth routes around it; a spur `path` (roadKind idiom, 084 S3) connects an approach node on the road graph to the plot edge, exactly like the rally spur. At stage 0 the site is just ground — a surveyor's reservation, invisible and free.

**State + economy (build.ts, mirroring the Spire wiring point-for-point).** `pillarStage` (0..3), `pillarProgress`, `pillarBuilding` on `ColonyState` beside `spireStage` (sim.ts:414); zeroed in `initBuild` (build.ts:260); `pillarBuilding` reserves its 5-hand crew in the labour count (beside build.ts:3244); `pillarStep` beside `spireStep` called from the build pass (build.ts:6490) — auto-fund gated on `pillarStartColonists`, surplus margin and treasury margin so a struggling colony never starts it. Payoffs: `pillarUnrestReliefPerDay` (0.06) joins the daily unrest pass beside the Spire's relief (build.ts:4213), and `retuneNightRelief` (0.02) fires once per 00:00 boundary guarded by `lastRetuneDay` — the spec-053 `lastFoundersYear` once-per-boundary idiom. Knobs live in `COLONY.build` beside the Spire block (config.ts:422). No market, wage or immigration coupling anywhere.

**Game API (runtime.ts).** `fundIronworkStage()` beside `fundSpireStage` (runtime.ts:3824), returning whether the stage began, plus the pillar block in `uiState` (`{ stage, progress, building, retuneTonight }`) — stage advance and completion drivable deterministically for tests.

**HUD (ColonyApp.tsx).** One row beside the Spire's (~line 1488): `Ironwork Pillar — Stage 2/3, 40%`, tooltip in the house voice ("A pillar over the works. Two hands, one wheel — the colony sleeps easier under a minded world."); at stage 3 the row gains a small calendar note, `Retune 00:00`, riding the spec-053 calendar readout.

**Renderer stage source.** The v2 engine is the single source of truth: `PlanetRenderer` reads `sim.state.pillarStage` each frame and rebuilds the `ironworkPillarProps` layer on change — the render/sim split stays intact, and the tower visibly grows as the town funds it.

---

## Recommended route to land it

**0. Spec first (this artifact).** Save the spec into `docs/specs/` in the citylife repo — the number is assigned on save (next free slot after 115). No commits from this design lane; hand the three artifacts (spec, geometry sketch, placement notes) to the build lanes.

**1. v2 mechanics lane — PR to MoJoJo (mechanics/dev).** The sim slice ships first because it is inert by default and merges safely ahead of any visuals: `pillarStage/pillarProgress/pillarBuilding` + `lastRetuneDay` state, config knobs, `pillarStep`/`fundPillarStage` beside the Spire functions, the `findIronworkPillarSite` seed placement + occupied reservation, the runtime `uiState.pillar` + `fundIronworkStage` API, the HUD row, and the Vitest suite (pure `restingToothIndex` cycling, stage-consumes-bundle, stage-0 byte-identical economy, payoff persistence). Same shape as spec 059's slice (mechanics/dev, PR #26). Queue it with `/queue mojojo` referencing the saved spec number.

**2. v3 render lane — citylife-bridge (the kooker-agents bridge lane).** The new `src/colony/render/ironworkPillarProps.ts` module + the four PlanetRenderer touches (skip 1285, build ~1302, update ~2773 with the stage-watch rebuild, dispose ~5865). This lane already carries the world-scale and screenshot-verification discipline (recent bridge commits demand real in-engine captures) — hold it to the VISUAL-STANDARD gate: Playwright screenshots on :5188 at stage 3 in daylight AND during a forced sim-midnight Retune (drive the clock via the Game API), or it is not done. It depends on the v2 slice only for `pillarStage`; until that merges, the bridge can develop against a stubbed stage value.

**3. Sequencing + hygiene.** Mechanics PR merges first (all existing tests must pass unchanged — the stage-0 byte-identical guarantee is the review gate's own teeth), renderer PR second, spec status flipped to built with the live-verification note in the 053/059 style. Commit messages in the kooker lanes stay plain prose (the CI shell-injection constraint — no double quotes, square brackets, or colon-then-bullet lines). Fitting, for this monument specifically: nothing ships unreviewed — each lane's gate is a pallet, and the spec is the wheel.