# 180 — Picket fence and garage as the first starter home

**Status:** proposed - dev flag off. The renderer/testbed slice is implemented; starter-home claim remains opt-in and disabled by `ColonyRuntime.STARTER_GARAGE_FIRST` (currently `false`).

## Intent

Make the first claimed property legible before a full house build exists: a small starter garage at the inland end of the driveway, enclosed by a low white picket fence. The garage door faces the street through the gate. Keep the lot boundary and driveway opening aligned to the existing 4 m grid.

## Integration plan

1. `claimStarterHome(target, { starterGarageFirst: true })` can set `starterGarage` and mark the plot built only when `ColonyRuntime.STARTER_GARAGE_FIRST` is enabled. Existing callers retain the full-house path.
2. `ParcelFence` renders only `fenceType: "fence"` using the checked-in GLB kit. Pure `parcelFencePlacements` derives ring panels, posts, and driveway gate from parcel cells.
3. The local testbed uses one generated real parcel and displays the sign; it is served as a standalone dev HTML entry and is not added to Vite's production input map.
4. The dev testbed uses deterministic named camera shots and a 14-second drive trajectory. Garage door animation is sampled from shot time, with `?door=open|closed` overrides; it does not depend on camera proximity.
5. Keep placement in world metres (`src/colony/scale.ts`: 1 unit = 1 m, `CELL_SIZE = 4`), Y-up and +Z authored facade orientation.
6. The standalone fence/garage test bed publishes parcel, driveway, garage, road centreline, and generated carriageway coordinates as `window.__testbed.info`. The 4 x 8 m garage sits with its front at the inland edge of the final driveway cell and its footprint inside the house zone. Road paving is outside the fence: a 9 m carriageway centred 7 m street-ward of the first driveway cell, with a kerb and concrete driveway/apron.
7. The driveway gate GLB has exactly two static end posts. Every rail, picket, and hinge is a descendant of `gate_leaf_left` or `gate_leaf_right`; leaf-local X coordinates run from the hinge toward the centre so the closed leaves meet at X=0. Parcel fence placements omit panels touching the gate cell and emit exactly one driveway gate. Tests verify every open-pose mesh bbox clears the lane opening (`|x| < 1.6 m`, `y=0..1.3 m`).

## Round 8 gate correction

The first generated gate's leaf descendants did move with their pivots, but the right-leaf picket positions were generated with positive local X coordinates. After adding the right hinge offset, that placed the pickets beyond the gate's 3.7 m span (up to about 3.7 m from centre) instead of between its hinge and centre. The closed/open test had checked leaf group bounds rather than every mesh and did not detect the outlying geometry. The generator now places all pickets on each leaf's inward local axis, keeps the only non-leaf meshes as the two gate posts, and the regression test checks all meshes and the rendered placement path.

## Round 9 gate ownership and panel spacing

`ParcelFence` owns exactly one driveway gate and accepts `gateOpen` from 0 (closed) to 1 (open), defaulting to closed for existing consumers. The testbed supplies its timeline and `?gate=closed` override to that same gate; it must not mount another GLB instance. `debugScene()` includes per-name instance counts for visible top-level scene pieces. Each 4 m fence edge places panel centres at its quarter and three-quarter points, producing two 2 m bays that abut without gaps or overlap.

## Dimensions and reference sources

| Element | Asset target | Reference range | Source |
|---|---:|---:|---|
| Picket height | 1.15 m (45.3 in) | 36–48 in | [Lumberama picket guide](https://lumberama.com/blog/picket-fence-guide), [First Fence white picket fence](https://firstfence.com/white-picket-fence) |
| Panel bay | 2.00 m | Posts commonly 6–8 ft apart; intermediate support at 2 m supports 4 m cells | Same sources; grid alignment is project choice |
| Starter garage | 4 x 8 m | 12 x 20 ft minimum to 16 x 24 ft | [SpecMyGarage size chart](https://specmygarage.com/guides/garage-size-chart), [Viking Steel Structures guide](https://vikingsteelstructures.com/blog/standard-garage-size-dimension-diagrams) |
| Garage door | 2.74 x 2.13 m | 9 x 7 ft | Common single-car door reference |
| Driveway | 4 m paved gate approach | 10–12 ft | [Angi driveway width guide](https://www.angi.com/articles/driveway-width-guide.htm) |

The fence and garage dimensions are authored asset targets; local bylaws, access requirements, and final house design may require different dimensions.

## Round 2 placement and camera decisions

- The driveway vector from gate to the road-facing first driveway cell is authoritative for street direction and garage yaw; `parcel.side` is only a fallback. This handles all four cardinal street approaches while retaining the generated side-1 result.
- The road centre is a metre-space presentation derived 7 m along the street vector from `driveway[0]`; the neighborhood's real `carriage` cells are also exposed for diagnosis. The visual road remains a straight 120 m strip because one parcel's local view does not render the neighborhood's entire routed spine.
- Five camera poses are independently defined: aerial, street gate, driveway approach, garage closed, and garage open. Animation state is a pure function of time and the explicit door override.

## Open decisions

- Which parcel metadata field is authoritative when `parcel.gate` and `parcel.driveway` disagree?
- Should a pedestrian gate be included on every claimed parcel, or only where a footpath connects?
- Which garage socket/orientation should be canonical for each street-facing house layout?
- Should the blank sign remain purely decorative or later receive a separately governed lot-state display?
- What state/event owns the door animation when a player uses the garage portal?
- Should the starter garage have a shallow gable roof in the final art direction, or retain the simple low-cost flat roof?
