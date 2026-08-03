# Spec 170 — The player-state HUD (UI.STATE.1)

- **Status:** proposed for review. **Docs only** — no runtime, scene or UI change ships with this spec; slice 1 is defined in §8.
- **Depends on:** UI.HUD.OVERLAP.1 (PR 421, bottom-right rail), UI.GEO.OVERLAP.1 (PR 432, bottom-left rail), spec 150 PR2 (canonical sol time), spec 167 (build stamp placement), the entitlement pattern in `src/colony/entitlement/*.ts`.
- **Design provenance:** operator, verbatim — _"our screens are full of HUD shit"_ and _"I dont know why we still have pause button and speed buttons, since our world never stops"_ — with the confirmed decision that CityLife time never stops: it is an auditable real measurement. Developed by a Fable concept panel against the live source.
- **Prior research (established input):** Roblox ships almost no persistent chrome — a thin collapsible topbar plus a health bar shown **only when damaged**; everything else is summoned. Their published UX guidance is context-driven ("swap HUD elements by player state"). Mobile guidance reserves the bottom-left (thumbstick) and bottom-right (jump) corners and uses safe-area insets. ProximityPrompt appears only within ~10 studs with line-of-sight and shows the key inline — **the prompt is the tutorial**.

## 1. Citizen voice

_You step off the bus into the evening street and the city is just… there. No dashboard, no dials, no bank ledger floating over the sunset. When you walk up to the Gamehouse door a single line breathes in over the handle — **E · Step inside** — and that is the whole manual. Your sprint meter only exists in the moment you've run it low. Everything else — the map, the radio, your account, the bug button — lives one press away, behind one small row of icons that never grows._

## 2. Design theses (binding)

1. **Persistent chrome must justify itself per state.** The default is off-screen. An element earns residency only by being needed *continuously* in the state the player is in.
2. **The world's clock is not a control.** Sol time is a real measurement (`solNowMs()` is `Date.now()` plus a debug-only offset). Nothing in the player HUD may claim to stop or scale it.
3. **The prompt is the tutorial.** `interactionPrompt` + `activateFirstPersonInteraction()` already exist; contextual prompts replace persistent buttons wherever a location can carry the affordance.
4. **Summoned, not deleted.** Everything removed stays one deliberate action away. Operator surfaces stay reachable — they just stop being player-facing.
5. **Corners have owners.** PRs 421/432 exist because elements self-pinned into corners and buried each other.
6. **Fail-closed gate.** Flag OFF renders today's HUD byte-identically.

## 3. The inventory, measured against `ColonyApp.tsx` (4,463 lines)

### 3.1 Topbar (ColonyApp.tsx:1909-2015)

| # | Element | Shows when | Verdict |
| --- | --- | --- | --- |
| 1 | Brand "CityLife · Colony" | always (hidden <760px) | Escape overlay header |
| 2 | Sol clock `Sol N · HH:MM ☀/☾` | always | **keep** — the one persistent status chip |
| 3 | Pause `❚❚/▶` | always; Space shortcut | **remove** — see §6 |
| 4 | Speed `1× 2× 5×` | always | **remove** — see §6 |
| 5 | Road Rally | always; disabled unless `ui.race.available` | contextual slot |
| 6 | Join Race | `ui.rally?.ready && race idle` | keep, same slot |
| 7 | 🐞 Log Bug | always | **keep as topbar icon** |
| 8 | 📷 snapshot | always | Escape overlay |
| 9a | 🌍 World View | not in builder/world view | Map icon (e2e depends on it) |
| 9b | 🏗️ City Builder | `canEnterCityBuilder(auth)` | Escape overlay, operator section |
| 9c | 🗺️ Survey Map | always | Map icon (e2e depends on it) |
| 9d | camera hint | `worldViewActive` only | keep, already contextual |
| 9e | Exit World View | `worldViewActive` | keep, contextual slot |
| 10 | Ask Kooker | always | Escape overlay |
| 11 | Change password | `hasRealAccount` | Escape overlay, account |
| 12 | Log out | always | Escape overlay, account |

**Up to 14 interactive controls plus brand and clock in one bar.** Under 760px it becomes a horizontally scrolling strip with the scrollbar hidden — controls scrolled off-screen are effectively undiscoverable on mobile.

### 3.2 Persistent panels outside the topbar

| # | Element | Shows when | Verdict |
| --- | --- | --- | --- |
| 13 | Radio strip | always (own open state) | summoned from Escape |
| 14 | Bus-network mini-map | **always — no condition ever unmounts it, including first person** | persistent only while riding a bus; otherwise summoned |
| 15 | Presence readout (`GeoReadout`) | whenever non-null, incl. first person | diagnostic by design (BUG.GEO.1) — fold into Log Bug capture |
| 16 | Rally "who is here" card | contextual already | keep |
| 17 | Build stamp | `!firstPerson.active` (+FP variant) | keep — spec 167, deliberately tiny |
| 18 | City HUD panel | `!builder && !worldView` | Escape overlay ("City" tab) |
| 19-22 | Drive home / Choose your home / The Gamehouse / Gearbox Auto Hub | entitlement-gated | become world prompts — §5 |
| 23 | Road Rally pill | `race.mode !== "idle"` | keep — correct state-scoped HUD |
| 24 | `RaceMobileControls` | race + touch | keep |
| 25 | `FirstPersonPanel` | `fp.active` | slim per §4 |
| 26 | `GaragePanel` | `ui.garage` non-null — **mount condition unverified** | out of scope |

**The honest count: in the default third-person view a fully entitled signed-in player has ~24 persistent elements on screen at once.** The operator's complaint is measured, not felt.

**Honest about debug surfaces:** the presence readout's seed/sol/rev stamp, grid coordinates and yaw, the 📷 snapshot, and pause/speed are diagnostic or operator tools. The readout was *designed* to burn evidence into screenshots — that mission moves into the Log Bug capture path rather than living on every player's screen.

### 3.3 Corrections found by reading the source

- **`src/colony/render/HqReceptionView.tsx` does not exist on `main`.** *(Editor's note: it is added by PR #493, which was unmerged when this was written. The spec's §5 direction — that HQ should ultimately be entered through portals in first person rather than via an overlay — stands as the longer-term target; #493 follows the existing Gamehouse/showroom overlay precedent as the interim door.)*
- **There is no "Kooker HQ" corner button on main** — the corner actions are exactly rows 19-22. *(Also added by #493.)*
- **"Radio" is not in the topbar** — it is its own fixed top-left strip.
- Bus riding is a first-person sub-state (`fpRidingBusId`), not a separate view.

## 4. The state model

| State | Detected by | Minimal persistent set |
| --- | --- | --- |
| **S1 Aerial World View** | `worldViewActive` | camera hint (first visit), Exit World View, Survey Map entry, clock |
| **S2 City Builder** (operator) | `builderActive` + role | builder chrome — out of scope |
| **S3 Third person** | default | clock chip + ≤5 topbar icons + rally card when at the rally point |
| **S4 First person on foot** | `fp.active && fp.citizenId` | **contextual prompt + at most one status chip.** Sprint meter appears **only when `fp.sprintCharge ≤ 20`** — the Roblox damaged-health-bar pattern. Joystick on touch only. |
| **S4b Riding a bus** | `fpRidingBusId !== null` | next-stop chip + alight prompt + **the mini-map** — the one state where it earns persistence |
| **S5 Driving / Rally** | `ui.race.mode !== "idle"` | the race pill + `RaceMobileControls`; nothing else |
| **S6 Interior overlays** | `showroomOpen` / `gamehouseOpen` / `homeOpen` / `driveHomeOpen`, each ANDed with its live entitlement | the overlay's chrome + close affordance; suppress city HUD underneath |

## 5. What becomes summoned

**Topbar target — 4 icons + 1 status chip + 1 contextual slot:**

| Slot | Contents |
| --- | --- |
| Clock chip | `Sol N · HH:MM ☀/☾` — status, not a button |
| 🗺 Map | Survey Map, World View enter/exit, bus network map |
| 🐞 Report | Log Bug |
| ☰ Menu | opens the Escape overlay |
| *contextual* | exactly one: Join Race / Road Rally / Exit World View — empty otherwise |

**Escape overlay:** City (the HUD-details stack + courier headline) · Account (Ask Kooker, Change password, Log out) · Extras (Radio, snapshot, Roadmap, Help) · Operator (role-gated: City Builder, Border Control, layout revisions). Escape's existing priority order — race → pointer lock → first person — is preserved.

**Corner actions become world prompts.** The four bottom-right buttons are doors pretending to be chrome. Each has a real site, so each becomes a proximity prompt at its door in S4 and a map pin in the Map overlay — same entitlement gates, same guarded `open*` handlers. Until a player is near, **nothing shows**.

## 6. Pause and speed — recommendation: remove from the player HUD

**What they actually do, measured:** `setPaused`/`setSpeed` gate only the legacy colony-sim accumulator — citizens and economy stepping. They do **not** touch world time: the clock, the sky and the bus fleet all read `canonicalSolClock(solNowMs())`, and `solNowMs()` is `Date.now() + debugOffsetMs`. **Pressing pause does not stop the clock the button sits next to.** Buses keep driving, the sun keeps moving, only citizens freeze. `2×/5×` desynchronise the citizen sim from auditable sol time by design.

**What depends on them, checked before recommending:**

- **Unit tests** `transitSolDriver.test.ts:49-56` explicitly lock *"ignores sim speed"*. These tests **defend the removal** — they call the runtime API, not the buttons.
- **e2e:** no spec clicks the pause/speed buttons. `busDepot.spec.ts` drives time via `debugSetSolTimeOfDay` *"instead of setSpeed"*, per its own header.
- **Debug tooling:** the local screenshot fixture calls `runtime.setSpeed(0)` under a dev-only query. **So `ColonyRuntime.setPaused`/`setSpeed` must stay** — they become explicitly debug/operator API.

**Recommendation:** delete the pause button, the `1×/2×/5×` buttons and the Space shortcut from the player HUD. Keep the runtime methods, documented as debug-only. **Not done here** (own spec): driving the citizen sim from sol time so `speed` can be deleted from the runtime too — a determinism change with test consequences.

## 7. Mobile

- **Reserved corners:** bottom-left is the joystick's (UI.GEO.OVERLAP.1 measured 34,532 px² of joystick-vs-readout collision at 1280×800; 39,324 px² + 6,630 px² at 390×844). Bottom-right is the action cluster. **In S4/S4b/S5 nothing new may enter either bottom corner.**
- **Safe-area insets:** continue the existing `env(safe-area-inset-*)` pattern; the new topbar adds `env(safe-area-inset-top)`.
- **Topbar:** ≤5 icons fit 390px without the current hidden-scrollbar overflow strip. The Escape overlay is a full-screen sheet with a thumb-reachable close.
- **Differs from desktop:** joystick and `RaceMobileControls` are touch-only; keyboard hints desktop-only; prompts render as ≥44px tap targets.

## 8. Migration — slice 1

**Gate:** `hud-player-state-v1`, a new `src/colony/entitlement/hudPlayerState.ts` cloned from `kookerHq.ts` (fail-closed on OFF/killed/401/403/timeout/malformed/network, default OFF, re-evaluated on identity change).

**In slice 1 — topbar only, a bounded edit at ColonyApp.tsx:1909-2015 plus one small component:**

1. Remove the pause/speed group and the Space shortcut.
2. Collapse Ask Kooker / Change password / Log out / snapshot into a ☰ menu.
3. Hide Road Rally unless `ui.race.available` — the disabled state becomes absence.

**Deliberately untouched in slice 1**, each a recently measured, test-locked region: `BuilderPanel` stays inline exactly as-is (`cityBuilderRoleGate.spec.ts`, `busDepotFoliage.spec.ts:167`, `junctionCapOvershoot.spec.ts`, `showroom.spec.ts` locate "World View"/"Survey Map" by role/title and must stay green); both corner rails; `FirstPersonPanel`; the mini-map; `GeoReadout`.

**Slice order after that:** 2 — Escape overlay absorbs the City HUD panel; 3 — corner actions become door prompts + Map pins; 4 — mini-map becomes state-driven; 5 — FP slimming.

## 9. Acceptance

1. Flag OFF: today's HUD byte-identical; full unit + e2e suites green.
2. Flag ON, S3: ≤5 topbar slots + clock; zero corner buttons for a player with no nearby door.
3. Flag ON, S4 away from any door: exactly one chip, zero prompts; near a door: one prompt.
4. `transitSolDriver` "ignores sim speed" and the sol-clock suites stay green.
5. Screenshots at 1280×800 and 390×844 per state, before/after, **counting visible persistent elements — the count is the deliverable the complaint is measured against.**

## 10. Deliberately not done here

- No split or refactor of `ColonyApp.tsx` — slices edit bounded regions only.
- No removal of `ColonyRuntime.setPaused`/`setSpeed` (debug API).
- No sol-time-driven citizen sim (own spec; determinism risk).
- No 3D in-world prompt rendering — slice 3 reuses the existing 2D affordance.
- No change to City Builder, Border Control, the two corner rails' layout contracts, or `GaragePanel`.
