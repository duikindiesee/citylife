import { describe, expect, it, vi } from "vitest";
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
        list: () => { id: string }[];
      };
      wanderIdleCitizens: (dt: number) => void;
      seedRallyFriend: () => void;
      fpCitizenId: string | null;
      barSeatCells: { x: number; y: number }[] | null;
      barOccupied: Set<string>;
      barSeatBy: (string | null)[];
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
    const t0 = performance.now();
    const rt = new ColonyRuntime(4242);
    const tConstruct = performance.now() - t0;
    const rally = rt.sim.state.structures.find((s) => s.kind === "rally")!;
    const cell = { x: Math.round(rally.x), y: Math.round(rally.y) };
    // force night — the path where idle citizens head to a bar stool (the move that would yank them)
    rt.sim.state.clock.isDay = false;
    const inner = internals(rt);
    const friend = inner.citizens.byId(FRIEND_ID)!;

    // Component-level test fixture: provide deterministic valid cached bar seats so the night
    // bar-stroll branch actively exercises seat allocation across idle citizens without repeatedly
    // executing the expensive unbuildable-seed geometric survey on every wander tick.
    // Note: this is a test component fixture, not canonical surveyed geometry.
    const barStool = { x: cell.x + 20, y: cell.y + 20 };
    inner.barSeatCells = [barStool];

    // Arrange an eligible unpinned citizen (position equals target, not fpCitizenId, not FRIEND_ID)
    const unpinnedPub = inner.citizens
      .list()
      .find((c) => c.id !== FRIEND_ID && c.id !== inner.fpCitizenId);
    expect(unpinnedPub).toBeTruthy();
    const unpinnedCit = inner.citizens.byId(unpinnedPub!.id)!;

    for (const pub of inner.citizens.list()) {
      if (pub.id === FRIEND_ID || pub.id === inner.fpCitizenId) continue;
      const c = inner.citizens.byId(pub.id);
      if (!c) continue;
      if (pub.id === unpinnedPub!.id) {
        c.pos = { x: cell.x + 10, y: cell.y + 10 };
        c.target = { x: cell.x + 10, y: cell.y + 10 };
      } else {
        // Keep other citizens in transit so the unpinned citizen deterministically claims the stool
        c.target = { x: c.pos.x + 5, y: c.pos.y + 5 };
      }
    }

    // Force seat-allocation random outcome with a scoped/restored spy:
    // dt = 0.5, so dt * 0.3 = 0.15. Returning 0.05 guarantees Math.random() < dt * 0.3.
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.05);
    const tWanderStart = performance.now();
    try {
      for (let i = 0; i < 300; i++) inner.wanderIdleCitizens(0.5);
    } finally {
      randomSpy.mockRestore();
    }
    const tWanderTotal = performance.now() - tWanderStart;

    console.log(
      `[Diagnostic rallyFriend] constructor=${tConstruct.toFixed(1)}ms, 300wanderTotal=${tWanderTotal.toFixed(1)}ms, barOccupiedCount=${inner.barOccupied.size}`,
    );

    // Friend remains strictly pinned at the rally point and unoccupied in bar
    expect(
      Math.hypot(friend.pos.x - cell.x, friend.pos.y - cell.y),
    ).toBeLessThan(0.01);
    expect(
      Math.hypot(friend.target.x - cell.x, friend.target.y - cell.y),
    ).toBeLessThan(0.01);
    expect(inner.barOccupied.has(FRIEND_ID)).toBe(false);

    // Deterministic seat-allocation assertion: exact unpinned citizen claimed the supplied bar seat and target
    expect(inner.barOccupied.has(unpinnedPub!.id)).toBe(true);
    expect(inner.barSeatBy[0]).toBe(unpinnedPub!.id);
    expect(unpinnedCit.target.x).toBe(barStool.x);
    expect(unpinnedCit.target.y).toBe(barStool.y);
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
