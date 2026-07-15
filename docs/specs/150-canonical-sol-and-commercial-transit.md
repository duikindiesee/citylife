# Spec 150 — canonical six-hour sols and commercial transit

Status: IMPLEMENTING on the v3 integration branch.

## Canonical public clock

CityLife's public clock is derived from one immutable event: the start of the
Johannesburg day containing the first repository commit.

- First commit: `c19aa9bd11695573c9bf23dbf9223d14edd1fe7c`
- Epoch: `2026-05-30T00:00:00+02:00` (`2026-05-29T22:00:00Z`)
- One sol: six real hours
- One Johannesburg day: four sols
- One in-sol hour: fifteen real minutes

The top bar's Sol, hour, minute and daylight glyph all come from the same pure
`canonicalSolClock` result. The old browser-local `citylife_founding_ms` value is no
longer an input, so two browsers at the same instant display the same clock.

This slice deliberately does not migrate the economy, lighting, Kookerbook rate limits
or bus fleet state machine away from their fast simulation clock. Those systems need a
separate missed-boundary/offline-replay contract before wall-clock scheduling is safe.

## Commercial bus stop

The route formerly received only founders and satellite-neighbourhood centroids. The
commercial district therefore had no stop even though its high street is drivable.

The route now also receives the Gearbox Auto Hub's deterministic `garagePad.roadTarget`
(falling back to the district intersection). The existing route builder owns snapping,
deduplication, ordering and BFS connection, so the stop automatically appears in the
world, mini-map, dwell sequence and boarding system.

For seed 4242 the stop is `{x:125,y:265}` on a dry avenue cell. Tests pin the stop and
loop membership for seeds 4242, 42 and 7 and rerun the route, depot, fleet, minimap,
placement and terrain-leveling contracts.
