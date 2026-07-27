// ARCADE.2A — deterministic out-of-order coverage for the latest-wins entitlement gate. Proves a STALE
// `enabled` result can never re-open (or keep open) a venue that a NEWER OFF / killed / denied / malformed
// / failed / aborted result just closed, regardless of the order the async checks resolve in. No DOM, no
// network, no timers — the gate is pure, so the race is expressed directly by choosing resolution order.
import { describe, expect, it } from "vitest";
import { createArcadeEntitlementGate } from "../src/colony/entitlement/arcadeEntitlementGate";
import type { ArcadeEntitlement } from "../src/colony/entitlement/arcadeGamehouse";

const ENABLED: ArcadeEntitlement = { enabled: true, reason: "cohort-a" };
// Every non-enabled shape the fail-closed evaluator can produce — all must close the venue and beat a
// stale earlier `enabled` that resolves after them.
const NON_ENABLED: ReadonlyArray<[string, ArcadeEntitlement]> = [
  ["OFF", { enabled: false, reason: "Arcade 3D venue is off" }],
  ["killed", { enabled: false, reason: "Arcade 3D venue is killed" }],
  ["denied", { enabled: false, reason: "Entitlement unavailable (HTTP 403)" }],
  ["malformed", { enabled: false, reason: "Malformed entitlement payload" }],
  ["failed", { enabled: false, reason: "Couldn't verify entitlement: boom" }],
  ["aborted", { enabled: false, reason: "Couldn't verify entitlement" }],
];

/** A recording sink so each test can assert exactly what the gate published and whether it closed. */
function recorder() {
  const published: Array<ArcadeEntitlement | null> = [];
  let closes = 0;
  return {
    sink: {
      setEntitlement: (e: ArcadeEntitlement | null) => published.push(e),
      closeVenue: () => {
        closes += 1;
      },
    },
    published,
    last: () => published[published.length - 1],
    closes: () => closes,
  };
}

describe("ARCADE.2A latest-wins gate — a stale enabled never overwrites a newer denial", () => {
  for (const [name, denial] of NON_ENABLED) {
    it(`drops an earlier enabled that resolves AFTER a newer ${name}, and closes the venue`, () => {
      const r = recorder();
      const gate = createArcadeEntitlementGate(r.sink);

      // Two overlapping checks, dispatched in order: the earlier asks first (would enable), the later
      // asks second (the fresh truth: a denial). This is the on-entry-vs-interval / refocus race.
      const applyEarlier = gate.begin();
      const applyLater = gate.begin();

      // The NEWER denial resolves FIRST...
      applyLater(denial);
      // ...then the STALE enabled resolves late and MUST be discarded.
      applyEarlier(ENABLED);

      expect(r.last()).toEqual(denial); // the denial still stands
      expect(r.published).not.toContainEqual(ENABLED); // the stale enable never published
      expect(r.closes()).toBe(1); // the venue was closed exactly once, by the denial
    });
  }

  it("still lets the NEWEST result win when it is the enabled one (normal ordering)", () => {
    const r = recorder();
    const gate = createArcadeEntitlementGate(r.sink);
    const applyEarlier = gate.begin();
    const applyLater = gate.begin();
    // Earlier said OFF, but the later (newest) check enables — the newest truth wins.
    applyEarlier(NON_ENABLED[0][1]);
    applyLater(ENABLED);
    expect(r.last()).toEqual(ENABLED);
  });

  it("does NOT close the venue for an enabled winner, and DOES for a non-enabled one", () => {
    const enabledRun = recorder();
    createArcadeEntitlementGate(enabledRun.sink).begin()(ENABLED);
    expect(enabledRun.closes()).toBe(0);

    const offRun = recorder();
    createArcadeEntitlementGate(offRun.sink).begin()(NON_ENABLED[0][1]);
    expect(offRun.closes()).toBe(1);
  });
});

describe("ARCADE.2A latest-wins gate — reset() fails closed and supersedes in-flight checks", () => {
  it("drops to null, closes the venue, and discards a check that was already in flight", () => {
    const r = recorder();
    const gate = createArcadeEntitlementGate(r.sink);

    // A check begins (e.g. from a prior identity), then the identity switches: reset() must win.
    const applyStale = gate.begin();
    gate.reset();
    // The stale check resolves enabled AFTER the reset — it must be dropped, not re-open the venue.
    applyStale(ENABLED);

    expect(r.last()).toBeNull(); // reset's null is the last published state
    expect(r.published).not.toContainEqual(ENABLED);
    expect(r.closes()).toBe(1); // reset closed the venue
  });

  it("lets a fresh check dispatched AFTER a reset win normally", () => {
    const r = recorder();
    const gate = createArcadeEntitlementGate(r.sink);
    gate.reset();
    const apply = gate.begin();
    apply(ENABLED);
    expect(r.last()).toEqual(ENABLED);
  });

  it("keeps the LATEST across three overlapping checks no matter the resolution order", () => {
    const r = recorder();
    const gate = createArcadeEntitlementGate(r.sink);
    const a = gate.begin();
    const b = gate.begin();
    const c = gate.begin(); // c is the newest
    // Resolve out of order: middle, newest, oldest.
    b(ENABLED);
    c(NON_ENABLED[1][1]); // killed — the newest, so it wins
    a(ENABLED); // oldest, resolves last — dropped
    expect(r.last()).toEqual(NON_ENABLED[1][1]);
    expect(r.published).not.toContainEqual(ENABLED);
  });
});
