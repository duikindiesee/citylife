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
  isPointInGarageVicinity,
} from "./garageAnchorShell";
import { ribbonSurfaceCells, type RoadWay } from "./roadRibbon";
import {
  commercialShopMassing,
  commercialShopNightFloorEmissive,
  type CommercialShopMassing,
} from "./commercialShopMassing";
import { buildCarMesh } from "../car/carMesh";
import { SHOWROOM_VEHICLES } from "../showroom/showroomCatalog";
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
import { attachCapPolys } from "./junctionCap";
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
  // PLAYER.GARAGE.1 — the model's dimensions are grid cells; the group sits in world metres.
  // Without this uniform cells→metres scale the whole landmark rendered at quarter size on its
  // 16×11-cell pad (operator-reported).
  g.scale.setScalar(model.renderScale);

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
    color: 0x3d4450,
    roughness: 0.65,
    metalness: 0.04,
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

  // Spec 176 / 177: Dedicated customer parking bays painted on the forecourt
  // Aligned with stall depth along world Z and vehicle orientation (rot: Math.PI / 2)
  const stallLineMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xdddddd,
    emissiveIntensity: 0.45,
    roughness: 0.3,
  });
  for (const [idx, bay] of model.parkingBays.entries()) {
    const stallGroup = new THREE.Group();
    stallGroup.name = `garageAnchorParkingStall.${idx + 1}`;
    stallGroup.position.set(bay.x, model.forecourt.y + 0.032, bay.z);
    stallGroup.rotation.y = bay.rot;

    // In stall local coordinates (rotated by Math.PI / 2):
    // Depth (bay.d) is along local X (pointing toward forecourt / road)
    // Width (bay.w) is along local Z (stall width)
    const leftLine = new THREE.Mesh(
      new THREE.BoxGeometry(bay.d, 0.015, 0.035),
      stallLineMat,
    );
    leftLine.position.set(0, 0, -bay.w / 2);
    const rightLine = new THREE.Mesh(
      new THREE.BoxGeometry(bay.d, 0.015, 0.035),
      stallLineMat,
    );
    rightLine.position.set(0, 0, bay.w / 2);
    const backLine = new THREE.Mesh(
      new THREE.BoxGeometry(0.035, 0.015, bay.w),
      stallLineMat,
    );
    backLine.position.set(-bay.d / 2, 0, 0);

    // Concrete wheel stop block behind the car
    const wheelStop = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.045, bay.w * 0.72),
      new THREE.MeshStandardMaterial({ color: 0x828d99, roughness: 0.72 }),
    );
    wheelStop.position.set(-bay.d / 2 + 0.12, 0.025, 0);
    stallGroup.add(leftLine, rightLine, backLine, wheelStop);
    g.add(stallGroup);
  }

  // Spec 177: Forecourt perimeter architectural light stanchion
  // Placed strictly on the far western perimeter curb corner, completely clear of all vehicle driving paths.
  // The old stanchion on the east side (which blocked the service bay entrance) is eliminated!
  {
    const poleX = -model.forecourt.w / 2 + 0.4;
    const poleZ = model.forecourt.frontOffset + model.forecourt.d / 2 - 0.3;
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.11, 4.2, 10),
      new THREE.MeshStandardMaterial({
        color: 0x1f2732,
        roughness: 0.35,
        metalness: 0.8,
      }),
    );
    pole.position.set(poleX, 2.1, poleZ);
    const luminaire = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.12, 0.55),
      new THREE.MeshStandardMaterial({
        color: 0xfff0d4,
        emissive: 0xffdfa8,
        emissiveIntensity: 1.8,
      }),
    );
    luminaire.position.set(poleX, 4.15, poleZ - 0.18);
    luminaire.rotation.x = 0.35;
    const flood = new THREE.PointLight(0xffeed4, 22, 16, 1.8);
    flood.position.set(poleX, 4.0, poleZ - 0.18);
    g.add(pole, luminaire, flood);
  }

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

  // Spec 174 / Spec 176: LUMINOUS ARCHITECTURAL GLASS SHOWROOM PAVILION
  // Transparent architectural glass pavilion with real 3D cars, bright interior lighting,
  // glowing ceiling light grid, warm timber feature wall, and illuminated presentation turntable.
  const showroomGroup = new THREE.Group();
  showroomGroup.name = "garageAnchorGlassShowroomGroup";

  // 1. Crystal clear transparent architectural glass outer box
  const showroomGlassMat = new THREE.MeshStandardMaterial({
    color: 0xebf6ff,
    roughness: 0.02,
    metalness: 0.65,
    transparent: true,
    opacity: 0.14,
    emissive: 0x1f3448,
    emissiveIntensity: 0.24,
  });
  const showroom = new THREE.Mesh(
    new THREE.BoxGeometry(model.showroom.w, model.showroom.h, model.showroom.d),
    showroomGlassMat,
  );
  showroom.name = "garageAnchorGlassShowroom";
  showroom.position.set(model.showroom.x, model.showroom.y, model.showroom.z);
  showroom.castShadow = false;
  showroom.receiveShadow = false;

  // Dark metallic structural mullions framing the glass with vertical warm LED accent strips
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x1b232e,
    metalness: 0.75,
    roughness: 0.3,
  });
  const mullionNeonMat = new THREE.MeshStandardMaterial({
    color: 0xffe1a8,
    emissive: 0xffb24a,
    emissiveIntensity: 1.1,
    roughness: 0.2,
  });
  C.garageFloorMats.push(mullionNeonMat);

  const frameCorners: [number, number][] = [
    [-model.showroom.w / 2 + 0.05, -model.showroom.d / 2 + 0.05],
    [model.showroom.w / 2 - 0.05, -model.showroom.d / 2 + 0.05],
    [-model.showroom.w / 2 + 0.05, model.showroom.d / 2 - 0.05],
    [model.showroom.w / 2 - 0.05, model.showroom.d / 2 - 0.05],
    [0, model.showroom.d / 2 - 0.05], // center mullion facing the road
  ];
  for (const [fx, fz] of frameCorners) {
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, model.showroom.h, 0.12),
      frameMat,
    );
    post.position.set(
      model.showroom.x + fx,
      model.showroom.y,
      model.showroom.z + fz,
    );
    showroomGroup.add(post);

    // Front road-facing mullions get vertical glowing edge strips
    if (fz > 0) {
      const edgeStrip = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, model.showroom.h * 0.95, 0.03),
        mullionNeonMat,
      );
      edgeStrip.position.set(
        model.showroom.x + fx,
        model.showroom.y,
        model.showroom.z + fz + 0.06,
      );
      showroomGroup.add(edgeStrip);
    }
  }

  // 2. Interior room environment (Group named garageAnchorShowroomInterior)
  const showroomInterior = new THREE.Group();
  showroomInterior.name = "garageAnchorShowroomInterior";

  // Polished high-reflectivity architectural terrazzo floor
  const intFloorMat = new THREE.MeshStandardMaterial({
    color: 0xd8e4ee,
    roughness: 0.12,
    metalness: 0.28,
    emissive: 0x223040,
    emissiveIntensity: 0.45,
  });
  C.garageFloorMats.push(intFloorMat);
  const intFloor = new THREE.Mesh(
    new THREE.BoxGeometry(
      model.showroom.w * 0.98,
      0.06,
      model.showroom.d * 0.98,
    ),
    intFloorMat,
  );
  intFloor.position.set(model.showroom.x, 0.05, model.showroom.z);
  intFloor.receiveShadow = true;
  showroomInterior.add(intFloor);

  // Back feature wall separating showroom from service bay (warm architectural wood / bronze styling)
  const backWall = new THREE.Mesh(
    new THREE.BoxGeometry(
      model.showroom.w * 0.98,
      model.showroom.h * 0.96,
      0.14,
    ),
    new THREE.MeshStandardMaterial({
      color: 0x543c28,
      roughness: 0.65,
      metalness: 0.15,
      emissive: 0x291d14,
      emissiveIntensity: 0.35,
    }),
  );
  backWall.position.set(
    model.showroom.x,
    model.showroom.y,
    model.showroom.z - model.showroom.d * 0.46,
  );
  showroomInterior.add(backWall);

  // Luminous Ceiling Light Grid (bright architectural LED softbox ceiling)
  const ceilingFrame = new THREE.Mesh(
    new THREE.BoxGeometry(
      model.showroom.w * 0.99,
      0.12,
      model.showroom.d * 0.99,
    ),
    new THREE.MeshStandardMaterial({
      color: 0x1a212a,
      roughness: 0.8,
    }),
  );
  ceilingFrame.position.set(
    model.showroom.x,
    model.showroom.h + 0.02,
    model.showroom.z,
  );
  showroomInterior.add(ceilingFrame);

  const ceilingLightMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xfffaed,
    emissiveIntensity: 2.2,
    roughness: 0.2,
  });
  C.garageFloorMats.push(ceilingLightMat);
  const ceilingLightPanel = new THREE.Mesh(
    new THREE.BoxGeometry(
      model.showroom.w * 0.92,
      0.04,
      model.showroom.d * 0.92,
    ),
    ceilingLightMat,
  );
  ceilingLightPanel.position.set(
    model.showroom.x,
    model.showroom.h - 0.02,
    model.showroom.z,
  );
  showroomInterior.add(ceilingLightPanel);

  // Spec 176: Real Three.js Interior PointLights illuminating hero car & showroom space
  const showroomKeyLight = new THREE.PointLight(0xfffaed, 36, 24, 1.8);
  showroomKeyLight.position.set(
    model.showroom.x - model.showroom.w * 0.06,
    model.showroom.h - 0.2,
    model.showroom.z + model.showroom.d * 0.04,
  );
  showroomInterior.add(showroomKeyLight);

  const showroomFillLight = new THREE.PointLight(0xa5dcff, 18, 18, 2.0);
  showroomFillLight.position.set(
    model.showroom.x + model.showroom.w * 0.28,
    model.showroom.h - 0.3,
    model.showroom.z - model.showroom.d * 0.15,
  );
  showroomInterior.add(showroomFillLight);

  // Ceiling recessed LED spotlights illuminating the showroom floor & plinth
  const spotMat = new THREE.MeshStandardMaterial({
    color: 0xfff3d6,
    emissive: 0xffe2a8,
    emissiveIntensity: 1.8,
    roughness: 0.2,
  });
  C.garageFloorMats.push(spotMat);
  const spotPositions: [number, number][] = [
    [-model.showroom.w * 0.22, 0],
    [model.showroom.w * 0.22, 0],
    [0, model.showroom.d * 0.18],
    [0, -model.showroom.d * 0.18],
  ];
  for (const [sx, sz] of spotPositions) {
    const spot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.24, 0.04, 16),
      spotMat,
    );
    spot.position.set(
      model.showroom.x + sx,
      model.showroom.h - 0.03,
      model.showroom.z + sz,
    );
    showroomInterior.add(spot);
  }

  // 3. Central illuminated presentation turntable plinth
  const plinth = new THREE.Mesh(
    new THREE.CylinderGeometry(1.65, 1.72, 0.12, 32),
    new THREE.MeshStandardMaterial({
      color: 0x222832,
      roughness: 0.26,
      metalness: 0.45,
      emissive: 0x161c24,
      emissiveIntensity: 0.22,
    }),
  );
  plinth.name = "garageAnchorShowroomPlinth";
  plinth.position.set(
    model.showroom.x - model.showroom.w * 0.1,
    0.11,
    model.showroom.z + model.showroom.d * 0.04,
  );
  plinth.receiveShadow = true;
  showroomInterior.add(plinth);

  // Plinth outer glowing neon ring
  const plinthRing = new THREE.Mesh(
    new THREE.RingGeometry(1.58, 1.66, 32),
    new THREE.MeshStandardMaterial({
      color: 0xffad42,
      emissive: 0xff9928,
      emissiveIntensity: 1.45,
      side: THREE.DoubleSide,
    }),
  );
  plinthRing.name = "garageAnchorShowroomPlinthRing";
  C.garageFloorMats.push(plinthRing.material as THREE.MeshStandardMaterial);
  plinthRing.rotation.x = -Math.PI / 2;
  plinthRing.position.set(
    model.showroom.x - model.showroom.w * 0.1,
    0.171,
    model.showroom.z + model.showroom.d * 0.04,
  );
  showroomInterior.add(plinthRing);

  // 4. HERO CAR ON THE PLINTH (Karoo X19 Targa - Yellow Fiat X1/9 GLB)
  // Centered on the turntable plinth and illuminated by ceiling spotlights.
  // Container group has scale 1.0 so GLB replacement (scale 0.262) inside 4x parent group renders at authentic 1:1 real-world proportion (~1.05m net scale).
  const heroGroup = new THREE.Group();
  heroGroup.name = "garageAnchorShowroomHeroCar";
  heroGroup.position.set(
    model.showroom.x - model.showroom.w * 0.1,
    0.17,
    model.showroom.z + model.showroom.d * 0.04,
  );
  heroGroup.rotation.y = -0.38; // initial angle toward the road-facing glass
  heroGroup.scale.setScalar(1.0);

  const heroSpec = SHOWROOM_VEHICLES[2]!.spec;
  const heroFallbackMesh = buildCarMesh(heroSpec);
  heroFallbackMesh.name = "garageAnchorShowroomHeroCarFallback";
  heroFallbackMesh.scale.setScalar(1.0);
  heroGroup.add(heroFallbackMesh);
  showroomInterior.add(heroGroup);

  // 6. Header sign and branding
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

  // Subtle lower glass kickplate / front accent
  const showroomFront = new THREE.Mesh(
    new THREE.BoxGeometry(model.showroom.w * 0.84, 0.16, 0.08),
    new THREE.MeshStandardMaterial({
      color: 0x1b232c,
      roughness: 0.3,
      metalness: 0.6,
    }),
  );
  showroomFront.name = "garageAnchorGlassShowroomFront";
  showroomFront.position.set(
    model.showroom.x,
    0.12,
    model.showroom.z + model.showroom.d / 2 + 0.05,
  );

  const showroomCarSilhouette = new THREE.Group();
  showroomCarSilhouette.name = "garageAnchorShowroomFrontCarSilhouette";

  const showroomCarGlow = new THREE.Group();
  showroomCarGlow.name = "garageAnchorShowroomCarGlow";

  // Spec 177: Discrete Workshop Building Shell (garageAnchorServiceBayBlock)
  // Partitioned into solid exterior walls, roof lintel, and front piers around the bay openings.
  // Bay 2 is an authentic hollow drive-through cavity with zero geometry occluding the drive-in path.
  const service = new THREE.Group();
  service.name = "garageAnchorServiceBayBlock";

  const workshopWallMat = new THREE.MeshStandardMaterial({
    color: 0x3e4754,
    roughness: 0.78,
    metalness: 0.12,
    emissive: 0x121a24,
    emissiveIntensity: 0.08,
  });

  const wallThickness = 0.22;
  const doorH = model.serviceBay.h * 0.78;
  const lintelH = model.serviceBay.h - doorH;
  const hdw = model.serviceBay.bayDoorW / 2;
  const bayFrontZ = model.serviceBay.z + model.serviceBay.d / 2;
  const bayBackZ = model.serviceBay.z - model.serviceBay.d / 2;

  // 1. Back Wall spanning full workshop width
  const workshopBackWall = new THREE.Mesh(
    new THREE.BoxGeometry(
      model.serviceBay.w,
      model.serviceBay.h,
      wallThickness,
    ),
    workshopWallMat,
  );
  workshopBackWall.name = "garageAnchorWorkshopBackWall";
  workshopBackWall.position.set(
    model.serviceBay.x,
    model.serviceBay.h / 2,
    bayBackZ + wallThickness / 2,
  );
  workshopBackWall.castShadow = true;
  workshopBackWall.receiveShadow = true;
  service.add(workshopBackWall);

  // 2. East Side Wall spanning full workshop depth
  const eastWall = new THREE.Mesh(
    new THREE.BoxGeometry(
      wallThickness,
      model.serviceBay.h,
      model.serviceBay.d,
    ),
    workshopWallMat,
  );
  eastWall.name = "garageAnchorWorkshopEastWall";
  eastWall.position.set(
    model.serviceBay.x + model.serviceBay.w / 2 - wallThickness / 2,
    model.serviceBay.h / 2,
    model.serviceBay.z,
  );
  eastWall.castShadow = true;
  eastWall.receiveShadow = true;
  service.add(eastWall);

  // 3. Workshop Floor Slab
  const workshopFloor = new THREE.Mesh(
    new THREE.BoxGeometry(model.serviceBay.w, 0.04, model.serviceBay.d),
    workshopWallMat,
  );
  workshopFloor.name = "garageAnchorWorkshopFloor";
  workshopFloor.position.set(model.serviceBay.x, 0.02, model.serviceBay.z);
  workshopFloor.receiveShadow = true;
  service.add(workshopFloor);

  // 4. Upper Spandrel Lintel above all door openings
  const lintel = new THREE.Mesh(
    new THREE.BoxGeometry(model.serviceBay.w, lintelH, wallThickness),
    workshopWallMat,
  );
  lintel.name = "garageAnchorWorkshopLintel";
  lintel.position.set(
    model.serviceBay.x,
    doorH + lintelH / 2,
    bayFrontZ - wallThickness / 2,
  );
  lintel.castShadow = true;
  lintel.receiveShadow = true;
  service.add(lintel);

  // 5. Front Piers partitioned cleanly around the three bay openings:
  const bayDoorSpacing = model.serviceBay.bayDoorW * 1.25;
  const bay1X = model.serviceBay.x - bayDoorSpacing;
  const bay2X = model.serviceBay.x;
  const bay3X = model.serviceBay.x + bayDoorSpacing;
  const westX = model.serviceBay.x - model.serviceBay.w / 2;
  const eastX = model.serviceBay.x + model.serviceBay.w / 2;

  const piers: [number, number, string][] = [
    [westX, bay1X - hdw, "garageAnchorWorkshopPier.west"],
    [bay1X + hdw, bay2X - hdw, "garageAnchorWorkshopPier.1_2"],
    [bay2X + hdw, bay3X - hdw, "garageAnchorWorkshopPier.2_3"],
    [bay3X + hdw, eastX, "garageAnchorWorkshopPier.east"],
  ];
  for (const [xLeft, xRight, pierName] of piers) {
    const pw = xRight - xLeft;
    if (pw > 0.02) {
      const pier = new THREE.Mesh(
        new THREE.BoxGeometry(pw, doorH, wallThickness),
        workshopWallMat,
      );
      pier.name = pierName;
      pier.position.set(
        (xLeft + xRight) / 2,
        doorH / 2,
        bayFrontZ - wallThickness / 2,
      );
      pier.castShadow = true;
      pier.receiveShadow = true;
      service.add(pier);
    }
  }

  // 6. Interior Partitions enclosing closed bays 1 and 3 while leaving Bay 2 completely open
  const partitionThickness = 0.22;
  const partitionD = model.serviceBay.d - wallThickness * 2;
  for (const [px, partName] of [
    [(bay1X + hdw + bay2X - hdw) / 2, "garageAnchorWorkshopPartition.1_2"],
    [(bay2X + hdw + bay3X - hdw) / 2, "garageAnchorWorkshopPartition.2_3"],
  ] as [number, string][]) {
    const partition = new THREE.Mesh(
      new THREE.BoxGeometry(partitionThickness, model.serviceBay.h, partitionD),
      workshopWallMat,
    );
    partition.name = partName;
    partition.position.set(px, model.serviceBay.h / 2, model.serviceBay.z);
    partition.castShadow = true;
    partition.receiveShadow = true;
    service.add(partition);
  }

  // Spec 177: Solid architectural dividing core between showroom and service workshop
  const dividingCore = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, model.showroom.h, model.showroom.d),
    new THREE.MeshStandardMaterial({
      color: 0x1e2733,
      roughness: 0.65,
      metalness: 0.35,
    }),
  );
  dividingCore.name = "garageAnchorCentralDividingCore";
  dividingCore.position.set(0.0, model.showroom.h / 2, model.showroom.z);
  dividingCore.castShadow = true;
  dividingCore.receiveShadow = true;
  g.add(dividingCore);

  // Spec 177: Dedicated floating architectural roof canopy over the showroom pavilion
  const showroomRoof = new THREE.Mesh(
    new THREE.BoxGeometry(
      model.showroom.w + 0.35,
      0.16,
      model.showroom.d + 0.4,
    ),
    new THREE.MeshStandardMaterial({
      color: 0x222a36,
      roughness: 0.7,
      metalness: 0.25,
    }),
  );
  showroomRoof.name = "garageAnchorShowroomCanopyRoof";
  showroomRoof.position.set(
    model.showroom.x,
    model.showroom.h + 0.08,
    model.showroom.z,
  );
  showroomRoof.castShadow = true;

  const showroomRoofGlow = new THREE.Mesh(
    new THREE.BoxGeometry(
      model.showroom.w + 0.38,
      0.04,
      model.showroom.d + 0.42,
    ),
    mullionNeonMat,
  );
  showroomRoofGlow.position.set(
    model.showroom.x,
    model.showroom.h + 0.02,
    model.showroom.z,
  );
  g.add(showroomRoof, showroomRoofGlow);

  // Spec 177: Modern parapet roof over the service bays (garageAnchorGraphiteFlatRoofCanopy)
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(
      model.serviceBay.w + 0.25,
      0.16,
      model.serviceBay.d + 0.35,
    ),
    new THREE.MeshStandardMaterial({
      color: 0x303845,
      roughness: 0.82,
      metalness: 0.12,
    }),
  );
  roof.name = "garageAnchorGraphiteFlatRoofCanopy";
  roof.position.set(
    model.serviceBay.x,
    model.serviceBay.h + 0.08,
    model.serviceBay.z,
  );
  roof.castShadow = true;

  // Spec 177: Wide continuous driveway apron connecting municipal street to forecourt and all service bays
  const fullApronMat = new THREE.MeshStandardMaterial({
    color: 0x3d4450,
    roughness: 0.68,
    metalness: 0.05,
    emissive: 0xff9f2f,
    emissiveIntensity:
      garageAnchorNightFloorEmissive(C.state.clock.daylight) * 0.52,
  });
  C.garageFloorMats.push(fullApronMat);
  const fullApron = new THREE.Mesh(
    new THREE.BoxGeometry(model.drivewayApron.w, 0.036, model.drivewayApron.d),
    fullApronMat,
  );
  fullApron.name = "garageAnchorDrivewayApron";
  fullApron.position.set(
    model.drivewayApron.x,
    model.drivewayApron.y,
    model.drivewayApron.z,
  );
  fullApron.receiveShadow = true;
  g.add(fullApron);

  const wrenchGroup = new THREE.Group();
  wrenchGroup.name = "garageAnchorRooftopWrenchEmblem";
  wrenchGroup.position.set(
    model.serviceBay.x,
    model.serviceBay.h + 0.28,
    model.serviceBay.z,
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
      // Well-lit service bay interior cavity
      const cavityMat = new THREE.MeshStandardMaterial({
        color: 0x2e3846,
        roughness: 0.6,
        metalness: 0.15,
        emissive: 0x253040,
        emissiveIntensity: 0.45,
      });
      C.garageFloorMats.push(cavityMat);
      // Spec 177: Authentic hollow service bay interior floor lining (not a solid obstructive volume)
      const cavity = new THREE.Mesh(
        new THREE.BoxGeometry(
          model.serviceBay.bayDoorW * 1.05,
          0.02,
          model.serviceBay.d * 0.88,
        ),
        cavityMat,
      );
      cavity.name = "garageAnchorOpenBayInterior";
      cavity.position.set(sx, 0.03, bayFaceZ - model.serviceBay.d * 0.46);
      cavity.receiveShadow = true;
      g.add(cavity);

      // Spec 176: High-output service bay inspection PointLight
      const bayInspectionLight = new THREE.PointLight(0xfff8ee, 24, 15, 1.8);
      bayInspectionLight.position.set(
        sx,
        model.serviceBay.h * 0.7,
        bayFaceZ - model.serviceBay.d * 0.22,
      );
      g.add(bayInspectionLight);

      // Hydraulic twin-post car lift
      const liftMat = new THREE.MeshStandardMaterial({
        color: 0xf5a720,
        roughness: 0.35,
        metalness: 0.65,
        emissive: 0x8a5508,
        emissiveIntensity: 0.35,
      });
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(
          new THREE.BoxGeometry(0.18, model.serviceBay.h * 0.65, 0.22),
          liftMat,
        );
        post.name = `garageAnchorHydraulicLift.${side < 0 ? "left" : "right"}`;
        post.position.set(
          sx + model.serviceBay.bayDoorW * 0.38 * side,
          model.serviceBay.h * 0.32,
          bayFaceZ - model.serviceBay.d * 0.26,
        );
        g.add(post);
      }

      // Yellow hazard threshold apron strip
      const hazardStrip = new THREE.Mesh(
        new THREE.BoxGeometry(model.serviceBay.bayDoorW * 1.1, 0.02, 0.16),
        new THREE.MeshStandardMaterial({
          color: 0xffcc00,
          emissive: 0xffaa00,
          emissiveIntensity: 0.75,
          roughness: 0.3,
        }),
      );
      hazardStrip.position.set(sx, model.nightFloor.y + 0.04, bayFaceZ);
      g.add(hazardStrip);

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
    const doorFrameMat = new THREE.MeshStandardMaterial({
      color: 0xffb24a,
      emissive: 0xff8f2f,
      emissiveIntensity: 0.38,
      roughness: 0.36,
    });
    const frame = new THREE.Group();
    frame.name = `garageAnchorRollupDoorFrame.${i + 1}`;
    const jambW = 0.12;
    const jambH = model.serviceBay.h * 0.78;
    const jambD = 0.08;
    const leftJamb = new THREE.Mesh(
      new THREE.BoxGeometry(jambW, jambH, jambD),
      doorFrameMat,
    );
    leftJamb.position.set(-model.serviceBay.bayDoorW * 0.52, jambH / 2, 0);
    const rightJamb = new THREE.Mesh(
      new THREE.BoxGeometry(jambW, jambH, jambD),
      doorFrameMat,
    );
    rightJamb.position.set(model.serviceBay.bayDoorW * 0.52, jambH / 2, 0);
    const lintel = new THREE.Mesh(
      new THREE.BoxGeometry(model.serviceBay.bayDoorW * 1.14, 0.18, jambD),
      doorFrameMat,
    );
    lintel.position.set(0, jambH + 0.09, 0);
    frame.add(leftJamb, rightJamb, lintel);
    frame.position.set(door.position.x, 0, bayFaceZ + 0.01);
    g.add(frame);
    for (let slat = 1; slat <= 5 && !open; slat++) {
      const rib = new THREE.Mesh(
        new THREE.BoxGeometry(model.serviceBay.bayDoorW * 0.96, 0.025, 0.075),
        new THREE.MeshStandardMaterial({ color: 0x8fa1ad, roughness: 0.45 }),
      );
      rib.name = `garageAnchorDoorSlat.${i + 1}.${slat}`;
      rib.position.set(0, (slat - 3) * 0.25, 0.02);
      door.add(rib);
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
    const displaySpec = SHOWROOM_VEHICLES[i % SHOWROOM_VEHICLES.length]!.spec;
    const realCar = buildCarMesh(displaySpec);
    realCar.scale.setScalar(1.0);
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
    underGlow.position.y = 0.02;
    cg.add(underGlow, realCar);
    g.add(cg);
  }

  g.add(
    floor,
    forecourt,
    forecourtLane,
    showroomGroup,
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

/**
 * Spec 177 / Kooker HQ Landmark:
 * Builds the Kooker HQ corporate innovation campus directly on the parcel setback behind
 * the Gearbox Auto Hub commercial garage. Features a 3-storey command hub tower, East ("Forge")
 * and West ("Flow") operations wings, double-height glazed reception lobby with brass entrance
 * pilasters, illuminated "KOOKER HQ" fascia sign, and rooftop telemetry array.
 */
function buildKookerHqLandmark(C: CommercialCtx, d: CommercialDistrict): void {
  if (!d.garagePad) return;
  const garage = d.garagePad;
  const t = C.state.terrain;

  // Sited on the parcel setback directly behind the Gearbox Auto Hub commercial garage.
  const facing = garage.facingAngle;
  const backDirX = -Math.sin(facing);
  const backDirY = -Math.cos(facing);

  // Position Kooker HQ 10.5 cells behind garage center (~42m behind garage center, leaving a 16m courtyard plaza)
  const hqCenterGX = garage.x + (garage.w - 1) / 2 + backDirX * 10.5;
  const hqCenterGY = garage.y + (garage.h - 1) / 2 + backDirY * 10.5;

  const baseY = padSeatY(
    t,
    Math.round(hqCenterGX - 5),
    Math.round(hqCenterGY - 5),
    11,
    11,
  );

  const g = new THREE.Group();
  g.name = "commercialDistrict.kookerHq";
  g.userData = {
    kind: "kooker_hq_landmark",
    publicName: "Kooker HQ",
    isPublicSafe: true,
    facingAngle: facing + Math.PI / 2,
  };
  g.position.set(C.wx(hqCenterGX), baseY, C.wz(hqCenterGY));
  g.rotation.y = facing + Math.PI / 2;

  // 1. Foundation Plaza Slab
  const plazaMat = new THREE.MeshStandardMaterial({
    color: 0x272e3a,
    roughness: 0.8,
    metalness: 0.1,
  });
  const plaza = new THREE.Mesh(new THREE.BoxGeometry(44, 0.16, 32), plazaMat);
  plaza.name = "kookerHqPlazaBase";
  plaza.position.set(0, 0.08, 1);
  plaza.receiveShadow = true;
  g.add(plaza);

  // Entrance Steps
  const stepMat = new THREE.MeshStandardMaterial({
    color: 0x364050,
    roughness: 0.7,
    metalness: 0.15,
  });
  const step1 = new THREE.Mesh(new THREE.BoxGeometry(20, 0.14, 8), stepMat);
  step1.position.set(0, 0.21, 13);
  const step2 = new THREE.Mesh(new THREE.BoxGeometry(16, 0.14, 6), stepMat);
  step2.position.set(0, 0.35, 12);
  g.add(step1, step2);

  // Pathway Bollard Lights
  const bollardMat = new THREE.MeshStandardMaterial({
    color: 0x475569,
    roughness: 0.5,
    metalness: 0.6,
  });
  const bollardLightMat = new THREE.MeshStandardMaterial({
    color: 0xffd479,
    emissive: 0xffb347,
    emissiveIntensity: 1.5,
    roughness: 0.2,
  });
  C.garageFloorMats.push(bollardLightMat);
  for (const bx of [-7, -3.5, 3.5, 7]) {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.14, 0.9, 12),
      bollardMat,
    );
    post.position.set(bx, 0.45, 14.5);
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.16, 0.15, 12),
      bollardLightMat,
    );
    cap.position.set(bx, 0.92, 14.5);
    g.add(post, cap);
  }

  // 2. Central Command Tower (3-Storey Headquarters Pavilion)
  const facadeMat = new THREE.MeshStandardMaterial({
    color: 0x1e2633,
    roughness: 0.62,
    metalness: 0.25,
  });
  const tower = new THREE.Mesh(new THREE.BoxGeometry(22, 15, 16), facadeMat);
  tower.name = "kookerHqCentralTower";
  tower.position.set(0, 7.5, -2);
  tower.castShadow = true;
  tower.receiveShadow = true;
  g.add(tower);

  // Ribbon Window Bands (tinted curtain glass with glowing night emissive)
  const windowMat = new THREE.MeshStandardMaterial({
    color: 0x142e45,
    roughness: 0.12,
    metalness: 0.85,
    transparent: true,
    opacity: 0.78,
    emissive: 0x00d8f0,
    emissiveIntensity: 0.42,
  });
  C.garageFloorMats.push(windowMat);

  const ribbon1 = new THREE.Mesh(
    new THREE.BoxGeometry(22.3, 2.4, 16.3),
    windowMat,
  );
  ribbon1.position.set(0, 2.4, -2);
  const ribbon2 = new THREE.Mesh(
    new THREE.BoxGeometry(22.3, 2.2, 16.3),
    windowMat,
  );
  ribbon2.position.set(0, 6.8, -2);
  const ribbon3 = new THREE.Mesh(
    new THREE.BoxGeometry(22.3, 2.2, 16.3),
    windowMat,
  );
  ribbon3.position.set(0, 11.2, -2);
  g.add(ribbon1, ribbon2, ribbon3);

  // Tower Overhanging Parapet
  const parapetMat = new THREE.MeshStandardMaterial({
    color: 0x2e3848,
    roughness: 0.4,
    metalness: 0.35,
  });
  const towerParapet = new THREE.Mesh(
    new THREE.BoxGeometry(23.5, 0.6, 17.5),
    parapetMat,
  );
  towerParapet.position.set(0, 15.2, -2);
  g.add(towerParapet);

  // 3. East & West Campus Wings
  const wingMat = new THREE.MeshStandardMaterial({
    color: 0x232c3a,
    roughness: 0.65,
    metalness: 0.2,
  });
  // West Wing ("Flow")
  const westWing = new THREE.Mesh(new THREE.BoxGeometry(11, 9.5, 13), wingMat);
  westWing.name = "kookerHqWestWing";
  westWing.position.set(-16, 4.75, -2);
  westWing.castShadow = true;
  const westRibbon1 = new THREE.Mesh(
    new THREE.BoxGeometry(11.2, 2.0, 13.2),
    windowMat,
  );
  westRibbon1.position.set(-16, 2.4, -2);
  const westRibbon2 = new THREE.Mesh(
    new THREE.BoxGeometry(11.2, 2.0, 13.2),
    windowMat,
  );
  westRibbon2.position.set(-16, 6.8, -2);
  const westParapet = new THREE.Mesh(
    new THREE.BoxGeometry(12, 0.45, 14),
    parapetMat,
  );
  westParapet.position.set(-16, 9.65, -2);
  g.add(westWing, westRibbon1, westRibbon2, westParapet);

  // East Wing ("Forge")
  const eastWing = new THREE.Mesh(new THREE.BoxGeometry(11, 9.5, 13), wingMat);
  eastWing.name = "kookerHqEastWing";
  eastWing.position.set(16, 4.75, -2);
  eastWing.castShadow = true;
  const eastRibbon1 = new THREE.Mesh(
    new THREE.BoxGeometry(11.2, 2.0, 13.2),
    windowMat,
  );
  eastRibbon1.position.set(16, 2.4, -2);
  const eastRibbon2 = new THREE.Mesh(
    new THREE.BoxGeometry(11.2, 2.0, 13.2),
    windowMat,
  );
  eastRibbon2.position.set(16, 6.8, -2);
  const eastParapet = new THREE.Mesh(
    new THREE.BoxGeometry(12, 0.45, 14),
    parapetMat,
  );
  eastParapet.position.set(16, 9.65, -2);
  g.add(eastWing, eastRibbon1, eastRibbon2, eastParapet);

  // 4. Double-Height Glazed Entrance Lobby (Spec 152/153 Reception)
  const lobbyGroup = new THREE.Group();
  lobbyGroup.name = "kookerHqReceptionLobby";
  lobbyGroup.position.set(0, 0, 6.5);

  const lobbyGlassMat = new THREE.MeshStandardMaterial({
    color: 0x163854,
    roughness: 0.1,
    metalness: 0.85,
    transparent: true,
    opacity: 0.7,
    emissive: 0x00f0ff,
    emissiveIntensity: 0.45,
  });
  C.garageFloorMats.push(lobbyGlassMat);

  const lobbyBody = new THREE.Mesh(
    new THREE.BoxGeometry(14, 5.4, 8),
    facadeMat,
  );
  lobbyBody.position.set(0, 2.7, 0);
  lobbyGroup.add(lobbyBody);

  // Front Glass Curtain Wall
  const lobbyGlass = new THREE.Mesh(
    new THREE.PlaneGeometry(13.6, 5.1),
    lobbyGlassMat,
  );
  lobbyGlass.position.set(0, 2.7, 4.02);
  lobbyGroup.add(lobbyGlass);

  // Architectural Brass Columns
  const brassMat = new THREE.MeshStandardMaterial({
    color: 0xd4af37,
    roughness: 0.32,
    metalness: 0.8,
    emissive: 0x5a4210,
    emissiveIntensity: 0.25,
  });
  for (const px of [-6.8, -2.4, 2.4, 6.8]) {
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.45, 5.5, 0.5), brassMat);
    col.position.set(px, 2.75, 4.05);
    lobbyGroup.add(col);
  }

  // Brass Door Frame (2.4m wide x 3.0m high)
  const leftDoorPost = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 3.0, 0.2),
    brassMat,
  );
  leftDoorPost.position.set(-1.2, 1.5, 4.08);
  const rightDoorPost = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 3.0, 0.2),
    brassMat,
  );
  rightDoorPost.position.set(1.2, 1.5, 4.08);
  const doorLintel = new THREE.Mesh(
    new THREE.BoxGeometry(2.55, 0.15, 0.2),
    brassMat,
  );
  doorLintel.position.set(0, 3.05, 4.08);
  lobbyGroup.add(leftDoorPost, rightDoorPost, doorLintel);

  // Interior Reception Desk
  const desk = new THREE.Mesh(
    new THREE.BoxGeometry(3.6, 1.1, 1.2),
    new THREE.MeshStandardMaterial({
      color: 0x222b37,
      roughness: 0.6,
      metalness: 0.2,
    }),
  );
  desk.position.set(0, 0.55, -1.0);
  const deskNeon = new THREE.Mesh(
    new THREE.BoxGeometry(3.65, 0.08, 1.22),
    new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      emissive: 0x00f0ff,
      emissiveIntensity: 1.8,
    }),
  );
  deskNeon.position.set(0, 0.95, -1.0);
  lobbyGroup.add(desk, deskNeon);

  // Interior Lobby Light
  const lobbyLight = new THREE.PointLight(0xfffaed, 30, 22, 1.6);
  lobbyLight.position.set(0, 4.2, 0.5);
  lobbyGroup.add(lobbyLight);

  // Cantilevered Porch Canopy
  const canopy = new THREE.Mesh(
    new THREE.BoxGeometry(16, 0.45, 4.5),
    parapetMat,
  );
  canopy.position.set(0, 5.5, 2.2);
  const canopyTrim = new THREE.Mesh(
    new THREE.BoxGeometry(16.2, 0.08, 0.08),
    new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      emissive: 0x00f0ff,
      emissiveIntensity: 1.5,
    }),
  );
  canopyTrim.position.set(0, 5.3, 4.45);
  lobbyGroup.add(canopy, canopyTrim);
  g.add(lobbyGroup);

  // 5. Grand Illuminated "KOOKER HQ" Signage
  const signBacking = new THREE.Mesh(
    new THREE.BoxGeometry(12.5, 2.4, 0.35),
    new THREE.MeshStandardMaterial({
      color: 0x141a24,
      roughness: 0.4,
      metalness: 0.4,
    }),
  );
  signBacking.position.set(0, 8.8, 6.2);
  g.add(signBacking);

  // Paint dynamic CanvasTexture for billboard sign
  if (typeof document !== "undefined") {
    const cv = document.createElement("canvas");
    cv.width = 512;
    cv.height = 128;
    const ctx = cv.getContext("2d");
    if (ctx) {
      const grad = ctx.createLinearGradient(0, 0, 512, 128);
      grad.addColorStop(0, "#0a111a");
      grad.addColorStop(0.5, "#101b2a");
      grad.addColorStop(1, "#0a111a");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 512, 128);

      ctx.strokeStyle = "#00e5ff";
      ctx.lineWidth = 4;
      ctx.strokeRect(6, 6, 500, 116);

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 44px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowColor = "#00e5ff";
      ctx.shadowBlur = 12;
      ctx.fillText("🏛️ KOOKER HQ", 256, 48);

      ctx.shadowBlur = 0;
      ctx.fillStyle = "#7de7ff";
      ctx.font = "600 16px monospace";
      ctx.fillText("AUTONOMOUS CAMPUS · GLOBAL COMMONS", 256, 88);
    }
    const signTex = new THREE.CanvasTexture(cv);
    const signFace = new THREE.Mesh(
      new THREE.PlaneGeometry(12.2, 2.1),
      new THREE.MeshStandardMaterial({
        map: signTex,
        emissiveMap: signTex,
        emissive: 0xffffff,
        emissiveIntensity: 0.85,
        roughness: 0.3,
      }),
    );
    signFace.position.set(0, 8.8, 6.4);
    g.add(signFace);
  }

  // 6. Rooftop Telemetry & Communications Arrays
  const dishMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    metalness: 0.7,
    roughness: 0.3,
  });
  const dish = new THREE.Mesh(
    new THREE.CylinderGeometry(2.0, 0.4, 0.5, 24),
    dishMat,
  );
  dish.rotation.x = 0.55;
  dish.rotation.y = 0.4;
  dish.position.set(-6, 17.0, -4.5);
  const dishStem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.18, 1.8, 12),
    dishMat,
  );
  dishStem.position.set(-6, 15.9, -4.5);
  g.add(dish, dishStem);

  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.2, 6.5, 8),
    dishMat,
  );
  mast.position.set(6.5, 18.5, -4.5);
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.25, 12, 12),
    new THREE.MeshStandardMaterial({
      color: 0xff2a3e,
      emissive: 0xff2a3e,
      emissiveIntensity: 2.5,
    }),
  );
  beacon.position.set(6.5, 21.8, -4.5);
  const beaconLight = new THREE.PointLight(0xff2a3e, 14, 25);
  beaconLight.position.set(6.5, 21.8, -4.5);
  g.add(mast, beacon, beaconLight);

  // Rooftop Solar Photovoltaic Arrays on wings
  const solarMat = new THREE.MeshStandardMaterial({
    color: 0x163255,
    metalness: 0.9,
    roughness: 0.15,
  });
  for (const side of [-1, 1]) {
    for (const offset of [-3.5, 0, 3.5]) {
      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(2.4, 0.08, 3.2),
        solarMat,
      );
      panel.rotation.x = 0.25;
      panel.position.set(side * 16 + offset * 0.4, 9.9, -2 + offset);
      g.add(panel);
    }
  }

  // 7. Architectural Facade Uplights & Planters
  for (const side of [-1, 1]) {
    const uplight = new THREE.PointLight(0x00d2ff, 18, 14, 1.8);
    uplight.position.set(side * 7, 0.4, 10);
    g.add(uplight);

    const planter = new THREE.Mesh(
      new THREE.BoxGeometry(2.8, 0.75, 2.8),
      stepMat,
    );
    planter.position.set(side * 8.5, 0.45, 11);
    const planterSoil = new THREE.Mesh(
      new THREE.BoxGeometry(2.5, 0.1, 2.5),
      new THREE.MeshStandardMaterial({ color: 0x4a3b2c, roughness: 0.9 }),
    );
    planterSoil.position.set(side * 8.5, 0.8, 11);
    g.add(planter, planterSoil);
  }

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
  buildKookerHqLandmark(C, d);

  // Spec 143 — venue placements: ONE pure survey (venuePlacement.ts) decides each shop's
  // seat, facing, plot-filling footprint and entrance; the live junction zones carve
  // their no-build pads first so nothing stands inside a junction's bound. The runtime
  // (bar stools) and the node tests read the same survey — no per-renderer improvising.
  // Cap outlines attached first: the pad hit test wants the junction's real footprint, not its
  // broad-phase bounding circle. See junctionZonesToPads.
  const pads = junctionZonesToPads(
    attachCapPolys(findJunctionZones(C.state.roadWays ?? [])),
  );
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
    const ways = (C.state.roadWays ?? []) as RoadWay[];
    const ribbonCells = ribbonSurfaceCells(ways, t);
    const junctionPads = junctionZonesToPads(
      attachCapPolys(findJunctionZones(ways)),
    );

    // Spatial tracker to prevent any overlap between furniture, ensure clear pedestrian routes,
    // and keep all elements out of carriageways and pads.
    const placedFurniture: { wx: number; wz: number }[] = [];
    const isFurniturePosClear = (
      wx: number,
      wz: number,
      minDistance = 3.0,
    ): boolean => {
      for (const p of placedFurniture) {
        if (Math.hypot(p.wx - wx, p.wz - wz) < minDistance) return false;
      }
      return true;
    };

    const isCellInForbiddenZone = (gx: number, gy: number): boolean => {
      // 1. Never on road asphalt or within its buffer
      const rx = Math.round(gx);
      const ry = Math.round(gy);
      if (ribbonCells.has(`${rx},${ry}`)) return true;
      if (C.state.roadSet.has(`${rx},${ry}`)) return true;

      // 2. Never inside any junction pad (clear vehicle turning and crossing paths)
      for (const pad of junctionPads) {
        if (Math.hypot(pad.cx - gx, pad.cy - gy) <= pad.r + 0.8) return true;
      }

      // 3. Never inside garage pad or apron
      if (d.garagePad && isPointInGarageVicinity(gx, gy, d.garagePad))
        return true;

      // 4. Never inside mall pad
      if (
        gx >= d.mallPad.x - 1 &&
        gx <= d.mallPad.x + d.mallPad.w + 1 &&
        gy >= d.mallPad.y - 1 &&
        gy <= d.mallPad.y + d.mallPad.h + 1
      ) {
        return true;
      }

      return false;
    };

    for (let i = 0; i < street.length; i += 5) {
      const c = street[i]!;
      const side = Math.floor(i / 5) % 2 === 0 ? 1 : -1; // alternate verges down the strip
      // Verge offset: 2.55 cells (10.2m from street centreline; the 4-cell way carriageway edge is at 8m).
      // This places the pole 2.2m clear of the white road stripe into the safe pedestrian verge.
      const lampGy = c.y + side * 2.55;
      if (isCellInForbiddenZone(c.x, lampGy)) continue;

      const wx = C.wx(c.x);
      const wz = C.wz(lampGy);
      if (!isFurniturePosClear(wx, wz, 3.2)) continue;

      const by = Math.max(0, t.worldY(Math.round(c.x), Math.round(lampGy)));
      const lamp = new THREE.Group();
      lamp.position.set(wx, by, wz);

      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.09, 3.2, 6),
        poleMat,
      );
      pole.position.y = 1.6;
      pole.castShadow = true;

      // Arm points TOWARD the carriageway (-side), illuminating the walkway and curb
      const arm = new THREE.Mesh(
        new THREE.BoxGeometry(0.09, 0.09, 0.7),
        poleMat,
      );
      arm.position.set(0, 3.2, -side * 0.35);

      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.24, 8, 6),
        headMat,
      );
      head.position.set(0, 3.15, -side * 0.7);

      lamp.add(pole, arm, head);
      C.group.add(lamp);
      placedFurniture.push({ wx, wz });
    }

    // promenade FURNITURE between the lamps — benches + leafy planters on the verges
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

    for (let i = 2; i < street.length; i += 7) {
      const c = street[i]!;
      const side = Math.floor(i / 7) % 2 === 0 ? -1 : 1;
      // Offset 2.85 cells (11.4m from centreline; 3.4m clear of road edge, set back against parcel frontages)
      const benchGy = c.y + side * 2.85;
      if (isCellInForbiddenZone(c.x, benchGy)) continue;

      const wx = C.wx(c.x);
      const fz = C.wz(benchGy);
      if (!isFurniturePosClear(wx, fz, 3.0)) continue;

      const by = Math.max(0, t.worldY(Math.round(c.x), Math.round(benchGy)));
      // a bench facing the street (backrest on the verge side, seat facing the street)
      const bench = new THREE.Group();
      bench.position.set(wx, by, fz);
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
      placedFurniture.push({ wx, wz: fz });

      // leafy planter safely beside the bench (1.4m along the street, same safe setback)
      const planterGx = c.x + 0.35;
      const planterWx = C.wx(planterGx);
      if (
        !isCellInForbiddenZone(planterGx, benchGy) &&
        isFurniturePosClear(planterWx, fz, 1.2)
      ) {
        const planter = new THREE.Group();
        planter.position.set(planterWx, by, fz);
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
        placedFurniture.push({ wx: planterWx, wz: fz });
      }
    }
    // Spec 081 P0 — AD BOARDS at the strip approaches. Each board is a post pair + frame + a screen
    // plane carrying a CanvasTexture painted by adCanvas (a deterministic poster for one real shop, or
    // the welcome PSA when none). Placement is the pure surveyBillboards (collision-checked against
    // roads + shop footprints); the screen faces inward down the strip and glows softly after dark
    // (emissive under the bloom threshold). Disposed with the group — texture too (see the teardown).
    const boardBlocked = new Set<string>(C.state.roadSet);
    for (const k of ribbonCells) boardBlocked.add(k);
    for (const p of d.parcels)
      for (let yy = p.y; yy < p.y + p.h; yy++)
        for (let xx = p.x; xx < p.x + p.w; xx++)
          boardBlocked.add(`${xx},${yy}`);
    if (d.garagePad) {
      for (
        let yy = d.garagePad.y - 1;
        yy <= d.garagePad.y + d.garagePad.h + 1;
        yy++
      ) {
        for (
          let xx = d.garagePad.x - 1;
          xx <= d.garagePad.x + d.garagePad.w + 1;
          xx++
        ) {
          boardBlocked.add(`${xx},${yy}`);
        }
      }
    }
    if (d.mallPad) {
      for (
        let yy = d.mallPad.y - 1;
        yy <= d.mallPad.y + d.mallPad.h + 1;
        yy++
      ) {
        for (
          let xx = d.mallPad.x - 1;
          xx <= d.mallPad.x + d.mallPad.w + 1;
          xx++
        ) {
          boardBlocked.add(`${xx},${yy}`);
        }
      }
    }
    for (const pad of junctionPads) {
      const pr = Math.ceil(pad.r) + 1;
      for (let dy = -pr; dy <= pr; dy++) {
        for (let dx = -pr; dx <= pr; dx++) {
          if (Math.hypot(dx, dy) <= pad.r + 1) {
            boardBlocked.add(
              `${Math.round(pad.cx + dx)},${Math.round(pad.cy + dy)}`,
            );
          }
        }
      }
    }
    const shopById = new Map(d.parcels.map((p) => [p.id, p]));
    const postMat = new THREE.MeshStandardMaterial({
      color: 0x3a3f4a,
      roughness: 0.7,
    });
    for (const site of surveyBillboards(d, t, boardBlocked)) {
      const by = Math.max(0, t.worldY(Math.round(site.x), Math.round(site.y)));
      const grp = new THREE.Group();
      grp.name = `commercialBillboard.${site.id}`;
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
      if (typeof document !== "undefined") {
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
      }
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

  if (!place.buildable) {
    // When a junction pad or road ribbon sweeps the parcel, do not spawn a protruding forecourt slab
    // or crates that intrude into the carriageway or junction clearance envelope.
    return;
  }

  // Neon night floor — the glowing plot pad.
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
    new THREE.BoxGeometry(bodyW * 1.06, 0.035, bodyD * 1.06),
    floorMat,
  );
  floor.name = "commercialShopNightFloor";
  floor.position.y = 0.04;
  g.add(floor);

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
    const crateMat = new THREE.MeshStandardMaterial({
      color: 0x7a5a36,
      roughness: 0.9,
    });
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
    depthTest: true,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(1.8, 24), floorMat);
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
