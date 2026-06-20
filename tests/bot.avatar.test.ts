import { describe, it, expect } from "vitest";
import { CitizenRoster } from "../src/colony/bot/citizenRoster";
import { generateHousehold } from "../src/colony/newcomers";
import type { Plot } from "../src/colony/cityPlan";

const plot: Plot = {
  id: "plot_1",
  name: "Beach Cove",
  vibe: "beach",
  zone: "residential",
  x: 10,
  y: 12,
  description: "a sandy plot",
};
const NOW = 1_700_000_000_000;

function citizen() {
  const r = new CitizenRoster();
  const c = r.register(generateHousehold(7), plot, NOW)!;
  return { r, c };
}

describe("P1 — citizen avatar movement", () => {
  it("starts the avatar at the home cell, at rest", () => {
    const { c } = citizen();
    expect(c.pos).toEqual({ x: 10, y: 12 });
    expect(c.target).toEqual({ x: 10, y: 12 });
    expect(c.heading).toBe(0);
    expect(c.spd).toBeGreaterThan(0);
  });

  it("setTarget points the avatar at a destination cell", () => {
    const { r, c } = citizen();
    expect(r.setTarget(c.id, { x: 20, y: 12 })).toBe(true);
    expect(c.target).toEqual({ x: 20, y: 12 });
    expect(r.setTarget("nope", { x: 1, y: 1 })).toBe(false);
    expect(r.setTarget(c.id, { x: Number.NaN, y: 1 })).toBe(false);
  });

  it("stepAvatars eases the avatar toward its target and never overshoots", () => {
    const { r, c } = citizen();
    r.setTarget(c.id, { x: 10 + c.spd, y: 12 }); // exactly one second of travel away
    r.stepAvatars(0.5);
    expect(c.pos.x).toBeCloseTo(10 + c.spd * 0.5, 5);
    expect(c.pos.y).toBeCloseTo(12, 5);
    expect(c.heading).toBeCloseTo(0, 5); // moving +x
    r.stepAvatars(0.5);
    expect(c.pos.x).toBeCloseTo(10 + c.spd, 5); // arrived, not past
    // further stepping does not overshoot
    r.stepAvatars(5);
    expect(c.pos.x).toBeCloseTo(10 + c.spd, 5);
  });

  it("ignores a non-positive or garbage dt", () => {
    const { r, c } = citizen();
    r.setTarget(c.id, { x: 30, y: 12 });
    const before = { ...c.pos };
    r.stepAvatars(0);
    r.stepAvatars(-1);
    r.stepAvatars(Number.NaN);
    expect(c.pos).toEqual(before);
  });

  it("avatars() exposes public render data only (name + position, no gateway url)", () => {
    const { r, c } = citizen();
    c.hasPod = true;
    (c as unknown as { botGatewayUrl?: string }).botGatewayUrl =
      "http://bot.citylife-citizens.svc.cluster.local:18789";
    const av = r.avatars();
    expect(av).toHaveLength(1);
    expect(av[0]!.id).toBe(c.id);
    expect(av[0]!.displayName).toBe(c.displayName);
    expect(av[0]!.hasPod).toBe(true);
    expect(
      (av[0] as unknown as { botGatewayUrl?: string }).botGatewayUrl,
    ).toBeUndefined();
  });
});
