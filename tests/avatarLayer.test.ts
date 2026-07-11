// Spec 120 — the citizen avatar layer. Pins the pure math the R3F component syncs from:
// legacy-verbatim colors and proportions, the grid-to-world transform with the legacy yaw
// convention, first-person hiding, and the 64-instance capacity clamp.
import { describe, it, expect } from "vitest";
import type { AvatarView } from "../src/colony/render/R3FPlanetRenderer";
import {
  AVATAR_CAP,
  AVATAR_BODY,
  AVATAR_HEAD,
  avatarColorHex,
  avatarTransform,
  drawableAvatars,
} from "../src/colony/render/avatarLayer";

function av(partial: Partial<AvatarView> & { id: string }): AvatarView {
  return {
    displayName: partial.id,
    x: 0,
    y: 0,
    heading: 0,
    hasPod: false,
    kind: "human",
    isOperator: false,
    ...partial,
  };
}

describe("spec 120 — legacy-verbatim constants", () => {
  it("keeps the legacy identity colors", () => {
    expect(avatarColorHex({ isOperator: true, hasPod: true })).toBe(0x66e0ff);
    expect(avatarColorHex({ isOperator: false, hasPod: true })).toBe(0x9f86d8);
    expect(avatarColorHex({ isOperator: false, hasPod: false })).toBe(0xc0b0e0);
  });

  it("stands a citizen at the shared 1.7 m adult height with feet on the ground (spec 146)", () => {
    // crown = head lift + head radius
    expect(AVATAR_HEAD.lift + AVATAR_HEAD.radius).toBeCloseTo(1.7, 5);
    // torso capsule bottom = lift - (radius + length/2) sits at the feet (y=0)
    expect(AVATAR_BODY.lift - (AVATAR_BODY.radius + AVATAR_BODY.length / 2)).toBeCloseTo(0, 5);
    expect(AVATAR_CAP).toBe(64);
  });
});

describe("spec 120 — grid to world transform", () => {
  it("maps cell coordinates through the 4m grid centered on the map", () => {
    const t = avatarTransform({ x: 10, y: 20, heading: 0 }, 40, () => 2.5);
    expect(t.wx).toBe((10 - 20) * 4);
    expect(t.wz).toBe((20 - 20) * 4);
    expect(t.wy).toBe(2.5);
  });

  it("applies the legacy yaw convention: facing +x means rotY of PI/2", () => {
    const east = avatarTransform({ x: 0, y: 0, heading: 0 }, 10, () => 0);
    expect(east.rotY).toBeCloseTo(Math.PI / 2, 12);
    const north = avatarTransform({ x: 0, y: 0, heading: -Math.PI / 2 }, 10, () => 0);
    expect(north.rotY).toBeCloseTo(Math.PI, 12);
  });

  it("never sinks below sea level and samples the ROUNDED cell", () => {
    const sampled: Array<[number, number]> = [];
    const t = avatarTransform({ x: 3.6, y: 7.4, heading: 0 }, 20, (x, y) => {
      sampled.push([x, y]);
      return -5;
    });
    expect(t.wy).toBe(0);
    expect(sampled).toEqual([[4, 7]]);
  });
});

describe("spec 120 — drawable subset", () => {
  it("hides the first-person citizen (the player IS that citizen)", () => {
    const list = [av({ id: "a" }), av({ id: "b" }), av({ id: "c" })];
    const drawn = drawableAvatars(list, "b");
    expect(drawn.map((a) => a.id)).toEqual(["a", "c"]);
  });

  it("clamps to the 64-instance capacity", () => {
    const list = Array.from({ length: 100 }, (_, i) => av({ id: `c${i}` }));
    expect(drawableAvatars(list, null)).toHaveLength(AVATAR_CAP);
  });

  it("hiding and clamping compose: the hidden citizen does not consume capacity", () => {
    const list = Array.from({ length: 66 }, (_, i) => av({ id: `c${i}` }));
    const drawn = drawableAvatars(list, "c0");
    expect(drawn).toHaveLength(AVATAR_CAP);
    expect(drawn.find((a) => a.id === "c0")).toBeUndefined();
  });
});
