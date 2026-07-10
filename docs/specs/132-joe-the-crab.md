# Spec 132 — Joe the Crab in v3, with the blue headset

The avatar port (spec 120) drew every citizen as a human capsule — Joe the Crab, the
founder, lost his body. Ported from the legacy makeCrabGeometry with the operator's Sol-34
review corrections:

- **Blue headset** ("blue headsets!"): blue-white band (0xbcd2f5) + blue earcups
  (0x2f6fd0) hugging the flattened shell.
- **Lightning accents ON the earcup outer faces** — the sides of the headset, one per cup
  — "not on his mouth and above him".
- **The hover bolt stays** — the operator liked the floating flash: a separate connected
  zigzag geometry the avatar layer bobs and slowly spins above Joe, tip down, emissive
  ("pointing to him"). `CRAB_BOLT_HOVER_Y` + sine bob in R3FAvatars' frame loop.

`R3FAvatars` now routes crab-kind avatars to the crab group (one Joe; the capsules skip
him) and positions it with the same avatarTransform as everyone else. Spec-119 disposal.

Tests: `tests/crabGeometry.test.ts` — blue cups + blue-leaning band by construction, bolt
vertices outboard of the shell at headset height (never near the mouth, never floating),
one per side, and the hover bolt a connected ~0.35-tall zigzag. GPU screenshot verified
in-world.
