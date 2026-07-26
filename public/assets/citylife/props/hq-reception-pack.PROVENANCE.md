# hq-reception-pack.glb — provenance and license

- **Asset:** `public/assets/citylife/props/hq-reception-pack.glb`
- **Authored by:** Fable (visible Claude Code session `claude-fable-review-kooker1`),
  2026-07-19, for the spec-152 Kooker HQ reception room.
- **Generator (single source of truth):** `scripts/generate_hq_reception_pack.mjs` —
  a deterministic Node script using the in-repo `three` + `GLTFExporter`
  pipeline (same pattern as `scripts/generate_ironwork_pillar.mjs`). Re-running
  the generator reproduces the committed binary byte-for-byte; the structural
  contract lives in `tests/hqReceptionPackGlb.test.ts`.
- **Contents:** three named parts — `HqReception_Desk` (2.40 × 0.96 × 0.80 m,
  pivot floor-center), `HqReception_ManifestoWall` (3.60 × 2.36 × 0.14 m, pivot
  floor-center-back), `HqReception_ArchiveShelf` (1.80 × 2.20 × 0.45 m, pivot
  floor-center-back). Meters, Y up, forward +Z. Placement metadata:
  `hq-reception-pack.placement.json` (reception-room-local coordinates).
- **Originality:** 100% procedural geometry authored in the generator. No
  third-party models, textures, scans, fonts or other external assets; no
  textures at all (material colors only). Palette colors reuse the existing
  in-repo ironwork-pillar family for visual consistency.
- **License:** same terms as this repository (Kooker/CityLife project asset;
  no external license obligations attach because no external content was
  used). Safe for the public CityLife runtime (`publicSafe: true`) — contains
  no personal data, credentials or private text.
- **Runtime integration:** deliberately not wired here; the integration slice
  (Opus) owns `venuePropAssets`/scene wiring and in-world QA.
