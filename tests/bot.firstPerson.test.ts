import { describe, it, expect } from "vitest";
import { ColonySim } from "../src/colony/sim";
import { ColonyRuntime } from "../src/colony/runtime";
import { CitizenRoster } from "../src/colony/bot/citizenRoster";
import { firstPersonView } from "../src/colony/bot/firstPersonView";
import { generateHousehold, isPublicSafe } from "../src/colony/newcomers";
import { makeCityPlan } from "../src/colony/cityPlan";

const fixedNow = 1_700_000_000_000;

function bootColony() {
  const sim = new ColonySim(42);
  sim.state.cityPlan = makeCityPlan(sim.state.terrain);
  const roster = new CitizenRoster();
  return { sim, roster };
}

describe("firstPersonView — spec 074", () => {
  it("returns null for an unknown citizen", () => {
    const { sim, roster } = bootColony();
    expect(firstPersonView(sim.state, "nope", roster)).toBeNull();
  });

  it("locates the citizen at their assigned plot", () => {
    const { sim, roster } = bootColony();
    const plot = sim.state.cityPlan!.plots[0]!;
    const c = roster.register(generateHousehold(7), plot, fixedNow)!;
    const v = firstPersonView(sim.state, c.id, roster)!;
    expect(v).toBeTruthy();
    expect(v.citizen.id).toBe(c.id);
    expect(v.citizen.homeXY).toEqual({ x: plot.x, y: plot.y });
    expect(v.citizen.positionXY).toEqual({ x: plot.x, y: plot.y });
    expect(v.citizen.plotName).toBe(plot.name);
    expect(typeof v.ground.biome).toBe("string");
    expect(v.ground.biome.length).toBeGreaterThan(0);
  });

  it("describes the citizen's current walking position, not only their home", () => {
    const { sim, roster } = bootColony();
    const plot = sim.state.cityPlan!.plots[0]!;
    const c = roster.register(generateHousehold(7), plot, fixedNow)!;
    c.pos = { x: plot.x + 3, y: plot.y + 2 };
    c.heading = Math.PI / 2;
    const v = firstPersonView(sim.state, c.id, roster)!;
    expect(v.citizen.homeXY).toEqual({ x: plot.x, y: plot.y });
    expect(v.citizen.positionXY).toEqual({ x: plot.x + 3, y: plot.y + 2 });
    expect(v.citizen.heading).toBeCloseTo(Math.PI / 2);
    const terrainIndex = sim.state.terrain.idx(plot.x + 3, plot.y + 2);
    expect(v.ground.elevation).toBe(
      Number((sim.state.terrain.elev[terrainIndex] ?? 0).toFixed(3)),
    );
  });

  it("reports neighbours when more than one citizen is registered", () => {
    const { sim, roster } = bootColony();
    const plots = sim.state.cityPlan!.plots;
    expect(plots.length).toBeGreaterThanOrEqual(2);
    const me = roster.register(generateHousehold(7), plots[0]!, fixedNow)!;
    roster.register(generateHousehold(11), plots[1]!, fixedNow);
    const v = firstPersonView(sim.state, me.id, roster)!;
    expect(v.neighbours.length).toBeGreaterThanOrEqual(1);
    expect(v.neighbours[0]!.distance).toBeGreaterThan(0); // not yourself
  });

  it("offers the nearest live neighbour as the first-person interaction prompt", () => {
    const { sim, roster } = bootColony();
    const plots = sim.state.cityPlan!.plots;
    expect(plots.length).toBeGreaterThanOrEqual(2);
    const me = roster.register(generateHousehold(7), plots[0]!, fixedNow)!;
    const neighbour = roster.register(
      generateHousehold(11),
      plots[1]!,
      fixedNow,
    )!;
    me.pos = { x: 20, y: 20 };
    neighbour.pos = { x: 21.2, y: 20 };
    sim.state.buildings.push({
      id: 9001,
      x: 20.4,
      y: 20,
      artifact: { kind: "market" },
    } as never);

    const v = firstPersonView(sim.state, me.id, roster)!;

    expect(v.interactionPrompt).toEqual({
      kind: "citizen",
      label: `Talk to ${neighbour.displayName}`,
      targetName: neighbour.displayName,
      targetXY: { x: 21.2, y: 20 },
      distance: 1.2,
    });
  });

  it("reports no neighbours when alone", () => {
    const { sim, roster } = bootColony();
    const plot = sim.state.cityPlan!.plots[0]!;
    const me = roster.register(generateHousehold(7), plot, fixedNow)!;
    const v = firstPersonView(sim.state, me.id, roster)!;
    expect(v.neighbours).toEqual([]);
  });

  it("reads colony mood from sim state", () => {
    const { sim, roster } = bootColony();
    const plot = sim.state.cityPlan!.plots[0]!;
    sim.state.outbreak = 0.4;
    sim.state.unrest = 0.2;
    sim.state.hygiene = 0.7;
    sim.state.food = 0;
    const me = roster.register(generateHousehold(7), plot, fixedNow)!;
    const v = firstPersonView(sim.state, me.id, roster)!;
    expect(v.mood.fever).toBe(0.4);
    expect(v.mood.unrest).toBe(0.2);
    expect(v.mood.hygiene).toBe(0.7);
    expect(v.mood.hungry).toBe(true);
  });

  it("passes the sim clock through verbatim", () => {
    const { sim, roster } = bootColony();
    const plot = sim.state.cityPlan!.plots[0]!;
    sim.state.clock.day = 9;
    sim.state.clock.hour = 14;
    sim.state.clock.minute = 23;
    const me = roster.register(generateHousehold(7), plot, fixedNow)!;
    const v = firstPersonView(sim.state, me.id, roster)!;
    expect(v.clock).toEqual({ day: 9, hour: 14, minute: 23, isDay: true });
  });

  it("restricts CITYLIFE_PLAYER step-in targets to the logged-in citizen only", () => {
    const rt = new ColonyRuntime(4242);
    const ui = rt.getUiState();
    const me = ui.citizens.list[0]!;
    const other = ui.citizens.list.find((c) => c.id !== me.id)!;

    rt.setOperatorName(me.displayName);
    rt.setPlayerView(true);

    const playerUi = rt.getUiState();
    expect(playerUi.firstPerson.stepInCitizenIds).toEqual([me.id]);
    expect(rt.enterFirstPerson(other.id)).toBe(false);
    expect(rt.getUiState().firstPerson.active).toBe(false);
    expect(rt.enterFirstPerson(me.id)).toBe(true);
    expect(rt.getUiState().firstPerson.citizenId).toBe(me.id);
  });

  it("keeps admin/operator step-in unrestricted", () => {
    const rt = new ColonyRuntime(4242);
    const ids = rt.getUiState().citizens.list.map((c) => c.id);
    rt.setPlayerView(false);
    expect(rt.getUiState().firstPerson.stepInCitizenIds).toEqual(ids);
  });

  it("scopes the mobile player HUD to the logged-in citizen's private data", () => {
    const rt = new ColonyRuntime(4242);
    const adminUi = rt.getUiState();
    const me = adminUi.citizens.list[0]!;
    const other = adminUi.citizens.list.find((c) => c.id !== me.id)!;
    const otherOwnedLot = adminUi.neighborhood.lots.find(
      (l) => l.ownerId === other.id,
    )!;
    expect(adminUi.citizens.wallets[other.id]).toBeGreaterThan(0);
    expect(otherOwnedLot.owner).toBe(other.displayName);

    rt.setOperatorName(me.displayName);
    rt.setPlayerView(true);

    const playerUi = rt.getUiState();
    expect(Object.keys(playerUi.citizens.wallets)).toEqual([me.id]);
    expect(playerUi.citizens.wallets[other.id]).toBeUndefined();
    expect(playerUi.bank.deposits).toBe(playerUi.citizens.wallets[me.id]);
    expect(playerUi.bank.accounts).toBe(1);
    expect(playerUi.bank.landOffice).toBe(0);
    expect(playerUi.bank.recent).toEqual([]);
    const scopedOtherLot = playerUi.neighborhood.lots.find(
      (l) => l.id === otherOwnedLot.id,
    )!;
    expect(scopedOtherLot.owner).toBe("Occupied");
    expect(scopedOtherLot.ownerId).toBeNull();
    expect(scopedOtherLot.occupied).toBe(true);
    expect(playerUi.neighborhood.free).toBe(adminUi.neighborhood.free);
    expect(playerUi.neighborhood.lots.filter((l) => !l.occupied).length).toBe(
      adminUi.neighborhood.free,
    );
    expect(
      playerUi.citizens.list.find((c) => c.id === other.id)!.displayName,
    ).toBe(other.displayName); // public presence stays visible
    expect(isPublicSafe(scopedOtherLot.owner!)).toBe(true);
  });

  it("does not leak other citizens' shop-buying power in the player HUD", () => {
    const rt = new ColonyRuntime(4242);
    const adminUi = rt.getUiState();
    const me = adminUi.citizens.list[0]!;
    const other = adminUi.citizens.list.find((c) => c.id !== me.id)!;
    const cheapest = adminUi.commerce.cheapest!;

    rt.sim.state.ledger.accounts[`citizen:${me.id}`] = 0;
    rt.sim.state.ledger.accounts[`citizen:${other.id}`] = cheapest.price;

    expect(rt.getUiState().commerce.canClaim).toBe(true);

    rt.setOperatorName(me.displayName);
    rt.setPlayerView(true);

    const playerUi = rt.getUiState();
    expect(playerUi.citizens.wallets[me.id]).toBe(0);
    expect(playerUi.citizens.wallets[other.id]).toBeUndefined();
    expect(playerUi.commerce.canClaim).toBe(false);
  });

  it("keeps unmatched player HUDs in public-stub mode instead of falling back to admin", () => {
    const rt = new ColonyRuntime(4242);
    const adminUi = rt.getUiState();
    const privatePlotNames = new Set(
      adminUi.citizens.list.map((c) => c.plotName),
    );

    rt.setOperatorName("johndoe");
    rt.setPlayerView(true);

    const playerUi = rt.getUiState();
    expect(playerUi.bank.scope).toBe("player");
    expect(playerUi.bank.deposits).toBe(0);
    expect(playerUi.bank.accounts).toBe(0);
    expect(playerUi.bank.recent).toEqual([]);
    expect(playerUi.firstPerson.stepInCitizenIds).toEqual([]);
    expect(Object.keys(playerUi.citizens.wallets)).toEqual([]);
    expect(playerUi.citizens.list.length).toBe(adminUi.citizens.list.length);
    for (const citizen of playerUi.citizens.list) {
      expect(citizen.plotName).toBe("Occupied");
      expect(privatePlotNames.has(citizen.plotName)).toBe(false);
      expect(citizen.telegramHandle).toBeUndefined();
      expect(citizen.tokensSpentLifetime).toBe(0);
      expect(isPublicSafe(citizen.plotName)).toBe(true);
    }
  });

  it("boots deterministic in-world agent citizens for Joe and Jack", () => {
    const rt = new ColonyRuntime(4242);
    const ui = rt.getUiState();
    const ids = ui.citizens.list.map((c) => c.id);
    expect(ids).toContain("citizen_joe");
    expect(ids).toContain("citizen_jack");

    const jack = ui.citizens.list.find((c) => c.id === "citizen_jack")!;
    expect(jack.displayName).toBe("Jack the Rabbit");
    expect(jack.plotName).toBe("Signal Burrow");
    expect(jack.telegramHandle).toBeUndefined();
    expect(jack.tokensSpentLifetime).toBe(0);

    const jackProfile = rt.kbProfile("citizen_jack")!;
    expect(jackProfile.alias).toBe("Jack the Rabbit");
    expect(jackProfile.kind).toBe("human");
    expect(jackProfile.bio).not.toMatch(/token|secret|cluster|telegram/i);
  });
});
