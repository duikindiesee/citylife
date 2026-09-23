# 172 — Owned vehicle arrival and world driving

Status: implementation in progress, not deployed acceptance.
Implementation task: ff391e7c-dc7b-487f-aec1-c5c37c28c2bb, child of arrival task
dd18507c-8ce4-4405-b7f2-10fb78b9f313; parent journey: 21a0b3b0-dbeb-4c40-8b97-34cc2dbea582.

## Player contract

An authenticated owner's vehicle comes from the current user's server ownership read.
Loading or reloading seats the player in that exact vehicle after the world and spawn
surface are ready. A local Border Patrol citizen or cached garage does not grant ownership.
No car means the existing Gearbox acquisition path. Unknown authority stays fail-closed.

The vehicle moves through the actual world, and the seated camera follows that pose.
W/up accelerates, S/down reverses, A/D or left/right steers, and Space brakes. Touch
controls expose the same inputs. Releasing touch, losing focus, opening a journey overlay
or changing account clears input. Park and exit stops the car and selects a walkable
adjacent cell; entry requires proximity. This is separate from the race and the legacy
drive-home cursor.

## Implementation boundary

The runtime owns user-bound pose and input. `car/ownedDriving.ts` integrates metres per
second in bounded substeps and tests the footprint against permitted world surfaces.
Tunables live in `COLONY.ownedDriving`. The renderer reads the pose each frame; cached
GLB meshes remain loader-owned. The first-person controller pins its camera/capsule to
the car while seated instead of also applying walking movement.

Until authoritative home parcels and driveway construction are connected, the surveyed
Gearbox road entrance is the available spawn anchor. A local citizen home is not used
as proof of an owned home. Current driving permits road surfaces and blocks water/building
cells; dynamic traffic collisions and home driveway
surfaces remain integration work. Car acquisition and funding are existing authoritative
economy operations; this movement slice grants no money, parts, vehicle or property.

## Required evidence

- Browser: authenticated server-owned X19, visible actual model, seated camera, movement
  from keyboard and touch, brake, exit/re-entry, reload and account isolation.
- Unit: swept road-gap denial, footprint width, bounded frame delta, acceleration/steering/
  reverse and braking without unwanted reverse motion.
- Final journey: deployed ownership/debits, actual plot purchase and build completion,
  home driveway spawn and logout/reload. Fixture browser tests do not close that gate.

## Local evidence, 2026-09-23

Chromium's returning-owner regression passed with keyboard movement, real touch
acceleration, braking, camera-position checks, touch-reachable exit/re-entry, reload
and a switch to an account without a car. The browser found and drove two corrections:
ownership can arrive before world layout, and independently positioned car controls
were obscured on mobile. Seating now waits for both prerequisites, and controls are
members of the shared corner rail. Four movement unit tests and 34 focused tests pass.
The full suite passed 2,360 tests in 266 files; TypeScript and the production build passed.
Independent exact-head review and deployed validation remain required before completion.

Independent review found that a retained controls ref could restore old throttle after a batched
seated owner-to-owner switch. Input authority now has a runtime generation changed synchronously
on identity, vehicle authority and seat changes. Controls check it on every input event as well
as effect cleanup, so an event arriving before React renders cannot reuse old input. Keyboard
auto-repeat never reactivates an input cleared by a switch; a new press is required. The browser
regression keeps the controls mounted, holds W, switches owners in place and steers in the same
JavaScript turn. This is a targeted fixture regression, not a deployed authentication-flow claim.

The player-parcel branch measures the current GLBs (4.08 by 1.825 m) and expands the shared
collision envelope to 4.10 by 1.84 m. Movement checks every intersected grid cell of the
rotated rectangle as well as edge samples, and shares this check with the driveway survey
in spec 173. An asset contract test prevents a new/larger model silently exceeding it.
The browser switch regression also asserts throttle was active before switching and that
runtime input was empty immediately afterward, before testing the retained-controls case.
