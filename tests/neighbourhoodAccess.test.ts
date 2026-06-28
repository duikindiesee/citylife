import { describe, it, expect } from "vitest";
import {
  neighbourhoodKeyForLot,
  checkPath,
  checkNeighbourhoodAccess,
  type NeighbourhoodAccessDeps,
} from "../src/colony/bot/neighbourhoodAccess";

function deps(
  over: Partial<NeighbourhoodAccessDeps> & {
    ok?: boolean;
    status?: number;
    allowed?: boolean | null;
    throws?: boolean;
    token?: string | null;
  } = {},
): { deps: NeighbourhoodAccessDeps; calls: string[] } {
  const calls: string[] = [];
  const d: NeighbourhoodAccessDeps = {
    transport: async (path) => {
      calls.push(path);
      if (over.throws) throw new Error("offline");
      return {
        ok: over.ok ?? true,
        status: over.status ?? 200,
        allowed: over.allowed ?? true,
      };
    },
    getToken: async () =>
      over.token === undefined ? "h.eyJ1c2VySWQiOjQyfQ.s" : over.token,
    getUserId: () => "42",
    ...over,
  };
  return { deps: d, calls };
}

describe("neighbourhoodKeyForLot", () => {
  it("returns the hamlet prefix for a satellite lot", () => {
    expect(neighbourhoodKeyForLot("wood1_lot_3")).toBe("wood1");
    expect(neighbourhoodKeyForLot("hill2_lot_10")).toBe("hill2");
    expect(neighbourhoodKeyForLot("vale1_lot_1")).toBe("vale1");
  });

  it("returns null for a bare primary lot (open land)", () => {
    expect(neighbourhoodKeyForLot("lot_3")).toBeNull();
    expect(neighbourhoodKeyForLot("lot_1")).toBeNull();
  });
});

describe("checkPath", () => {
  it("builds the by-key CHECK url through the kooker proxy", () => {
    expect(checkPath("wood1")).toBe(
      "/kooker/api/v1/citylife/neighbourhoods/by-key/wood1/access/check",
    );
  });
});

describe("checkNeighbourhoodAccess", () => {
  it("allows a keyless lot without any network call", async () => {
    const { deps: d, calls } = deps();
    expect(await checkNeighbourhoodAccess(null, d)).toEqual({ allowed: true });
    expect(calls).toHaveLength(0);
  });

  it("denies a keyed lot when not signed in", async () => {
    const { deps: d, calls } = deps({ token: null });
    const r = await checkNeighbourhoodAccess("wood1", d);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/sign in/i);
    expect(calls).toHaveLength(0);
  });

  it("allows when the backend says allowed", async () => {
    const { deps: d, calls } = deps({ allowed: true });
    expect(await checkNeighbourhoodAccess("wood1", d)).toEqual({
      allowed: true,
    });
    expect(calls).toEqual([
      "/kooker/api/v1/citylife/neighbourhoods/by-key/wood1/access/check",
    ]);
  });

  it("denies when the backend says not allowed (private, no grant)", async () => {
    const { deps: d } = deps({ allowed: false });
    const r = await checkNeighbourhoodAccess("wood1", d);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/private/i);
  });

  it("fails closed on a non-ok response", async () => {
    const { deps: d } = deps({ ok: false, status: 503, allowed: null });
    const r = await checkNeighbourhoodAccess("wood1", d);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/503/);
  });

  it("fails closed on a transport error", async () => {
    const { deps: d } = deps({ throws: true });
    const r = await checkNeighbourhoodAccess("wood1", d);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/offline/);
  });
});
