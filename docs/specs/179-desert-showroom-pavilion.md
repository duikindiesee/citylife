# Spec 179 — Desert low-poly Gearbox pavilion and open-bay workshop

- status: built
- proposed-by: Irwin (creative direction), implemented in the cloud agent lane
- date: 2026-11-11
- depends-on: Spec 176, Spec 177

## Why (the citizens' and player's case)

The Gearbox Auto Hub read as a dark metal glass box. The approved CityLife look is faceted and flat-shaded, like the desert keyframe, and the showroom should feel like a warm timber pavilion at night: teal glass, a speckled pale floor, a turntable, and a workshop you can see into from the apron. A near-photoreal interior frame was used only for layout and mood. A later concept pass asked for two corrections the concept image itself gets wrong: lamp poles must not stand in the sightline, and no pier or lift post may hide the car in the open bay.

## Mechanic

Appearance only. The 16 by 11 cell pad, `buildGarageAnchorShellModel` surfaces, apron height functions, named collision ids, and `renderScale` stay. The landmark is not resized.

1. **Pavilion.** Large flat teal glass panes in warm wood mullions with a faint `#ffb24a` edge. Pale terrazzo `#d8e4ee` uses a 256² procedural data texture, not extra geometry. A pale faceted disc sits inside a dark segmented ring under the existing hero car. The back wall is vertical wood slats. The ceiling is a wood soffit, three emissive strips, and three cylindrical pendants. Key light stays `#fffaed`, rim `#a5dcff`.

2. **Apron.** Yellow curbs `#ffc83b` follow the existing apron surface. Asphalt stays `#595f6a`.

3. **Night emissive.** `garageFloorMats` used to overwrite every material's `emissiveIntensity` with `garageAnchorNightFloorEmissive` (0.12 at noon, 1.05 at full dark). That flattened a ceiling authored at 2.35 down to 1.05 and blew the floor up to the same number. Untagged materials (Kooker HQ windows, bollards, lobby glass) still follow that absolute curve. Tagged materials keep an authored night intensity and dim toward a day value along the same curve. `blendGarageEmissive` is the helper.

4. **Workshop.** Same massing. Walls move to warm sand, the roof and a few fittings to graphite, the open-bay floor to warm concrete. The open middle bay is dressed with shared low-poly props against the partitions and the back wall: red rolling tool chests, a corner workbench, a pegboard of tool silhouettes, a tyre rack, and a bright inspection lamp. The existing yellow two-post lift stays, with posts spread to `GARAGE_LIFT_POST_SPREAD` (0.44 of the door width) so they sit by the jambs. A Karoo Vonk display car, the same GLB the forecourt already uses, sits centred between the posts with its side toward the apron. It is scenery, not a new obstacle, so Bay 2 stays drivable.

5. **Poles.** The lamp stays a single west pole (`forecourt_light_pole_west`) on the outer edge of the parking apron, x less than -6, outside the glass and far from the open bay. An east pole would fail the bay-approach clearance test, so the workshop side stays clear. The corner pylon contract is unchanged. If the pylon already occupies that west corner, the lamp steps back along the flank.

6. **Reflections.** A one-shot PMREM bake, the same idea as `showroomEnvironment.tsx`, is applied only to pavilion glass, the turntable disc, and the hero and lift cars. It is not `scene.environment`. If the bake cannot run, the materials still render.

## Rules & data

- Glass: colour `#b7ddd4`, roughness 0.06, opacity 0.22, `depthWrite` off.
- Wood mullions `#8d5a32`, slat backing `#6b4428`, roof `#7a4e30`.
- Terrazzo texture 256², repeat 8 by 6. No texture above 512².
- Turntable disc radius 1.12 cells, 16 dark ring segments around radius 1.32.
- Ceiling strips authored night intensity 2.35, day 0.42. Mullion edge night 0.55.
- Lift posts at `bayDoorW * 0.44` either side of the bay centre, same depth as before.
- Props stay outside the centred car's width and below the sightline rays that prove the bay opening, or against the back wall where those rays are already required to land deep in the bay.
- Triangle budget, measured on seed 4242 with the GLB cars not yet swapped in: the shell goes from 2842 triangles and 124 meshes to 4652 triangles and 138 meshes. That is +1810 triangles and +14 meshes. The open-bay dressing is 984 triangles. With the Karoo GLBs loaded, a wide approach frame goes from 22086 triangles and 930 draw calls to 30208 triangles and 1186 draw calls. Most of that framed increase is the extra Vonk seated on the lift, a second copy of a GLB the forecourt already uses. Repeated mullions, slats, chests, and ring segments are merged or instanced.

## Cost — materials & labour

None. This is a render change. No stockpile, staff, or sim clock cost.

## Acceptance

- `tests/garagePavilionLook.test.ts` checks the night-curve blend, authored ceiling intensity, legacy HQ intensity, pole placement outside the glass and the open bay, a body-height ray from the apron hitting the lift car rather than a post or pier, the yellow curb, and a triangle ceiling.
- Existing garage shell, bay sightline, and collision tests still pass.
- `npm run build` passes.
- Approach, day, night, interior, and open-bay screenshots show the pavilion and a clear view of the lift car.

## Scale correction (Irwin review of PR 581)

The first pass left the pavilion at its old cell height, 6 m was not 6 m: `showroom.h` was 3.15 cells, and the group scale is 4, so the room was 12.6 m tall on a 13 m off-centre disc. Cars then looked like toys, and the lift car was yawed so its 4.08 m length ran across the opening.

What changed, and what did not:

- Pad footprint, apron C1 height (`garageApronSurfaceY` / `garageApronGroundY`), and obstacle ids are unchanged.
- Showroom height is `GARAGE_SHOWROOM_HEIGHT_M` = 6. Workshop height is `GARAGE_WORKSHOP_HEIGHT_M` = 5.5. Roller opening is `GARAGE_BAY_DOOR_HEIGHT_M` = 3.25. Those three replace the old 12.6 m / 9.4 m masses and the old `0.78 * height` door. Wall and pier colliders follow the new heights. Sightline samples that used to sit at 4–5.6 m now sit inside the 3.25 m opening.
- The turntable is centred on the showroom and is `GARAGE_TURNTABLE_DIAMETER_M` = 7. The pedestrian block around it matches that disc (radius 3.9 m) instead of the old 5.6 m off-centre bubble.
- Karoo GLBs measure 4.08 × 1.825 × 1.01 m in file space, nose toward -Z. `GARAGE_CAR_METRE_SCALE` is `1 / renderScale` (0.25). World size equals the file size. The old 0.262 / 0.255 factors are gone.
- The lift car keeps yaw 0, so its long axis is Z and the nose points at the back wall. The deck is `GARAGE_LIFT_DECK_M` = 1.5, on two yellow arms between the side posts.
- Workshop walls, roof, door frames, and a clerestory band use the pavilion wood and teal glass. The roller doors still close bays 1 and 3.
- Five static floor cars plus the hero (six showroom cars) sit on the 30.7 × 22 m floor. The five static copies are merged per material, about 43 meshes instead of one draw per GLB mesh.

Workshop lights, none of them casting shadows: a `#fffaed` key point (intensity 42, distance 16), an `#a5dcff` fill point (intensity 18, distance 14), and two emissive `#fffaed` ceiling strips. They replace the single inspection point.

Measured on seed 4242 after this correction, wide approach frame with GLBs loaded: 1316 draw calls and 63576 shell triangles. Against the first PR 581 frame (1186 calls, 30208 shell triangles) that is +130 calls and +33368 triangles, almost all of it the five extra showroom cars. Those five are about 43 draw calls and roughly 33k triangles after the merge. The lift car bbox is 1.82 × 1.00 × 4.08 m at a 1.5 m deck. The turntable hero’s authored bbox is the same 4.08 × 1.825 × 1.01 m; a posed axis-aligned box is larger because the car is yawed.

## Follow-up

Meshy GLB props (finished pendant lamps, lounge chairs, desert plants) are a later change. The procedural cylinders and chests are the stand-ins.
