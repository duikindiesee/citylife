# Spec 107 — Commercial high-street variety

- status: built
- proposed-by: Irwin / Jack implementation lane
- date: 2026-06-26
- depends-on: Spec 079 commercial plots and shops; Joe signage PR #173 reads the same business identities

## Why

The commercial district must read as a real high street, not one repeated box with different neon paint. Joe's screenshot pass showed the current strip duplicated the same flat shop body and repeated names such as `Trading Post` / `Corner Kiosk`, which broke the commerce vision: each plot should front a distinct Kooker app storefront such as The Nearest, Sprout & Stem, Sportifine, Chef Ott's Market, and the supporting town services.

## Mechanic

Each commercial plot receives two deterministic layers:

1. **Identity assignment** — `assignBusinesses` ranks surveyed plots and assigns authored public-safe business identities from an ordered pool. Immediate neighbours may not repeat names, and the visible strip should only reuse a name at most rarely after the authored pool is exhausted.
2. **Massing assignment** — `commercialShopMassing(parcel, business, index)` derives height, roof form, footprint proportions, canopy depth, sign width, window count, and a per-business signature feature from the assigned business id plus plot kind.

The renderer uses the massing contract to build adjacent storefronts with visibly different silhouettes: flat, gable, mono, barrel, stepped, and terrace roof forms; varied wall heights and frontage/depth; varied canopies and signboards; and business-specific props/emblems such as bar stools, Sportifine rings, Sprout planters, Chef Ott market crates, records, garage bay, notice boards, ledger coin, and builder frames.

## Rules & data

- Deterministic only: no `Math.random`, `Date.now`, or runtime nondeterminism.
- Public-safe: each authored business name, app label, tagline, and signature feature is checked with `isPublicSafe` coverage.
- Adjacent shops must differ in both identity and massing signature.
- A visible strip must not repeat any business name more than twice.
- Night readability uses a deterministic emissive floor helper: `commercialShopNightFloorEmissive(daylight)` maps day to `0.1`, night to `0.9`, and clamps daylight inputs.
- Joe's signage lane (#173) can read `group.userData.businessName`, `businessId`, `app`, and `signatureFeature` from the rendered commercial shop groups.

## Acceptance

- Vitest proves business assignment has no immediate-neighbour repeat, keeps visible names bounded, and all business metadata is public-safe.
- Vitest proves adjacent high-street shop massing signatures differ and the night floor emissive mapping is deterministic/clamped.
- Local gates pass: focused commerce tests, `npm run typecheck`, `npm run build`, and full `npm test`.
- Day and night screenshot proof show a varied row of distinct shops, with identity/massing metadata available for Joe signage #173.
