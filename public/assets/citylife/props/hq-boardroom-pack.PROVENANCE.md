# hq-boardroom-pack.glb — provenance and license

- **Asset:** `public/assets/citylife/props/hq-boardroom-pack.glb` — seven Gate Room parts (table, chair, epic wall, gate puck, merge ticker, holo epic, sideboard), for the
  spec-153 Kooker HQ campus interior (`docs/specs/153-kooker-hq-campus-interior.md`).
- **Authored by:** Fable (visible Claude Code session `claude-fable-review-kooker1`), 2026-07-20.
- **Generator (single source of truth):** `scripts/generate_hq_boardroom_pack.mjs` — deterministic
  Node script on the in-repo three + GLTFExporter pipeline (PR 352 pattern).
  Re-running reproduces the committed binary byte-for-byte; the structural
  contract is `tests/hqBoardroomPackGlb.test.ts`; placement/module metadata is
  `public/assets/citylife/props/hq-boardroom-pack.placement.json`.
- **Conventions:** meters, Y up, forward +Z, minY = 0 on every part,
  translation-only node transforms, no textures (material colors only),
  CityLife ironwork-pillar palette family.
- **Originality:** 100% procedural geometry authored in the generator. No
  third-party models, textures, scans, fonts or other external assets.
- **License:** same terms as this repository (Kooker/CityLife project asset;
  no external license obligations attach). `publicSafe: true` — no personal
  data, credentials or private text.
- **Runtime integration:** deliberately not wired here; the spec-153 §11
  slices own frames, wiring and in-world QA.
