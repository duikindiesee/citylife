import { describe, it, expect } from "vitest";
import {
  headlineFor,
  shareStats,
  siteLabel,
  DEFAULT_TAGLINE,
} from "../src/colony/social/shareCard";
import type { ColonyUiState } from "../src/colony/runtime";

// A minimal UI-state stub — only the fields the card reads.
const ui = (over: Partial<ColonyUiState> = {}): ColonyUiState =>
  ({
    clock: { day: 3, hour: 10, minute: 0, isDay: true },
    colonists: 16,
    colony: { capacity: 25, food: 30, buildings: 5 },
    power: { solarW: 3.8 },
    name: "Landing One",
    biome: "Crystal shore",
    ...over,
  }) as unknown as ColonyUiState;

describe("Social card — headlines from the day build", () => {
  it("maps the food/greenhouse spec to a farming line", () => {
    expect(headlineFor("Skyfarm Greenhouse: food production")).toMatch(/farm/i);
  });
  it("maps the water spec to a water line", () => {
    expect(headlineFor("Water Hub — first service")).toMatch(/water/i);
  });
  it("maps extraction to a mine line", () => {
    expect(headlineFor("Extraction mine")).toMatch(/mine/i);
  });
  it("falls back to the house line for an unknown / empty spec", () => {
    expect(headlineFor(undefined)).toBe("The city that builds itself.");
    expect(headlineFor("something brand new")).toBe(
      "The city that builds itself.",
    );
  });
});

describe("Social card — stat chips + site label", () => {
  it("draws Sol, Pop, Food, Built and Solar from the UI state", () => {
    const s = shareStats(ui());
    expect(s.find((x) => x.label === "Sol")?.value).toBe("3");
    expect(s.find((x) => x.label === "Pop")?.value).toBe("16/25");
    expect(s.find((x) => x.label === "Food")?.value).toBe("30");
    expect(s.find((x) => x.label === "Built")?.value).toBe("5");
    expect(s.find((x) => x.label === "Solar")?.value).toBe("3.8kW");
  });
  it("combines the colony name and biome into the site label", () => {
    expect(siteLabel(ui())).toBe("Landing One · Crystal shore");
  });
  it("ships a non-empty house tagline", () => {
    expect(DEFAULT_TAGLINE.length).toBeGreaterThan(10);
  });
});
