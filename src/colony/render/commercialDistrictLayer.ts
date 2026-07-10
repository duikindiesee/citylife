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
import type { CommercialDistrict } from "../commerce/district";
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
import { RENDER_DRY_FLOOR } from "./useTerrainLeveling";
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
      model.baseY,
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
    canopy.position.set(
      0,
      model.entranceCanopy.y,
      model.entranceCanopy.zOffset,
    );
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
      model.baseY,
      C.wz(model.center.y),
    );
    g.rotation.y = model.facingAngle;

    const floorMat = new THREE.MeshStandardMaterial({
      color: 0xffb24a,
      emissive: 0xff9f2f,
      emissiveIntensity: garageAnchorNightFloorEmissive(
        C.state.clock.daylight,
      ),
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
      lane.position.set(
        x,
        model.forecourt.y + 0.03,
        model.forecourt.frontOffset,
      );
      forecourtLane.add(lane);
    }

    const showroom = new THREE.Mesh(
      new THREE.BoxGeometry(
        model.showroom.w,
        model.showroom.h,
        model.showroom.d,
      ),
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

    d.parcels.forEach((p, i) => {
      // Spec 079 — each plot fronts a real kooker app: its business sets the neon palette, a rooftop
      // emblem, and (the Nearest bar) a counter + stools where bots can sit. Plots stay for-sale.
      const biz = p.business ? BUSINESSES[p.business] : undefined;
      const neon =
        biz?.palette ?? NEON[i % NEON.length]!;
      const massing = commercialShopMassing(p, biz, i);
      const wallH = massing.wallHeight;
      const bodyW = massing.bodyW;
      const bodyD = massing.bodyD;
      const cx = p.x + (p.w - 1) / 2;
      const cy = p.y + (p.h - 1) / 2;
      // Sit the shop on the LOWEST corner of its footprint so no edge floats over sloped/coastal
      // ground; the uphill terrain just buries into the solid body, and the foundation plinth below
      // fills the slope gap. (Was the centre height, which left the downhill side floating.)
      let loY = Infinity,
        hiY = 0,
        rawLoY = Infinity;
      for (const fx of [p.x, p.x + p.w - 1])
        for (const fy of [p.y, p.y + p.h - 1]) {
          // Seat on the DRIED/levelled surface (surfaceY), not raw worldY — a coastal pad is raised
          // clear of the sea in relevelTerrain, so the shop lifts with it instead of seating underwater.
          const h = C.surfaceY(fx, fy);
          const rawH = t.worldY(fx, fy);
          if (h < loY) loY = h;
          if (h > hiY) hiY = h;
          if (rawH < rawLoY) rawLoY = rawH;
        }
      const baseY = loY;
      const coastalDriedSeat = rawLoY < RENDER_DRY_FLOOR;
      const front = -p.side; // +z when the plot fronts the street to its -y side

      const g = new THREE.Group();
      g.name = `commercialDistrict.${p.id}.${biz?.id ?? "open"}`;
      g.userData = {
        parcelId: p.id,
        businessId: biz?.id,
        businessName: biz?.name,
        massing: massing.signatureKey,
      };
      g.position.set(C.wx(cx), baseY, C.wz(cy));

      // Foundation plinth — inland/sloped shops still get a deep fill body. Coastal DRY seats already own
      // a flat render pad plus the Spec 105 terrain apron, so a full-depth dark plinth reads as the exact
      // black vertical side/floating table we are removing. Keep those coastal plinths thin and let the
      // blended terrain do the visual grounding.
      const foundH = coastalDriedSeat ? 0.22 : hiY - loY + 0.7;
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

      const floorMat = new THREE.MeshStandardMaterial({
        color: neon,
        emissive: neon,
        emissiveIntensity: commercialShopNightFloorEmissive(
          C.state.clock.daylight,
        ),
        roughness: 0.55,
        transparent: true,
        opacity: 0.52,
      });
      const floor = new THREE.Mesh(
        new THREE.BoxGeometry(bodyW * 1.12, 0.035, bodyD * 1.12),
        floorMat,
      );
      floor.name = "commercialShopNightFloor";
      floor.position.y = 0.04;
      C.floorMats.push(floorMat);
      g.add(floor);

      // Body — inland plots keep the dark slate shopfront; coastal dried seats use a colour-matched wall
      // band so night views show grounded shop mass instead of a black tabletop silhouette.
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
      body.name = "commercialShopBody";
      body.position.y = wallH / 2;
      body.castShadow = true;

      // Roof form — per-business massing turns adjacent shops into distinct silhouettes instead of
      // one flat box recoloured.
      const roof = buildCommercialShopRoof(C, 
        massing,
        neon,
        coastalDriedSeat,
      );
      roof.name = `commercialShopRoof.${massing.roofForm}`;
      roof.position.y = wallH + massing.roofRise / 2;

      // Awning — a glowing neon canopy slightly oversailing the body.
      const canopy = new THREE.Mesh(
        new THREE.BoxGeometry(bodyW * massing.roofOverhang, 0.16, bodyD * 0.42),
        new THREE.MeshStandardMaterial({
          color: neon,
          roughness: 0.4,
          emissive: neon,
          emissiveIntensity: 0.45,
        }),
      );
      canopy.name = "commercialShopCanopy";
      canopy.position.y = wallH * 0.86;
      canopy.position.z = front * (bodyD / 2 + 0.22);
      canopy.castShadow = true;

      // Signage — a bright panel standing above the STREET-FACING front edge.
      const frontZ = front * (bodyD / 2 + 0.12);
      const signMat = new THREE.MeshStandardMaterial({
        color: neon,
        emissive: neon,
        emissiveIntensity: 0.7,
        roughness: 0.3,
      });
      const sign = new THREE.Mesh(
        new THREE.BoxGeometry(bodyW * massing.signWidthScale, 0.5, 0.1),
        signMat,
      );
      sign.name = "commercialShopSign";
      sign.position.set(0, wallH + massing.roofRise + 0.34, frontZ);
      C.signMats.push(signMat);
      g.add(body, roof, canopy, sign);

      // Storefront detail (spec 092) — a warm-lit window band flanking a recessed door, awning support
      // posts, and a couple of goods crates, so each shop reads as an OPEN business rather than a plain
      // neon box. Windows glow warm (interior light) against the cool slate body + the neon sign.
      const faceZ = front * (bodyD / 2 + 0.04);
      const glassMat = new THREE.MeshStandardMaterial({
        color: 0xffe6b0,
        emissive: 0xffca78,
        emissiveIntensity: 0.6,
        roughness: 0.3,
      });
      const winW = bodyW * Math.max(0.14, 0.62 / massing.windowCount),
        winH = wallH * 0.46;
      for (let wi = 0; wi < massing.windowCount; wi++) {
        const center = (massing.windowCount - 1) / 2;
        const sx = (wi - center) * (bodyW * 0.18);
        const win = new THREE.Mesh(
          new THREE.BoxGeometry(winW, winH, 0.06),
          glassMat,
        );
        win.position.set(sx, wallH * 0.52, faceZ);
        g.add(win);
      }
      const door = new THREE.Mesh(
        new THREE.BoxGeometry(bodyW * 0.2, wallH * 0.66, 0.08),
        new THREE.MeshStandardMaterial({
          color: 0x15181f,
          roughness: 0.6,
          metalness: 0.2,
        }),
      );
      door.position.set(0, wallH * 0.33, faceZ);
      g.add(door);
      // Awning posts + goods crates only where there's no bar counter (the seating shops fill the front).
      if (!biz?.seating) {
        const postMat = new THREE.MeshStandardMaterial({
          color: 0x20242c,
          roughness: 0.6,
          metalness: 0.3,
        });
        for (const sx of [-bodyW * 0.5, bodyW * 0.5]) {
          const post = new THREE.Mesh(
            new THREE.CylinderGeometry(0.05, 0.05, wallH + 0.06, 8),
            postMat,
          );
          post.position.set(sx, (wallH + 0.06) / 2, front * (bodyD / 2 + 0.5));
          post.castShadow = true;
          g.add(post);
        }
        const crateMat = new THREE.MeshStandardMaterial({
          color: 0x7a5a36,
          roughness: 0.9,
        });
        for (let k = 0; k < 2; k++) {
          const cs = 0.32 + k * 0.06;
          const crate = new THREE.Mesh(
            new THREE.BoxGeometry(cs, cs, cs),
            crateMat,
          );
          crate.position.set(
            -bodyW * 0.42 + k * 0.1,
            cs / 2,
            front * (bodyD / 2 + 0.42 - k * 0.18),
          );
          crate.castShadow = true;
          g.add(crate);
        }
      }

      // Rooftop emblem — a distinct shape per business so the app reads at a glance.
      if (biz) {
        const em = makeBusinessEmblem(C, biz.emblem, neon);
        em.position.y = wallH + 0.5;
        g.add(em);
      }

      // The bar's seating: a counter + stools on the street side. The stools are left empty here —
      // real citizens walk over and occupy them after dark (runtime.wanderIdleCitizens), so we must
      // NOT draw static patron spheres or they'd double up with the live bots taking the seats.
      if (biz?.seating) {
        const counter = new THREE.Mesh(
          new THREE.BoxGeometry(bodyW * 0.9, 0.5, 0.22),
          new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.85 }),
        );
        counter.position.set(0, 0.25, front * (bodyD / 2 + 0.45));
        counter.castShadow = true;
        g.add(counter);
        const stoolMat = new THREE.MeshStandardMaterial({
          color: 0x3a3f4a,
          roughness: 0.7,
        });
        const n = 3;
        for (let k = 0; k < n; k++) {
          const sx = (k - (n - 1) / 2) * ((bodyW * 0.9) / n);
          const stool = new THREE.Mesh(
            new THREE.CylinderGeometry(0.09, 0.09, 0.42, 10),
            stoolMat,
          );
          stool.position.set(sx, 0.21, front * (bodyD / 2 + 0.78));
          stool.castShadow = true;
          g.add(stool);
        }
        // Joe the Crab tends the Nearest — the signature "Joe at the bar" look from the concept image:
        // his headset, eyes and claws clear the counter as he serves the patrons across it. A static
        // prop reusing the founder crab geometry; he stands on a hidden duckboard riser behind the
        // counter and faces the street side. (Citizen-Joe is separate; this is the bar's mascot keeper.)
        const riser = 0.36;
        const board = new THREE.Mesh(
          new THREE.BoxGeometry(bodyW * 0.5, riser, 0.32),
          new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.9 }),
        );
        board.position.set(0, riser / 2, front * (bodyD / 2 + 0.18));
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
        keeper.scale.setScalar(1.25);
        keeper.position.set(0, riser, front * (bodyD / 2 + 0.18));
        if (front < 0) keeper.rotation.y = Math.PI; // the crab faces +z by default; turn him to face the street side
        keeper.castShadow = true;
        g.add(keeper);
      }

      // Signature props give each marquee app a distinct, recognisable place (the bar's radar dish +
      // vials + bar-chart, Sprout's plants, Sportifine's pitch, Chef Otto's market awning + crates).
      if (biz) g.add(buildBusinessProps(C, biz, bodyW, bodyD, wallH, front));

      C.group.add(g);
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
        lamp.position.set(C.wx(c.x), by, C.wz(c.y + side * 1.4));
        const pole = new THREE.Mesh(
          new THREE.CylinderGeometry(0.04, 0.05, 1.4, 6),
          poleMat,
        );
        pole.position.y = 0.7;
        pole.castShadow = true;
        const arm = new THREE.Mesh(
          new THREE.BoxGeometry(0.04, 0.04, 0.3),
          poleMat,
        );
        arm.position.set(0, 1.4, side * 0.15);
        const head = new THREE.Mesh(
          new THREE.SphereGeometry(0.11, 8, 6),
          headMat,
        );
        head.position.set(0, 1.38, side * 0.3);
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
        const fz = C.wz(c.y + side * 1.5);
        // a bench facing the street (backrest on the verge side)
        const bench = new THREE.Group();
        bench.position.set(C.wx(c.x), by, fz);
        const seat = new THREE.Mesh(
          new THREE.BoxGeometry(0.6, 0.05, 0.22),
          woodMat,
        );
        seat.position.y = 0.2;
        seat.castShadow = true;
        const back = new THREE.Mesh(
          new THREE.BoxGeometry(0.6, 0.18, 0.04),
          woodMat,
        );
        back.position.set(0, 0.3, side * 0.09);
        for (const lx of [-0.24, 0.24]) {
          const leg = new THREE.Mesh(
            new THREE.BoxGeometry(0.05, 0.2, 0.18),
            legMat,
          );
          leg.position.set(lx, 0.1, 0);
          bench.add(leg);
        }
        bench.add(seat, back);
        C.group.add(bench);
        // a leafy planter just along from the bench
        const planter = new THREE.Group();
        planter.position.set(C.wx(c.x + 1.1), by, fz);
        const tub = new THREE.Mesh(
          new THREE.CylinderGeometry(0.14, 0.11, 0.2, 10),
          planterMat,
        );
        tub.position.y = 0.1;
        tub.castShadow = true;
        const bush = new THREE.Mesh(
          new THREE.SphereGeometry(0.15, 8, 7),
          leafMat,
        );
        bush.position.y = 0.3;
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
        const by = Math.max(
          0,
          t.worldY(Math.round(site.x), Math.round(site.y)),
        );
        const grp = new THREE.Group();
        grp.position.set(C.wx(site.x), by, C.wz(site.y));
        grp.rotation.y = site.faceX === 1 ? Math.PI / 2 : -Math.PI / 2; // a +z plane turned to face along the street
        for (const px of [-0.7, 0.7]) {
          const post = new THREE.Mesh(
            new THREE.CylinderGeometry(0.05, 0.06, 1.8, 6),
            postMat,
          );
          post.position.set(px, 0.9, 0);
          post.castShadow = true;
          grp.add(post);
        }
        const frame = new THREE.Mesh(
          new THREE.BoxGeometry(1.95, 1.32, 0.12),
          postMat,
        );
        frame.position.set(0, 2.1, 0);
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
          new THREE.PlaneGeometry(1.78, 1.12),
          new THREE.MeshStandardMaterial({
            map: tex,
            emissive: 0xffffff,
            emissiveMap: tex,
            emissiveIntensity: 0.35,
            roughness: 0.6,
          }),
        );
        screen.position.set(0, 2.1, 0.07);
        grp.add(screen);
        C.group.add(grp);
      }
    }
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
      SCRATCH.projection
        .copy(SCRATCH.world)
        .project(C.camera);
      const distance = C.camera.position.distanceTo(
        SCRATCH.world,
      );
      candidates.push({
        label: entry.model,
        screenX: (SCRATCH.projection.x + 1) * 0.5 * width,
        screenY: (1 - SCRATCH.projection.y) * 0.5 * height,
        distance,
        occluded:
          SCRATCH.projection.z < -1 ||
          SCRATCH.projection.z > 1 ||
          Math.abs(SCRATCH.projection.x) >
            BUSINESS_LABEL_VIEWPORT_NDC_LIMIT ||
          Math.abs(SCRATCH.projection.y) >
            BUSINESS_LABEL_VIEWPORT_NDC_LIMIT ||
          commercialLabelOccluded(C, occluders, distance),
      });
    }
    const visibility = declutterBusinessLabels(candidates);
    for (const entry of C.labelMats) {
      const state = visibility.find(
        (item) => item.shopId === entry.model.shopId,
      );
      entry.group.visible = Boolean(state?.visible);
      entry.visibilityOpacity = state?.visible ? state.opacity : 0;
    }
    applyCommercialLabelVisibility(C);
  }

function commercialLabelOccluders(C: CommercialCtx) {
    const occluders: THREE.Object3D[] = [];
    C.scene.traverse((object) => {
      if (object.type !== "Mesh") return;
      if (isCommercialLabelObject(C, object)) return;
      occluders.push(object);
    });
    return occluders;
  }

function commercialLabelOccluded(C: CommercialCtx, 
    occluders: readonly THREE.Object3D[],
    distance: number,
  ) {
    if (distance <= 1.4 || occluders.length === 0) return false;
    SCRATCH.direction
      .copy(SCRATCH.world)
      .sub(C.camera.position)
      .normalize();
    SCRATCH.raycaster.set(
      C.camera.position,
      SCRATCH.direction,
    );
    SCRATCH.raycaster.far = Math.max(0.1, distance - 1.2);
    return (
      SCRATCH.raycaster.intersectObjects([...occluders], false)
        .length > 0
    );
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

function makeCommercialBusinessLabel(C: CommercialCtx, 
    label: BusinessLabel,
  ): THREE.Object3D | null {
    if (typeof document === "undefined") return null; // headless (node tests) draw no label canvases
    if (!isPublicSafe(label.text)) return null;
    const group = new THREE.Group();
    group.name = `commercial-label-${label.shopId}`;
    group.position.set(
      C.wx(label.x),
      C.surfaceY(label.x, label.y) + label.height,
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
    sprite.scale.set(4.8, 1.55, 1);
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
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1.25, 24), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.72;
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

  /** Signature props for a marquee storefront, positioned relative to its plot centre. `front` is the
   *  +z/-z direction of the street the plot faces. Keeps each app's site recognisable from afar. */
function buildBusinessProps(C: CommercialCtx, 
    biz: Business,
    bodyW: number,
    bodyD: number,
    wallH: number,
    front: number,
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
    const frontZ = front * (bodyD / 2);
    if (biz.id === "nearest_bar") {
      const mast = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, 1.0, 6),
        matte(0x9aa3b2),
      );
      mast.position.set(bodyW * 0.35, wallH + 0.5, -frontZ * 0.6);
      const dish = new THREE.Mesh(
        new THREE.ConeGeometry(0.32, 0.2, 18, 1, true),
        glow(biz.palette, 0.7),
      );
      dish.position.set(bodyW * 0.35, wallH + 1.05, -frontZ * 0.6);
      dish.rotation.x = Math.PI * 0.8;
      grp.add(mast, dish);
      const vials = [0xff2d95, 0x18e0ff, 0xffc233, 0x7bff4d];
      vials.forEach((cv, k) => {
        const v = new THREE.Mesh(
          new THREE.CylinderGeometry(0.05, 0.05, 0.3, 8),
          glow(cv, 0.85),
        );
        v.position.set((k - 1.5) * 0.18, wallH + 0.25, frontZ * 0.6);
        grp.add(v);
      });
      [0.3, 0.5, 0.4, 0.6].forEach((h, k) => {
        const b = new THREE.Mesh(
          new THREE.BoxGeometry(0.08, h, 0.06),
          glow(biz.palette, 0.6),
        );
        b.position.set(
          -bodyW * 0.5 - 0.16,
          wallH * 0.4 + h / 2,
          (k - 1.5) * 0.12,
        );
        grp.add(b);
      });
    } else if (biz.id === "sprout_nursery") {
      // A lush little nursery: a terracotta planter trough of flowering sprouts, potted bushes flanking
      // the door, a leafy trellis arch over the entrance, and shrubs on the roof.
      const leaf = matte(0x3fae5a),
        leafDk = matte(0x2f8f49),
        terra = matte(0xb5663a);
      const blooms = [0xff7eb6, 0xffd23f, 0xf6f6f6, 0xff5ca8, 0x7bd0ff];
      const trough = new THREE.Mesh(
        new THREE.BoxGeometry(bodyW * 0.9, 0.16, 0.26),
        terra,
      );
      trough.position.set(0, 0.08, frontZ + front * 0.55);
      grp.add(trough);
      for (let k = 0; k < 5; k++) {
        const stem = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.34, 7), leaf);
        stem.position.set((k - 2) * 0.28, 0.32, frontZ + front * 0.55);
        grp.add(stem);
        const bloom = new THREE.Mesh(
          new THREE.SphereGeometry(0.07, 8, 6),
          glow(blooms[k % blooms.length]!, 0.3),
        );
        bloom.position.set((k - 2) * 0.28, 0.52, frontZ + front * 0.55);
        grp.add(bloom);
      }
      for (const sx of [-bodyW * 0.34, bodyW * 0.34]) {
        const pot = new THREE.Mesh(
          new THREE.CylinderGeometry(0.12, 0.09, 0.18, 10),
          terra,
        );
        pot.position.set(sx, 0.09, frontZ + front * 0.3);
        grp.add(pot);
        const bush = new THREE.Mesh(
          new THREE.SphereGeometry(0.16, 8, 7),
          leafDk,
        );
        bush.position.set(sx, 0.28, frontZ + front * 0.3);
        grp.add(bush);
      }
      const archMat = matte(0xd8d2c4);
      for (const sx of [-0.5, 0.5]) {
        const post = new THREE.Mesh(
          new THREE.BoxGeometry(0.05, 0.9, 0.05),
          archMat,
        );
        post.position.set(sx, 0.45, frontZ + front * 0.15);
        grp.add(post);
      }
      const archTop = new THREE.Mesh(
        new THREE.BoxGeometry(1.05, 0.05, 0.05),
        archMat,
      );
      archTop.position.set(0, 0.9, frontZ + front * 0.15);
      grp.add(archTop);
      for (let k = 0; k < 4; k++) {
        const vine = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), leaf);
        vine.position.set((k - 1.5) * 0.3, 0.88, frontZ + front * 0.15);
        grp.add(vine);
      }
      for (const sx of [-bodyW * 0.3, bodyW * 0.3]) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 7), leafDk);
        s.position.set(sx, wallH + 0.2, -frontZ * 0.3);
        grp.add(s);
      }
    } else if (biz.id === "sportifine_club") {
      // A proper club: a green pitch with goal + ball, two floodlight poles, a stepped grandstand and a
      // corner flag in the club colour.
      const pitch = new THREE.Mesh(
        new THREE.BoxGeometry(bodyW * 0.9, 0.04, 1.2),
        matte(0x2e8b3e),
      );
      pitch.position.set(0, 0.02, frontZ + front * 0.85);
      grp.add(pitch);
      const postMat = glow(0xf6f6f6, 0.2);
      const gl = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.5, 0.05),
        postMat,
      );
      gl.position.set(-0.4, 0.25, frontZ + front * 1.35);
      const gr = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.5, 0.05),
        postMat,
      );
      gr.position.set(0.4, 0.25, frontZ + front * 1.35);
      const gt = new THREE.Mesh(
        new THREE.BoxGeometry(0.85, 0.05, 0.05),
        postMat,
      );
      gt.position.set(0, 0.5, frontZ + front * 1.35);
      const ball = new THREE.Mesh(
        new THREE.SphereGeometry(0.1, 10, 8),
        matte(0xf0f0f0),
      );
      ball.position.set(0.1, 0.1, frontZ + front * 0.5);
      grp.add(gl, gr, gt, ball);
      const poleMat = matte(0x9aa3b2);
      for (const sx of [-bodyW * 0.45, bodyW * 0.45]) {
        const pole = new THREE.Mesh(
          new THREE.CylinderGeometry(0.03, 0.03, 1.2, 6),
          poleMat,
        );
        pole.position.set(sx, 0.6, frontZ + front * 1.25);
        grp.add(pole);
        const lamp = new THREE.Mesh(
          new THREE.BoxGeometry(0.22, 0.1, 0.06),
          glow(0xfff3c0, 0.7),
        );
        lamp.position.set(sx, 1.18, frontZ + front * 1.25);
        grp.add(lamp);
      }
      const standMat = matte(biz.palette);
      for (let s = 0; s < 3; s++) {
        const step = new THREE.Mesh(
          new THREE.BoxGeometry(0.7, 0.12, 0.18),
          standMat,
        );
        step.position.set(
          -bodyW * 0.5 - 0.25,
          0.06 + s * 0.12,
          frontZ + front * (0.5 + s * 0.18),
        );
        grp.add(step);
      }
      const flagPole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.015, 0.015, 0.4, 5),
        poleMat,
      );
      flagPole.position.set(bodyW * 0.4, 0.2, frontZ + front * 0.45);
      grp.add(flagPole);
      const flag = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.1, 0.02),
        glow(biz.palette, 0.5),
      );
      flag.position.set(bodyW * 0.4 + 0.09, 0.34, frontZ + front * 0.45);
      grp.add(flag);
    } else if (biz.id === "chef_market") {
      // A restaurant-market: a striped awning, a produce stall, a glowing grill under a smoking chimney,
      // an outdoor bistro table, and a kettlebell — the nod to the chef app's exercise side.
      const wood = matte(0x9c6b3f);
      const awning = new THREE.Mesh(
        new THREE.BoxGeometry(bodyW * 1.1, 0.08, 0.7),
        glow(0xff6a3d, 0.4),
      );
      awning.position.set(0, wallH * 0.82, frontZ + front * 0.35);
      awning.rotation.x = front * 0.25;
      grp.add(awning);
      const produce = [0xe23b2f, 0x7bff4d, 0xffc233];
      for (let k = 0; k < 3; k++) {
        const cr = new THREE.Mesh(
          new THREE.BoxGeometry(0.22, 0.22, 0.22),
          wood,
        );
        cr.position.set((k - 1) * 0.32, 0.11, frontZ + front * 0.7);
        grp.add(cr);
        for (let j = 0; j < 3; j++) {
          const f = new THREE.Mesh(
            new THREE.SphereGeometry(0.05, 6, 5),
            matte(produce[k % 3]!),
          );
          f.position.set(
            (k - 1) * 0.32 + (j - 1) * 0.06,
            0.25,
            frontZ + front * 0.7,
          );
          grp.add(f);
        }
      }
      const grill = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, 0.18, 0.26),
        matte(0x3a3f4a),
      );
      grill.position.set(bodyW * 0.32, 0.12, frontZ + front * 0.55);
      grp.add(grill);
      const embers = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.04, 0.22),
        glow(0xff5a1f, 0.7),
      );
      embers.position.set(bodyW * 0.32, 0.22, frontZ + front * 0.55);
      grp.add(embers);
      const chimney = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.07, 0.4, 8),
        matte(0x5a5f6a),
      );
      chimney.position.set(-bodyW * 0.3, wallH + 0.2, -frontZ * 0.4);
      grp.add(chimney);
      for (let k = 0; k < 3; k++) {
        const puff = new THREE.Mesh(
          new THREE.SphereGeometry(0.08 + k * 0.02, 6, 5),
          matte(0xcfd3da),
        );
        puff.position.set(-bodyW * 0.3, wallH + 0.5 + k * 0.18, -frontZ * 0.4);
        grp.add(puff);
      }
      const table = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.16, 0.04, 12),
        wood,
      );
      table.position.set(-bodyW * 0.32, 0.34, frontZ + front * 0.7);
      const leg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.03, 0.34, 6),
        matte(0x5a5f6a),
      );
      leg.position.set(-bodyW * 0.32, 0.17, frontZ + front * 0.7);
      grp.add(table, leg);
      for (const sx of [-0.22, 0.22]) {
        const stool = new THREE.Mesh(
          new THREE.CylinderGeometry(0.07, 0.07, 0.26, 8),
          matte(0x3a3f4a),
        );
        stool.position.set(-bodyW * 0.32 + sx, 0.13, frontZ + front * 0.72);
        grp.add(stool);
      }
      const kb = new THREE.Mesh(
        new THREE.SphereGeometry(0.1, 8, 7),
        matte(0x2b3040),
      );
      kb.position.set(bodyW * 0.34, 0.1, frontZ + front * 0.88);
      const handle = new THREE.Mesh(
        new THREE.TorusGeometry(0.05, 0.015, 6, 10, Math.PI),
        matte(0x2b3040),
      );
      handle.position.set(bodyW * 0.34, 0.18, frontZ + front * 0.88);
      grp.add(kb, handle);
    } else {
      const featureMat = glow(biz.palette, 0.55);
      const sideX = bodyW * 0.38;
      if (biz.id === "citylife_garage") {
        const bay = new THREE.Mesh(
          new THREE.BoxGeometry(bodyW * 0.46, 0.72, 0.08),
          matte(0x1d222b),
        );
        bay.position.set(0, 0.36, frontZ + front * 0.12);
        const wrench = new THREE.Mesh(
          new THREE.BoxGeometry(0.54, 0.08, 0.08),
          featureMat,
        );
        wrench.position.set(sideX, wallH + 0.18, frontZ * 0.2);
        grp.add(bay, wrench);
      } else if (biz.id === "mojojo_records") {
        const disc = new THREE.Mesh(
          new THREE.TorusGeometry(0.24, 0.055, 10, 18),
          featureMat,
        );
        disc.position.set(-sideX, wallH + 0.12, frontZ * 0.2);
        disc.rotation.x = Math.PI / 2;
        const booth = new THREE.Mesh(
          new THREE.BoxGeometry(0.5, 0.28, 0.32),
          matte(0x20242c),
        );
        booth.position.set(0, 0.14, frontZ + front * 0.58);
        grp.add(disc, booth);
      } else if (biz.id === "classifieds_arcade") {
        for (const sx of [-0.28, 0, 0.28]) {
          const board = new THREE.Mesh(
            new THREE.BoxGeometry(0.2, 0.34, 0.05),
            featureMat,
          );
          board.position.set(sx, wallH * 0.52, frontZ + front * 0.12);
          grp.add(board);
        }
      } else if (biz.id === "ledger_exchange") {
        const counter = new THREE.Mesh(
          new THREE.BoxGeometry(bodyW * 0.62, 0.26, 0.28),
          matte(0x4d3b1f),
        );
        counter.position.set(0, 0.13, frontZ + front * 0.52);
        const coin = new THREE.Mesh(
          new THREE.CylinderGeometry(0.16, 0.16, 0.04, 18),
          featureMat,
        );
        coin.position.set(sideX, wallH + 0.2, frontZ * 0.2);
        coin.rotation.x = Math.PI / 2;
        grp.add(counter, coin);
      } else if (biz.id === "tarentaal_tours") {
        const perch = new THREE.Mesh(
          new THREE.CylinderGeometry(0.025, 0.025, 0.7, 6),
          matte(0x9a7a4a),
        );
        perch.position.set(-sideX, 0.35, frontZ + front * 0.55);
        const bird = new THREE.Mesh(
          new THREE.SphereGeometry(0.14, 8, 7),
          featureMat,
        );
        bird.position.set(-sideX, 0.76, frontZ + front * 0.55);
        grp.add(perch, bird);
      } else if (biz.id === "builder_studio") {
        const frameA = new THREE.Mesh(
          new THREE.BoxGeometry(0.08, 0.9, 0.06),
          featureMat,
        );
        frameA.position.set(-0.38, 0.45, frontZ + front * 0.18);
        const frameB = frameA.clone();
        frameB.position.x = 0.38;
        const lintel = new THREE.Mesh(
          new THREE.BoxGeometry(0.84, 0.08, 0.06),
          featureMat,
        );
        lintel.position.set(0, 0.88, frontZ + front * 0.18);
        grp.add(frameA, frameB, lintel);
      } else {
        const marker = new THREE.Mesh(
          new THREE.BoxGeometry(0.36, 0.24, 0.1),
          featureMat,
        );
        marker.position.set(sideX, wallH + 0.18, frontZ * 0.2);
        grp.add(marker);
      }
    }
    return grp;
  }

function buildCommercialShopRoof(C: CommercialCtx, 
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
        new THREE.CylinderGeometry(w * 0.28, w * 0.38, massing.roofRise, 8),
        mat,
      );
    return new THREE.Mesh(new THREE.BoxGeometry(w, massing.roofRise, d), mat);
  }

  /** A small, distinctive rooftop emblem per business kind (positioned at the group origin by the
   *  caller). Glows in the business palette so each storefront reads from District view. */
function makeBusinessEmblem(C: CommercialCtx, emblem: Emblem, neon: number): THREE.Object3D {
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
        C.mallFloorMat.emissiveIntensity = mallAnchorNightFloorEmissive(daylight);
      for (const fm of C.garageFloorMats)
        fm.emissiveIntensity = garageAnchorNightFloorEmissive(daylight);
      for (const fm of C.floorMats)
        fm.emissiveIntensity = commercialShopNightFloorEmissive(daylight);
      updateCommercialBusinessLabels(C);
      applyCommercialLabelVisibility(C);
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
