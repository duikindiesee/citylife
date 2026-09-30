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
