import { describe, expect, it } from "vitest";
import { COLONY } from "../src/colony/config";
import { ColonyRuntime } from "../src/colony/runtime";
import { ColonySim, findIronworkPillarSite } from "../src/colony/sim";
import {
  fundIronworkStage,
  freeLabour,
  pillarStatus,
  restingToothIndex,
  undercroftBarPhase,
  isRetuneHour,
} from "../src/colony/build";

function economySnapshot(rt: ColonyRuntime) {
  const s = rt.sim.state;
  return {
    clock: s.clock.totalMinutes,
    colonists: Math.round(s.colonists * 1000) / 1000,
    treasury: Math.round(s.treasury * 1000) / 1000,
    materials: Math.round(s.materials * 1000) / 1000,
    components: Math.round(s.components * 1000) / 1000,
    reels: Math.round(s.reels * 1000) / 1000,
    linen: Math.round((s.linen ?? 0) * 1000) / 1000,
    food: Math.round(s.food * 1000) / 1000,
    unrest: Math.round((s.unrest ?? 0) * 1000) / 1000,
    jobs: s.jobs.length,
    buildings: s.buildings.length,
    spireStage: s.spireStage,
    pillarStage: s.pillarStage,
    pillarBuilding: s.pillarBuilding,
  };
}

describe("spec 144 Ironwork Pillar mechanics", () => {
  it("cycles the resting tooth through all twelve deterministic states", () => {
    const teeth = new Set<number>();
    for (let hour = 0; hour < 12; hour++) teeth.add(restingToothIndex(7, hour));
    expect([...teeth].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(undercroftBarPhase(7, 3)).toBe(undercroftBarPhase(7, 3));
    expect(isRetuneHour(0)).toBe(true);
    expect(isRetuneHour(1)).toBe(false);
  });

  it("places an invisible reserved pillar site at founding", () => {
    const sim = new ColonySim(4242);
    const pillar = sim.state.structures.find((s) => s.kind === "ironworkPillar");
    expect(pillar).toBeTruthy();
    const found = findIronworkPillarSite(sim.state.terrain, {
      used: sim.state.structures.filter((s) => s.kind !== "ironworkPillar"),
    });
    expect(found).toEqual({ x: pillar!.x, y: pillar!.y });
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        expect(sim.state.occupied.has(`${pillar!.x + dx},${pillar!.y + dy}`)).toBe(true);
      }
    }
  });

  it("funds a stage by consuming the stage bundle and reserving five hands", () => {
    const rt = new ColonyRuntime(4242);
    const s = rt.sim.state;
    s.colonists = COLONY.build.pillarStartColonists;
    s.treasury = 10000;
    s.materials = 1000;
    s.components = 1000;
    s.reels = 1000;
    s.linen = 1000;
    const beforeLabour = freeLabour(s);
    expect(fundIronworkStage(s)).toBe(true);
    expect(s.pillarBuilding).toBe(true);
    expect(s.pillarStage).toBe(0);
    expect(s.treasury).toBe(10000 - COLONY.build.pillarStageTreasury[0]);
    expect(s.materials).toBe(1000 - COLONY.build.pillarStageMaterials[0]);
    expect(s.components).toBe(1000 - COLONY.build.pillarStageComponents[0]);
    expect(freeLabour(s)).toBe(beforeLabour - COLONY.build.pillarStageCrew);
    const ui = rt.getUiState().colony.pillar;
    expect(ui).toMatchObject({ stage: 0, total: COLONY.build.pillarStageCount, building: true });
  });

  it("keeps stage zero economy byte-identical to a world with the pillar disabled", () => {
    const enabled = new ColonyRuntime(777);
    const disabled = new ColonyRuntime(777);
    disabled.sim.state.pillarStage = 0;
    disabled.sim.state.pillarProgress = 0;
    disabled.sim.state.pillarBuilding = false;
    disabled.sim.state.lastRetuneDay = disabled.sim.state.clock.day;
    for (let i = 0; i < 96; i++) {
      enabled.sim.step();
      disabled.sim.step();
    }
    expect(economySnapshot(enabled)).toEqual(economySnapshot(disabled));
  });

  it("persists the completed payoff and once-per-midnight retune guard", () => {
    const rt = new ColonyRuntime(4242);
    const s = rt.sim.state;
    s.pillarStage = COLONY.build.pillarStageCount;
    s.unrest = 0.01;
    s.clock.totalMinutes = 23 * 60 + 59;
    s.clock.day = 0;
    s.clock.hour = 23;
    s.clock.minute = 59;
    rt.sim.step();
    const afterMidnight = s.unrest;
    expect(s.lastRetuneDay).toBe(1);
    rt.sim.step();
    expect(s.unrest).toBe(afterMidnight);
    const saved = JSON.parse(JSON.stringify({
      pillarStage: s.pillarStage,
      pillarProgress: s.pillarProgress,
      pillarBuilding: s.pillarBuilding,
      lastRetuneDay: s.lastRetuneDay,
    }));
    const restored = new ColonyRuntime(4242);
    Object.assign(restored.sim.state, saved);
    expect(pillarStatus(restored.sim.state)).toMatchObject({
      stage: COLONY.build.pillarStageCount,
      complete: true,
      retuneTonight: false,
    });
  });
});
