import { describe, it, expect, vi, afterEach } from "vitest";
import {
  clampToGrid,
  clampCell,
  homeTargetCell,
  dealershipStartCell,
  isWithinArrivalBounds,
  headingToHome,
  computeRouteGuidance,
  stepCell,
  boundedArrivalEvidence,
  classifyArrivalStatus,
  arrivalIdempotencyKey,
  homePlotRef,
  isResident,
  parseHomeResidency,
  isHomeGarageUnlocked,
  arrivalButtonView,
  arrivalStateColor,
  fetchHomeResidency,
  postHomeArrival,
  ARRIVAL_RADIUS_CELLS,
  type Cell,
} from "../src/colony/home/driveHome";
import { STARTER_PLACEMENT_GRID } from "../src/colony/home/starterHouseProjection";
import type { HomeTruth } from "../src/colony/home/starterProperty";
import { getAuthClient } from "../src/colony/authClient";

// PLAYER.HOME.1D.S2 — the dark, server-truth drive-home slice. Everything below is the pure model
// (geometry, guidance, classifiers, residency, button views) plus the fail-soft backend layer; no DOM.

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function truth(over: Partial<HomeTruth> = {}): HomeTruth {
  return {
    owned: true,
    status: "OWNED",
    neighbourhoodKey: "coastal",
    plotId: "starter-home:demo-user",
    frameId: "starter-home-frame:demo-user",
    onboardingState: "OWNED",
    priceKco: 350,
    ...over,
  };
}

const NOT_OWNED: HomeTruth = {
  owned: false,
  status: null,
  neighbourhoodKey: null,
  plotId: null,
  frameId: null,
  onboardingState: "NONE",
  priceKco: null,
};

describe("driveHome — grid clamp", () => {
  it("rounds and clamps any coordinate into [0, grid-1]", () => {
    expect(clampToGrid(-5)).toBe(0);
    expect(clampToGrid(1000)).toBe(STARTER_PLACEMENT_GRID - 1);
    expect(clampToGrid(3.4)).toBe(3);
    expect(clampToGrid(Number.NaN)).toBe(0);
    expect(clampToGrid(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampCell({ x: -1, y: 99999 })).toEqual({
      x: 0,
      y: STARTER_PLACEMENT_GRID - 1,
    });
  });
});

describe("driveHome — server-derived destination (never client-authored)", () => {
  it("returns the SAME cell PLAYER.HOME.1C projects the house onto — deterministic across devices", () => {
    const a = homeTargetCell(truth());
    const b = homeTargetCell(truth());
    expect(a).not.toBeNull();
    expect(a).toEqual(b); // same deed → same cell, always (refresh / relogin / second device)
    expect(a!.x).toBeGreaterThanOrEqual(0);
    expect(a!.x).toBeLessThan(STARTER_PLACEMENT_GRID);
  });
  it("is null unless the truth is unambiguously OWNED, and null on a reference-less deed", () => {
    expect(homeTargetCell(null)).toBeNull();
    expect(homeTargetCell(NOT_OWNED)).toBeNull();
    expect(
      homeTargetCell(truth({ owned: true, status: "PENDING" })),
    ).toBeNull();
    expect(
      homeTargetCell(
        truth({ plotId: null, frameId: null, neighbourhoodKey: null }),
      ),
    ).toBeNull();
  });
  it("seeds a deterministic dealership start that never coincides with the home cell", () => {
    const start = dealershipStartCell(truth());
    const home = homeTargetCell(truth());
    expect(start).not.toBeNull();
    expect(start).toEqual(dealershipStartCell(truth())); // deterministic
    expect(start).not.toEqual(home); // would trivially auto-arrive otherwise
    expect(dealershipStartCell(null)).toBeNull();
  });
});

describe("driveHome — arrival bounds + heading (route recovery is inherent)", () => {
  const home: Cell = { x: 30, y: 30 };
  it("counts as arrived only inside the Chebyshev plot radius", () => {
    expect(isWithinArrivalBounds({ x: 30, y: 30 }, home)).toBe(true);
    expect(
      isWithinArrivalBounds({ x: 30 + ARRIVAL_RADIUS_CELLS, y: 30 }, home),
    ).toBe(true);
    expect(
      isWithinArrivalBounds({ x: 30 + ARRIVAL_RADIUS_CELLS + 1, y: 30 }, home),
    ).toBe(false);
  });
  it("points toward home from every quadrant and is null once inside", () => {
    expect(headingToHome({ x: 30, y: 50 }, home)).toBe("N");
    expect(headingToHome({ x: 30, y: 10 }, home)).toBe("S");
    expect(headingToHome({ x: 10, y: 30 }, home)).toBe("E");
    expect(headingToHome({ x: 50, y: 30 }, home)).toBe("W");
    expect(headingToHome({ x: 10, y: 50 }, home)).toBe("NE");
    expect(headingToHome({ x: 50, y: 10 }, home)).toBe("SW");
    expect(headingToHome({ x: 30, y: 30 }, home)).toBeNull();
  });
  it("recomputes purely from the CURRENT position — straying just re-points home (route recovery)", () => {
    // Overshoot past home on the x-axis: the heading flips to keep pointing back at the plot.
    expect(headingToHome({ x: 20, y: 30 }, home)).toBe("E");
    expect(headingToHome({ x: 40, y: 30 }, home)).toBe("W");
  });
});

describe("driveHome — guidance (fail-closed on missing destination)", () => {
  it("fails closed to a neutral 'waiting' guidance when position or destination is missing", () => {
    const g = computeRouteGuidance(null, { x: 1, y: 1 });
    expect(g.arrived).toBe(false);
    expect(g.heading).toBeNull();
    expect(g.distance).toBe(Number.POSITIVE_INFINITY);
    expect(computeRouteGuidance({ x: 1, y: 1 }, null).instruction).toMatch(
      /waiting/i,
    );
  });
  it("reports remaining distance and an arrived flag inside the plot", () => {
    const home: Cell = { x: 10, y: 10 };
    const far = computeRouteGuidance({ x: 10, y: 40 }, home);
    expect(far.arrived).toBe(false);
    expect(far.distance).toBe(30 - ARRIVAL_RADIUS_CELLS);
    expect(far.heading).toBe("N");
    const here = computeRouteGuidance({ x: 10, y: 10 }, home);
    expect(here.arrived).toBe(true);
    expect(here.distance).toBe(0);
    expect(here.heading).toBeNull();
  });
});

describe("driveHome — driving cursor step (clamped)", () => {
  it("moves one cell per compass press and never leaves the grid", () => {
    expect(stepCell({ x: 5, y: 5 }, "up")).toEqual({ x: 5, y: 4 });
    expect(stepCell({ x: 5, y: 5 }, "down")).toEqual({ x: 5, y: 6 });
    expect(stepCell({ x: 5, y: 5 }, "left")).toEqual({ x: 4, y: 5 });
    expect(stepCell({ x: 5, y: 5 }, "right")).toEqual({ x: 6, y: 5 });
    expect(stepCell({ x: 0, y: 0 }, "up")).toEqual({ x: 0, y: 0 }); // clamped
    const max = STARTER_PLACEMENT_GRID - 1;
    expect(stepCell({ x: max, y: max }, "right")).toEqual({ x: max, y: max });
  });
});

describe("driveHome — bounded arrival evidence", () => {
  it("clamps the observed cell and reports the local in-bounds signal only", () => {
    const home: Cell = { x: 20, y: 20 };
    const inside = boundedArrivalEvidence({ x: 21, y: 20 }, home);
    expect(inside.cell).toEqual({ x: 21, y: 20 });
    expect(inside.withinBounds).toBe(true);
    const out = boundedArrivalEvidence({ x: 999, y: -5 }, home);
    expect(out.cell).toEqual({ x: STARTER_PLACEMENT_GRID - 1, y: 0 }); // clamped, never out of range
    expect(out.withinBounds).toBe(false);
  });
});

describe("driveHome — arrival status classification (idempotent duplicate = pending)", () => {
  it("maps every meaningful status to a closed outcome", () => {
    expect(classifyArrivalStatus(200)).toEqual({ kind: "confirmed" });
    expect(classifyArrivalStatus(201)).toEqual({ kind: "confirmed" });
    expect(classifyArrivalStatus(202)).toEqual({ kind: "pending" });
    expect(classifyArrivalStatus(409)).toEqual({ kind: "pending" }); // duplicate arrival replay
    expect(classifyArrivalStatus(422)).toEqual({ kind: "rejected" });
    expect(classifyArrivalStatus(401)).toEqual({ kind: "disabled" });
    expect(classifyArrivalStatus(403)).toEqual({ kind: "disabled" });
    expect(classifyArrivalStatus(503)).toEqual({ kind: "disabled" });
    expect(classifyArrivalStatus(500)).toEqual({ kind: "error", status: 500 });
  });
});

describe("driveHome — idempotency + plot reference (server-owned)", () => {
  it("is stable per (user, plot) so a double-tap can never record a second arrival", () => {
    expect(arrivalIdempotencyKey("u1", "plot-a")).toBe(
      arrivalIdempotencyKey("u1", "plot-a"),
    );
    expect(arrivalIdempotencyKey("u1", "plot-a")).not.toBe(
      arrivalIdempotencyKey("u2", "plot-a"),
    );
  });
  it("keys the arrival to the deed's server plot/frame/neighbourhood, never a client value", () => {
    expect(homePlotRef(truth())).toBe("starter-home:demo-user");
    expect(homePlotRef(truth({ plotId: null }))).toBe(
      "starter-home-frame:demo-user",
    );
    expect(homePlotRef(truth({ plotId: null, frameId: null }))).toBe("coastal");
    expect(homePlotRef(NOT_OWNED)).toBeNull();
  });
});

describe("driveHome — residency + home-garage unlock (fail-closed on ambiguity)", () => {
  it("is RESIDENT only on an owned deed whose onboarding state reads RESIDENT", () => {
    expect(isResident(truth({ onboardingState: "RESIDENT" }))).toBe(true);
    expect(isResident(truth({ onboardingState: "OWNED" }))).toBe(false);
    expect(isResident(NOT_OWNED)).toBe(false);
    expect(isResident(null)).toBe(false);
  });
  it("parses residency and unlocks the garage only on the server-confirmed RESIDENT truth", () => {
    const owned = parseHomeResidency({
      owned: true,
      status: "OWNED",
      onboardingState: "OWNED",
      plotId: "p",
    });
    expect(owned.resident).toBe(false);
    expect(owned.garageUnlocked).toBe(false);
    expect(isHomeGarageUnlocked(owned)).toBe(false);

    const res = parseHomeResidency({
      owned: true,
      status: "OWNED",
      onboardingState: "RESIDENT",
      plotId: "p",
    });
    expect(res.resident).toBe(true);
    expect(res.garageUnlocked).toBe(true);
    expect(isHomeGarageUnlocked(res)).toBe(true);
  });
  it("an explicit server garage-lock always wins over the RESIDENT signal", () => {
    const res = parseHomeResidency({
      owned: true,
      status: "OWNED",
      onboardingState: "RESIDENT",
      plotId: "p",
      homeGarageUnlocked: false,
    });
    expect(res.resident).toBe(true);
    expect(res.garageUnlocked).toBe(false);
    expect(isHomeGarageUnlocked(res)).toBe(false);
  });
  it("fails closed on a malformed body and a null residency", () => {
    const bad = parseHomeResidency("nope");
    expect(bad.truth).toBeNull();
    expect(bad.resident).toBe(false);
    expect(isHomeGarageUnlocked(bad)).toBe(false);
    expect(isHomeGarageUnlocked(null)).toBe(false);
  });
});

describe("driveHome — arrival button view (thin, exhaustive)", () => {
  it("is 'far' (disabled) until inside the plot, then 'ready'", () => {
    expect(arrivalButtonView(false, false, false, undefined).state).toBe("far");
    expect(arrivalButtonView(false, false, false, undefined).disabled).toBe(
      true,
    );
    const ready = arrivalButtonView(false, true, false, undefined);
    expect(ready.state).toBe("ready");
    expect(ready.disabled).toBe(false);
  });
  it("shows a disabled in-flight pending and never re-fires while processing", () => {
    expect(arrivalButtonView(false, true, true, undefined).state).toBe(
      "pending",
    );
    expect(arrivalButtonView(false, true, true, undefined).disabled).toBe(true);
    expect(
      arrivalButtonView(false, true, false, { kind: "pending" }).disabled,
    ).toBe(true);
  });
  it("renders each settled outcome; a confirmed RESIDENT truth locks the control", () => {
    expect(arrivalButtonView(true, true, false, undefined).state).toBe(
      "confirmed",
    );
    expect(arrivalButtonView(true, true, false, undefined).disabled).toBe(true);
    expect(
      arrivalButtonView(false, true, false, { kind: "rejected" }).state,
    ).toBe("rejected");
    expect(
      arrivalButtonView(false, true, false, { kind: "disabled" }).state,
    ).toBe("disabled");
    expect(arrivalButtonView(false, true, false, { kind: "error" }).state).toBe(
      "error",
    );
    // A colour exists for every state.
    for (const s of [
      "far",
      "ready",
      "pending",
      "confirmed",
      "rejected",
      "disabled",
      "error",
    ] as const) {
      expect(arrivalStateColor(s)).toMatch(/^#/);
    }
  });
});

describe("driveHome — residency fetch (best-effort, fail-soft)", () => {
  it("returns null when signed out and never calls the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(getAuthClient(), "getValidToken").mockResolvedValue(null);
    expect(await fetchHomeResidency()).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("returns null on a non-ok / thrown read (endpoint absent while it ships)", async () => {
    vi.spyOn(getAuthClient(), "getValidToken").mockResolvedValue("jwt.tok");
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 404 }));
    expect(await fetchHomeResidency()).toBeNull();
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    expect(await fetchHomeResidency()).toBeNull();
  });
  it("parses the RESIDENT truth into an unlocked residency", async () => {
    vi.spyOn(getAuthClient(), "getValidToken").mockResolvedValue("jwt.tok");
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        owned: true,
        status: "OWNED",
        onboardingState: "RESIDENT",
        plotId: "starter-home:demo-user",
        frameId: "starter-home-frame:demo-user",
        neighbourhoodKey: "coastal",
      }),
    }));
    const res = await fetchHomeResidency();
    expect(res?.resident).toBe(true);
    expect(isHomeGarageUnlocked(res)).toBe(true);
  });
});

describe("driveHome — POST arrival (server authority, bounded evidence only)", () => {
  it("refuses locally WITHOUT any network call when there is no owned home", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(getAuthClient(), "getValidToken").mockResolvedValue("jwt.tok");
    expect(await postHomeArrival({ x: 0, y: 0 }, NOT_OWNED)).toEqual({
      kind: "disabled",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("refuses locally WITHOUT posting when not inside the owned plot cells", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(getAuthClient(), "getValidToken").mockResolvedValue("jwt.tok");
    const home = homeTargetCell(truth())!;
    const far: Cell = {
      x: (home.x + STARTER_PLACEMENT_GRID / 2) % STARTER_PLACEMENT_GRID,
      y: (home.y + STARTER_PLACEMENT_GRID / 2) % STARTER_PLACEMENT_GRID,
    };
    expect(await postHomeArrival(far, truth())).toEqual({ kind: "disabled" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("is disabled (never posts) when signed out even if in bounds", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(getAuthClient(), "getValidToken").mockResolvedValue(null);
    const home = homeTargetCell(truth())!;
    expect(await postHomeArrival(home, truth())).toEqual({ kind: "disabled" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("posts the clamped cell + server plot echo ONLY, with a bearer + stable idempotency key", async () => {
    vi.spyOn(getAuthClient(), "getValidToken").mockResolvedValue("jwt.tok");
    let url = "";
    let init: RequestInit = {};
    vi.stubGlobal("fetch", async (u: string, i: RequestInit) => {
      url = u;
      init = i;
      return { ok: true, status: 200 };
    });
    const home = homeTargetCell(truth())!;
    const r = await postHomeArrival(home, truth());
    expect(r).toEqual({ kind: "confirmed" });
    expect(url).toBe("/kooker/api/v1/citylife/players/me/home/arrival");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer jwt.tok");
    expect(headers["Idempotency-Key"]).toContain("starter-home:demo-user");
    // Bounded evidence only — the observed cell + the server plot echo, NO owner / deed / price claim.
    expect(JSON.parse(init.body as string)).toEqual({
      cell: home,
      plotRef: "starter-home:demo-user",
    });
  });
  it("maps a 409 duplicate to a neutral pending replay and a 422 to rejected", async () => {
    vi.spyOn(getAuthClient(), "getValidToken").mockResolvedValue("jwt.tok");
    const home = homeTargetCell(truth())!;
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 409 }));
    expect(await postHomeArrival(home, truth())).toEqual({ kind: "pending" });
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 422 }));
    expect(await postHomeArrival(home, truth())).toEqual({ kind: "rejected" });
  });
  it("maps a thrown/network failure to a transient error", async () => {
    vi.spyOn(getAuthClient(), "getValidToken").mockResolvedValue("jwt.tok");
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    const home = homeTargetCell(truth())!;
    expect(await postHomeArrival(home, truth())).toEqual({ kind: "error" });
  });
});
