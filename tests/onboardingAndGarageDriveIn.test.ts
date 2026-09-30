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
      x: garagePad.roadTarget.x + (garagePad.x + garagePad.w / 2 - garagePad.roadTarget.x) * 0.5,
      y: garagePad.roadTarget.y + (garagePad.y + garagePad.h / 2 - garagePad.roadTarget.y) * 0.5,
    };
    const isDrivable = rt.isGaragePadDrivable(forecourtCell.x, forecourtCell.y, garagePad);
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
    const lot = (rt as any).neighborhood.lots.find((l: any) => l.id === homeTarget!.lotId);
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

    // 4. Negative: Non-existent neighbourhood key string refuses without falling back to unrelated lots
    expect(testRt.claimStarterHome("nonexistent_hamlet_99")).toBe(false);
    expect(testRt.hasOperatorHome()).toBe(false);

    // 5. Positive: Explicit neighbourhood key string 'coast4' resolves strictly to a coast4 lot
    const okKey = testRt.claimStarterHome("coast4");
    expect(okKey).toBe(true);
    expect(testRt.hasOperatorHome()).toBe(true);
    const target = testRt.getOperatorHomeTarget();
    expect(target).toBeTruthy();
    const claimedLot = (testRt as any).neighborhood.lots.find((l: any) => l.id === target!.lotId);
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
    const truthLot = (testRt as any).neighborhood.lots.find((l: any) => l.id === "coast4_lot_2");
    expect(truthLot?.neighborhoodKey).toBe("coast4");
    expect(truthLot?.ownerCitizenId).toBe(opId);
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
    const x19 = SHOWROOM_VEHICLES.find((v) => v.spec.id === "showroom:karoo-x19-targa");
    expect(x19).toBeDefined();
    expect(x19?.glbUrl).toContain("fiat_x19.glb");
  });

  it("identifies garagePad forecourt and showroom as walkable on foot", () => {
    // Forecourt center cell
    const forecourtCell = {
      x: garagePad.roadTarget.x + (garagePad.x + garagePad.w / 2 - garagePad.roadTarget.x) * 0.5,
      y: garagePad.roadTarget.y + (garagePad.y + garagePad.h / 2 - garagePad.roadTarget.y) * 0.5,
    };
    expect(rt.isGaragePadWalkable(forecourtCell.x, forecourtCell.y, garagePad)).toBe(true);

    // Showroom pedestrian floor: localX = -2.5, localZ = -0.5
    const cx = garagePad.x + (garagePad.w - 1) / 2;
    const cy = garagePad.y + (garagePad.h - 1) / 2;
    const cos = Math.cos(garagePad.facingAngle);
    const sin = Math.sin(garagePad.facingAngle);
    const showroomX = cx - 2.5 * cos + -0.5 * sin;
    const showroomY = cy + 2.5 * sin + -0.5 * cos;
    expect(rt.isGaragePadWalkable(showroomX, showroomY, garagePad)).toBe(true);
  });
});
