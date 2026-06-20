import { describe, it, expect } from "vitest";
import { validateActions, extractJson } from "../src/ai/schema";

describe("action schema keeps a small model on the rails", () => {
  it("drops unknown actions and illegal args", () => {
    const raw = [
      { action: "setTaxRate", args: ["residential", 0.08], why: "ok" },
      { action: "launchNukes", args: [] }, // not a real action
      { action: "setBudget", args: ["safety", 1200] },
      { action: "setTaxRate", args: ["mars", 9] }, // bad zone
    ];
    const out = validateActions(raw, 8);
    expect(out).toHaveLength(2);
    expect(out[0]!.action).toBe("setTaxRate");
    expect(out[1]!.action).toBe("setBudget");
  });

  it("tolerates a percentage written as a whole number", () => {
    const out = validateActions(
      [{ action: "setTaxRate", args: ["commercial", 12] }],
      4,
    );
    expect(out[0]!.args[1]).toBeCloseTo(0.12);
  });

  it("extracts JSON from a chatty LLM reply", () => {
    const text =
      'Sure! Here is my plan:\n[{"action":"noop","args":[]}]\nHope that helps.';
    const parsed = extractJson(text);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it("caps the number of actions", () => {
    const many = Array.from({ length: 20 }, () => ({
      action: "noop",
      args: [],
    }));
    expect(validateActions(many, 4)).toHaveLength(4);
  });
});
