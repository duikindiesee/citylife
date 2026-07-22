# Spec 153 — Kooker HQ Campus Interior ("Hub and Formula")

- **Status:** proposed for review, not yet built
- **Depends on:** spec 152 (authoritative spatial registry; HQ building frame,
  reception room and door portals in `src/colony/spatial/kookerHqInterior.ts`)
- **Relates to:** reception asset pack PR 352 (`hq-reception-pack.glb`),
  spec 116 (Ironwork Pillar — palette family), the planned Suzi library building
- **Design provenance:** operator brief ("HQ should feel like a tech campus —
  boardroom, watercooler/games room, an office per bot checking into its
  worklist"), developed by a Fable 5 concept panel — three independent concepts
  (campus-realism, game-readable, systems-first), adversarially judged with
  every portal endpoint recomputed, then synthesized. Docs only: no runtime,
  scene, or Task API change ships with this spec.

## 1. Citizen voice

_You push through the brass-posted door and the reception desk greets you the
way it always has. But past it, where the back wall used to be, the room now
exhales into a bright commons: a two-storey hub with the Big Board burning on
its far wall — every bot, every task, live. Left, behind glass, the Gate Room
where epics wait for a human hand. Right, the Arcade — foosball, a watercooler,
whoever's idle. And running east and west, two colour-washed office wings where
you can walk past a door and see, truthfully, what Jack is building right now._

## 2. Design theses (from the panel, binding)

1. **Truthful projection.** Every surface that looks like telemetry IS live
   Task API state. Empty boardroom = genuinely empty; an offline bot's board
   greys out but still shows its real queue. Zero placeholder data, ever.
2. **The weenie.** One straight sightline: street door → reception → commons →
   **Big Board**. You understand the building the moment you enter.
3. **Geometry by formula, identity by principal.** Office rooms are anonymous
   `office-slot-NN` frames from a pure slot formula; the bot↔slot binding is a
   `WorldLayoutReservation` with `ownerRef: "principal:bot:<id>"` (field and
   `principal:` grammar verified in `worldLayoutDocument.ts:755-758`) plus an
   explicit immutable `slotIndex` in the fleet registry — never derived from a
   mutable sort. Rebinding a bot is one reservation swap; no geometry moves.
4. **Append-only growth.** The campus grows by appending wing segments; every
   existing address and transform stays byte-identical (spec 152 lock).
5. **Animation never claims work.** The renderer holds a read-only Task API
   credential and every visual transition cites an observed event id — a
   capability guarantee, not a convention.

## 3. Floor plan (building-local meters; origin = street door; +Z into the building)

All new frames: `kind:"room"`, `layer:"interior"`, `parentId` = the spec-152
`kooker-hq` building frame, 1 m cells, grid origin (0,0,0), unit scale,
yaw ∈ {0, π} only. Walls are zero-thickness shared planes (the authored
reception idiom). Doors sit on each room's local z=0 wall at (W/2, 0, 0),
opening local +Z.

| Room                          | localId               | Grid W×D | Frame position  | Yaw           | Building extent (x × z) |
| ----------------------------- | --------------------- | -------- | --------------- | ------------- | ----------------------- |
| Reception (exists, untouched) | `reception`           | 12×10    | (−6, 0, 0)      | 0             | [−6,6] × [0,10]         |
| Commons hub                   | `commons`             | 16×12    | (−8, 0, 10)     | 0             | [−8,8] × [10,22]        |
| Boardroom "Gate Room"         | `boardroom`           | 8×8      | (0, 0, 22)      | 0             | [0,8] × [22,30]         |
| Social "Arcade"               | `arcade`              | 8×8      | (−8, 0, 22)     | 0             | [−8,0] × [22,30]        |
| East wing segment 1 "Forge"   | `wing-east-1`         | 12×4     | (8, 0, 14)      | 0             | [8,20] × [14,18]        |
| West wing segment 1 "Flow"    | `wing-west-1`         | 12×4     | (−20, 0, 14)    | 0             | [−20,−8] × [14,18]      |
| Offices ×12                   | `office-slot-00`…`11` | 4×5      | slot formula §5 | 0 (N) / π (S) | wings ±[8..20]          |

Envelope day one: **40 m × 30 m**. 17 new frames, 34 new portal records.

The boardroom and arcade are symmetric **8×8** frames sitting **wholly within the
commons width** (`[0,8]` and `[−8,0]`, the door axis at x=0). They stop at the
office-column boundary x=±8, so their `[22,30]` footprints share only the x=±8 and
z=22 boundary lines with the north offices (`z[18,23]`) and the commons (`z[10,22]`)
— zero overlapping area under the half-open `[x₀, x₀+W)` / `[z₀, z₀+D)` frame
convention. This is the FIX1 resolution of the two 3 m × 1 m room-frame collisions
found in review; envelope, frame count and portal count are unchanged.

```text
                    z=30 ┌──────────────┐      ┌──────────────┐
                         │    ARCADE    │      │  GATE ROOM   │
                         │ (watercooler │      │ (boardroom,  │
                         │  foosball,   │      │  EpicWall,   │
                         │  FleetBoard) │      │  gate pucks) │
                    z=22 └──────┬───────┘      └──────┬───────┘
   ┌───office─┬─office─┬─office─┴──────────────────────┴─office─┬─office─┬─office──┐
z=18│ slot-06 │ slot-07│ slot-08│    ▲ BIG BOARD (north   │slot-00│ slot-01│ slot-02 │
   ┌┴─────────┴────────┴────────┤      wall of commons)   ├───────┴────────┴────────┴┐
   │  WING WEST-1 "Flow" (blue) │                         │ WING EAST-1 "Forge"(org) │
z=14└┬─────────┬────────┬───────┤       COMMONS HUB       ├───────┬────────┬────────┬┘
    │ slot-09 │ slot-10 │slot-11│   (Suzi liaison desk,   │slot-03│ slot-04│ slot-05 │
    └─office──┴─office──┴office─┤    "LIBRARY →" sign)    ├─office┴─office─┴─office──┘
                    z=10        └──────────┬──────────────┘
                                ┌──────────┴──────────────┐
                                │       RECEPTION         │  ← exists (12×10,
                                │  (desk, manifesto wall, │     PR 352 assets)
                                │   archive shelves)      │
                     z=0        └───────────▓▓────────────┘
                                       street door (origin)
```

_(Diagram is indicative; the tables are normative.)_

## 4. Portal plan (17 doorways = 34 records)

Every doorway is one enter/exit **exact-inverse pair** between distinct frames
(the authored HQ pattern), modes `["walk","portal"]` (the merged spec-152 /
runtime authorship order, not alphabetical), endpoints 0.5 m
inside each doorway plane and strictly inside the half-open grid extents.
Ids `<hq>:portal:<near>--<far>:enter|exit`, addresses
`<hqAddr>/portal/<near>--<far>/enter|exit`.

| Doorway                | from-local endpoint | to-local endpoint | building-local                                                                 |
| ---------------------- | ------------------- | ----------------- | ------------------------------------------------------------------------------ |
| reception ↔ commons   | (6, 0, 9.5)         | (8, 0, 0.5)       | (0, 9.5)/(0, 10.5) — on the door→Big Board axis                                |
| commons ↔ boardroom   | (12, 0, 11.5)       | (4, 0, 0.5)       | (4, 21.5)/(4, 22.5) — recentred on the 8-wide boardroom (door at building x=4) |
| commons ↔ arcade      | (4, 0, 11.5)        | (4, 0, 0.5)       | (−4, 21.5)/(−4, 22.5) — recentred on the 8-wide arcade (door at building x=−4) |
| commons ↔ wing-east-1 | (15.5, 0, 6)        | (0.5, 0, 2)       | (7.5, 16)/(8.5, 16)                                                            |
| commons ↔ wing-west-1 | (0.5, 0, 6)         | (11.5, 0, 2)      | (−7.5, 16)/(−8.5, 16)                                                          |
| segment ↔ N office ×6 | (2+4j, 0, 3.5)      | (2, 0, 0.5)       | (x₀+2+4j, 17.5)/(…, 18.5)                                                      |
| segment ↔ S office ×6 | (2+4j, 0, 0.5)      | (2, 0, 0.5)       | (x₀+2+4j, 14.5)/(…, 13.5)                                                      |

Panel verification: all endpoints recomputed under the confirmed
`frameTransforms.rotateY` convention (x′ = x·cosθ + z·sinθ,
z′ = −x·sinθ + z·cosθ); all in bounds; no from==to; no id/address collisions;
0.5-step float-exact coordinates throughout. FIX1 recompute: the boardroom and
arcade commons-side endpoints move to building x=±4 (commons-local x=12 and 4)
and their room-side endpoints to local (4, 0, 0.5) — both 0.5 m inside the now
8-wide rooms and inside the commons `z[0,12]` extent; the exact inverses and all
other 32 endpoints are unchanged.

## 5. Office slot formula (pure, total)

For wing segment m ≥ 1 and slot j ∈ {0,1,2}: east x₀(m) = 8 + 12(m−1);
west x₀(m) = −8 − 12m. North office: frame position (x₀+4j, 0, 18), yaw 0,
door at building (x₀+2+4j, 18). South office: frame position (x₀+4j+4, 0, 14),
yaw π, door at building (x₀+2+4j, 14). Slot numbering is fixed at authoring
time and recorded as immutable `slotIndex` in the fleet registry.

The total, explicit `slotIndex` → (wing, segment, j, side) mapping — the
authored day-one binding, never derived from a mutable sort:

| slotIndex | Wing (segment)     | j   | Side | Door (building-local) | Day-one bot      |
| --------- | ------------------ | --- | ---- | --------------------- | ---------------- |
| 00        | East "Forge" (m=1) | 0   | N    | (10, 18)              | Joe              |
| 01        | East "Forge" (m=1) | 1   | N    | (14, 18)              | Jack             |
| 02        | East "Forge" (m=1) | 2   | N    | (18, 18)              | MoJoJo           |
| 03        | East "Forge" (m=1) | 0   | S    | (10, 14)              | Floyd            |
| 04        | East "Forge" (m=1) | 1   | S    | (14, 14)              | Vesper           |
| 05        | East "Forge" (m=1) | 2   | S    | (18, 14)              | Alice            |
| 06        | West "Flow" (m=1)  | 0   | N    | (−18, 18)             | Fable-review     |
| 07        | West "Flow" (m=1)  | 1   | N    | (−14, 18)             | Sonnet-executor  |
| 08        | West "Flow" (m=1)  | 2   | N    | (−10, 18)             | CityLife-builder |
| 09        | West "Flow" (m=1)  | 0   | S    | (−18, 14)             | — dark shell     |
| 10        | West "Flow" (m=1)  | 1   | S    | (−14, 14)             | — dark shell     |
| 11        | West "Flow" (m=1)  | 2   | S    | (−10, 14)             | — dark shell     |

(East = "Forge", slots 00–05; West = "Flow", slots 06–11; N row z=18, S row z=14;
`j` increases with the diagram's left-to-right reading. Door building-local
follows §5's `(x₀+2+4j, 18|14)`.)

**Day-one binding (9 bound, 3 dark shells):** 00 Joe, 01 Jack, 02 MoJoJo,
03 Floyd, 04 Vesper, 05 Alice (Forge); 06 Fable-review, 07 Sonnet-executor,
08 CityLife-builder (Flow); 09–11 unbound dark shells (lights off, no
nameplate, honest "unassigned"). **Suzi gets no office**: a liaison desk in
the commons plus a "LIBRARY →" signpost honours her future library building.

## 6. The bot-office module (4×5 m, repeatable)

Room-local, door at (2,0,0): `WorklistBoard` 3.0×1.8 back-flush on the z=5
wall facing the door; `Desk` 1.6×0.75×0.8 at (2,0,3.6) yaw π — the bot faces
the door with its board readable over its shoulder (the intended camera
composition); `StatusTotem` 0.4×2.2 emissive-banded at (0.5,0,0.7); shelf,
lamp, plant; per-wing floor stripe; per-bot accent door light (runtime tint
from the registry — geometry stays neutral). Task cards are instanced
0.6×0.4 meshes, ≤8 visible + an overflow counter chip.

**Presence behaviour (projection only, per the read-only doctrine):**
WORKING → presence at desk anchor, totem pulsing, active card raised.
IDLE_AT_DESK → totem steady dim. IDLE_SOCIAL → avatar in the Arcade, desk
honestly empty. COMMUTE → walks the wing, address flips atomically per portal.
OFFLINE → totem dark, board greyscale but still showing real queued tasks with
an "offline" chip. AWAITING_HUMAN → totem amber, card in a gate slot. Empty
worklist → dim "no queued work" strip. The one delight beat: on an _observed_
claim event, the office door light blinks once (badge-tap ritual).

**Worklist data quarantine:** the 2026-07-12 big-board presence contract file
is not in this repo's tree; every Task API field binding therefore lives
behind a single `WorklistProjection` interface in the integration slice.
Geometry, frames, portals and asset packs have zero dependency on it and can
ship first.

## 7. Boardroom "Gate Room" and Arcade

**Gate Room (8×8):** glass front toward the commons; 3.6×1.4 table, 10
instanced chairs; `EpicWall` 6.0×2.4 on the back wall — one swimlane per live
epic; physical `GatePuck` tokens glow amber in the "awaiting operator" column;
`MergeTicker` over the door scrolls MoJoJo merge events only when they exist.
A chair reads occupied only when a presence address sits at that seat anchor.

**Arcade (8×8):** watercooler totem (landmark prop), foosball, arcade
cabinet (decor shader — decor never imitates telemetry), couches facing a
3.6×2.0 `FleetBoard` with per-bot coarse presence chips and fleet WIP/queue
depth. Idle avatars congregate here: a crowded Arcade _is_ the idle-capacity
gauge. Deterministic foosball pairing from the sorted idle set.

## 8. Asset plan (four packs, reception-pack pipeline)

Same discipline as PR 352: deterministic Node generator per pack, byte-stable
GLB, `PROVENANCE.md`, `citylife-prop-placement/v1` placement JSON, vitest
structural contract. Office placement JSONs are emitted per slot by the slot
formula — one generator, N rooms.

| Pack                   | Nodes (count)                                                                                                                                    | Est. source tris |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| `hq-campus-shell-pack` | Wall1m, DoorFrame, GlassPanel1m, FloorTile, CeilingDuct2m, FloorStripe1m, Planter, ServerNook (8)                                                | ~500             |
| `hq-bot-office-pack`   | Desk, TaskChair, WorklistBoard, TaskCard, StatusTotem, DoorLight, Shelf, DeskLamp, Plant, LiaisonDesk, RoutingBoard, LibrarySign, Workbench (13) | ~1,400           |
| `hq-boardroom-pack`    | BoardTable, BoardChair, EpicWall, GatePuck, MergeTicker, HoloEpic, Sideboard (7)                                                                 | ~900             |
| `hq-commons-pack`      | Watercooler, Foosball, Arcade, Couch, BeanBag, FleetBoard, SnackShelf, Rug (8)                                                                   | ~1,100           |

Budgets: ≤6 draw calls per office (merged static + emissive set + instanced
cards + SDF text); ≤150 resident interior draw calls worst case (~40 typical
in view); props hydrate per wing segment (<16 ms, cached); frames/portals
always resident. The HQ street door remains the **sole streaming boundary**
(spec 152). Palette: ironwork-pillar family + per-wing hue (Forge orange
`0xb0622f`-family, Flow blue `0x2f6ab0`-family) + reception materials.

## 9. Growth (+N bots, no coordinate resets)

First 3 arrivals: bind the dark shells — reservation swap only, zero
construction. Beyond that: append `wing-east-2` at (20,0,14) (joint doorway
east-1 (11.5,0,2) ↔ east-2 (0.5,0,2)) with 6 office frames + 7 portal pairs —
one revision, all existing records byte-untouched, O(1) records per segment
forever along ±x. All of it lives in one pure, `ALREADY_PRESENT`-guarded
`withKookerHqCampus(document, surfaceFrame, { segmentsPerWing })` that embeds
the existing `withKookerHqInterior` output verbatim. Retired bots: reservation
released, shell goes dark honestly; slot ids never re-imply an old identity.
Optional later graft: a `gallery` connector joining wing tips into a
circulation loop (one appended frame + pairs).

## 10. Acceptance

1. Document validates: single root, unique ids/addresses, every portal pair an
   exact inverse with in-bounds endpoints (property test across all 34).
2. Spec-152 lock passes: byte-diff shows every pre-existing record unchanged.
3. Slot formula property test: for any N, generated frames/portals/placements
   are collision-free and in-bounds.
4. Reception content (PR 352 placements) renders unchanged.
5. Sightline check: Big Board visible from the street door through both
   doorways at CityLife camera.
6. Presence honesty tests: offline/empty/idle states render from recorded
   fixtures of real API shapes; a mutation attempt from the renderer's
   credential fails (read-only token).
7. Draw-call budget measured ≤ budgets in §8 on the reference scene.

## 11. Gates and sequencing

Docs-only spec (OPERATOR review) → asset packs (four PRs, same pipeline as
PR 352, independently reviewable) → `withKookerHqCampus` fragment builder +
tests (MERGE) → render/streaming slice (MERGE) → `WorklistProjection`
integration once the presence contract is sourced (MERGE) → in-world QA, day
and night (a green vitest cannot see grounding/lighting). Nothing merges or
renders before its gate; this spec authorizes none of it.
