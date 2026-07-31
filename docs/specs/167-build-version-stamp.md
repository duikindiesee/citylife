# Spec 167 — The build version stamp (UI.VERSION.1)

- **Status:** proposed for review.
- **Depends on:** spec 127 (the R3F ribbon roads, only for the corner-rail context), the
  UI.HUD.OVERLAP.1 bottom-right rail (PR 421) and the UI.GEO.OVERLAP.1 bottom-left rail (PR 432).
- **Design provenance:** operator request, marked critical — "I want to see a version, small, in
  the corner of the game and on the login screen."

## The problem, stated precisely

A live bug report ("the bus is driving off-route through grass") is unanswerable until you know
**which build is live**. Three transit fixes merged within hours of each other, so answering that
question took several lookups against git history and the deploy workflow — for every report. Worse,
a **stale deploy is silently indistinguishable from a real regression**: the same symptom means
"already fixed, not rolled out" or "newly broken", and nothing on screen tells you which.

This is not cosmetic. It converts a research task into a glance.

## What is shown, and why

`v<version> · <short sha>` — for example `v0.43.2 · cee985f`.

- **Release version alone is insufficient.** It cannot distinguish two deploys of the same version:
  a re-run, a rebuild from cache, or a rollback all report the same number.
- **Short SHA alone is insufficient.** It is not human-orderable — you cannot tell at a glance
  whether `a1b2c3d` is newer than `e4f5a6b`.
- **Build time** is genuinely useful for diagnosing a stale deploy, but far too wide for a corner
  stamp, so it lives in the `title` tooltip together with the full pair.

When a value is missing the stamp degrades honestly — `build unknown` — rather than rendering
something that could be mistaken for a real build identity.

## Where it comes from: the build, never a constant

`vite.config.ts` resolves the three values at build time and inlines them with `define`. The order
is **env first, git second**, and that order is forced by the deploy path:

`.dockerignore` excludes `.git`, so **inside the Docker build there is no repository to ask**. CI
therefore passes the values in as build args (`APP_VERSION`, `GIT_SHA`, `BUILD_TIME`), exactly as
`APP_VERSION` was already being passed. The git lookup exists only so a developer running the dev
server still sees a truthful SHA instead of a blank.

There is no hand-edited constant anywhere in this design, so there is nothing to forget to update.

**Note on what already existed.** `APP_VERSION` → `VITE_APP_VERSION` was already plumbed through the
Dockerfile before this spec, and was **consumed nowhere in `src/`**. This spec does not add a second
mechanism; it consumes the one that was already there and adds the commit and build time beside it.

## Where it is shown, and why not a fourth corner

UI.HUD.OVERLAP.1 and UI.GEO.OVERLAP.1 both exist because separate elements each pinned themselves
into the same corner with `position: fixed/absolute`, and whichever painted last buried the other. A
version stamp is an obvious candidate to repeat that mistake, so it carries **no positioning of its
own** and instead joins whichever element already owns the region:

| View         | Owner it joins                                                | Why                                                          |
| ------------ | ------------------------------------------------------------- | ------------------------------------------------------------ |
| Third person | `.hud-corner-rail-left`, as the last member                   | Closest to the corner; the rail owns layout                  |
| First person | `.first-person-panel__destination-strip` in the edge-HUD grid | The bottom-left is the **touch joystick's** corner on mobile |
| Login screen | Anchored to the bottom of `.login`                            | Not a corner element at all                                  |

**The login screen needed a correction, found by measurement.** `.login` is a centring flex ROW, so
the first implementation — an in-flow stamp after the card — became a second row item, was pushed to
the right of the card and was **clipped by the viewport at 390px**. It also stole width from the
card. It is now anchored to the bottom of `.login` (itself `position: fixed; inset: 0`) instead of
participating in that row. This is safe here in a way it would not be in the game HUD: the login
screen has exactly one other element, so there is no corner to contend for. The two login tests in
`buildStampCorner.spec.ts` exist because of this defect and fail against that first implementation.

**First person is treated separately on purpose, and it is the mobile-first case.** In first person
the bottom-left belongs to the touch joystick — UI.GEO.OVERLAP.1 measured 34532px² of joystick
versus readout collision there — and `geoCornerLayout` asserts the rail degrades to **exactly one
member** in that view. An unconditional stamp would both break that invariant and drop a second
occupant under the player's thumb on the smallest screen. So in first person the stamp rides in the
destination strip at the **top** of the edge-HUD grid: an already-owned box, no new grid area, and
nowhere near the thumb controls.

## Relationship to the presence stamp — examined, deliberately left alone

`formatPresenceStamp` (`spatial/presenceReadout`) already stamps the geo readout with
`seed N · sol N HH:MM · rev <layoutRevision>`. It is **not** reused, for three measured reasons:

1. **It identifies the world, not the code.** Seed, sol and world-layout revision are independent of
   the build — the identical seed renders differently under two builds, which is precisely the
   confusion this spec exists to remove.
2. **It is conditional.** `GeoReadout` returns `null` when there is no presence data, so a build
   stamp inside it would vanish exactly when someone is trying to report a problem.
3. **It does not exist on the login screen**, which is half of the requirement.

The presence stamp is unchanged by this spec.

## Acceptance

1. The stamp is visible in a game corner and on the login screen.
2. It reflects the actual build: two production builds from different commits produce different
   SHAs, each matching `git rev-parse --short=7 HEAD`.
3. Proven in a **production** build (`npm run build`), not only the dev server.
4. `e2e/buildStampCorner.spec.ts` asserts the stamp is present, non-empty, on-screen and shares no
   pixel with any existing HUD region — at 1280×800 and 390×844, in player and operator view, and
   in first person on mobile.
5. That overlap assertion is **verified to discriminate**: the final test in that file deliberately
   pins the stamp over the geo readout and requires the same detector to report the collision.
6. `geoCornerLayout` and `hudCornerLayout` stay green.
