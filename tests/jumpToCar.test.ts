import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";

// Spec 096 E — "jump into your house, land next to your car". jumpToMyHouse steps the signed-in player
// into first person as their OWN citizen, standing beside their parked car. The beside-the-car spawn
// and facing are verified live on 5191; here we cover the deterministic, renderer-free behaviour: the
// operator gate and that the player enters first person as themselves.
describe("jump to my car (096 E)", () => {
  it("drops the signed-in player into first person as their own citizen", () => {
    const rt = new ColonyRuntime(4242);
    const me = rt.getUiState().citizens.list[0]!;
    rt.setOperatorName(me.displayName);
    expect(rt.getUiState().firstPerson.active).toBe(false);

    expect(rt.jumpToMyHouse()).toBe(true);
    const fp = rt.getUiState().firstPerson;
    expect(fp.active).toBe(true);
    expect(fp.citizenId).not.toBeNull();
    // you land in your OWN avatar, not someone else's
    expect(fp.citizenId).toBe(fp.operatorCitizenId);
  });

  it("is a no-op without an operator citizen", () => {
    const rt = new ColonyRuntime(4242);
    expect(rt.jumpToMyHouse()).toBe(false);
    expect(rt.getUiState().firstPerson.active).toBe(false);
  });

  it("places citizen outside every lot.houseZone before and after claimStarterHome (including authoritativeHomeTruth)", () => {
    const rt = new ColonyRuntime(4242);
    const me = rt.getUiState().citizens.list[0]!;
    rt.setOperatorName(me.displayName);

    const isInsideAnyLotHouseZone = (pos: { x: number; y: number }) => {
      const ix = Math.round(pos.x);
      const iy = Math.round(pos.y);
      return (rt as any).neighborhood.lots.some((l: any) => {
        const hz = l?.houseZone;
        if (!hz) return false;
        const w = hz.width ?? hz.w ?? 1;
        const d = hz.depth ?? hz.d ?? 1;
        return ix >= hz.x && ix < hz.x + w && iy >= hz.y && iy < hz.y + d;
      });
    };

    expect(rt.jumpToMyHouse()).toBe(true);
    let citizen = (rt as any).citizens.byId(me.id)!;
    expect(isInsideAnyLotHouseZone(citizen.pos)).toBe(false);
    expect((rt as any).blockedStepReason(citizen.pos.x, citizen.pos.y)).not.toBe("building");

    rt.setOperatorUserId("jump-car-owner-1");
    expect(rt.claimStarterHome()).toBe(true);
    expect(rt.jumpToMyHouse()).toBe(true);
    citizen = (rt as any).citizens.byId(me.id)!;
    expect(isInsideAnyLotHouseZone(citizen.pos)).toBe(false);
    expect((rt as any).blockedStepReason(citizen.pos.x, citizen.pos.y)).not.toBe("building");

    const ownedLot = (rt as any).neighborhood.lots.find(
      (l: any) => l.ownerCitizenId === me.id,
    )!;
    expect(ownedLot).toBeTruthy();
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
    expect(rt.claimStarterHome(truth as any)).toBe(true);
    // Even if homeXY were synthetic inside houseZone, jumpToMyHouse resolves outside truth.geometry.houseZone
    citizen.homeXY = {
      x: Math.round(ownedLot.houseZone.x + ownedLot.houseZone.w / 2),
      y: Math.round(ownedLot.houseZone.y + ownedLot.houseZone.d / 2),
    };
    expect(rt.jumpToMyHouse()).toBe(true);
    citizen = (rt as any).citizens.byId(me.id)!;
    expect(isInsideAnyLotHouseZone(citizen.pos)).toBe(false);
    expect((rt as any).blockedStepReason(citizen.pos.x, citizen.pos.y)).not.toBe("building");
  });
});
