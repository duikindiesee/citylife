import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { isPublicSafe } from "../src/colony/newcomers";

const FRIEND_ID = "citizen_rally_friend";

// Phase-1 S1 — a deterministic, public-safe night-meetup friend pinned at the hilltop Rally Point so
// the operator can drive out and actually MEET someone: rallyPresence reaches two with a single live
// player. The friend must (a) stand at the rally cell, (b) stay pinned through the night bar-stroll,
// (c) be idempotent and public-safe.
describe("rally friend (phase-1 S1)", () => {
  function internals(rt: ColonyRuntime) {
    return rt as unknown as {
      citizens: {
        byId: (id: string) =>
          | {
              pos: { x: number; y: number };
              target: { x: number; y: number };
              displayName: string;
            }
          | undefined;
      };
      wanderIdleCitizens: (dt: number) => void;
      seedRallyFriend: () => void;
    };
  }

  it("seeds the friend standing at the rally cell, within the presence radius", () => {
    const rt = new ColonyRuntime(4242);
    const rally = rt.sim.state.structures.find((s) => s.kind === "rally")!;
    const cell = { x: Math.round(rally.x), y: Math.round(rally.y) };
    const friend = internals(rt).citizens.byId(FRIEND_ID);
    expect(friend).toBeTruthy();
    expect(friend!.displayName).toBe("Cole the Racer");
    expect(
      Math.hypot(friend!.pos.x - cell.x, friend!.pos.y - cell.y),
    ).toBeLessThan(0.01);
    // inside the R=1.5 presence radius, so a single arriving player makes two present
    expect(
      Math.hypot(friend!.pos.x - rally.x, friend!.pos.y - rally.y),
    ).toBeLessThanOrEqual(1.5);
  });

  it("pins the friend at the rally through the night bar-stroll (never wanders off)", () => {
    const rt = new ColonyRuntime(4242);
    const rally = rt.sim.state.structures.find((s) => s.kind === "rally")!;
    const cell = { x: Math.round(rally.x), y: Math.round(rally.y) };
    // force night — the path where idle citizens head to a bar stool (the move that would yank them)
    rt.sim.state.clock.isDay = false;
    const inner = internals(rt);
    const friend = inner.citizens.byId(FRIEND_ID)!;
    for (let i = 0; i < 300; i++) inner.wanderIdleCitizens(0.5);
    expect(
      Math.hypot(friend.pos.x - cell.x, friend.pos.y - cell.y),
    ).toBeLessThan(0.01);
    expect(
      Math.hypot(friend.target.x - cell.x, friend.target.y - cell.y),
    ).toBeLessThan(0.01);
  });

  it("seeds the friend once (idempotent) with a public-safe identity", () => {
    const rt = new ColonyRuntime(4242);
    const count = () =>
      rt.getUiState().citizens.list.filter((c) => c.id === FRIEND_ID).length;
    expect(count()).toBe(1);
    internals(rt).seedRallyFriend(); // re-seed must not duplicate
    expect(count()).toBe(1);
    expect(isPublicSafe("Cole the Racer")).toBe(true);
    expect(isPublicSafe("Rally Overlook")).toBe(true);
  });
});
