import { describe, it, expect } from "vitest";
import { validatePG, validatePGName } from "../src/colony/bot/pgSafety";
import {
  generateSafePersonality,
  MockBotAdapter,
  type BotAdapter,
} from "../src/colony/bots";

describe("validatePG — kid-and-grownup-safe gate", () => {
  it("passes clean, friendly text", () => {
    expect(validatePG("A cheerful baker who loves the rain").ok).toBe(true);
    expect(validatePG("Pim Quillfeather, a hopeful welder").ok).toBe(true);
    expect(validatePG("").ok).toBe(true);
    expect(validatePG(undefined).ok).toBe(true);
  });

  it("does not false-positive on benign words that embed short tokens", () => {
    // class/assassin? no — assistant, class, grass, Scunthorpe-style cases must pass
    expect(validatePG("a classy assistant who cuts grass").ok).toBe(true);
    expect(validatePG("Cassidy from Scunthorpe").ok).toBe(true);
  });

  it("blocks profanity, slurs, sexual and violent content", () => {
    expect(validatePG("what the f u c k").ok).toBe(false); // despaced substring match catches the spaced-out evasion
    expect(validatePG("a fucking mess").ok).toBe(false);
    expect(validatePG("go kill them all").ok).toBe(false);
    expect(validatePG("naked porn star").ok).toBe(false);
    expect(validatePG("what a sh1t show").ok).toBe(false); // leet-folded 1 -> i gives shit
  });

  it("rejects over-long text", () => {
    expect(validatePG("a".repeat(601)).ok).toBe(false);
  });
});

describe("validatePGName", () => {
  it("accepts plain single-word names", () => {
    expect(validatePGName("Pim", "Quillfeather").ok).toBe(true);
    expect(validatePGName("O'Hara", "Vandersnoot").ok).toBe(true);
  });
  it("rejects unsafe or non-name input", () => {
    expect(validatePGName("a whole sentence here", "Smith").ok).toBe(false); // not a single word
    expect(validatePGName("Fuck", "Smith").ok).toBe(false); // profanity
    expect(validatePGName("Pim", "Asshole").ok).toBe(false); // profane surname
  });
});

class ProfaneAdapter implements BotAdapter {
  readonly source = "profane";
  async generate(): Promise<string> {
    return "x";
  }
  async generatePersonality(): Promise<string> {
    return "You are a fucking legend.";
  }
}

describe("generateSafePersonality — enforces PG on input AND output", () => {
  it("returns a clean personality for a clean prompt (mock)", async () => {
    const r = await generateSafePersonality(
      new MockBotAdapter(),
      "a gentle gardener who sings to the plants",
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.personality.length).toBeGreaterThan(10);
  });

  it("rejects an unsafe PROMPT before calling the model", async () => {
    let called = false;
    const adapter: BotAdapter = {
      source: "t",
      async generate() {
        return "";
      },
      async generatePersonality() {
        called = true;
        return "clean";
      },
    };
    const r = await generateSafePersonality(adapter, "a sexy naked killer");
    expect(r.ok).toBe(false);
    expect(called).toBe(false); // never even hit the model
  });

  it("rejects an unsafe model OUTPUT and never returns it", async () => {
    const r = await generateSafePersonality(
      new ProfaneAdapter(),
      "a kind baker",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBeTruthy();
  });

  it("rejects an empty prompt", async () => {
    const r = await generateSafePersonality(new MockBotAdapter(), "   ");
    expect(r.ok).toBe(false);
  });

  it("falls back gracefully when the adapter cannot generate", async () => {
    const noGen: BotAdapter = {
      source: "nogen",
      async generate() {
        return "";
      },
    };
    const r = await generateSafePersonality(noGen, "a kind baker");
    expect(r.ok).toBe(false);
  });
});
