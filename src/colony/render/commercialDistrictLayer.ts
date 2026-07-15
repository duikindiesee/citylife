// Spec 135 — the commercial district layer, extracted VERBATIM from the legacy
// PlanetRenderer private pipeline (buildMallAnchorShell / buildGarageAnchorShell /
// buildCommercialDistrict / business labels, props, roofs and emblems — legacy lines
// ~3263-5129) with the `this.*` context mechanically rewritten onto a CommercialCtx
// object (named C: the shop-sign painters use canvas 2D contexts named ctx). The R3F
// component (R3FCommercialDistrict) owns the layer: builds it from
// sim.state.commercialDistrict, parents the group, drives update() per frame (sign glow,
// night floors, label projection + occlusion) and disposes on rebuild/unmount.
import * as THREE from "three";
import type { ColonyState } from "../sim";
import type { CommercialDistrict, ShopParcel } from "../commerce/district";
import { BUSINESSES, type Business, type Emblem } from "../commerce/businesses";
import { surveyBillboards } from "../commerce/billboards";
import {
  BUSINESS_LABEL_VIEWPORT_NDC_LIMIT,
  declutterBusinessLabels,
  labelOpacityForVisibility,
  surveyBusinessLabels,
  type BusinessLabel,
  type BusinessLabelDeclutterInput,
} from "../commerce/businessLabels";
import { posterModel, paintPoster } from "../commerce/adCanvas";
import {
  buildMallAnchorShellModel,
  mallAnchorNightFloorEmissive,
} from "./mallAnchorShell";
import {
  buildGarageAnchorShellModel,
  garageAnchorNightFloorEmissive,
} from "./garageAnchorShell";
import {
  commercialShopMassing,
  commercialShopNightFloorEmissive,
  type CommercialShopMassing,
} from "./commercialShopMassing";
import { isPublicSafe } from "../newcomers";
import { padSeatY, RENDER_DRY_FLOOR } from "./useTerrainLeveling";
import {
  surveyVenuePlacements,
  junctionZonesToPads,
  venueSeatY,
  venueRoadBlockedCells,
  BAR_COUNTER_OFF_M,
  BAR_STOOL_OFF_M,
  BAR_STOOL_SPACING_M,
  DOOR_H_M,
  DOOR_W_M,
  type VenuePlacement,
} from "./venuePlacement";
import { findJunctionZones } from "./roadJunctions";
import { buildCrabGeometry } from "./crabGeometry";

export interface CommercialLabelEntry {
  group: THREE.Object3D;
  sprite: THREE.SpriteMaterial;
  floor: THREE.MeshBasicMaterial;
  model: BusinessLabel;
  visibilityOpacity: number;
}

interface CommercialCtx {
  state: ColonyState;
  district: CommercialDistrict;
  wx: (x: number) => number;
  wz: (y: number) => number;
  surfaceY: (x: number, y: number) => number;
  group: THREE.Group;
  signMats: THREE.MeshStandardMaterial[];
  floorMats: THREE.MeshStandardMaterial[];
  garageFloorMats: THREE.MeshStandardMaterial[];
  mallFloorMat: THREE.MeshStandardMaterial | null;
  labelMats: CommercialLabelEntry[];
  labelNight: number;
  camera: THREE.Camera;
  scene: THREE.Scene;
  canvas: HTMLCanvasElement;
}

const SCRATCH = {
  projection: new THREE.Vector3(),
  world: new THREE.Vector3(),
  direction: new THREE.Vector3(),
  raycaster: new THREE.Raycaster(),
};

const NEON = [
  0xff2d95, 0x18e0ff, 0xffc233, 0x7bff4d, 0xb24dff, 0xff6a3d,
] as const;

function buildMallAnchorShell(C: CommercialCtx, d: CommercialDistrict): void {
  const model = buildMallAnchorShellModel(d.mallPad, (x, y) =>
    C.surfaceY(x, y),
  );
  const g = new THREE.Group();
  g.name = "commercialDistrict.mallPad.mallAnchorShell";
  g.userData.kind = model.kind;
  g.position.set(
    C.wx(model.center.x),
    // Spec 143 — anchors seat on the ONE pad-seat formula (spec 128) like every venue;
    // the model's own lowest-corner baseY drifts from the graded pad on sloped ground.
    padSeatY(
      C.state.terrain,
      d.mallPad.x,
      d.mallPad.y,
      d.mallPad.w,
      d.mallPad.h,
    ),
    C.wz(model.center.y),
  );

  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x1b2938,
    roughness: 0.58,
    metalness: 0.05,
    emissive: 0x31d6ff,
    emissiveIntensity: model.nightFloor.emissiveIntensity.day,
    transparent: true,
    opacity: 0.82,
  });
  C.mallFloorMat = floorMat;
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(model.nightFloor.w, 0.05, model.nightFloor.d),
    floorMat,
  );
  floor.name = "mallAnchorNightFloor";
  floor.position.y = model.nightFloor.y;
  floor.receiveShadow = true;

  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x465169,
    roughness: 0.72,
    metalness: 0.08,
    emissive: 0x102040,
    emissiveIntensity: 0.08,
  });
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(model.body.w, model.body.h, model.body.d),
    wallMat,
  );
  body.name = "mallAnchorMainBody";
  body.position.y = model.body.y;
  body.castShadow = true;
  body.receiveShadow = true;

  const wingMat = new THREE.MeshStandardMaterial({
    color: 0x384258,
    roughness: 0.76,
    metalness: 0.06,
  });
  for (const sx of [-1, 1]) {
    const wing = new THREE.Mesh(
      new THREE.BoxGeometry(model.wing.w, model.wing.h, model.wing.d),
      wingMat,
    );
    wing.name = sx < 0 ? "mallAnchorWestWing" : "mallAnchorEastWing";
    wing.position.set(sx * model.wing.xOffset, model.wing.y, 0.2);
    wing.castShadow = true;
    wing.receiveShadow = true;
    g.add(wing);
  }

  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(model.roof.w, model.roof.h, model.roof.d),
    new THREE.MeshStandardMaterial({
      color: 0x202633,
      roughness: 0.84,
      metalness: 0.04,
    }),
  );
  roof.name = "mallAnchorFlatRoof";
  roof.position.y = model.roof.y;
  roof.castShadow = true;

  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x8bdcff,
    roughness: 0.24,
    metalness: 0.15,
    emissive: 0x5ed7ff,
    emissiveIntensity: 0.42,
  });
  for (const sx of [-model.body.w * 0.24, 0, model.body.w * 0.24]) {
    const pane = new THREE.Mesh(
      new THREE.BoxGeometry(model.body.w * 0.18, model.body.h * 0.45, 0.06),
      glassMat,
    );
    pane.name = "mallAnchorStorefrontPane";
    pane.position.set(sx, model.body.h * 0.46, -model.body.d / 2 - 0.035);
    g.add(pane);
  }

  const canopy = new THREE.Mesh(
    new THREE.BoxGeometry(
      model.entranceCanopy.w,
      model.entranceCanopy.h,
      model.entranceCanopy.d,
    ),
    new THREE.MeshStandardMaterial({
      color: 0x31d6ff,
      emissive: 0x31d6ff,
      emissiveIntensity: 0.62,
      roughness: 0.35,
    }),
  );
  canopy.name = "mallAnchorEntranceCanopy";
  canopy.position.set(0, model.entranceCanopy.y, model.entranceCanopy.zOffset);
  canopy.castShadow = true;

  g.add(floor, body, roof, canopy);
  C.group.add(g);
}

function buildGarageAnchorShell(C: CommercialCtx, d: CommercialDistrict): void {
  if (!d.garagePad) return;
  const model = buildGarageAnchorShellModel(d.garagePad, (x, y) =>
    C.surfaceY(x, y),
  );
  const g = new THREE.Group();
  g.name = "commercialDistrict.garagePad.garageAnchorShell";
  g.userData = {
    kind: model.kind,
    publicName: model.publicName,
    isPublicSafe: model.isPublicSafe,
    facingAngle: model.facingAngle,
    roadTarget: d.garagePad.roadTarget,
  };
  g.position.set(
    C.wx(model.center.x),
    // Spec 143 — the ONE pad-seat formula (spec 128), same as the mall anchor above.
    padSeatY(
      C.state.terrain,
      d.garagePad.x,
      d.garagePad.y,
      d.garagePad.w,
      d.garagePad.h,
    ),
    C.wz(model.center.y),
  );
  g.rotation.y = model.facingAngle;

  const floorMat = new THREE.MeshStandardMaterial({
    color: 0xffb24a,
    emissive: 0xff9f2f,
    emissiveIntensity: garageAnchorNightFloorEmissive(C.state.clock.daylight),
    roughness: 0.52,
    transparent: true,
    opacity: 0.54,
  });
  C.garageFloorMats.push(floorMat);
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(model.nightFloor.w, 0.04, model.nightFloor.d),
    floorMat,
  );
  floor.name = "garageAnchorNightFloor";
  floor.position.y = model.nightFloor.y;

  const forecourtMat = new THREE.MeshStandardMaterial({
    color: 0x4c5262,
    roughness: 0.68,
    metalness: 0.02,
    emissive: 0xff9f2f,
    emissiveIntensity:
      garageAnchorNightFloorEmissive(C.state.clock.daylight) * 0.58,
  });
  C.garageFloorMats.push(forecourtMat);
  const forecourt = new THREE.Mesh(
    new THREE.BoxGeometry(model.forecourt.w, 0.035, model.forecourt.d),
    forecourtMat,
  );
  forecourt.name = "garageAnchorRoadFacingForecourt";
  forecourt.position.set(0, model.forecourt.y, model.forecourt.frontOffset);
  forecourt.receiveShadow = true;

  const forecourtLane = new THREE.Group();
  forecourtLane.name = "garageAnchorForecourtWarmLaneStrips";
  const laneMat = new THREE.MeshStandardMaterial({
    color: 0xffcf74,
    emissive: 0xffa13a,
    emissiveIntensity: 0.58,
    roughness: 0.34,
  });
  for (const x of [-model.forecourt.w * 0.22, model.forecourt.w * 0.22]) {
    const lane = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.035, model.forecourt.d * 0.82),
      laneMat,
    );
    lane.name = `garageAnchorForecourtWarmLaneStrip.${x < 0 ? "left" : "right"}`;
    lane.position.set(x, model.forecourt.y + 0.03, model.forecourt.frontOffset);
    forecourtLane.add(lane);
  }

  const showroom = new THREE.Mesh(
    new THREE.BoxGeometry(model.showroom.w, model.showroom.h, model.showroom.d),
    new THREE.MeshStandardMaterial({
      // Spec 109/110 — COOL glazing (not a warm frosted cube): low-opacity blue-teal glass with a
      // metallic sheen reads against the warm sign/forecourt for material contrast, and the dark
      // interior box below gives it depth so it reads as glass with a lit showroom behind it.
      color: 0x8fd2e6,
      roughness: 0.05,
      metalness: 0.28,
      emissive: 0x123642,
      emissiveIntensity: 0.16,
      transparent: true,
      opacity: 0.38,
    }),
  );
  showroom.name = "garageAnchorGlassShowroom";
  showroom.position.set(model.showroom.x, model.showroom.y, model.showroom.z);
  showroom.castShadow = true;
  showroom.receiveShadow = true;

  // Dark lit interior behind the glass so the showroom reads as glazing with depth (not a frosted
  // cube). Warm interior glow at night via the night-floor emissive helper.
  const showroomInteriorMat = new THREE.MeshStandardMaterial({
    color: 0x14202c,
    roughness: 0.85,
    emissive: 0x3a2a12,
    emissiveIntensity: 0.12,
  });
  const showroomInterior = new THREE.Mesh(
    new THREE.BoxGeometry(
      model.showroom.w * 0.9,
      model.showroom.h * 0.86,
      model.showroom.d * 0.9,
    ),
    showroomInteriorMat,
  );
  showroomInterior.name = "garageAnchorShowroomInterior";
  showroomInterior.position.set(
    model.showroom.x,
    model.showroom.y * 0.96,
    model.showroom.z,
  );

  const showroomFront = new THREE.Mesh(
    new THREE.BoxGeometry(
      model.showroom.w * 0.84,
      model.showroom.h * 0.58,
      0.08,
    ),
    new THREE.MeshStandardMaterial({
      color: 0xffd3a0,
      roughness: 0.08,
      metalness: 0.04,
      emissive: 0xffb24a,
      emissiveIntensity: 0.58,
      transparent: true,
      opacity: 0.8,
    }),
  );
  showroomFront.name = "garageAnchorGlassShowroomFront";
  showroomFront.position.set(
    model.showroom.x,
    model.showroom.h * 0.54,
    model.showroom.z + model.showroom.d / 2 + 0.06,
  );

  const showroomHeader = new THREE.Mesh(
    new THREE.BoxGeometry(model.showroom.w * 0.9, 0.32, 0.14),
    new THREE.MeshStandardMaterial({
      color: 0xffb24a,
      emissive: 0xff8f2f,
      emissiveIntensity: 0.65,
      roughness: 0.36,
    }),
  );
  showroomHeader.name = "garageAnchorShowroomHeaderSign";
  showroomHeader.position.set(
    model.showroom.x,
    model.showroom.h + 0.12,
    model.showroom.z + model.showroom.d / 2 + 0.08,
  );

  const showroomCarSilhouette = new THREE.Group();
  showroomCarSilhouette.name = "garageAnchorShowroomFrontCarSilhouette";
  showroomCarSilhouette.position.set(
    model.showroom.x,
    model.showroom.h * 0.43,
    model.showroom.z + model.showroom.d / 2 + 0.13,
  );
  const silhouetteMat = new THREE.MeshStandardMaterial({
    color: 0x6fe7ff,
    emissive: 0x35d8ff,
    emissiveIntensity: 0.78,
    roughness: 0.18,
    transparent: true,
    opacity: 0.88,
  });
  const silhouetteBody = new THREE.Mesh(
    new THREE.BoxGeometry(model.showroom.w * 0.44, 0.13, 0.04),
    silhouetteMat,
  );
  silhouetteBody.name = "garageAnchorShowroomFrontCarSilhouette.body";
  const silhouetteCab = new THREE.Mesh(
    new THREE.BoxGeometry(model.showroom.w * 0.18, 0.17, 0.045),
    silhouetteMat,
  );
  silhouetteCab.name = "garageAnchorShowroomFrontCarSilhouette.cab";
  silhouetteCab.position.y = 0.14;
  showroomCarSilhouette.add(silhouetteBody, silhouetteCab);

  const showroomCarGlow = new THREE.Group();
  showroomCarGlow.name = "garageAnchorShowroomCarGlow";
  showroomCarGlow.position.set(
    model.showroom.x - model.showroom.w * 0.03,
    0.16,
    model.showroom.z + model.showroom.d * 0.26,
  );
  const showroomCarBody = new THREE.Mesh(
    new THREE.BoxGeometry(1.18, 0.24, 0.54),
    new THREE.MeshStandardMaterial({
      color: 0xff6f3a,
      roughness: 0.42,
      emissive: 0xff6f3a,
      emissiveIntensity: 0.38,
    }),
  );
  showroomCarBody.name = "garageAnchorShowroomCarGlow.body";
  showroomCarBody.position.y = 0.2;
  const showroomCarCab = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.25, 0.4),
    new THREE.MeshStandardMaterial({
      color: 0xffe3b8,
      roughness: 0.12,
      emissive: 0xffc47a,
      emissiveIntensity: 0.5,
      transparent: true,
      opacity: 0.82,
    }),
  );
  showroomCarCab.name = "garageAnchorShowroomCarGlow.cab";
  showroomCarCab.position.set(-0.08, 0.42, 0);
  const showroomUnderGlow = new THREE.Mesh(
    new THREE.BoxGeometry(1.38, 0.035, 0.68),
    new THREE.MeshStandardMaterial({
      color: 0xffb24a,
      emissive: 0xff8f2f,
      emissiveIntensity: 0.9,
      transparent: true,
      opacity: 0.7,
    }),
  );
  showroomUnderGlow.name = "garageAnchorShowroomCarUnderGlow";
  showroomUnderGlow.position.y = 0.04;
  showroomCarGlow.add(showroomUnderGlow, showroomCarBody, showroomCarCab);

  const service = new THREE.Mesh(
    new THREE.BoxGeometry(
      model.serviceBay.w,
      model.serviceBay.h,
      model.serviceBay.d,
    ),
    new THREE.MeshStandardMaterial({
      color: 0x46505d,
      roughness: 0.78,
      metalness: 0.08,
      emissive: 0x121a24,
      emissiveIntensity: 0.08,
    }),
  );
  service.name = "garageAnchorServiceBayBlock";
  service.position.set(
    model.serviceBay.x,
    model.serviceBay.y,
    model.serviceBay.z,
  );
  service.castShadow = true;
  service.receiveShadow = true;

  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(
      model.footprint.w * 0.86,
      0.16,
      // overhang the road frontage so the canted roof reads as a canopy, not a lid
      model.footprint.d * 0.78,
    ),
    new THREE.MeshStandardMaterial({
      color: 0x303845,
      roughness: 0.82,
      metalness: 0.06,
    }),
  );
  roof.name = "garageAnchorGraphiteFlatRoofCanopy";
  roof.position.set(0.12, model.serviceBay.h + 0.16, 0.02);
  // Spec 110 — MONO-SLOPE the roof (tilt toward the road) so the garage silhouette is no longer a flat
  // box lid; the canted plane + the cool glass below are the two non-orthogonal moves that break the
  // "detailed box" read the design critique flagged.
  roof.rotation.x = -0.19;
  roof.castShadow = true;

  const wrenchGroup = new THREE.Group();
  wrenchGroup.name = "garageAnchorRooftopWrenchEmblem";
  wrenchGroup.position.set(
    model.serviceBay.x + model.serviceBay.w * 0.04,
    model.serviceBay.h + 0.27,
    model.serviceBay.z - model.serviceBay.d * 0.04,
  );
  wrenchGroup.rotation.y = -0.28;
  const wrenchMat = new THREE.MeshStandardMaterial({
    color: 0x6fe7ff,
    emissive: 0x26c6ff,
    emissiveIntensity: 0.48,
    roughness: 0.28,
  });
  const wrenchHandle = new THREE.Mesh(
    new THREE.BoxGeometry(1.25, 0.08, 0.16),
    wrenchMat,
  );
  wrenchHandle.name = "garageAnchorRooftopWrenchHandle";
  const wrenchJaw = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, 0.08, 0.48),
    wrenchMat,
  );
  wrenchJaw.name = "garageAnchorRooftopWrenchJaw";
  wrenchJaw.position.x = 0.63;
  wrenchGroup.add(wrenchHandle, wrenchJaw);

  const doorMat = new THREE.MeshStandardMaterial({
    color: 0xd8e4ee,
    roughness: 0.5,
    metalness: 0.22,
    emissive: 0xffc36b,
    emissiveIntensity: 0.22,
  });
  const openBayIndex = 1; // Spec 110 — the road-facing middle bay is OPEN (a real recessed cavity you
  // can drive into); the other two stay closed. +z is the road frontage (group rotated by facingAngle).
  const bayFaceZ = model.serviceBay.z + model.serviceBay.d / 2 + 0.045;
  for (let i = 0; i < model.serviceBay.doorCount; i++) {
    const sx =
      model.serviceBay.x +
      (i - (model.serviceBay.doorCount - 1) / 2) *
        (model.serviceBay.bayDoorW * 1.25);
    const open = i === openBayIndex;
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(
        model.serviceBay.bayDoorW,
        open ? model.serviceBay.h * 0.14 : model.serviceBay.h * 0.68,
        0.075,
      ),
      doorMat,
    );
    door.name = `garageAnchorRollupDoor.${i + 1}`;
    door.position.set(
      sx,
      open ? model.serviceBay.h * 0.88 : model.serviceBay.h * 0.39,
      bayFaceZ,
    );
    g.add(door);
    if (open) {
      // recessed dark cavity set INTO the shed (a real opening, not a lifted door over a solid wall)
      const cavity = new THREE.Mesh(
        new THREE.BoxGeometry(
          model.serviceBay.bayDoorW * 1.05,
          model.serviceBay.h * 0.72,
          model.serviceBay.d * 0.52,
        ),
        new THREE.MeshStandardMaterial({
          color: 0x0a0f15,
          roughness: 0.95,
          emissive: 0x2b3a4a,
          emissiveIntensity: 0.18,
        }),
      );
      cavity.name = "garageAnchorOpenBayInterior";
      cavity.position.set(
        sx,
        model.serviceBay.h * 0.36,
        bayFaceZ - model.serviceBay.d * 0.27,
      );
      g.add(cavity);
      // apron/ramp continuing out of the bay toward the road — reads as drive-into-able and is the
      // corner-aligned approach the free-roam car will use (true drive-through gated on the Codex
      // carSpec hook; this lays the road-facing path + visual now).
      const apronMat = new THREE.MeshStandardMaterial({
        color: 0x3a3f4a,
        roughness: 0.7,
        emissive: 0xff9f2f,
        emissiveIntensity:
          garageAnchorNightFloorEmissive(C.state.clock.daylight) * 0.5,
      });
      C.garageFloorMats.push(apronMat);
      const apron = new THREE.Mesh(
        new THREE.BoxGeometry(
          model.serviceBay.bayDoorW * 1.35,
          0.04,
          model.serviceBay.d * 0.85,
        ),
        apronMat,
      );
      apron.name = "garageAnchorDriveInApronRamp";
      apron.position.set(
        sx,
        model.nightFloor.y + 0.02,
        bayFaceZ + model.serviceBay.d * 0.42,
      );
      g.add(apron);
    }
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(
        model.serviceBay.bayDoorW * 1.14,
        model.serviceBay.h * 0.77,
        0.04,
      ),
      new THREE.MeshStandardMaterial({
        color: 0xffb24a,
        emissive: 0xff8f2f,
        emissiveIntensity: 0.38,
        roughness: 0.36,
      }),
    );
    frame.name = `garageAnchorRollupDoorFrame.${i + 1}`;
    frame.position.set(
      door.position.x,
      door.position.y,
      door.position.z - 0.018,
    );
    g.add(frame);
    for (let slat = 1; slat <= 5 && !open; slat++) {
      const rib = new THREE.Mesh(
        new THREE.BoxGeometry(model.serviceBay.bayDoorW * 0.96, 0.025, 0.075),
        new THREE.MeshStandardMaterial({ color: 0x8fa1ad, roughness: 0.45 }),
      );
      rib.name = `garageAnchorDoorSlat.${i + 1}.${slat}`;
      rib.position.set(
        door.position.x,
        door.position.y + (slat - 3) * 0.25,
        door.position.z + 0.02,
      );
      g.add(rib);
    }
  }

  const pylonMat = new THREE.MeshStandardMaterial({
    color: 0xffb24a,
    emissive: 0xff8f2f,
    emissiveIntensity: 0.85,
    roughness: 0.32,
  });
  const pylon = new THREE.Mesh(
    new THREE.BoxGeometry(model.pylon.w, model.pylon.h, model.pylon.d),
    pylonMat,
  );
  pylon.name = "garageAnchorCornerPylonSign";
  pylon.position.set(model.pylon.x, model.pylon.y, model.pylon.z);
  pylon.castShadow = true;

  const pylonCap = new THREE.Mesh(
    new THREE.BoxGeometry(model.pylon.w * 2.35, 0.9, model.pylon.d * 1.35),
    pylonMat,
  );
  pylonCap.name = "garageAnchorPylonLightBox";
  pylonCap.position.set(model.pylon.x, model.pylon.h + 0.28, model.pylon.z);

  const pylonCyanPanel = new THREE.Mesh(
    new THREE.BoxGeometry(model.pylon.w * 1.45, 0.12, model.pylon.d * 1.52),
    new THREE.MeshStandardMaterial({
      color: 0x79edff,
      emissive: 0x35d8ff,
      emissiveIntensity: 0.74,
      roughness: 0.24,
    }),
  );
  pylonCyanPanel.name = "garageAnchorPylonCyanEdgePanel";
  pylonCyanPanel.position.set(
    model.pylon.x,
    model.pylon.h + 0.78,
    model.pylon.z,
  );

  const pylonRoadFace = new THREE.Mesh(
    new THREE.BoxGeometry(model.pylon.w * 1.9, model.pylon.h * 0.34, 0.08),
    new THREE.MeshStandardMaterial({
      color: 0xffcf74,
      emissive: 0xff9f2f,
      emissiveIntensity: 0.9,
      roughness: 0.26,
    }),
  );
  pylonRoadFace.name = "garageAnchorRoadFacingPylonSignFace";
  pylonRoadFace.position.set(
    model.pylon.x,
    model.pylon.h * 0.74,
    model.pylon.z + model.pylon.d * 0.78,
  );

  for (const [i, car] of model.displayCars.entries()) {
    const cg = new THREE.Group();
    cg.name = `garageAnchorDisplayCar.${i + 1}`;
    cg.position.set(car.x, 0.08, car.z);
    cg.rotation.y = car.rot;
    cg.scale.setScalar(car.scale);
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1.15, 0.22, 0.56),
      new THREE.MeshStandardMaterial({
        color: i === 0 ? 0x31d6ff : 0xff6b4a,
        roughness: 0.5,
      }),
    );
    body.position.y = 0.22;
    const cab = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.24, 0.42),
      new THREE.MeshStandardMaterial({
        color: 0xb9f1ff,
        emissive: 0x1f7d99,
        emissiveIntensity: 0.18,
      }),
    );
    cab.position.set(-0.05, 0.43, 0);
    const underGlow = new THREE.Mesh(
      new THREE.BoxGeometry(1.26, 0.025, 0.62),
      new THREE.MeshStandardMaterial({
        color: 0xffb24a,
        emissive: 0xff8f2f,
        emissiveIntensity: 0.62,
        transparent: true,
        opacity: 0.7,
      }),
    );
    underGlow.name = `garageAnchorDisplayCarUnderGlow.${i + 1}`;
    underGlow.position.y = 0.035;
    cg.add(underGlow, body, cab);
    g.add(cg);
  }

  g.add(
    floor,
    forecourt,
    forecourtLane,
    showroomInterior,
    showroom,
    showroomFront,
    showroomHeader,
    showroomCarSilhouette,
    showroomCarGlow,
    service,
    roof,
    wrenchGroup,
    pylon,
    pylonCap,
    pylonCyanPanel,
    pylonRoadFace,
  );
  C.group.add(g);
}

/** Raise a vibrant neon market stall on each surveyed shop plot: a dark counter body, a glowing
 *  awning canopy, and a bright signage panel facing the street. Disposes any prior build first. */
function buildCommercialDistrict(C: CommercialCtx): void {
  // Tear down a previous build (geometry + materials) so re-survey/reload never leaks GPU memory.
  for (const child of C.group.children) {
    child.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const disposeMat = (x: THREE.Material) => {
        (x as THREE.MeshStandardMaterial).map?.dispose();
        x.dispose();
      }; // free the board CanvasTextures too
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach(disposeMat);
      else if (mat) disposeMat(mat);
    });
  }
  C.group.clear();
  C.signMats = [];
  C.mallFloorMat = null;
  C.garageFloorMats = [];
  C.floorMats = [];
  C.labelMats = [];
  const d = C.district;
  if (!d) return;
  const t = C.state.terrain;

  buildMallAnchorShell(C, d);
  buildGarageAnchorShell(C, d);

  // Spec 143 — venue placements: ONE pure survey (venuePlacement.ts) decides each shop's
  // seat, facing, plot-filling footprint and entrance; the live junction zones carve
  // their no-build pads first so nothing stands inside a junction's bound. The runtime
  // (bar stools) and the node tests read the same survey — no per-renderer improvising.
  const pads = junctionZonesToPads(findJunctionZones(C.state.roadWays ?? []));
  const placements = surveyVenuePlacements(
    d,
    pads,
    venueRoadBlockedCells(C.state.roadWays, t),
  );
  d.parcels.forEach((p, i) => {
    buildShopVenue(C, p, placements[i]!, i);
  });

  for (const label of surveyBusinessLabels(d)) {
    const plate = makeCommercialBusinessLabel(C, label);
    if (plate) C.group.add(plate);
  }

  // 086-P1 polish — a seaside PROMENADE: warm lamp posts line the high street on alternating verges,
  // glowing after dark so the coastal strip by the lighthouse reads as a lit boardwalk. Cheap static
  // posts; the head emissive stays below the bloom threshold (warmth, not a halo). Disposed with the
  // group on rebuild like every other commercial mesh.
  const street = d.street;
  if (street.length > 0) {
    const poleMat = new THREE.MeshStandardMaterial({
      color: 0x2f343d,
      roughness: 0.7,
    });
    const headMat = new THREE.MeshStandardMaterial({
      color: 0xffe6b0,
      emissive: 0xffd9a0,
      emissiveIntensity: 0.82,
      roughness: 0.4,
    }); // warm, but under the 0.9 bloom threshold
    for (let i = 0; i < street.length; i += 5) {
      const c = street[i]!;
      const by = Math.max(0, t.worldY(Math.round(c.x), Math.round(c.y)));
      const side = Math.floor(i / 5) % 2 === 0 ? 1 : -1; // alternate verges down the strip
      const lamp = new THREE.Group();
      // Spec 143 — the verge starts past the RIBBON edge (the 4-cell way is 8 m half-
      // width); the old 1.4-cell offset planted every pole on the carriageway.
      lamp.position.set(C.wx(c.x), by, C.wz(c.y + side * 2.35));
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.09, 3.2, 6),
        poleMat,
      );
      pole.position.y = 1.6;
      pole.castShadow = true;
      const arm = new THREE.Mesh(
        new THREE.BoxGeometry(0.09, 0.09, 0.7),
        poleMat,
      );
      arm.position.set(0, 3.2, side * 0.3);
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.24, 8, 6),
        headMat,
      );
      head.position.set(0, 3.15, side * 0.62);
      lamp.add(pole, arm, head);
      C.group.add(lamp);
    }
    // promenade FURNITURE between the lamps — a few benches + leafy planters on the verges so the
    // strip feels strolled, not just lit. Placed on a different phase/offset from the lamps.
    const woodMat = new THREE.MeshStandardMaterial({
      color: 0x6b4a2f,
      roughness: 0.85,
    });
    const legMat = new THREE.MeshStandardMaterial({
      color: 0x3a3f4a,
      roughness: 0.7,
    });
    const planterMat = new THREE.MeshStandardMaterial({
      color: 0x8a6a44,
      roughness: 0.9,
    });
    const leafMat = new THREE.MeshStandardMaterial({
      color: 0x3fae5a,
      roughness: 0.8,
    });
    for (let i = 3; i < street.length; i += 8) {
      const c = street[i]!;
      const by = Math.max(0, t.worldY(Math.round(c.x), Math.round(c.y)));
      const side = Math.floor(i / 8) % 2 === 0 ? -1 : 1; // opposite phase to the lamps
      const fz = C.wz(c.y + side * 2.35); // spec 143 — past the ribbon edge, like the lamps
      // a bench facing the street (backrest on the verge side), sized for the 1.8 m citizen
      const bench = new THREE.Group();
      bench.position.set(C.wx(c.x), by, fz);
      const seat = new THREE.Mesh(
        new THREE.BoxGeometry(1.8, 0.12, 0.55),
        woodMat,
      );
      seat.position.y = 0.45;
      seat.castShadow = true;
      const back = new THREE.Mesh(
        new THREE.BoxGeometry(1.8, 0.5, 0.09),
        woodMat,
      );
      back.position.set(0, 0.75, side * 0.24);
      for (const lx of [-0.72, 0.72]) {
        const leg = new THREE.Mesh(
          new THREE.BoxGeometry(0.12, 0.45, 0.5),
          legMat,
        );
        leg.position.set(lx, 0.225, 0);
        bench.add(leg);
      }
      bench.add(seat, back);
      C.group.add(bench);
      // a leafy planter just along from the bench
      const planter = new THREE.Group();
      planter.position.set(C.wx(c.x + 1.1), by, fz);
      const tub = new THREE.Mesh(
        new THREE.CylinderGeometry(0.4, 0.32, 0.5, 10),
        planterMat,
      );
      tub.position.y = 0.25;
      tub.castShadow = true;
      const bush = new THREE.Mesh(
        new THREE.SphereGeometry(0.42, 8, 7),
        leafMat,
      );
      bush.position.y = 0.85;
      planter.add(tub, bush);
      C.group.add(planter);
    }
    // Spec 081 P0 — AD BOARDS at the strip approaches. Each board is a post pair + frame + a screen
    // plane carrying a CanvasTexture painted by adCanvas (a deterministic poster for one real shop, or
    // the welcome PSA when none). Placement is the pure surveyBillboards (collision-checked against
    // roads + shop footprints); the screen faces inward down the strip and glows softly after dark
    // (emissive under the bloom threshold). Disposed with the group — texture too (see the teardown).
    const boardBlocked = new Set<string>(C.state.roadSet);
    for (const p of d.parcels)
      for (let yy = p.y; yy < p.y + p.h; yy++)
        for (let xx = p.x; xx < p.x + p.w; xx++)
          boardBlocked.add(`${xx},${yy}`);
    const shopById = new Map(d.parcels.map((p) => [p.id, p]));
    const postMat = new THREE.MeshStandardMaterial({
      color: 0x3a3f4a,
      roughness: 0.7,
    });
    for (const site of surveyBillboards(d, t, boardBlocked)) {
      const by = Math.max(0, t.worldY(Math.round(site.x), Math.round(site.y)));
      const grp = new THREE.Group();
      grp.position.set(C.wx(site.x), by, C.wz(site.y));
      grp.rotation.y = site.faceX === 1 ? Math.PI / 2 : -Math.PI / 2; // a +z plane turned to face along the street
      for (const px of [-2.0, 2.0]) {
        const post = new THREE.Mesh(
          new THREE.CylinderGeometry(0.12, 0.15, 4.2, 6),
          postMat,
        );
        post.position.set(px, 2.1, 0);
        post.castShadow = true;
        grp.add(post);
      }
      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(5.2, 3.0, 0.3),
        postMat,
      );
      frame.position.set(0, 4.6, 0);
      frame.castShadow = true;
      grp.add(frame);
      const shop = site.shopId ? shopById.get(site.shopId) : undefined;
      if (typeof document === "undefined") continue; // headless: frame without poster
      const cv = document.createElement("canvas");
      cv.width = 256;
      cv.height = 160;
      const ctx = cv.getContext("2d");
      if (ctx)
        paintPoster(ctx, posterModel(shop?.business), cv.width, cv.height);
      const tex = new THREE.CanvasTexture(cv);
      const screen = new THREE.Mesh(
        new THREE.PlaneGeometry(4.8, 2.85),
        new THREE.MeshStandardMaterial({
          map: tex,
          emissive: 0xffffff,
          emissiveMap: tex,
          emissiveIntensity: 0.35,
          roughness: 0.6,
        }),
      );
      screen.position.set(0, 4.6, 0.17);
      grp.add(screen);
      C.group.add(grp);
    }
  }
}

/** Spec 143 — one venue: a plot-filling, road-facing building massing seated on the pad
 *  seat, its storefront life on the frontage strip between the building face and the
 *  carriageway edge. Primitive massing today; Jack's venue GLB drops in at the same
 *  (origin, seatY, facing) via the userData.venue contract. */
function buildShopVenue(
  C: CommercialCtx,
  p: ShopParcel,
  place: VenuePlacement,
  i: number,
): void {
  const t = C.state.terrain;
  // Spec 079 — each plot fronts a real kooker app: its business sets the neon palette, a
  // rooftop emblem, and (the Nearest bar) a counter + stools where bots can sit. Plots
  // stay for-sale.
  const biz = p.business ? BUSINESSES[p.business] : undefined;
  const neon = biz?.palette ?? NEON[i % NEON.length]!;
  const massing = commercialShopMassing(p, biz, i, place);
  const wallH = massing.wallHeight;
  const bodyW = massing.bodyW;
  const bodyD = massing.bodyD;

  // The ONE seat formula (spec 128) — the venue seats at EXACTLY the height the terrain
  // leveling grades its parcel pad to. (Was a lowest-corner sample of a leveling map
  // baked at layer build time — stale the moment roads regraded, hence floating shops.)
  const baseY = venueSeatY(t, place);
  let rawLoY = Infinity;
  for (const fx of [p.x, p.x + p.w - 1])
    for (const fy of [p.y, p.y + p.h - 1]) {
      const rawH = t.worldY(fx, fy);
      if (rawH < rawLoY) rawLoY = rawH;
    }
  // Coastal dry seat: the pad is raised out of the sea by the leveling (spec 105) — thin
  // plinth + colour-matched walls so night views read grounded mass, not a black table.
  const coastalDriedSeat = rawLoY < RENDER_DRY_FLOOR;

  const g = new THREE.Group();
  g.name = `venue.${p.id}.${biz?.id ?? "open"}`;
  g.userData = {
    parcelId: p.id,
    businessId: biz?.id,
    businessName: biz?.name,
    massing: massing.signatureKey,
    // The GLB swap-in contract (spec 143): mount a venue GLB at exactly this transform
    // and it stands where the primitive massing stands today.
    venue: {
      venueType: place.venueType,
      seatY: baseY,
      facing: place.facing,
      footprint: { ...place.footprint },
      entrance: { ...place.entrance },
      frontStripM: place.frontStripM,
      buildable: place.buildable,
    },
  };
  g.position.set(C.wx(place.centerGX), baseY, C.wz(place.centerGY));
  // Local +z faces the fronting road: every storefront feature below builds street-side
  // at +z and this one rotation turns the whole venue toward its street.
  g.rotation.y = place.facing;
  C.group.add(g);

  // Neon night floor — the glowing plot pad. An unbuildable parcel (swallowed by a
  // junction pad's bound) stays an open glowing forecourt with market crates: land the
  // economy can still sell, with nothing standing inside the junction's clearance.
  const floorMat = new THREE.MeshStandardMaterial({
    color: neon,
    emissive: neon,
    emissiveIntensity: commercialShopNightFloorEmissive(C.state.clock.daylight),
    roughness: 0.55,
    transparent: true,
    opacity: 0.52,
  });
  C.floorMats.push(floorMat);
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(
      place.buildable ? bodyW * 1.06 : 8,
      0.035,
      place.buildable ? bodyD * 1.06 : 8,
    ),
    floorMat,
  );
  floor.name = "commercialShopNightFloor";
  floor.position.y = 0.04;
  g.add(floor);

  const crateMat = new THREE.MeshStandardMaterial({
    color: 0x7a5a36,
    roughness: 0.9,
  });
  if (!place.buildable) {
    for (let k = 0; k < 3; k++) {
      const cs = 0.7 + k * 0.15;
      const crate = new THREE.Mesh(new THREE.BoxGeometry(cs, cs, cs), crateMat);
      crate.position.set(-2.2 + k * 1.6, cs / 2, k === 1 ? 1.2 : -0.8);
      crate.castShadow = true;
      g.add(crate);
    }
    return;
  }

  // Foundation plinth — fills the gap between the seat and the natural ground below the
  // footprint on slopes; coastal dry seats keep it thin (the blended terrain grounds
  // them — a full-depth dark plinth reads as the black floating table we removed).
  const foundH = coastalDriedSeat
    ? 0.24
    : Math.max(0.6, baseY - Math.max(rawLoY, 0) + 0.6);
  const found = new THREE.Mesh(
    new THREE.BoxGeometry(bodyW * 1.02, foundH, bodyD * 1.02),
    new THREE.MeshStandardMaterial({
      color: coastalDriedSeat ? 0x536b3a : 0x2a2f38,
      roughness: 0.9,
    }),
  );
  found.position.y = -foundH / 2 + 0.02;
  found.castShadow = true;
  g.add(found);

  // Body — the swappable venue SHELL (the e2e asserts its bbox seats on the pad; a venue
  // GLB replaces exactly this node's volume).
  const coastalWall = new THREE.Color(neon).lerp(
    new THREE.Color(0x536b3a),
    0.45,
  );
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(bodyW, wallH, bodyD),
    new THREE.MeshStandardMaterial({
      color: coastalDriedSeat ? coastalWall : 0x2b3040,
      roughness: 0.7,
      metalness: coastalDriedSeat ? 0.04 : 0.1,
      emissive: coastalDriedSeat ? coastalWall : 0x000000,
      emissiveIntensity: coastalDriedSeat ? 0.12 : 0,
    }),
  );
  body.name = "venueShell";
  body.position.y = wallH / 2;
  body.castShadow = true;
  body.receiveShadow = true;

  // Roof form — per-business massing turns adjacent shops into distinct silhouettes.
  const roof = buildCommercialShopRoof(C, massing, neon, coastalDriedSeat);
  roof.name = `commercialShopRoof.${massing.roofForm}`;
  roof.position.y = wallH + massing.roofRise / 2;

  // Awning — a neon canopy oversailing the frontage strip (the strip is FRONT_STRIP_M
  // deep by survey, so the canopy and everything under it clears the carriageway by
  // construction).
  const canopy = new THREE.Mesh(
    new THREE.BoxGeometry(bodyW * 0.92, 0.18, 2.1),
    new THREE.MeshStandardMaterial({
      color: neon,
      roughness: 0.4,
      emissive: neon,
      emissiveIntensity: 0.45,
    }),
  );
  canopy.name = "commercialShopCanopy";
  canopy.position.set(0, Math.min(wallH * 0.88, 3.4), bodyD / 2 + 1.05);
  canopy.castShadow = true;

  // Fascia sign — a lit band above the street face.
  const signMat = new THREE.MeshStandardMaterial({
    color: neon,
    emissive: neon,
    emissiveIntensity: 0.7,
    roughness: 0.3,
  });
  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(bodyW * massing.signWidthScale, 1.5, 0.25),
    signMat,
  );
  sign.name = "commercialShopSign";
  sign.position.set(0, wallH + 0.95, bodyD / 2 + 0.15);
  C.signMats.push(signMat);
  g.add(body, roof, canopy, sign);

  // Storefront (spec 092 lineage, now metric): warm window bays flanking a WALK-IN door
  // at the surveyed entrance cell — 2.5 m tall on a 3.5 m storey, sized for the 1.8 m
  // citizen of the scale constitution.
  const faceZ = bodyD / 2 + 0.06;
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xffe6b0,
    emissive: 0xffca78,
    emissiveIntensity: 0.6,
    roughness: 0.3,
  });
  const doorX = place.entrance.localX;
  const bays = Math.max(2, Math.round(bodyW / 3.6) + (massing.windowCount - 2));
  const bayStep = bodyW / (bays + 1);
  for (let wi = 1; wi <= bays; wi++) {
    const sx = -bodyW / 2 + wi * bayStep;
    if (Math.abs(sx - doorX) < DOOR_W_M * 1.1) continue; // the door owns its bay
    const win = new THREE.Mesh(
      new THREE.BoxGeometry(Math.min(2.2, bayStep * 0.62), 1.7, 0.12),
      glassMat,
    );
    win.position.set(sx, 1.55, faceZ);
    g.add(win);
    if (wallH >= 6) {
      const up = new THREE.Mesh(
        new THREE.BoxGeometry(Math.min(2.0, bayStep * 0.55), 1.5, 0.12),
        glassMat,
      );
      up.position.set(sx, wallH - 1.85, faceZ);
      g.add(up);
    }
  }
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(DOOR_W_M, DOOR_H_M, 0.14),
    new THREE.MeshStandardMaterial({
      color: 0x15181f,
      roughness: 0.6,
      metalness: 0.2,
    }),
  );
  door.name = "venueEntranceDoor";
  door.position.set(doorX, DOOR_H_M / 2, faceZ);
  g.add(door);
  const transom = new THREE.Mesh(
    new THREE.BoxGeometry(DOOR_W_M * 1.2, 0.5, 0.1),
    glassMat,
  );
  transom.position.set(doorX, DOOR_H_M + 0.35, faceZ);
  g.add(transom);

  // Awning posts + goods crates only where there's no bar counter (the seating venue
  // fills its frontage strip with the counter instead).
  if (!biz?.seating) {
    const postMat = new THREE.MeshStandardMaterial({
      color: 0x20242c,
      roughness: 0.6,
      metalness: 0.3,
    });
    for (const sx of [-bodyW * 0.44, bodyW * 0.44]) {
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.1, 3.0, 8),
        postMat,
      );
      post.position.set(sx, 1.5, bodyD / 2 + 1.9);
      post.castShadow = true;
      g.add(post);
    }
    for (let k = 0; k < 2; k++) {
      const cs = 0.8 + k * 0.18;
      const crate = new THREE.Mesh(new THREE.BoxGeometry(cs, cs, cs), crateMat);
      crate.position.set(
        -bodyW * 0.36 + k * 0.5,
        cs / 2,
        bodyD / 2 + 1.15 - k * 0.5,
      );
      crate.castShadow = true;
      g.add(crate);
    }
  }

  // Rooftop emblem — a distinct shape per business so the app reads at a glance.
  if (biz) {
    const em = makeBusinessEmblem(C, biz.emblem, neon);
    em.scale.setScalar(3);
    em.position.y = wallH + massing.roofRise + 0.3;
    g.add(em);
  }

  // The bar's seating: counter + stools on the frontage strip. The stool spots are the
  // SHARED formula (venuePlacement.barStoolGridPositions) — runtime.wanderIdleCitizens
  // sends sitters to EXACTLY these positions, so the local math here mirrors it by
  // construction (same constants, same local frame). Stools stay empty here: live
  // citizens claim them after dark, so no static patron meshes.
  if (biz?.seating) {
    const counterW = Math.min(bodyW * 0.7, 7.2);
    const counter = new THREE.Mesh(
      new THREE.BoxGeometry(counterW, 1.05, 0.6),
      new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.85 }),
    );
    counter.position.set(doorX, 0.525, bodyD / 2 + BAR_COUNTER_OFF_M);
    counter.castShadow = true;
    g.add(counter);
    const stoolMat = new THREE.MeshStandardMaterial({
      color: 0x3a3f4a,
      roughness: 0.7,
    });
    const n = 3;
    for (let k = 0; k < n; k++) {
      const sx = doorX + (k - (n - 1) / 2) * BAR_STOOL_SPACING_M;
      const stool = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.24, 0.65, 10),
        stoolMat,
      );
      stool.name = `venueBarStool.${k}`;
      // SIT anchor (spec 143): the venue GLB carries SIT.<n> empties at these spots;
      // 0.65 m seat height suits the Citizen_sit pose of the scale constitution.
      stool.userData.sit = { anchor: `SIT.${k}` };
      stool.position.set(sx, 0.325, bodyD / 2 + BAR_STOOL_OFF_M);
      stool.castShadow = true;
      g.add(stool);
    }
    // Joe the Crab tends the Nearest — behind the counter on a duckboard riser, facing
    // the street across it (local +z IS the street side, so no flip logic anymore).
    const riser = 0.7;
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(counterW * 0.6, riser, 0.9),
      new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.9 }),
    );
    board.position.set(doorX, riser / 2, bodyD / 2 + 0.35);
    g.add(board);
    const keeper = new THREE.Mesh(
      buildCrabGeometry(),
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        flatShading: true,
        roughness: 0.6,
        metalness: 0.05,
      }),
    );
    keeper.scale.setScalar(2.6);
    keeper.position.set(doorX, riser, bodyD / 2 + 0.35);
    keeper.castShadow = true;
    g.add(keeper);
  }

  // Signature props give each marquee app a distinct, recognisable place.
  if (biz) g.add(buildBusinessProps(biz, bodyW, bodyD, wallH));
}

function applyCommercialLabelVisibility(C: CommercialCtx) {
  const night = C.labelNight;
  for (const entry of C.labelMats) {
    const opacity = labelOpacityForVisibility(
      entry.model,
      entry.visibilityOpacity,
      night,
    );
    entry.sprite.opacity = opacity.spriteOpacity;
    entry.floor.opacity = opacity.floorOpacity;
  }
}

function updateCommercialBusinessLabels(C: CommercialCtx) {
  if (C.labelMats.length === 0) return;
  const width = Math.max(1, C.canvas.clientWidth);
  const height = Math.max(1, C.canvas.clientHeight);
  const candidates: BusinessLabelDeclutterInput[] = [];
  const occluders = commercialLabelOccluders(C);
  for (const entry of C.labelMats) {
    entry.group.getWorldPosition(SCRATCH.world);
    SCRATCH.projection.copy(SCRATCH.world).project(C.camera);
    const distance = C.camera.position.distanceTo(SCRATCH.world);
    candidates.push({
      label: entry.model,
      screenX: (SCRATCH.projection.x + 1) * 0.5 * width,
      screenY: (1 - SCRATCH.projection.y) * 0.5 * height,
      distance,
      occluded:
        SCRATCH.projection.z < -1 ||
        SCRATCH.projection.z > 1 ||
        Math.abs(SCRATCH.projection.x) > BUSINESS_LABEL_VIEWPORT_NDC_LIMIT ||
        Math.abs(SCRATCH.projection.y) > BUSINESS_LABEL_VIEWPORT_NDC_LIMIT ||
        commercialLabelOccluded(C, occluders, distance),
    });
  }
  const visibility = declutterBusinessLabels(candidates);
  for (const entry of C.labelMats) {
    const state = visibility.find((item) => item.shopId === entry.model.shopId);
    entry.group.visible = Boolean(state?.visible);
    entry.visibilityOpacity = state?.visible ? state.opacity : 0;
  }
  applyCommercialLabelVisibility(C);
}

function commercialLabelOccluders(C: CommercialCtx) {
  // v3 perf (spec 135): occluders are the DISTRICT's own meshes, not the whole scene —
  // legacy traversed the full scene, which in v3 means raycasting the 76k-instance
  // foliage and the 370k-vertex terrain chunks per label per update. Shops occluding
  // their neighbours' labels is the case that matters; a label behind a distant hill
  // staying faintly visible is an acceptable trade.
  const occluders: THREE.Object3D[] = [];
  C.group.traverse((object) => {
    if (object.type !== "Mesh") return;
    if (isCommercialLabelObject(C, object)) return;
    occluders.push(object);
  });
  return occluders;
}

function commercialLabelOccluded(
  C: CommercialCtx,
  occluders: readonly THREE.Object3D[],
  distance: number,
) {
  if (distance <= 1.4 || occluders.length === 0) return false;
  SCRATCH.direction.copy(SCRATCH.world).sub(C.camera.position).normalize();
  SCRATCH.raycaster.set(C.camera.position, SCRATCH.direction);
  SCRATCH.raycaster.far = Math.max(0.1, distance - 1.2);
  return SCRATCH.raycaster.intersectObjects([...occluders], false).length > 0;
}

function isCommercialLabelObject(C: CommercialCtx, object: THREE.Object3D) {
  for (
    let cursor: THREE.Object3D | null = object;
    cursor;
    cursor = cursor.parent
  ) {
    if (cursor.name.startsWith("commercial-label-")) return true;
  }
  return false;
}

function makeCommercialBusinessLabel(
  C: CommercialCtx,
  label: BusinessLabel,
): THREE.Object3D | null {
  if (typeof document === "undefined") return null; // headless (node tests) draw no label canvases
  if (!isPublicSafe(label.text)) return null;
  const group = new THREE.Group();
  group.name = `commercial-label-${label.shopId}`;
  group.position.set(
    C.wx(label.x),
    // Pad-seat parity: label.x/y is the parcel centre, so the centre sample IS the
    // padSeatY of the parcel (spec 128) — the plate rides the graded pad, not a stale
    // baked surface.
    Math.max(C.state.terrain.worldYAt(label.x, label.y), RENDER_DRY_FLOOR) +
      label.height,
    C.wz(label.y),
  );

  const cv = document.createElement("canvas");
  cv.width = 512;
  cv.height = 160;
  const ctx = cv.getContext("2d");
  if (!ctx) return null;
  const accent = `#${label.color.toString(16).padStart(6, "0")}`;
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = "rgba(5, 8, 18, 0.86)";
  ctx.fillRect(18, 22, cv.width - 36, cv.height - 44);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 8;
  ctx.strokeRect(22, 26, cv.width - 44, cv.height - 52);
  ctx.fillStyle = accent;
  ctx.fillRect(42, 122, cv.width - 84, 8);
  ctx.fillStyle = "#fff5d6";
  ctx.font = "700 38px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = accent;
  ctx.shadowBlur = 14;
  ctx.fillText(label.text, cv.width / 2, cv.height / 2, cv.width - 78);
  ctx.shadowBlur = 0;

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const spriteMat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    opacity: label.nightEmissiveFloor,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
  });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.scale.set(7.5, 2.4, 1);
  sprite.name = label.text;
  sprite.renderOrder = 30;

  const floorMat = new THREE.MeshBasicMaterial({
    color: label.color,
    transparent: true,
    opacity: label.nightEmissiveFloor * 0.28,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(3.2, 24), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -(label.height - 0.1); // the glow ring lies on the pad below
  floor.renderOrder = 29;
  group.add(floor, sprite);
  C.labelMats.push({
    group,
    sprite: spriteMat,
    floor: floorMat,
    model: label,
    visibilityOpacity: 1,
  });
  return group;
}

/** Signature props for a marquee storefront, positioned in the venue's LOCAL frame
 *  (+z = the frontage strip toward the street; metres). Keeps each app's site
 *  recognisable from afar; everything street-side sits within the ~3 m strip so no
 *  prop ever stands on the carriageway. */
function buildBusinessProps(
  biz: Business,
  bodyW: number,
  bodyD: number,
  wallH: number,
): THREE.Object3D {
  const grp = new THREE.Group();
  const glow = (hex: number, ei = 0.5) =>
    new THREE.MeshStandardMaterial({
      color: hex,
      emissive: hex,
      emissiveIntensity: ei,
      roughness: 0.4,
    });
  const matte = (hex: number) =>
    new THREE.MeshStandardMaterial({ color: hex, roughness: 0.8 });
  const stripZ = bodyD / 2 + 1.6; // mid frontage strip
  if (biz.id === "nearest_bar") {
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 3.0, 6),
      matte(0x9aa3b2),
    );
    mast.position.set(bodyW * 0.35, wallH + 1.5, -bodyD * 0.3);
    const dish = new THREE.Mesh(
      new THREE.ConeGeometry(0.95, 0.6, 18, 1, true),
      glow(biz.palette, 0.7),
    );
    dish.position.set(bodyW * 0.35, wallH + 3.15, -bodyD * 0.3);
    dish.rotation.x = Math.PI * 0.8;
    grp.add(mast, dish);
    const vials = [0xff2d95, 0x18e0ff, 0xffc233, 0x7bff4d];
    vials.forEach((cv, k) => {
      const v = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.15, 0.9, 8),
        glow(cv, 0.85),
      );
      v.position.set((k - 1.5) * 0.55, wallH + 0.75, bodyD * 0.3);
      grp.add(v);
    });
    [0.9, 1.5, 1.2, 1.8].forEach((h, k) => {
      const b = new THREE.Mesh(
        new THREE.BoxGeometry(0.25, h, 0.2),
        glow(biz.palette, 0.6),
      );
      b.position.set(-bodyW / 2 - 0.5, h / 2 + 0.6, (k - 1.5) * 0.4);
      grp.add(b);
    });
  } else if (biz.id === "sprout_nursery") {
    // A lush nursery: a terracotta trough of flowering sprouts, potted bushes flanking
    // the door, a leafy trellis arch over the entrance, and shrubs on the roof.
    const leaf = matte(0x3fae5a),
      leafDk = matte(0x2f8f49),
      terra = matte(0xb5663a);
    const blooms = [0xff7eb6, 0xffd23f, 0xf6f6f6, 0xff5ca8, 0x7bd0ff];
    const trough = new THREE.Mesh(
      new THREE.BoxGeometry(bodyW * 0.8, 0.5, 0.8),
      terra,
    );
    trough.position.set(0, 0.25, stripZ);
    grp.add(trough);
    for (let k = 0; k < 5; k++) {
      const stem = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.0, 7), leaf);
      stem.position.set((k - 2) * bodyW * 0.15, 1.0, stripZ);
      grp.add(stem);
      const bloom = new THREE.Mesh(
        new THREE.SphereGeometry(0.2, 8, 6),
        glow(blooms[k % blooms.length]!, 0.3),
      );
      bloom.position.set((k - 2) * bodyW * 0.15, 1.6, stripZ);
      grp.add(bloom);
    }
    for (const sx of [-bodyW * 0.3, bodyW * 0.3]) {
      const pot = new THREE.Mesh(
        new THREE.CylinderGeometry(0.36, 0.28, 0.55, 10),
        terra,
      );
      pot.position.set(sx, 0.275, bodyD / 2 + 0.8);
      grp.add(pot);
      const bush = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 7), leafDk);
      bush.position.set(sx, 0.95, bodyD / 2 + 0.8);
      grp.add(bush);
    }
    const archMat = matte(0xd8d2c4);
    for (const sx of [-1.5, 1.5]) {
      const post = new THREE.Mesh(
        new THREE.BoxGeometry(0.15, 2.7, 0.15),
        archMat,
      );
      post.position.set(sx, 1.35, bodyD / 2 + 0.5);
      grp.add(post);
    }
    const archTop = new THREE.Mesh(
      new THREE.BoxGeometry(3.2, 0.15, 0.15),
      archMat,
    );
    archTop.position.set(0, 2.7, bodyD / 2 + 0.5);
    grp.add(archTop);
    for (let k = 0; k < 4; k++) {
      const vine = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 5), leaf);
      vine.position.set((k - 1.5) * 0.9, 2.65, bodyD / 2 + 0.5);
      grp.add(vine);
    }
    for (const sx of [-bodyW * 0.3, bodyW * 0.3]) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 7), leafDk);
      s.position.set(sx, wallH + 0.55, -bodyD * 0.15);
      grp.add(s);
    }
  } else if (biz.id === "sportifine_club") {
    // A proper club: a green practice pitch with goal + ball, floodlight poles, a stepped
    // grandstand along the side, and a corner flag in the club colour.
    const pitch = new THREE.Mesh(
      new THREE.BoxGeometry(bodyW * 0.8, 0.06, 2.4),
      matte(0x2e8b3e),
    );
    pitch.position.set(0, 0.03, bodyD / 2 + 1.5);
    grp.add(pitch);
    const postMat = glow(0xf6f6f6, 0.2);
    const goalZ = bodyD / 2 + 2.3;
    const gl = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.5, 0.12), postMat);
    gl.position.set(-1.4, 0.75, goalZ);
    const gr = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.5, 0.12), postMat);
    gr.position.set(1.4, 0.75, goalZ);
    const gt = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.12, 0.12), postMat);
    gt.position.set(0, 1.5, goalZ);
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 10, 8),
      matte(0xf0f0f0),
    );
    ball.position.set(0.4, 0.3, bodyD / 2 + 1.2);
    grp.add(gl, gr, gt, ball);
    const poleMat = matte(0x9aa3b2);
    for (const sx of [-bodyW * 0.42, bodyW * 0.42]) {
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.12, 4.6, 6),
        poleMat,
      );
      pole.position.set(sx, 2.3, bodyD / 2 + 2.1);
      grp.add(pole);
      const lamp = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 0.35, 0.2),
        glow(0xfff3c0, 0.7),
      );
      lamp.position.set(sx, 4.5, bodyD / 2 + 2.1);
      grp.add(lamp);
    }
    const standMat = matte(biz.palette);
    for (let s = 0; s < 3; s++) {
      const step = new THREE.Mesh(
        new THREE.BoxGeometry(2.4, 0.4, 0.6),
        standMat,
      );
      step.position.set(
        -bodyW / 2 - 0.55,
        0.2 + s * 0.4,
        bodyD / 2 - 1.2 + s * 0.62,
      );
      grp.add(step);
    }
    const flagPole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 1.4, 5),
      poleMat,
    );
    flagPole.position.set(bodyW * 0.38, 0.7, bodyD / 2 + 1.1);
    grp.add(flagPole);
    const flag = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.35, 0.06),
      glow(biz.palette, 0.5),
    );
    flag.position.set(bodyW * 0.38 + 0.3, 1.2, bodyD / 2 + 1.1);
    grp.add(flag);
  } else if (biz.id === "chef_market") {
    // A restaurant-market: striped awning, produce stall, glowing grill under a smoking
    // chimney, an outdoor bistro table, and the kettlebell nod to the exercise side.
    const wood = matte(0x9c6b3f);
    const awning = new THREE.Mesh(
      new THREE.BoxGeometry(bodyW * 0.98, 0.16, 1.9),
      glow(0xff6a3d, 0.4),
    );
    awning.position.set(0, Math.min(wallH * 0.8, 3.1), bodyD / 2 + 0.95);
    awning.rotation.x = 0.22;
    grp.add(awning);
    const produce = [0xe23b2f, 0x7bff4d, 0xffc233];
    for (let k = 0; k < 3; k++) {
      const cr = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), wood);
      cr.position.set((k - 1) * 1.05, 0.35, bodyD / 2 + 2.1);
      grp.add(cr);
      for (let j = 0; j < 3; j++) {
        const f = new THREE.Mesh(
          new THREE.SphereGeometry(0.16, 6, 5),
          matte(produce[k % 3]!),
        );
        f.position.set((k - 1) * 1.05 + (j - 1) * 0.2, 0.79, bodyD / 2 + 2.1);
        grp.add(f);
      }
    }
    const grill = new THREE.Mesh(
      new THREE.BoxGeometry(1.0, 0.6, 0.8),
      matte(0x3a3f4a),
    );
    grill.position.set(bodyW * 0.3, 0.3, bodyD / 2 + 1.6);
    grp.add(grill);
    const embers = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.12, 0.7),
      glow(0xff5a1f, 0.7),
    );
    embers.position.set(bodyW * 0.3, 0.66, bodyD / 2 + 1.6);
    grp.add(embers);
    const chimney = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.25, 1.5, 8),
      matte(0x5a5f6a),
    );
    chimney.position.set(-bodyW * 0.28, wallH + 0.75, -bodyD * 0.2);
    grp.add(chimney);
    for (let k = 0; k < 3; k++) {
      const puff = new THREE.Mesh(
        new THREE.SphereGeometry(0.3 + k * 0.08, 6, 5),
        matte(0xcfd3da),
      );
      puff.position.set(-bodyW * 0.28, wallH + 1.8 + k * 0.6, -bodyD * 0.2);
      grp.add(puff);
    }
    const table = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.5, 0.1, 12),
      wood,
    );
    table.position.set(-bodyW * 0.3, 0.95, bodyD / 2 + 1.9);
    const leg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 0.95, 6),
      matte(0x5a5f6a),
    );
    leg.position.set(-bodyW * 0.3, 0.475, bodyD / 2 + 1.9);
    grp.add(table, leg);
    for (const sx of [-0.7, 0.7]) {
      const stool = new THREE.Mesh(
        new THREE.CylinderGeometry(0.2, 0.2, 0.65, 8),
        matte(0x3a3f4a),
      );
      stool.position.set(-bodyW * 0.3 + sx, 0.325, bodyD / 2 + 2.0);
      grp.add(stool);
    }
    const kb = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 8, 7),
      matte(0x2b3040),
    );
    kb.position.set(bodyW * 0.32, 0.28, bodyD / 2 + 2.4);
    const handle = new THREE.Mesh(
      new THREE.TorusGeometry(0.15, 0.045, 6, 10, Math.PI),
      matte(0x2b3040),
    );
    handle.position.set(bodyW * 0.32, 0.52, bodyD / 2 + 2.4);
    grp.add(kb, handle);
  } else {
    const featureMat = glow(biz.palette, 0.55);
    const sideX = bodyW * 0.38;
    if (biz.id === "citylife_garage") {
      const bay = new THREE.Mesh(
        new THREE.BoxGeometry(bodyW * 0.42, 3.2, 0.25),
        matte(0x1d222b),
      );
      bay.position.set(-bodyW * 0.18, 1.6, bodyD / 2 + 0.12);
      const wrench = new THREE.Mesh(
        new THREE.BoxGeometry(1.7, 0.25, 0.25),
        featureMat,
      );
      wrench.position.set(sideX, wallH + 0.6, 0);
      grp.add(bay, wrench);
    } else if (biz.id === "mojojo_records") {
      const disc = new THREE.Mesh(
        new THREE.TorusGeometry(0.8, 0.18, 10, 18),
        featureMat,
      );
      disc.position.set(-sideX, wallH + 0.5, 0);
      disc.rotation.x = Math.PI / 2;
      const booth = new THREE.Mesh(
        new THREE.BoxGeometry(1.5, 0.95, 1.0),
        matte(0x20242c),
      );
      booth.position.set(bodyW * 0.28, 0.475, bodyD / 2 + 1.7);
      grp.add(disc, booth);
    } else if (biz.id === "classifieds_arcade") {
      for (const sx of [-1.0, 0, 1.0]) {
        const board = new THREE.Mesh(
          new THREE.BoxGeometry(0.65, 1.1, 0.15),
          featureMat,
        );
        board.position.set(sx + bodyW * 0.22, 1.5, bodyD / 2 + 0.35);
        grp.add(board);
      }
    } else if (biz.id === "ledger_exchange") {
      const counter = new THREE.Mesh(
        new THREE.BoxGeometry(bodyW * 0.45, 0.85, 0.8),
        matte(0x4d3b1f),
      );
      counter.position.set(bodyW * 0.2, 0.425, bodyD / 2 + 1.5);
      const coin = new THREE.Mesh(
        new THREE.CylinderGeometry(0.55, 0.55, 0.14, 18),
        featureMat,
      );
      coin.position.set(sideX, wallH + 0.7, 0);
      coin.rotation.x = Math.PI / 2;
      grp.add(counter, coin);
    } else if (biz.id === "tarentaal_tours") {
      const perch = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.07, 2.1, 6),
        matte(0x9a7a4a),
      );
      perch.position.set(-sideX, 1.05, bodyD / 2 + 1.6);
      const bird = new THREE.Mesh(
        new THREE.SphereGeometry(0.42, 8, 7),
        featureMat,
      );
      bird.position.set(-sideX, 2.35, bodyD / 2 + 1.6);
      grp.add(perch, bird);
    } else if (biz.id === "builder_studio") {
      const frameA = new THREE.Mesh(
        new THREE.BoxGeometry(0.24, 2.7, 0.2),
        featureMat,
      );
      frameA.position.set(-bodyW * 0.24 - 1.15, 1.35, bodyD / 2 + 0.55);
      const frameB = frameA.clone();
      frameB.position.x = -bodyW * 0.24 + 1.15;
      const lintel = new THREE.Mesh(
        new THREE.BoxGeometry(2.55, 0.24, 0.2),
        featureMat,
      );
      lintel.position.set(-bodyW * 0.24, 2.65, bodyD / 2 + 0.55);
      grp.add(frameA, frameB, lintel);
    } else {
      const marker = new THREE.Mesh(
        new THREE.BoxGeometry(1.1, 0.7, 0.3),
        featureMat,
      );
      marker.position.set(sideX, wallH + 0.55, 0);
      grp.add(marker);
    }
  }
  return grp;
}

function buildCommercialShopRoof(
  C: CommercialCtx,
  massing: CommercialShopMassing,
  neon: number,
  coastalDriedSeat: boolean,
): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({
    color: coastalDriedSeat
      ? new THREE.Color(neon).lerp(new THREE.Color(0x536b3a), 0.3)
      : neon,
    emissive: neon,
    emissiveIntensity: 0.16,
    roughness: 0.55,
    metalness: 0.06,
  });
  const w = massing.bodyW * massing.roofOverhang;
  const d = massing.bodyD * massing.roofOverhang;
  if (massing.roofForm === "gable") {
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(w * 0.55, massing.roofRise, 4),
      mat,
    );
    roof.rotation.y = Math.PI / 4;
    roof.scale.z = d / w;
    return roof;
  }
  if (massing.roofForm === "mono") {
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(w, massing.roofRise, d),
      mat,
    );
    roof.rotation.z = 0.08;
    return roof;
  }
  if (massing.roofForm === "sawtooth") {
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(w, massing.roofRise, d),
      mat,
    );
    roof.rotation.z = -0.08;
    return roof;
  }
  if (massing.roofForm === "greenhouse")
    return new THREE.Mesh(
      new THREE.SphereGeometry(
        Math.min(w, d) * 0.42,
        16,
        8,
        0,
        Math.PI * 2,
        0,
        Math.PI / 2,
      ),
      mat,
    );
  if (massing.roofForm === "arena") {
    const roof = new THREE.Mesh(
      new THREE.CylinderGeometry(w * 0.48, w * 0.55, massing.roofRise, 18),
      mat,
    );
    roof.scale.z = d / w;
    return roof;
  }
  if (massing.roofForm === "market-canopy") {
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(w * 1.08, massing.roofRise, d * 0.7),
      mat,
    );
    roof.rotation.x = 0.12;
    return roof;
  }
  if (massing.roofForm === "tower-cap")
    return new THREE.Mesh(
      // clamp: a metre-scaled body would otherwise grow a 7 m-radius drum
      new THREE.CylinderGeometry(
        Math.min(w * 0.28, 2.6),
        Math.min(w * 0.38, 3.4),
        massing.roofRise,
        8,
      ),
      mat,
    );
  return new THREE.Mesh(new THREE.BoxGeometry(w, massing.roofRise, d), mat);
}

/** A small, distinctive rooftop emblem per business kind (positioned at the group origin by the
 *  caller). Glows in the business palette so each storefront reads from District view. */
function makeBusinessEmblem(
  C: CommercialCtx,
  emblem: Emblem,
  neon: number,
): THREE.Object3D {
  const glow = (hex: number, ei = 0.5) =>
    new THREE.MeshStandardMaterial({
      color: hex,
      emissive: hex,
      emissiveIntensity: ei,
      roughness: 0.4,
    });
  if (emblem === "dish") {
    const grp = new THREE.Group();
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 0.22, 6),
      new THREE.MeshStandardMaterial({ color: 0x9aa3b2 }),
    );
    post.position.y = 0.11;
    const dish = new THREE.Mesh(
      new THREE.ConeGeometry(0.18, 0.12, 16, 1, true),
      glow(neon, 0.65),
    );
    dish.position.y = 0.3;
    dish.rotation.x = Math.PI * 0.85;
    grp.add(post, dish);
    return grp;
  }
  if (emblem === "leaf") {
    const m = new THREE.Mesh(
      new THREE.ConeGeometry(0.12, 0.3, 7),
      glow(0x49c46a, 0.35),
    );
    m.position.y = 0.15;
    return m;
  }
  if (emblem === "ball") {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xf6f6f6, roughness: 0.5 }),
    );
    m.position.y = 0.14;
    return m;
  }
  if (emblem === "pot") {
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.07, 0.16, 10),
      glow(neon, 0.4),
    );
    m.position.y = 0.08;
    return m;
  }
  if (emblem === "crate") {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.2, 0.2),
      glow(neon, 0.35),
    );
    m.position.y = 0.1;
    return m;
  }
  if (emblem === "garage") {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.26, 0.18, 0.08),
      glow(neon, 0.55),
    );
    m.position.y = 0.12;
    return m;
  }
  if (emblem === "record") {
    const m = new THREE.Mesh(
      new THREE.TorusGeometry(0.13, 0.035, 8, 16),
      glow(neon, 0.65),
    );
    m.position.y = 0.13;
    return m;
  }
  if (emblem === "board") {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.18, 0.04),
      glow(neon, 0.6),
    );
    m.position.y = 0.12;
    return m;
  }
  if (emblem === "coin") {
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 0.04, 18),
      glow(neon, 0.55),
    );
    m.rotation.x = Math.PI / 2;
    m.position.y = 0.12;
    return m;
  }
  if (emblem === "bird") {
    const m = new THREE.Mesh(
      new THREE.ConeGeometry(0.12, 0.24, 5),
      glow(neon, 0.5),
    );
    m.position.y = 0.14;
    return m;
  }
  if (emblem === "frame") {
    const m = new THREE.Mesh(
      new THREE.TorusGeometry(0.13, 0.02, 4, 4),
      glow(neon, 0.55),
    );
    m.position.y = 0.14;
    return m;
  }
  const tag = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.14, 0.04),
    glow(neon, 0.6),
  );
  tag.position.y = 0.1;
  return tag;
}

/** Spec 076 — draw the homestead neighbourhood: the spine carriageway + verge ribbon, then each
 *  bordered parcel (zone ground pads + fence ring + driveway always; the worked farm crops, garden
 *  beds, trees and the set-back voxel house once built). Rebuilt only when the signature changes. */

export interface CommercialDistrictLayer {
  group: THREE.Group;
  update(
    daylight: number,
    camera: THREE.Camera,
    scene: THREE.Scene,
    canvas: HTMLCanvasElement,
  ): void;
  dispose(): void;
}

/** Build the whole district — mall anchor, garage anchor, every shop parcel with its neon
 *  floor, signage, business props, roof and emblem, plus the floating business labels. */
export function buildCommercialDistrictLayer(opts: {
  state: ColonyState;
  district: CommercialDistrict;
  wx: (x: number) => number;
  wz: (y: number) => number;
  surfaceY: (x: number, y: number) => number;
}): CommercialDistrictLayer {
  const C: CommercialCtx = {
    ...opts,
    group: new THREE.Group(),
    signMats: [],
    floorMats: [],
    garageFloorMats: [],
    mallFloorMat: null,
    labelMats: [],
    labelNight: 0,
    camera: null as unknown as THREE.Camera,
    scene: null as unknown as THREE.Scene,
    canvas: null as unknown as HTMLCanvasElement,
  };
  C.group.name = "commercialDistrict";
  buildCommercialDistrict(C);
  let updateTick = 0;
  return {
    group: C.group,
    update(daylight, camera, scene, canvas) {
      C.camera = camera;
      C.scene = scene;
      C.canvas = canvas;
      const night = 1 - daylight;
      // Spec 079 — signage glows day and night, flaring after dark; the night floors fade
      // with their own curves (the legacy frame-loop block, verbatim).
      C.labelNight = night;
      for (const sm of C.signMats) sm.emissiveIntensity = 0.7 + night * 0.9;
      if (C.mallFloorMat)
        C.mallFloorMat.emissiveIntensity =
          mallAnchorNightFloorEmissive(daylight);
      for (const fm of C.garageFloorMats)
        fm.emissiveIntensity = garageAnchorNightFloorEmissive(daylight);
      for (const fm of C.floorMats)
        fm.emissiveIntensity = commercialShopNightFloorEmissive(daylight);
      // v3 perf (spec 135): label projection + occlusion on a 4-frame cadence — the fade
      // easing hides the step, and the per-frame cost of raycast occlusion is the single
      // heaviest item in the district's update.
      if ((updateTick++ & 3) === 0) {
        updateCommercialBusinessLabels(C);
        applyCommercialLabelVisibility(C);
      }
    },
    dispose() {
      C.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const disposeMat = (x: THREE.Material) => {
          (x as THREE.MeshStandardMaterial).map?.dispose();
          x.dispose();
        };
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach(disposeMat);
        else if (mat) disposeMat(mat);
      });
      C.group.clear();
      C.labelMats = [];
    },
  };
}
