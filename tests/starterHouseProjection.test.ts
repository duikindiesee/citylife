import { describe, it, expect } from "vitest";
import {
  parseHomeTruth,
  type HomeTruth,
} from "../src/colony/home/starterProperty";
import {
  projectStarterHome,
  deriveHomeSeed,
  deriveHomePlacement,
  homeIdentityString,
  STARTER_PLACEMENT_GRID,
} from "../src/colony/home/starterHouseProjection";

// PLAYER.HOME.1C — the identity-bound house projection is a PURE function of the authoritative deed, so
// determinism, cross-device convergence and idempotency are provable without a DOM or a device.

function ownedTruth(over: Partial<HomeTruth> = {}): HomeTruth {
  return parseHomeTruth({
    owned: true,
    status: "OWNED",
    neighbourhoodKey: "coastal",
    plotId: "starter-home:user-42",
    frameId: "starter-home-frame:user-42",
    onboardingState: "OWNED",
    ...over,
  })!;
}

describe("projects exactly one house only for an OWNED deed", () => {
  it("returns null for a not-owned / pending / malformed truth", () => {
    expect(projectStarterHome(null)).toBeNull();
    expect(
      projectStarterHome(parseHomeTruth({ owned: false, status: null })),
    ).toBeNull();
    expect(
      projectStarterHome(parseHomeTruth({ owned: true, status: "PENDING" })),
    ).toBeNull();
    // owned but with no server reference at all → fail closed (no floating, non-deterministic house)
    expect(
      projectStarterHome(
        parseHomeTruth({
          owned: true,
          status: "OWNED",
          onboardingState: "OWNED",
        }),
      ),
    ).toBeNull();
  });
  it("returns exactly one bound house for an OWNED deed", () => {
    const p = projectStarterHome(ownedTruth());
    expect(p).not.toBeNull();
    expect(p!.frameId).toBe("starter-home-frame:user-42");
    expect(p!.plotId).toBe("starter-home:user-42");
    expect(p!.neighbourhoodKey).toBe("coastal");
    expect(p!.spec.seed).toBe(p!.seed);
  });
});

describe("deterministic + cross-device / re-login convergence", () => {
  it("the same deed always yields a byte-identical projection", () => {
    const a = projectStarterHome(ownedTruth());
    const b = projectStarterHome(ownedTruth());
    expect(a).toEqual(b); // seed, full HouseSpec and placement all identical
  });
  it("a second device seeing the same server truth converges on the same house + place", () => {
    // Simulate two independent client boots parsing the same authoritative JSON payload.
    const payload = {
      owned: true,
      status: "OWNED",
      neighbourhoodKey: "vale2",
      plotId: "starter-home:zed",
      frameId: "starter-home-frame:zed",
      onboardingState: "OWNED",
    };
    const device1 = projectStarterHome(parseHomeTruth(payload));
    const device2 = projectStarterHome(parseHomeTruth({ ...payload }));
    expect(device1).toEqual(device2);
    expect(device1!.placement).toEqual(device2!.placement);
  });
  it("is idempotent under a re-fetch / double-tap (no second or drifting house)", () => {
    const first = projectStarterHome(ownedTruth());
    // A double-tap re-fetches the SAME authoritative truth; the projection must not move.
    const afterReplay = projectStarterHome(ownedTruth());
    expect(afterReplay).toEqual(first);
  });
});

describe("identity binding — distinct players get distinct homes", () => {
  it("different server deeds derive different seeds and (almost surely) different placements", () => {
    const alice = projectStarterHome(
      ownedTruth({
        plotId: "starter-home:alice",
        frameId: "starter-home-frame:alice",
      }),
    )!;
    const bob = projectStarterHome(
      ownedTruth({
        plotId: "starter-home:bob",
        frameId: "starter-home-frame:bob",
      }),
    )!;
    expect(alice.seed).not.toBe(bob.seed);
    expect(alice.placement).not.toEqual(bob.placement);
  });
  it("the identity string prefers the server frame, then plot, then neighbourhood", () => {
    expect(homeIdentityString(ownedTruth({ frameId: "F", plotId: "P" }))).toBe(
      "F",
    );
    expect(
      homeIdentityString(
        parseHomeTruth({ owned: true, status: "OWNED", plotId: "P" })!,
      ),
    ).toBe("P");
    expect(
      homeIdentityString(
        parseHomeTruth({
          owned: true,
          status: "OWNED",
          neighbourhoodKey: "coastal",
        })!,
      ),
    ).toBe("nbh:coastal");
  });
});

describe("placement stays inside the bounded grid", () => {
  it("x and y are always within [0, GRID)", () => {
    for (const id of [
      "a",
      "bb",
      "ccc",
      "user-42",
      "zzzzzz",
      "starter-home:q",
    ]) {
      const place = deriveHomePlacement(
        ownedTruth({ plotId: id, frameId: `frame:${id}` }),
      );
      expect(place.x).toBeGreaterThanOrEqual(0);
      expect(place.x).toBeLessThan(STARTER_PLACEMENT_GRID);
      expect(place.y).toBeGreaterThanOrEqual(0);
      expect(place.y).toBeLessThan(STARTER_PLACEMENT_GRID);
    }
  });
  it("deriveHomeSeed is a stable 32-bit unsigned integer", () => {
    const s = deriveHomeSeed(ownedTruth());
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(0xffffffff);
    expect(deriveHomeSeed(ownedTruth())).toBe(s);
  });
});
