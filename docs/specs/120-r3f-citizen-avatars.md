# Spec 120 — citizens visible in the R3F world (avatar layer v1)

The biggest hole in the porting tracker's Phase 3: the runtime fed live citizen avatars
into `setAvatarSource` every frame, but the R3F PlanetRenderer stubbed it — the v3 world
had no people. This ports the legacy `updateAvatars` path.

## Design

- **Bridge without re-renders**: the PlanetRenderer class holds mutable `AvatarRefs`
  (`source`, `fpCitizenId`); `setAvatarSource` / `enterFirstPerson` / `exitFirstPerson`
  become real ref setters, and `R3FAvatars` reads the refs in `useFrame` — the runtime's
  imperative hooks reach the React tree with zero reconciliation.
- **Max-capacity instancing** (the spec 119 verifier's suggestion): two `InstancedMesh`es
  (capsule bodies + sphere heads sharing matrices) allocated ONCE at the legacy cap of 64;
  `mesh.count` varies per frame — no reconstruction on roster changes.
- **Legacy-verbatim look**: capsule 0.16/0.44, head 0.12 lifted 0.86, identity colors
  cyan operator / pod purple / lavender (0x66e0ff / 0x9f86d8 / 0xc0b0e0), yaw =
  `-heading + PI/2`. The first-person citizen is hidden (the player IS that citizen).
- **Pure math in `avatarLayer.ts`** (transforms, colors, capacity clamp, fp-hiding) —
  node-testable; the component is a thin syncer.
- Mounts at boot stage 1 with the rest of the city (spec 117).
- **Sibling fix**: R3FPlayerCar's hardcoded y=0.22 now snaps to `terrain.worldY` (it
  floated on hills and sank in valleys).

## v2 backlog (deliberate deferrals)

Rally nameplates (canvas sprites), Joe's crab mesh, surface overrides (road-ribbon lift +
house pads), lookPitch, ambient pedestrian crowd (28-walker pool scaling with colonists).

## Tests

- `tests/avatarLayer.test.ts` (8): legacy constants pinned, grid-to-world transform, yaw
  convention, sea-level floor + rounded-cell sampling, fp-hiding, capacity clamp, and
  their composition.
- `e2e/avatars.spec.ts`: asserts the avatar instanced mesh exists in the probed scene and
  its drawn count equals the live roster size (first run: 4 citizens, 4 instances).
