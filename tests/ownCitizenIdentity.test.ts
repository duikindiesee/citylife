import { describe, it, expect } from "vitest";
import { CitizenRoster } from "../src/colony/bot/citizenRoster";
import { ColonyRuntime } from "../src/colony/runtime";

// Issue 2 — the player view / first-person must be keyed to the authenticated kooker USER ID, not the
// display name. These cover the roster's identity-first resolution and the runtime's claim/backfill so
// a colliding or reused display name can never reach another player's citizen.

/** Seed a citizen with a controlled id + display name (founder seeding is public-safe screened). */
function seed(roster: CitizenRoster, id: string, name: string) {
  return roster.seedFounder({
    id,
    householdId: `hh_${id}`,
    displayName: name,
    plotId: `plot_${id}`,
    plotName: "Cove",
    home: { x: 1, y: 1 },
    kind: "human",
    nowMs: 1,
  });
}

describe("CitizenRoster identity resolution", () => {
  it("resolves by kooker user id, ignoring a colliding display name", () => {
    const roster = new CitizenRoster();
    seed(roster, "a", "Alex"); // a different citizen that happens to share the name
    seed(roster, "b", "Alex"); // the one the player actually owns
    expect(roster.setKookerUserId("b", "user-1")).toBe(true);

    // Identity wins outright — the name match to `a` is irrelevant.
    expect(roster.resolveOwnCitizenId("user-1", "Alex")).toBe("b");
    expect(roster.byKookerUserId("user-1")?.id).toBe("b");
  });

  it("name fallback only matches an UNCLAIMED citizen", () => {
    const roster = new CitizenRoster();
    seed(roster, "a", "Bob"); // unclaimed
    seed(roster, "b", "Bob"); // owned by someone else
    roster.setKookerUserId("b", "user-2");

    // A bare name (no user id) resolves to the unclaimed citizen, never the claimed one.
    expect(roster.resolveOwnCitizenId(null, "Bob")).toBe("a");
    // A different user who owns nothing also only ever reaches the unclaimed citizen by name.
    expect(roster.resolveOwnCitizenId("user-3", "Bob")).toBe("a");
    expect(roster.resolveOwnCitizenId("user-3", "nobody")).toBeNull();
  });

  it("setKookerUserId rejects an unknown citizen or a blank id", () => {
    const roster = new CitizenRoster();
    seed(roster, "a", "Cleo");
    expect(roster.setKookerUserId("missing", "user-1")).toBe(false);
    expect(roster.setKookerUserId("a", "  ")).toBe(false);
    expect(roster.byKookerUserId("user-1")).toBeUndefined();
  });
});

describe("ColonyRuntime — identity-keyed own citizen", () => {
  it("claims the name-matched citizen for the signed-in user id at login", () => {
    const rt = new ColonyRuntime(4242);
    const me = rt.getUiState().citizens.list[0]!;

    rt.setOperatorName(me.displayName);
    rt.setOperatorUserId("kooker-1");
    rt.setPlayerView(true);

    const ui = rt.getUiState();
    expect(ui.firstPerson.operatorCitizenId).toBe(me.id);
    expect(ui.firstPerson.stepInCitizenIds).toEqual([me.id]);
  });

  it("keeps resolving by user id even when the login name later changes to another citizen", () => {
    const rt = new ColonyRuntime(4242);
    const list = rt.getUiState().citizens.list;
    const me = list[0]!;
    const other = list.find((c) => c.id !== me.id)!;

    rt.setOperatorName(me.displayName);
    rt.setOperatorUserId("kooker-1"); // claims `me`
    rt.setPlayerView(true);
    expect(rt.getUiState().firstPerson.operatorCitizenId).toBe(me.id);

    // A name collision (rename, or another citizen sharing the name) must NOT steal identity.
    rt.setOperatorName(other.displayName);
    const ui = rt.getUiState();
    expect(ui.firstPerson.operatorCitizenId).toBe(me.id);
    expect(ui.firstPerson.stepInCitizenIds).toEqual([me.id]);
    expect(rt.enterFirstPerson(other.id)).toBe(false); // cannot step into the name-colliding citizen
    expect(rt.enterFirstPerson(me.id)).toBe(true);
  });

  it("still resolves a legacy session by display name when no user id is set", () => {
    const rt = new ColonyRuntime(4242);
    const me = rt.getUiState().citizens.list[0]!;

    rt.setOperatorName(me.displayName); // no setOperatorUserId — legacy / userId-less token
    rt.setPlayerView(true);

    expect(rt.getUiState().firstPerson.operatorCitizenId).toBe(me.id);
    expect(rt.getUiState().firstPerson.stepInCitizenIds).toEqual([me.id]);
  });
});
