# hq-civic-art-pack.glb — provenance and license

- **Asset:** `public/assets/citylife/props/hq-civic-art-pack.glb` — five civic-art
  & landmark props (fountain, statue, obelisk, banner pole, planter bench) for
  the "Landmarks and Civic Art" lane.
- **Authored by:** Fable (visible Claude Code session `claude-fable-review-kooker1`),
  2026-07-21.
- **Generator (single source of truth):** `scripts/generate_hq_civic_art_pack.mjs`
  — a deterministic Node script on the in-repo `three` + `GLTFExporter` pipeline
  (same pattern as the reception and campus packs). Re-running reproduces the
  committed binary byte-for-byte; the structural contract lives in
  `tests/hqCivicArtPackGlb.test.ts`; example placements in
  `public/assets/citylife/props/hq-civic-art-pack.placement.json`.
- **Conventions:** meters, Y up, forward +Z, `minY = 0` on every part (parts
  stand on the floor), translation-only node transforms, no textures (material
  colours only), CityLife palette family.
- **Originality:** 100% procedural geometry authored in the generator. No
  third-party models, textures, scans, fonts or other external assets.
- **License:** same terms as this repository (Kooker/CityLife project asset; no
  external license obligations attach). `publicSafe: true` — no personal data,
  credentials or private text.
- **Runtime integration:** deliberately not wired here; a later gated slice
  chooses anchors and grounds the props. Visual is verified against
  `docs/specs/VISUAL-STANDARD.md` at the live-render reviewer gate.
