import { describe, it, expect } from "vitest";
import { CitizenRoster } from "../src/colony/bot/citizenRoster";
import { generateHousehold } from "../src/colony/newcomers";
import type { Plot } from "../src/colony/cityPlan";

// Spec 078 — Joe the Crab, the founding resident. These cover the roster plumbing that makes a
// permanent, non-household crab citizen possible (the renderer + runtime wiring is verified live on
// :5188). Pure, deterministic, node-safe — same style as the spec-074 roster tests.

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

const JOE = {
  id: "citizen_joe",
  householdId: "household_joe",
  displayName: "Joe the Crab",
  plotId: "lot_4",
  plotName: "Driftwood Cove",
  home: { x: 100, y: 106 },
  kind: "crab" as const,
  avatarKind: "crab" as const,
  glbUrl: "/assets/citylife/avatars/joe-crab.glb",
  nowMs: 0,
  spd: 0.6,
};

describe("Spec 078 — Joe the Crab founder plumbing", () => {
  it("ordinary citizens default to human avatarKind without a dedicated GLB", () => {
    const r = new CitizenRoster();
    const c = r.register(generateHousehold(7), plot, NOW)!;
    expect(c.kind).toBe("human");
    expect(c.avatarKind).toBe("human");
    expect(c.glbUrl).toBeUndefined();
    const av = r.avatars()[0]!;
    expect(av.kind).toBe("human");
    expect(av.avatarKind).toBe("human");
    expect(av.glbUrl).toBeUndefined();
  });

  it("seedFounder seeds Joe with a dedicated animated GLB avatar", () => {
    const r = new CitizenRoster();
    const joe = r.seedFounder(JOE)!;
    expect(joe.kind).toBe("crab");
    expect(joe.avatarKind).toBe("crab");
    expect(joe.glbUrl).toBe("/assets/citylife/avatars/joe-crab.glb");
    expect(joe.id).toBe("citizen_joe");
    expect(joe.displayName).toBe("Joe the Crab");
    expect(joe.homeXY).toEqual({ x: 100, y: 106 });
    expect(joe.pos).toEqual({ x: 100, y: 106 });
    expect(joe.target).toEqual({ x: 100, y: 106 });
    expect(joe.spd).toBe(0.6);
    expect(joe.hasPod).toBe(false);
    expect(r.byId("citizen_joe")).toBe(joe);
  });

  it("routes Joe through the avatar stream with glbUrl so only unnamed crabs stay instanced", () => {
    const r = new CitizenRoster();
    r.register(generateHousehold(7), plot, NOW); // a human neighbour
    r.seedFounder(JOE);
    const av = r.avatars();
    const human = av.find((a) => a.id !== "citizen_joe")!;
    const joe = av.find((a) => a.id === "citizen_joe")!;
    expect(human.kind).toBe("human");
    expect(human.avatarKind).toBe("human");
    expect(human.glbUrl).toBeUndefined();
    expect(joe.kind).toBe("crab");
    expect(joe.avatarKind).toBe("crab");
    expect(joe.glbUrl).toBe("/assets/citylife/avatars/joe-crab.glb");
    expect(joe.displayName).toBe("Joe the Crab");
  });

  it("is idempotent on the citizen id — re-seeding keeps the original record unchanged", () => {
    const r = new CitizenRoster();
    const a = r.seedFounder(JOE)!;
    const b = r.seedFounder({
      ...JOE,
      plotId: "lot_9",
      plotName: "Elsewhere",
      home: { x: 9, y: 9 },
      nowMs: 50,
    })!;
    expect(b).toBe(a);
    expect(b.homeXY).toEqual({ x: 100, y: 106 }); // unchanged
    expect(r.size()).toBe(1);
  });

  it("refuses a founder whose name fails public-safety screening (no internal/secret strings)", () => {
    const r = new CitizenRoster();
    const bad = r.seedFounder({ ...JOE, displayName: "Joe the secret token" });
    expect(bad).toBeNull();
    expect(r.size()).toBe(0);
  });
});
