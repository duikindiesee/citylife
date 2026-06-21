import { describe, it, expect } from "vitest";
import { ColonySim } from "../src/colony/sim";
import { ColonyRuntime } from "../src/colony/runtime";
import { CitizenRoster } from "../src/colony/bot/citizenRoster";
import { firstPersonView } from "../src/colony/bot/firstPersonView";
import { generateHousehold } from "../src/colony/newcomers";
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
    expect(v.citizen.plotName).toBe(plot.name);
    expect(typeof v.ground.biome).toBe("string");
    expect(v.ground.biome.length).toBeGreaterThan(0);
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
});
