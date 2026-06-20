import { describe, it, expect } from "vitest";
import {
  BotService,
  MockBotAdapter,
  composeLifeHistory,
  composeCityBrainPrompt,
  GREETING,
  type BotAdapter,
  type ChatMessage,
  type Speaker,
} from "../src/colony/bots";
import { generateHousehold } from "../src/colony/newcomers";
import type { CityPlan } from "../src/colony/cityPlan";

const h = generateHousehold(7);

/** A test plan with two plots so the patrol always has something to allocate. */
const plan: CityPlan = {
  plots: [
    {
      id: "plot_1",
      name: "Beach Cove",
      vibe: "beach",
      zone: "residential",
      x: 10,
      y: 10,
      description: "a sandy plot on the shore",
    },
    {
      id: "plot_2",
      name: "Hillside Vista",
      vibe: "hillside",
      zone: "residential",
      x: 30,
      y: 20,
      description: "an elevated lot",
    },
  ],
};

class PatrolPicksBeach implements BotAdapter {
  readonly source = "patrol-picks-beach";
  async generate(
    _systemPrompt: string,
    _history: ChatMessage[],
    speakingAs: Speaker,
  ): Promise<string> {
    return speakingAs === "patrol"
      ? "Welcome to Landing One — we've allocated you Beach Cove. It should suit your family well."
      : "I'm Pim, hoping for a place by the sea.";
  }
}

class PatrolReturnsNoPlot implements BotAdapter {
  readonly source = "patrol-no-plot";
  async generate(
    _p: string,
    _h: ChatMessage[],
    speakingAs: Speaker,
  ): Promise<string> {
    return speakingAs === "patrol" ? "Welcome." : "I'm Pim.";
  }
}

class BrokenAdapter implements BotAdapter {
  readonly source = "broken";
  async generate(): Promise<string> {
    throw new Error("inference down");
  }
}

describe("composeLifeHistory", () => {
  it("embeds the household identity, origin, and motivation", () => {
    const s = composeLifeHistory(h);
    expect(s).toContain(h.members[0]!.name);
    expect(s).toContain(h.originLocation);
    expect(s).toContain(h.lead.migrationMotivation);
  });
  it("mentions the plot vibes the newcomer can hint at", () => {
    expect(composeLifeHistory(h)).toMatch(
      /beach|hillside|riverside|plains|forest/i,
    );
  });
});

describe("composeCityBrainPrompt", () => {
  it("lists every available plot by name + description", () => {
    const s = composeCityBrainPrompt(plan);
    expect(s).toContain("Beach Cove");
    expect(s).toContain("Hillside Vista");
    expect(s).toMatch(/sandy plot/);
  });
  it("skips plots already allocated", () => {
    const p2: CityPlan = {
      plots: [{ ...plan.plots[0]!, assignedTo: "household_x" }, plan.plots[1]!],
    };
    const s = composeCityBrainPrompt(p2);
    expect(s).not.toContain("Beach Cove");
    expect(s).toContain("Hillside Vista");
  });
});

describe("MockBotAdapter", () => {
  it("reads who is speaking and answers accordingly", async () => {
    const a = new MockBotAdapter();
    const patrolReply = await a.generate(
      composeCityBrainPrompt(plan),
      [{ speaker: "newcomer", text: "we love the sea", ts: 0 }],
      "patrol",
    );
    expect(patrolReply).toContain("Beach Cove");
    const newcomerReply = await a.generate(
      composeLifeHistory(h),
      [{ speaker: "patrol", text: GREETING, ts: 0 }],
      "newcomer",
    );
    expect(newcomerReply.length).toBeGreaterThan(0);
  });
});

describe("BotService — newcomer + patrol bot-to-bot", () => {
  it("boots a newcomer, gets a real reply, and the patrol allocates a plot", async () => {
    const svc = new BotService(new PatrolPicksBeach(), plan);
    const bot = await svc.create(h);
    expect(bot.status).toBe("awake");
    expect(bot.messages[0]).toMatchObject({
      speaker: "patrol",
      text: GREETING,
    });
    expect(bot.messages[1]!.speaker).toBe("newcomer");
    expect(bot.messages[2]!.speaker).toBe("patrol"); // the city brain's allocation turn
    expect(bot.messages[2]!.text).toContain("Beach Cove");
    expect(bot.messages[3]!.speaker).toBe("narrator");
    expect(bot.messages[3]!.text).toContain("Beach Cove");
    expect(bot.plotId).toBe("plot_1");
    expect(plan.plots[0]!.assignedTo).toBe(h.id);
  });

  it("marks a narrator note when the patrol does not name a recognised plot", async () => {
    const localPlan: CityPlan = {
      plots: plan.plots.map((p) => ({ ...p, assignedTo: undefined })),
    };
    const svc = new BotService(new PatrolReturnsNoPlot(), localPlan);
    const bot = await svc.create(h);
    expect(bot.plotId).toBeUndefined();
    expect(
      bot.messages.some(
        (m) =>
          m.speaker === "narrator" &&
          m.text.includes("not name a recognised plot"),
      ),
    ).toBe(true);
  });

  it("idempotent per household", async () => {
    const svc = new BotService(new PatrolPicksBeach(), {
      plots: plan.plots.map((p) => ({ ...p, assignedTo: undefined })),
    });
    const a = await svc.create(h);
    const b = await svc.create(h);
    expect(a).toBe(b);
    expect(svc.bots).toHaveLength(1);
  });

  it("ask appends the question + reply", async () => {
    const svc = new BotService(new PatrolPicksBeach(), {
      plots: plan.plots.map((p) => ({ ...p, assignedTo: undefined })),
    });
    const bot = await svc.create(h);
    const before = bot.messages.length;
    await svc.ask(bot.id, "What work can your family do?");
    expect(bot.messages.length).toBe(before + 2);
    expect(bot.messages[before]).toMatchObject({
      speaker: "patrol",
      text: "What work can your family do?",
    });
    expect(bot.messages[before + 1]!.speaker).toBe("newcomer");
  });

  it("marks error when the newcomer reply fails", async () => {
    const svc = new BotService(new BrokenAdapter(), {
      plots: plan.plots.map((p) => ({ ...p, assignedTo: undefined })),
    });
    const bot = await svc.create(h);
    expect(bot.status).toBe("error");
    expect(bot.error).toContain("inference down");
  });

  it("remove marks the bot deleted (reset support)", async () => {
    const svc = new BotService(new PatrolPicksBeach(), {
      plots: plan.plots.map((p) => ({ ...p, assignedTo: undefined })),
    });
    const bot = await svc.create(h);
    svc.remove(bot.id);
    expect(svc.forHousehold(h.id)).toBeUndefined();
  });

  it("skips allocation when every plot is taken", async () => {
    const fullPlan: CityPlan = {
      plots: plan.plots.map((p) => ({ ...p, assignedTo: "someone_else" })),
    };
    const svc = new BotService(new PatrolPicksBeach(), fullPlan);
    const bot = await svc.create(h);
    expect(bot.plotId).toBeUndefined();
    // Only greeting + newcomer reply; no patrol allocation turn.
    expect(bot.messages.filter((m) => m.speaker === "patrol").length).toBe(1);
  });
});
