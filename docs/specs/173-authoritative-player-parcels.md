# 173 — Authoritative player parcels and home arrival

Status: implementation in progress, not published or deployed.
Task: c489562b-2e5d-4add-9e6a-03f93e373b13. Depends on the owned-car arrival/driving slices (171/172) and the user-service parcel reservation API.

## Required player journey

An owned-car player without a home sees real available parcels at server prices. A selected parcel is exclusively reserved before any debit, becomes owned land after payment, and enters the existing house builder. Only durable, server-validated house completion creates a home. Returning players load their exact owned car at that home's usable, road-connected driveway. Reload, account switching and uncertain requests cannot duplicate purchases or borrow another household's home.

## Canonical geometry survey

`node scripts/surveyStarterParcels.mjs <output.json>` boots the configured world in survey mode, captures its actual layout hash and inspects generated parcels. It does not import a player's IndexedDB world or invent a parcel per user. Output is explicitly `SURVEY_ONLY_NOT_PUBLISHED`; it contains no price, ownership claim or sale availability.

The initial seed-4242 survey contains 20 parcels. Ten satellite parcels have named neighbourhood keys (wood1, wood2, wood3). The ten coastal parcels lack these keys and are excluded; this also excludes the first two parcels later reserved for founders during normal boot. A named key still needs the server's registered/public neighbourhood check.

Existing parcel driveways are pedestrian approaches: they begin on the verge and include the house doorway. The survey joins only an actual immediately adjacent road cell, stops before the house, verifies ground and cardinal continuity, preserves the real parcel ID and fence bounds, and chooses an off-road centre with a path cell remaining before the house. Occupied, built, founder-reserved and commercial parcels are refused. No existing runtime geometry is changed.

Four tests exercise the actual seed's ten candidates, road and terrain refusal, occupied/reserved exclusion, boundary/identity refusal, and deterministic conversion without changing pedestrian paths.

### Vehicle clearance evidence

`node scripts/measureOwnedVehicleModels.mjs` measures the three current GLB scenes through node transforms and catalogue rotation, retaining asset SHA256s. All current models have conservative static bounds about 4.08 m long by 1.825 m wide. The previous movement envelope was 4.0 by 1.7 m; it is now rounded outward to 4.10 by 1.84 m in `COLONY.ownedDriving`. A test binds all catalogue GLBs to these measurements and rejects missing/new/unmeasured or larger assets.

Movement and survey share `ownedDriveFootprintClear`, which checks the rotated body against every intersected grid cell plus continuous edge samples. The survey samples straight driveways at 0.25 m intervals, refusing fence, house, unavailable surface or ground intersections. All ten current candidates pass this static body-clearance test. A production `stepOwnedDrive` test with X19 stats then drives each spawn to its actual road at low speed and checks that a blocked gate/spawn is refused.

This proves straight approach clearance with the current static collider, not a complete usable driveway. Turning onto the road, slope/graded-surface continuity, dynamic obstruction and deployed keyboard/touch driving still require acceptance. The survey does not authorize runtime access to privately owned land.

Local validation on 2026-09-23: 2,367 tests in 268 files passed (275.26 s), TypeScript and the production build passed, and the returning-owner Chromium regression passed (1 test, 26 s) using fixture APIs. That browser exercise includes keyboard/touch driving, brake, exit/re-entry, reload and in-place account switching. It starts at Gearbox, not at an owned home. The retained screenshot shows the seated road view and controls; it is not evidence of deployed home arrival.

## Required before publication

### Land/home truth correction

Paid published land uses `PLOT_OWNED`, `plotOwned:true`, `requiresBuild:true` and `owned:false`.
The home truth includes its canonical frame/revision and price; backend current ownership
must still belong to the authenticated user. The UI shows that the plot is secured but the
house is still unbuilt, hides further land purchase, and does not show a completed home.
The legacy hash-grid house projection rejects every published layout revision, including
an apparently completed response: the new path must render actual server geometry and a
durable blueprint instead. The selector now uses actual plot offers (below); this
intermediate paid-land view links to the server-backed player house builder when its plot
matches the loaded published inventory.

Focused validation: 28 client unit tests, typecheck/build and a Chromium paid-land reload
test passed. The browser booted the real UI with fixture APIs, reloaded, found no synthetic
house and observed zero purchase requests. This is state-display evidence, not a real
purchase/build/deployment or starting-wallet acceptance result.

### Actual offers and payment recovery

The primary property UI now reads `/players/me/home/available-plots`. Each card uses the
server's exact plot ID, neighbourhood, quoted KCO price and dimensions; dimensions are
displayed in metres using the engine cell scale. Malformed or duplicate offers reject the
catalogue, and an absent endpoint shows an error rather than a neighbourhood-only fallback.
POST submits only `neighbourhoodKey`, `plotId` and `layoutRevision`; it never submits price,
owner or frame. The server still independently validates all selection and payment facts.

A synchronous in-flight guard prevents a second tap from posting while React is updating.
The view is keyed by authenticated user; late offer responses and switches during token
refresh are rejected. A 409 selection conflict requires fresh availability. Processing
responses never infer ownership from HTTP success alone.

On reload, an existing insufficient-funds intent displays the retained plot instead of an
empty catalogue. Retry posts exactly that selection and stable idempotency key. A pending
intent offers a read-only status check; operator-held or legacy unbound intents cannot
silently select another plot. Current server ownership remains the source of paid-land and
completed-home state. This client does not release reservations or grant funds.

Validation: 34 focused client tests, TypeScript and build passed. Five Chromium property
tests passed in 56.9 s: exact offered selection (including choosing the second plot),
double-tap exclusion, paid-land reload, feature-off/error/retry and insufficient-funds
reload/resume with identical request bodies. These use fixture APIs and prove no real
debit, live catalogue publication, starting balance or house completion.

- Validate swept vehicle clearance, elevation/slope, gate opening and turning onto the connected road with the actual supported car dimensions. Centre-line connectivity alone is insufficient.
- Canonical parcel child-frame generation now exists in `starterParcelManifest.ts`. Generate a review artifact with `node scripts/createStarterParcelManifest.mjs <output.json>` from the configured untouched seed. It creates surface-region children, with local cell zero at the first parcel cell centre and no invented building elevation. The resulting document hash is embedded in every plot geometry, while `sourceLayoutRevision` retains the original survey hash. Ten seed-4242 candidates qualify; the ten unnamed coastal plots remain excluded. Publication still requires review and a live server import; authenticated client bootstrap is wired locally.
- Runtime isolation now accepts an immutable player-inventory list pinned to the exact generated world ID and layout hash before residents or blueprint restoration start. It rejects duplicate, unknown, occupied, commercial and unnamed coastal/founder parcels. Legacy allocation, purchase, builder, blueprint restoration, construction, demolition and citizen cleanup exclude these IDs. This is a local guard, not publication or ownership authority: the authenticated bootstrap now consumes the reviewed server manifest, including sold parcels (an available-only list would expose sold land to NPCs). Explicit local authoring boots remain inventory-free. Focused tests cover mismatched inventories, unchanged protected geometry/materials/ledger, citizen cleanup and ordinary parcel construction.
- Import the reviewed manifest server-side, pin the world revision, and verify public neighbourhood registration. Client-authored geometry cannot publish land. Prices come from server offers.
- Authoritative offer selection and insufficient-funds resume are implemented locally. Still verify the real published catalogue, real ledger outcomes and uncertain-debit convergence after deployment.
- Project the server-completed player home and driveway into the world. Existing driving only permits road cells, so it must explicitly authorize the owned driveway before home spawning.
- Preserve legacy synthetic deeds through explicit no-recharge recovery; do not silently remap them to these shared parcels.
- Review the coherent backend/frontend exact heads, then build, deploy and prove all three arrival states in the real interface.

No gameplay or purchase acceptance is claimed by this survey. The backend's current unpublished selection API must not deploy alone against the old neighbourhood-only purchase UI.

The generated manifest is explicitly `REVIEW_REQUIRED_NOT_PUBLISHED`, has no prices or
owners, and includes the complete canonical layout plus plot/frame bindings and spawn
headings. It derives roads from that layout, requires production straight-driveway
footprint clearance and refuses reusing an already parcel-framed document as a fresh
survey. It is deterministic under parcel input reordering. The runtime constructor can
hydrate the supplied canonical document before accepting inventory and populating
residents; document identity and revision must match the inventory. This constructor
seam is now connected through the authenticated starter-catalogue boot gate. Do not
mistake the artifact for a published catalogue or rendered foundation/grade proof.

### Player inventory HUD and remaining authority boundaries

The runtime exposes a distinct `playerManaged` flag to the homestead HUD. These sites
show as player home sites, never as free NPC land or founder reservations. Both player
and operator HUDs hide legacy assignment, design, commission, construction, demolition
and eviction actions for them. Property offer/truth screens remain the source of price
and ownership; the local citizen owner field is not player ownership evidence.

Inventory-enabled runtimes now validate saved-layout hydration, import preflight and
revision adoption against the canonical durable geometry captured when the inventory
was accepted. `WorldLayoutBootCoordinator` can advance persistence metadata without
changing that geometry. Changed roads, terrain, frames or other durable spatial data
are rejected before mutation; accepting a changed world requires an explicit reviewed
inventory migration. Published-world boots disable the legacy City Builder for every
role, including ADMIN, and clear stale drawing mode before runtime construction.
The existing BuilderPanel access enforcement also clears later stale mode toggles.
Explicit local DEV skip-auth authoring boots retain their existing editor behavior.
These are application flow guards, not a claim that client code is an ownership authority.

### Authenticated boot barrier

`StarterWorldGate` loads `/kooker/api/v1/citylife/worlds/seed-4242/starter-catalogue`
before constructing ColonyRuntime. Only a published response with a valid canonical
world hash and unique plot/frame bindings can proceed. Missing, malformed and failed
responses show a retry screen; no empty or locally generated playable fallback is
created. Token refresh and late-response identity changes are rejected. Fetches have
a ten-second timeout, and runtime construction errors have a retry boundary.

Published boots use the server document directly and do not load or overwrite the
browser's edited IndexedDB world. The private editor's old save remains intact. No
runtime or NPC restoration happens until this barrier succeeds. This is now required
for authenticated game entry, so deployment must be coordinated with reviewed backend
publication; do not deploy this frontend alone to an unpublished world. It does not
enable the journey flag or grant ownership, money or purchase eligibility.

Validation for the boot integration: 2,386 unit tests across 272 files passed, plus
TypeScript and the production build. Thirteen Chromium checks passed: unpublished
world/retry, exact returning-car hydration, six editor-access cases and five property
selection/recovery cases. Browser fixtures generate the same canonical world document
through the production generator. The post-warm-up screenshot shows rendered ground
and sky; the tests do not prove a live service publication or finished home journey.

The existing User `CitylifeBlueprintService.upsert` stores per-user scripts after basic
text screening. It does not validate a paid deed, parcel dimensions, driveway clearance
or durable completion. Player completion must validate the exact owned parcel/revision,
persist the accepted design and completion atomically, and only then activate residence
and home spawn. A successful legacy blueprint PUT must never substitute for this step.
# Offer binding to the loaded world

The property screen rejects an entire offer response if any entry differs from the loaded
published world, layout revision, plot inventory or exact plot-to-frame binding. Missing
published inventory is a read failure. Prices and purchase validation remain server-owned.
This prevents stale or cross-world offers from selecting land outside the loaded catalogue.

## Player house builder

Paid land opens `/builder.html?mode=player-home` in the current tab. This mode fetches
the published world and authenticated `/players/me/home/build` context; it never uses
query-string ownership, dimensions, seed or blueprint. The existing visual editor is reused
with the published footprint and driveway-facing door locked. The operator authoring mode
remains a separate ADMIN-only entry. Player mode does not use the legacy Builder Desk's
local purchase negotiation or `blueprint_saved` messages as completion evidence.

Accept POSTs only the bound plot, revision and script, then reads back completion and the
exact script. Pending requests prevent another submit and design edits. Failure remains
visible and retryable; account changes invalidate both requests and results. Reload of a
completed build shows a return link without another write. Server eligibility, ownership,
design validation, atomic completion and residence remain authoritative. The accepted
design is not yet projected into the game scene; the return link alone does not prove
home spawning or full deployed onboarding.
