import { describe, expect, it } from "vitest";
import {
  addPost,
  createProfile,
  safeProfile,
  AUTHORED_PER_SOL,
  type KbProfile,
} from "../src/colony/social/kookerbook";
import { shareStats } from "../src/colony/social/shareCard";
import type { ColonyUiState } from "../src/colony/runtime";

// Spec 150 PR3 — one displayed Sol truth. The share card and the Kookerbook feed must show the
// canonical sol, while the feed's post id, seq and authored cap stay keyed on the FAST game-day
// bucket (that cap was tuned to the 160 s sim-day; re-keying it on the six-hour sol starves it).

const profile = (): KbProfile =>
  createProfile({ citizenId: "c1", alias: "Ada", bio: "builder" })!;

describe("spec 150 PR3 — share card Sol", () => {
  it("reads the canonical sol, not the earth day", () => {
    const ui = {
      clock: { day: 7, hour: 12, minute: 0, isDay: true, sol: 29 },
      colonists: 4,
      colony: { capacity: 10, food: 12, buildings: 3 },
      power: { solarW: 1.25 },
    } as unknown as ColonyUiState;
    const sol = shareStats(ui).find((s) => s.label === "Sol");
    expect(sol?.value).toBe("29");
    // The bug this locks: the chip used to print clock.day, so a shared card disagreed with the HUD.
    expect(sol?.value).not.toBe("7");
  });
});

describe("spec 150 PR3 — Kookerbook sol display vs bucket", () => {
  it("displays the canonical sol while keying the id on the game-day bucket", () => {
    const p = addPost(profile(), {
      sol: 7, // fast game-day bucket
      displaySol: 29, // canonical wall-clock sol
      kind: "event",
      text: "Ada arrived in Landing One.",
    })!;
    const post = p.posts[0]!;
    expect(post.displaySol).toBe(29);
    expect(post.sol).toBe(7);
    expect(post.id).toBe("c1_7_0"); // id stays on the bucket
  });

  it("keeps the authored cap on the game-day bucket", () => {
    // All three posts share one game day but land on different canonical sols (a 160 s sim-day is
    // far shorter than a six-hour sol). The cap must still bite on the bucket.
    let p = profile();
    for (let i = 0; i < AUTHORED_PER_SOL; i++) {
      const next = addPost(p, {
        sol: 7,
        displaySol: 29 + i,
        kind: "authored",
        text: `post ${i}`,
      });
      expect(next).not.toBeNull();
      p = next!;
    }
    // Over the cap for game day 7 — refused even though the canonical sol moved on.
    expect(
      addPost(p, { sol: 7, displaySol: 99, kind: "authored", text: "one more" }),
    ).toBeNull();
    // A new game day reopens the allowance.
    expect(
      addPost(p, { sol: 8, displaySol: 99, kind: "authored", text: "next day" }),
    ).not.toBeNull();
  });

  it("carries displaySol through the untrusted parse path", () => {
    const p = addPost(profile(), {
      sol: 7,
      displaySol: 29,
      kind: "event",
      text: "stored",
    })!;
    const restored = safeProfile(JSON.parse(JSON.stringify(p)));
    expect(restored?.posts[0]?.displaySol).toBe(29);
    expect(restored?.posts[0]?.sol).toBe(7);
  });

  it("tolerates posts stored before PR3, which have no displaySol", () => {
    const legacy = addPost(profile(), { sol: 7, kind: "event", text: "old" })!;
    const post = legacy.posts[0]!;
    expect(post.displaySol).toBeUndefined();
    // The feed falls back to the bucket rather than rendering undefined.
    expect(post.displaySol ?? post.sol).toBe(7);
  });

  it("ignores a non-finite displaySol instead of storing it", () => {
    const p = addPost(profile(), {
      sol: 7,
      displaySol: Number.NaN,
      kind: "event",
      text: "bad clock",
    })!;
    expect(p.posts[0]?.displaySol).toBeUndefined();
  });
});
