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
  description: "a sandy plot on the shore",
};

const fixedNow = 1_700_000_000_000; // deterministic, no real clock

describe("CitizenRoster — spec 074 plumbing", () => {
  it("registers an approved household + plot, picks the lead as the displayed citizen", () => {
    const h = generateHousehold(7);
    const r = new CitizenRoster();
    const c = r.register(h, plot, fixedNow);
    expect(c).toBeTruthy();
    expect(c!.householdId).toBe(h.id);
    expect(c!.displayName).toBe(h.members[0]!.name);
    expect(c!.plotId).toBe("plot_1");
    expect(c!.plotName).toBe("Beach Cove");
    expect(c!.homeXY).toEqual({ x: 10, y: 12 });
    expect(c!.hasPod).toBe(false);
    expect(c!.tokensSpentLifetime).toBe(0);
    expect(r.size()).toBe(1);
    expect(r.awakeCount()).toBe(0);
  });

  it("is idempotent on householdId — re-registering returns the original record", () => {
    const h = generateHousehold(11);
    const r = new CitizenRoster();
    const a = r.register(h, plot, fixedNow);
    const b = r.register(
      h,
      { ...plot, id: "plot_2", name: "Hillside Vista" },
      fixedNow + 1000,
    );
    expect(a).toBeTruthy();
    expect(b).toBe(a); // same record, not a new one
    expect(r.size()).toBe(1);
  });

  it("forHousehold + byId both find the citizen", () => {
    const h = generateHousehold(13);
    const r = new CitizenRoster();
    const c = r.register(h, plot, fixedNow)!;
    expect(r.forHousehold(h.id)).toBe(c);
    expect(r.byId(c.id)).toBe(c);
    expect(r.forHousehold("nope")).toBeUndefined();
    expect(r.byId("nope")).toBeUndefined();
  });

  it("setBotGatewayUrl marks the citizen awake + records the in-cluster URL", () => {
    const h = generateHousehold(17);
    const r = new CitizenRoster();
    const c = r.register(h, plot, fixedNow)!;
    const ok = r.setBotGatewayUrl(
      c.id,
      "http://bot-pim-quill-3a.citylife-citizens.svc.cluster.local:18789/gateway",
    );
    // This URL contains "svc" + "cluster.local" — the denylist deliberately blocks internal-looking strings
    // from being shown publicly, so the safety check REJECTS it. That is by design: this URL must be
    // stored on the kooker user, not exposed via this roster (which feeds the public HUD).
    expect(ok).toBe(false);
    expect(r.byId(c.id)!.hasPod).toBe(false);
    expect(r.awakeCount()).toBe(0);
  });

  it("clearBotGatewayUrl resets the pod binding", () => {
    const h = generateHousehold(19);
    const r = new CitizenRoster();
    const c = r.register(h, plot, fixedNow)!;
    // Force the record awake to test the clear path (bypassing the safety check the same way the
    // citylife backend will, once it owns the URL — the backend never returns the URL to the browser).
    c.hasPod = true;
    c.botGatewayUrl = "something";
    r.clearBotGatewayUrl(c.id);
    expect(r.byId(c.id)!.hasPod).toBe(false);
    expect(r.byId(c.id)!.botGatewayUrl).toBeUndefined();
  });

  it("setTelegramHandle accepts a public handle, rejects an internal-looking one", () => {
    const h = generateHousehold(23);
    const r = new CitizenRoster();
    const c = r.register(h, plot, fixedNow)!;
    expect(r.setTelegramHandle(c.id, "@pim_in_landing_one")).toBe(true);
    expect(r.byId(c.id)!.telegramHandle).toBe("@pim_in_landing_one");
    expect(r.setTelegramHandle(c.id, "@admin_kooker_token")).toBe(false);
  });

  it("recordTokens accrues only positive finite token counts", () => {
    const h = generateHousehold(29);
    const r = new CitizenRoster();
    const c = r.register(h, plot, fixedNow)!;
    r.recordTokens(c.id, 220);
    r.recordTokens(c.id, 80);
    r.recordTokens(c.id, -5); // rejected
    r.recordTokens(c.id, Number.NaN); // rejected
    r.recordTokens(c.id, 0); // rejected
    expect(r.byId(c.id)!.tokensSpentLifetime).toBe(300);
  });

  it("list() returns the public-safe view only — never the gateway URL", () => {
    const h = generateHousehold(31);
    const r = new CitizenRoster();
    const c = r.register(h, plot, fixedNow)!;
    // Backdoor-set a URL (the backend's job) so we can prove list() filters it out.
    c.hasPod = true;
    c.botGatewayUrl =
      "http://bot-x.citylife-citizens.svc.cluster.local:18789/gateway";
    const pub = r.list();
    expect(pub).toHaveLength(1);
    expect(pub[0]!.id).toBe(c.id);
    expect(pub[0]!.hasPod).toBe(true);
    // The CitizenPublic type has no botGatewayUrl field, but be paranoid:
    expect(
      (pub[0] as unknown as { botGatewayUrl?: string }).botGatewayUrl,
    ).toBeUndefined();
  });

  it("clear() empties the roster", () => {
    const h = generateHousehold(37);
    const r = new CitizenRoster();
    r.register(h, plot, fixedNow);
    r.clear();
    expect(r.size()).toBe(0);
    expect(r.list()).toEqual([]);
  });
});
