import { describe, it, expect } from "vitest";
import { MockBackend } from "../src/colony/backend";

describe("MockBackend (Border Control boundary)", () => {
  it("adds distinct triage households", async () => {
    const b = new MockBackend(1);
    const h1 = await b.addNewcomer();
    const h2 = await b.addNewcomer();
    expect(h1.status).toBe("triage");
    expect(h1.id).not.toBe(h2.id);
    expect(b.households()).toHaveLength(2);
  });

  it("approve / hold / decline set the status", async () => {
    const b = new MockBackend(5);
    const h1 = await b.addNewcomer();
    expect((await b.decide(h1.id, "approve"))!.status).toBe("approved");
    const h2 = await b.addNewcomer();
    expect((await b.decide(h2.id, "hold"))!.status).toBe("held");
    const h3 = await b.addNewcomer();
    expect((await b.decide(h3.id, "decline"))!.status).toBe("rejected");
  });

  it("decline is terminal, and unknown ids return null", async () => {
    const b = new MockBackend(9);
    const h = await b.addNewcomer();
    await b.decide(h.id, "decline");
    expect((await b.decide(h.id, "approve"))!.status).toBe("rejected");
    expect(await b.decide("nope", "approve")).toBeNull();
  });

  it("is deterministic by seed", async () => {
    const a = new MockBackend(42);
    const b = new MockBackend(42);
    expect((await a.addNewcomer()).id).toBe((await b.addNewcomer()).id);
  });
});
