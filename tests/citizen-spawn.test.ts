import { describe, it, expect, vi, afterEach } from "vitest";
import { splitName, spawnCitizenSubUser } from "../src/colony/bot/citizenSpawn";
import { getAuthClient } from "../src/colony/authClient";

afterEach(() => vi.unstubAllGlobals());

describe("splitName", () => {
  it("splits a two-word name into first + last", () => {
    expect(splitName("Dax Brackenhollow")).toEqual({
      firstName: "Dax",
      lastName: "Brackenhollow",
    });
  });
  it("keeps a single word as the first name", () => {
    expect(splitName("Wren")).toEqual({ firstName: "Wren", lastName: "" });
  });
  it("treats the remainder as the last name", () => {
    expect(splitName("Mary Jane Watson")).toEqual({
      firstName: "Mary",
      lastName: "Jane Watson",
    });
  });
  it("falls back to Citizen on empty input", () => {
    expect(splitName("   ")).toEqual({ firstName: "Citizen", lastName: "" });
  });
});

describe("spawnCitizenSubUser", () => {
  it("fails closed when no one is signed in", async () => {
    // No session → getValidToken() resolves null.
    getAuthClient().logout();
    const r = await spawnCitizenSubUser({
      firstName: "Dax",
      lastName: "Brackenhollow",
    });
    expect(r).toEqual({ ok: false, error: "not signed in" });
  });

  it("posts the citizen with the player Bearer when signed in", async () => {
    const auth = getAuthClient();
    vi.spyOn(auth, "getValidToken").mockResolvedValue("player.jwt.tok");
    let sentAuth = "";
    let sentBody: unknown = null;
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sentAuth = (init.headers as Record<string, string>).Authorization;
      sentBody = JSON.parse(init.body as string);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          userId: 42,
          profileId: 7,
          status: "PROVISIONING",
        }),
      };
    });
    const r = await spawnCitizenSubUser({
      firstName: "Dax",
      lastName: "Brackenhollow",
      age: 41,
      profession: "Botanist",
    });
    expect(r).toEqual({
      ok: true,
      citizenUserId: 42,
      profileId: 7,
      status: "PROVISIONING",
    });
    expect(sentAuth).toBe("Bearer player.jwt.tok");
    expect(sentBody).toMatchObject({
      firstName: "Dax",
      profession: "Botanist",
      age: 41,
    });
  });

  it("surfaces a non-2xx as ok:false", async () => {
    const auth = getAuthClient();
    vi.spyOn(auth, "getValidToken").mockResolvedValue("player.jwt.tok");
    vi.stubGlobal("fetch", async () => ({
      ok: false,
      status: 404,
      json: async () => ({}),
    }));
    const r = await spawnCitizenSubUser({ firstName: "Dax", lastName: "B" });
    expect(r).toEqual({ ok: false, error: "HTTP 404" });
  });
});
