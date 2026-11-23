// Spec 175 — Smooth onboarding journey, garage drive-in clearance, homestead acquisition & GPS navigation
import { describe, it, expect } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";

describe("spec 175 — garage drive-in clearance and homestead acquisition", () => {
  const rt = new ColonyRuntime(4242);
  const district = rt.sim.state.commercialDistrict!;
  const garagePad = district.garagePad!;

  it("identifies garagePad forecourt and entrance apron as drivable", () => {
    expect(garagePad).toBeTruthy();
    // Forecourt center cell facing the road
    const forecourtCell = {
      x:
        garagePad.roadTarget.x +
        (garagePad.x + garagePad.w / 2 - garagePad.roadTarget.x) * 0.5,
      y:
        garagePad.roadTarget.y +
        (garagePad.y + garagePad.h / 2 - garagePad.roadTarget.y) * 0.5,
    };
    const isDrivable = rt.isGaragePadDrivable(
      forecourtCell.x,
      forecourtCell.y,
      garagePad,
    );
    expect(isDrivable).toBe(true);
  });

  it("blocks driving through solid back wall of the service bay", () => {
    // Back wall of the service bay (deep into negative local Z)
    const cx = garagePad.x + (garagePad.w - 1) / 2;
    const cy = garagePad.y + (garagePad.h - 1) / 2;
    const cos = Math.cos(garagePad.facingAngle);
    const sin = Math.sin(garagePad.facingAngle);
    // Behind the service bay: localX = 2.0, localZ = -4.5
    const worldX = cx + 2.0 * cos + -4.5 * sin;
    const worldY = cy - 2.0 * sin + -4.5 * cos;
    const isDrivable = rt.isGaragePadDrivable(worldX, worldY, garagePad);
    expect(isDrivable).toBe(false);
  });

  it("allows operator to claim a starter home and immediately builds house with GPS target", () => {
    // Find or create operator citizen
    const citizen = (rt as any).citizens.list()[0]!;
    rt.setOperatorName(citizen.displayName);
    rt.setOperatorUserId("test-player-1");
    const opId = rt.operatorCitizenId();
    expect(opId).toBeTruthy();

    // Clear any existing lot to test new-player onboarding journey
    for (const l of (rt as any).neighborhood.lots) {
      if (l.ownerCitizenId === opId) {
        l.ownerCitizenId = undefined;
        l.built = false;
      }
    }
    rt.setGpsNavigating(false);

    expect(rt.hasOperatorHome()).toBe(false);
    expect(rt.isGpsNavigating()).toBe(false);

    // Claim starter home
    const ok = rt.claimStarterHome();
    expect(ok).toBe(true);
    expect(rt.hasOperatorHome()).toBe(true);
    expect(rt.isGpsNavigating()).toBe(true);

    const homeTarget = rt.getOperatorHomeTarget();
    expect(homeTarget).toBeTruthy();
    expect(homeTarget?.lotId).toBeTruthy();
    expect(Number.isFinite(homeTarget?.x)).toBe(true);
    expect(Number.isFinite(homeTarget?.y)).toBe(true);

    // Lot is marked built
    const lot = (rt as any).neighborhood.lots.find(
      (l: any) => l.id === homeTarget!.lotId,
    );
    expect(lot?.built).toBe(true);
    expect(lot?.ownerCitizenId).toBe(opId);

    // Homestead driveway is drivable
    const drivewayX = lot!.doorX;
    const drivewayY = lot!.doorY;
    expect(rt.isHomesteadDriveway(drivewayX, drivewayY)).toBe(true);

    // Solid house zone blocks
    const houseCenterX = Math.round(lot!.houseZone.x + lot!.houseZone.w / 2);
    const houseCenterY = Math.round(lot!.houseZone.y + lot!.houseZone.d / 2);
    expect(rt.isHomesteadDriveway(houseCenterX, houseCenterY)).toBe(false);

    // Non-door lot.houseZone interior blocks as "building" without authoritativeHomeTruth
    expect(rt.getAuthoritativeHomeTruth()).toBeNull();
    expect((rt as any).blockedStepReason(houseCenterX, houseCenterY)).toBe("building");
    expect(
      (rt as any).blockedStepReason(houseCenterX, houseCenterY, {
        x: drivewayX,
        y: drivewayY,
      }),
    ).toBe("building");
    expect(
      (rt as any).blockedSegmentReason(
        { x: drivewayX, y: drivewayY },
        { x: houseCenterX, y: houseCenterY },
      ),
    ).toBe("building");

    // Owned door threshold remains walkable when stepping onto it
    expect((rt as any).blockedStepReason(drivewayX, drivewayY)).toBeNull();
    const prevDriveway =
      lot!.driveway?.find(
        (c: { x: number; y: number }) => c.x !== drivewayX || c.y !== drivewayY,
      ) ?? { x: drivewayX, y: drivewayY };
    expect(
      (rt as any).blockedStepReason(drivewayX, drivewayY, prevDriveway),
    ).toBeNull();

    // Unowned / other lot door and houseZone interior both block as "building" (with and without `from`)
    const otherLot = (rt as any).neighborhood.lots.find(
      (l: any) =>
        l.id !== lot!.id &&
        l.ownerCitizenId !== opId &&
        l.houseZone &&
        typeof l.doorX === "number" &&
        typeof l.doorY === "number",
    );
    expect(otherLot).toBeTruthy();
    const otherCenterX = Math.round(otherLot.houseZone.x + otherLot.houseZone.w / 2);
    const otherCenterY = Math.round(otherLot.houseZone.y + otherLot.houseZone.d / 2);
    expect((rt as any).blockedStepReason(otherLot.doorX, otherLot.doorY)).toBe(
      "building",
    );
    expect(
      (rt as any).blockedStepReason(otherLot.doorX, otherLot.doorY, {
        x: otherLot.doorX,
        y: otherLot.doorY,
      }),
    ).toBe("building");
    expect((rt as any).blockedStepReason(otherCenterX, otherCenterY)).toBe(
      "building",
    );
    expect(
      (rt as any).blockedStepReason(otherCenterX, otherCenterY, {
        x: otherLot.doorX,
        y: otherLot.doorY,
      }),
    ).toBe("building");
  });

  it("enforces authority-bound and neighbourhood-matched starter home resolution (MoJoJo finding)", () => {
    const testRt = new ColonyRuntime(4242);
    const citizen = (testRt as any).citizens.list()[0]!;
    testRt.setOperatorName(citizen.displayName);
    testRt.setOperatorUserId("test-operator-authority");
    const opId = testRt.operatorCitizenId()!;
    expect(opId).toBeTruthy();

    // Clear operator home
    for (const l of (testRt as any).neighborhood.lots) {
      if (l.ownerCitizenId === opId) {
        l.ownerCitizenId = undefined;
        l.built = false;
      }
    }

    // 1. Negative: Unowned or invalid HomeTruth refuses resolution without fallback
    const unownedTruth = {
      owned: false,
      status: "NONE",
      neighbourhoodKey: "coast4",
      plotId: null,
      frameId: null,
      onboardingState: "NONE",
      priceKco: null,
    };
    expect(testRt.claimStarterHome(unownedTruth as any)).toBe(false);
    expect(testRt.hasOperatorHome()).toBe(false);

    // 2. Negative: Non-existent plot ID refuses resolution
    const bogusPlotTruth = {
      owned: true,
      status: "OWNED",
      neighbourhoodKey: "coast4",
      plotId: "nonexistent-lot-99",
      frameId: null,
      onboardingState: "NONE",
      priceKco: null,
    };
    expect(testRt.claimStarterHome(bogusPlotTruth as any)).toBe(false);
    expect(testRt.hasOperatorHome()).toBe(false);

    // 3. Negative: Mismatched neighbourhood with plot ID refuses resolution
    const mismatchedTruth = {
      owned: true,
      status: "OWNED",
      neighbourhoodKey: "wood1",
      plotId: "coast4_lot_1",
      frameId: null,
      onboardingState: "NONE",
      priceKco: null,
    };
    expect(testRt.claimStarterHome(mismatchedTruth as any)).toBe(false);
    expect(testRt.hasOperatorHome()).toBe(false);

    // 3b. Negative: Owned truth with null plotId AND null neighbourhoodKey refuses without falling back to open land (MoJoJo finding)
    const unlocatedOwnedTruth = {
      owned: true,
      status: "OWNED",
      neighbourhoodKey: null,
      plotId: null,
      frameId: null,
      onboardingState: "NONE",
      priceKco: null,
    };
    expect(testRt.claimStarterHome(unlocatedOwnedTruth as any)).toBe(false);
    expect(testRt.hasOperatorHome()).toBe(false);

    // 4. Negative: Non-existent neighbourhood key string refuses without falling back to unrelated lots
    expect(testRt.claimStarterHome("nonexistent_hamlet_99")).toBe(false);
    expect(testRt.hasOperatorHome()).toBe(false);

    // 5. Positive: With no authority snapshot, the separate legacy path resolves 'coast4' strictly.
    testRt.setAuthoritativeHomeTruth(null);
    const okKey = testRt.claimStarterHome("coast4");
    expect(okKey).toBe(true);
    expect(testRt.hasOperatorHome()).toBe(true);
    const target = testRt.getOperatorHomeTarget();
    expect(target).toBeTruthy();
    const claimedLot = (testRt as any).neighborhood.lots.find(
      (l: any) => l.id === target!.lotId,
    );
    expect(claimedLot?.neighborhoodKey).toBe("coast4");
    expect(claimedLot?.built).toBe(true);
    expect(claimedLot?.ownerCitizenId).toBe(opId);

    // 6. Positive: Authoritative owned HomeTruth resolves matching plot and neighbourhood
    // Reset home
    claimedLot.ownerCitizenId = undefined;
    claimedLot.built = false;

    const validTruth = {
      owned: true,
      status: "OWNED",
      neighbourhoodKey: "coast4",
      plotId: "coast4_lot_2",
      frameId: null,
      onboardingState: "NONE",
      priceKco: 350,
    };
    const okTruth = testRt.claimStarterHome(validTruth as any);
    expect(okTruth).toBe(true);
    const truthTarget = testRt.getOperatorHomeTarget();
    expect(truthTarget?.lotId).toBe("coast4_lot_2");
    const truthLot = (testRt as any).neighborhood.lots.find(
      (l: any) => l.id === "coast4_lot_2",
    );
    expect(truthLot?.neighborhoodKey).toBe("coast4");
    expect(truthLot?.ownerCitizenId).toBe(opId);
    expect(truthLot?.built).toBe(true);

    // A malformed claim cannot replace the previously verified ownership projection.
    expect(testRt.claimStarterHome(mismatchedTruth as any)).toBe(false);
    expect(testRt.getAuthoritativeHomeTruth()).toEqual(validTruth);
    expect(testRt.getOperatorHomeTarget()).toEqual(truthTarget);

    // A concrete unowned result withdraws the projection, even if local assignment remains built.
    expect(testRt.claimStarterHome(unownedTruth as any)).toBe(false);
    expect(testRt.getAuthoritativeHomeTruth()).toEqual(unownedTruth);
    expect(testRt.getOperatorHomeTarget()).toBeNull();
    expect(testRt.getPlayerHomeDriveway()).toBeNull();
    expect(testRt.hasOperatorHome()).toBe(false);
    expect(truthLot?.built).toBe(true);

  });

  it("ensures showroom catalog carries authentic GLB models for all display vehicles", async () => {
    const { SHOWROOM_VEHICLES } = await import(
      "../src/colony/showroom/showroomCatalog"
    );
    expect(SHOWROOM_VEHICLES.length).toBe(3);
    for (const v of SHOWROOM_VEHICLES) {
      expect(v.glbUrl).toBeTruthy();
      expect(v.glbUrl?.endsWith(".glb")).toBe(true);
      expect(v.spec.paint.body).toBeDefined();
    }
    // Hero sports targa matching player car
    const x19 = SHOWROOM_VEHICLES.find(
      (v) => v.spec.id === "showroom:karoo-x19-targa",
    );
    expect(x19).toBeDefined();
    expect(x19?.glbUrl).toContain("fiat_x19.glb");
  });

  it("identifies garagePad forecourt and showroom as walkable on foot", () => {
    // Forecourt center cell
    const forecourtCell = {
      x:
        garagePad.roadTarget.x +
        (garagePad.x + garagePad.w / 2 - garagePad.roadTarget.x) * 0.5,
      y:
        garagePad.roadTarget.y +
        (garagePad.y + garagePad.h / 2 - garagePad.roadTarget.y) * 0.5,
    };
    expect(
      rt.isGaragePadWalkable(forecourtCell.x, forecourtCell.y, garagePad),
    ).toBe(true);

    // Showroom pedestrian floor: localX = -2.5, localZ = -0.5
    const cx = garagePad.x + (garagePad.w - 1) / 2;
    const cy = garagePad.y + (garagePad.h - 1) / 2;
    const cos = Math.cos(garagePad.facingAngle);
    const sin = Math.sin(garagePad.facingAngle);
    const showroomX = cx - 2.5 * cos + -0.5 * sin;
    const showroomY = cy + 2.5 * sin + -0.5 * cos;
    expect(rt.isGaragePadWalkable(showroomX, showroomY, garagePad)).toBe(true);
  });

  it("spawns founders outside every lot.houseZone", () => {
    const testRt = new ColonyRuntime(4242);
    const lots = (testRt as any).neighborhood.lots as any[];
    const inAnyHouseZone = (pos: { x: number; y: number }) => {
      const ix = Math.round(pos.x);
      const iy = Math.round(pos.y);
      return lots.some((l) => {
        const hz = l?.houseZone;
        if (!hz) return false;
        const w = hz.width ?? hz.w ?? 1;
        const d = hz.depth ?? hz.d ?? 1;
        return ix >= hz.x && ix < hz.x + w && iy >= hz.y && iy < hz.y + d;
      });
    };

    for (const id of ["citizen_joe", "citizen_viw", "citizen_jack"]) {
      const c = (testRt as any).citizens.byId(id);
      expect(c, `${id} should be seeded`).toBeTruthy();
      expect(inAnyHouseZone(c.pos), `${id}.pos must be outside houseZone`).toBe(false);
      expect(inAnyHouseZone(c.homeXY), `${id}.homeXY must be outside houseZone`).toBe(false);
    }
  });

  it("walks citizen_joe south off lot_1 parcel at 60fps when unauthenticated", () => {
    const walkRt = new ColonyRuntime(4242);
    const joe = (walkRt as any).citizens.byId("citizen_joe")!;
    const joeStart = { ...joe.pos };
    walkRt.enterFirstPerson("citizen_joe");
    walkRt.placeFirstPersonDogfood(joeStart, Math.PI / 2); // south along lot_1 driveway
    walkRt.setFpKey("KeyW", true);
    for (let i = 0; i < 120; i++) walkRt.stepFirstPersonDogfood(1 / 60);
    walkRt.setFpKey("KeyW", false);
    expect(walkRt.getUiState().firstPerson.blockedReason).toBeNull();
    expect(joe.pos.y).toBeGreaterThan(joeStart.y + 1.0);
    // Continue walking onto the street off the parcel
    walkRt.setFpKey("KeyW", true);
    for (let i = 0; i < 480; i++) walkRt.stepFirstPersonDogfood(1 / 60);
    walkRt.setFpKey("KeyW", false);
    expect(walkRt.getUiState().firstPerson.blockedReason).toBeNull();
    expect(
      (walkRt as any).sim.state.occupied.has(
        `${Math.round(joe.pos.x)},${Math.round(joe.pos.y)}`,
      ),
    ).toBe(false);
  });

  it("walks citizen_joe south off lot_1 parcel at 60fps when authenticated", () => {
    const walkRt = new ColonyRuntime(4242);
    const joe = (walkRt as any).citizens.byId("citizen_joe")!;
    walkRt.setOperatorName(joe.displayName);
    walkRt.setOperatorUserId("founder-walk-auth-1");
    const joeStart = { ...joe.pos };
    walkRt.enterFirstPerson("citizen_joe");
    walkRt.placeFirstPersonDogfood(joeStart, Math.PI / 2); // south along lot_1 driveway
    walkRt.setFpKey("KeyW", true);
    for (let i = 0; i < 120; i++) walkRt.stepFirstPersonDogfood(1 / 60);
    walkRt.setFpKey("KeyW", false);
    expect(walkRt.getUiState().firstPerson.blockedReason).toBeNull();
    expect(joe.pos.y).toBeGreaterThan(joeStart.y + 1.0);
    // Continue walking onto the street off the parcel
    walkRt.setFpKey("KeyW", true);
    for (let i = 0; i < 480; i++) walkRt.stepFirstPersonDogfood(1 / 60);
    walkRt.setFpKey("KeyW", false);
    expect(walkRt.getUiState().firstPerson.blockedReason).toBeNull();
    expect(
      (walkRt as any).sim.state.occupied.has(
        `${Math.round(joe.pos.x)},${Math.round(joe.pos.y)}`,
      ),
    ).toBe(false);
  });

  it("walks citizen_viw east from lot_2 doorstep at 60fps when unauthenticated", () => {
    const viwRt = new ColonyRuntime(4242);
    const viw = (viwRt as any).citizens.byId("citizen_viw")!;
    const viwStart = { ...viw.pos };
    viwRt.enterFirstPerson("citizen_viw");
    viwRt.placeFirstPersonDogfood(viwStart, 0); // east along lot_2 driveway
    viwRt.setFpKey("KeyW", true);
    for (let i = 0; i < 120; i++) viwRt.stepFirstPersonDogfood(1 / 60);
    viwRt.setFpKey("KeyW", false);
    expect(viwRt.getUiState().firstPerson.blockedReason).toBeNull();
    expect(viw.pos.x).toBeGreaterThan(viwStart.x + 1.0);
  });

  it("walks citizen_viw east from lot_2 doorstep at 60fps when authenticated", () => {
    const viwRt = new ColonyRuntime(4242);
    const viw = (viwRt as any).citizens.byId("citizen_viw")!;
    viwRt.setOperatorName(viw.displayName);
    viwRt.setOperatorUserId("founder-walk-auth-2");
    const viwStart = { ...viw.pos };
    viwRt.enterFirstPerson("citizen_viw");
    viwRt.placeFirstPersonDogfood(viwStart, 0); // east along lot_2 driveway
    viwRt.setFpKey("KeyW", true);
    for (let i = 0; i < 120; i++) viwRt.stepFirstPersonDogfood(1 / 60);
    viwRt.setFpKey("KeyW", false);
    expect(viwRt.getUiState().firstPerson.blockedReason).toBeNull();
    expect(viw.pos.x).toBeGreaterThan(viwStart.x + 1.0);
  });

  it("blocks fractional houseZone entry and parcel outer fence crossings", () => {
    const testRt = new ColonyRuntime(4242);
    const lot1 = (testRt as any).neighborhood.lots[0]!;
    const lot2 = (testRt as any).neighborhood.lots[1]!;

    // Fractional from at hz.x - 0.4 stepping into houseZone must return "building"
    expect(
      (testRt as any).blockedStepReason(lot1.houseZone.x + 1, lot1.houseZone.y, {
        x: lot1.houseZone.x - 0.4,
        y: lot1.houseZone.y,
      }),
    ).toBe("building");
    // Unowned door, back wall, side wall of lot_1 & lot_2 all return "building"
    expect((testRt as any).blockedStepReason(lot2.doorX, lot2.doorY)).toBe("building");
    expect(
      (testRt as any).blockedStepReason(
        lot1.houseZone.x + 1,
        lot1.houseZone.y,
        { x: lot1.houseZone.x + 1, y: lot1.houseZone.y + 1 },
      ),
    ).toBe("building");
    expect(
      (testRt as any).blockedStepReason(
        lot1.houseZone.x,
        lot1.houseZone.y + 1,
        { x: lot1.houseZone.x + 1, y: lot1.houseZone.y + 1 },
      ),
    ).toBe("building");

    // Walking east across an unowned parcel's outer fence boundary via stepFirstPersonDogfood(0.05)
    // stops at x < minX - 0.5 with fpBlockedReason === "parcel"
    const unownedLot = (testRt as any).neighborhood.lots.find(
      (l: any) => !l.ownerCitizenId && !l.reservedFor && l.fence?.length,
    )!;
    expect(unownedLot).toBeTruthy();
    const minX = Math.min(...unownedLot.fence.map((f: { x: number }) => f.x));
    const fenceRow = unownedLot.fence.find(
      (f: { x: number; y: number }) => f.x === minX && f.y !== unownedLot.gate?.y,
    )!;
    const joe = (testRt as any).citizens.byId("citizen_joe")!;
    testRt.enterFirstPerson("citizen_joe");
    testRt.placeFirstPersonDogfood({ x: minX - 1.2, y: fenceRow.y }, 0);
    testRt.setFpKey("KeyW", true);
    for (let i = 0; i < 60; i++) {
      testRt.stepFirstPersonDogfood(0.05);
    }
    testRt.setFpKey("KeyW", false);
    expect(joe.pos.x).toBeLessThan(minX - 0.5);
    expect(testRt.getUiState().firstPerson.blockedReason).toBe("parcel");
  });

  it("protects authoritativeHomeTruth driveway while blocking owned door threshold", () => {
    // With authoritativeHomeTruth.geometry.houseZone set, owned citizen at doorstep steps around driveway/yard (null)
    const authRt = new ColonyRuntime(4242);
    const owner = (authRt as any).citizens.byId("citizen_joe")!;
    authRt.setOperatorName(owner.displayName);
    authRt.setOperatorUserId("auth-driveway-owner");
    const ownedLot = (authRt as any).neighborhood.lots[0]!;
    const truth = {
      owned: true,
      status: "OWNED",
      neighbourhoodKey: ownedLot.neighborhoodKey ?? null,
      plotId: ownedLot.id,
      frameId: null,
      onboardingState: "OWNED",
      priceKco: 350,
      geometry: {
        houseZone: { ...ownedLot.houseZone },
        door: { x: ownedLot.doorX, y: ownedLot.doorY },
        driveway: ownedLot.driveway,
      },
    };
    expect(authRt.claimStarterHome(truth as any)).toBe(true);
    const doorstep = (authRt as any).lotDoorstepCell(ownedLot);
    const nextDriveway = ownedLot.driveway.find(
      (c: { x: number; y: number }) =>
        (c.x !== doorstep.x || c.y !== doorstep.y) &&
        !(authRt as any).isCellInHouseZone(ownedLot.houseZone, c.x, c.y),
    )!;
    expect(
      (authRt as any).blockedStepReason(nextDriveway.x, nextDriveway.y, doorstep),
    ).toBeNull();
    expect(
      (authRt as any).blockedStepReason(ownedLot.doorX, ownedLot.doorY, doorstep),
    ).toBe("building");
  });
});
