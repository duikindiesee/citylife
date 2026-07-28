// BUG.GEO.1 — wiring proof. The pure resolver is covered in presenceReadout.test.ts; this file proves
// the RUNTIME feeds it the authoritative frame graph, the live roster pose and the real world seed, and
// that spec 152's visibility policy is enforced against the existing step-in authorization rail.
import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { avatarTransform } from "../src/colony/render/avatarLayer";

const SEED = 4242;

describe("ColonyRuntime.presenceReadout", () => {
  it("locates the stepped-in citizen at the pose the renderer draws them at", () => {
    const rt = new ColonyRuntime(SEED);
    const me = rt.getUiState().citizens.list[0]!;
    rt.enterFirstPerson(me.id);
    const pose = rt.getUiState().firstPerson.view!.citizen;

    const readout = rt.presenceReadout();
    const local = readout.entries.find((e) => e.isLocal)!;
    expect(local.subjectId).toBe(me.id);
    expect(local.resolution).toBe("exact");

    const terrain = rt.sim.state.terrain;
    const expected = avatarTransform(
      { x: pose.positionXY.x, y: pose.positionXY.y, heading: pose.heading },
      terrain.size,
      (x, y) => terrain.worldY(x, y),
    );
    expect(local.fix!.world.x).toBeCloseTo(expected.wx, 6);
    expect(local.fix!.world.z).toBeCloseTo(expected.wz, 6);
    expect(local.fix!.cell!.x).toBeCloseTo(pose.positionXY.x, 6);
    expect(local.fix!.cell!.y).toBeCloseTo(pose.positionXY.y, 6);
    expect(local.fix!.withinExtent).toBe(true);
  });

  it("stamps the world seed and a canonical sol so a screenshot is reproducible", () => {
    const rt = new ColonyRuntime(SEED);
    const stamp = rt.presenceReadout().stamp;
    expect(stamp.worldSeed).toBe(SEED);
    expect(Number.isInteger(stamp.sol)).toBe(true);
    expect(stamp.sol).toBeGreaterThanOrEqual(0);
    expect(stamp.solHour).toBeGreaterThanOrEqual(0);
    expect(stamp.solHour).toBeLessThan(24);
  });

  it("addresses presence against the authoritative surface frame, not an ad-hoc id", () => {
    const rt = new ColonyRuntime(SEED);
    const surfaceFrameId = rt.worldSurvey().surfaceFrameId;
    expect(rt.presenceFrames().surfaceFrameId).toBe(surfaceFrameId);
    const entry = rt.presenceReadout().entries[0]!;
    expect(entry.ancestry.map((f) => f.frameId)).toContain(surfaceFrameId);
    expect(entry.ancestry[entry.ancestry.length - 1]!.frameId).toBe(
      "universe:citylife",
    );
  });

  it("coarsens everyone the player is not authorized to resolve, and only them", () => {
    const rt = new ColonyRuntime(SEED);
    const list = rt.getUiState().citizens.list;
    expect(list.length).toBeGreaterThan(1); // otherwise the policy is untested
    const me = list[0]!;
    rt.setOperatorName(me.displayName);
    rt.setPlayerView(true);

    const readout = rt.presenceReadout();
    const own = readout.entries.filter((e) => e.resolution === "exact");
    expect(own.map((e) => e.subjectId)).toEqual([me.id]);
    const others = readout.entries.filter((e) => e.subjectId !== me.id);
    expect(others.length).toBeGreaterThan(0);
    for (const other of others) {
      expect(other.resolution).toBe("coarse");
      expect(other.fix).toBeNull();
      expect(other.headingDegrees).toBeNull();
    }
  });

  it("resolves every citizen exactly for an operator view", () => {
    const rt = new ColonyRuntime(SEED);
    rt.setPlayerView(false);
    const readout = rt.presenceReadout();
    expect(readout.entries.length).toBeGreaterThan(0);
    expect(readout.entries.every((e) => e.resolution === "exact")).toBe(true);
  });
});
