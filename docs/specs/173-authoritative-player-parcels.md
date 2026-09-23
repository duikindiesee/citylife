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

- Validate swept vehicle clearance, elevation/slope, gate opening and turning onto the connected road with the actual supported car dimensions. Centre-line connectivity alone is insufficient.
- Create canonical parcel child frames in the reviewed world document. The existing document has a shared surface frame and venue frames, not individual parcel frames; do not invent a different frame for each buyer.
- Reserve the exact published inventory from NPC assignment, purchase and local blueprint restoration before residents start. This is not implemented by the survey.
- Import the reviewed manifest server-side, pin the world revision, and verify public neighbourhood registration. Client-authored geometry cannot publish land. Prices come from server offers.
- Render authoritative offers and submit plot/revision selection; resume durable intents after uncertain debit responses.
- Connect owned land to the builder, validate/persist completion and project the correct home and driveway. Existing driving only permits road cells, so it must explicitly authorize the owned driveway before home spawning.
- Preserve legacy synthetic deeds through explicit no-recharge recovery; do not silently remap them to these shared parcels.
- Review the coherent backend/frontend exact heads, then build, deploy and prove all three arrival states in the real interface.

No gameplay or purchase acceptance is claimed by this survey. The backend's current unpublished selection API must not deploy alone against the old neighbourhood-only purchase UI.
