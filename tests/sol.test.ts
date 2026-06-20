import { describe, it, expect } from "vitest";
import {
  solCount,
  secondsToNextSol,
  resolveFoundingMs,
  MS_PER_SOL,
} from "../src/colony/sol";

const FOUND = 1_700_000_000_000; // a fixed founding instant; no real clock used

describe("sols — 1 real day = 1 sol", () => {
  it("is 0 on the founding day", () => {
    expect(solCount(FOUND, FOUND)).toBe(0);
    expect(solCount(FOUND, FOUND + 1000)).toBe(0);
    expect(solCount(FOUND, FOUND + MS_PER_SOL - 1)).toBe(0);
  });

  it("advances by exactly 1 per 86400 real seconds", () => {
    expect(solCount(FOUND, FOUND + MS_PER_SOL)).toBe(1);
    expect(solCount(FOUND, FOUND + 3 * MS_PER_SOL)).toBe(3);
    expect(solCount(FOUND, FOUND + 365 * MS_PER_SOL + 5000)).toBe(365);
  });

  it("never goes negative for a future founding or garbage input", () => {
    expect(solCount(FOUND, FOUND - MS_PER_SOL)).toBe(0);
    expect(solCount(Number.NaN, FOUND)).toBe(0);
    expect(solCount(FOUND, Number.NaN)).toBe(0);
  });

  it("counts the seconds to the next sol tick", () => {
    expect(secondsToNextSol(FOUND, FOUND)).toBe(86400);
    expect(secondsToNextSol(FOUND, FOUND + (MS_PER_SOL - 1000))).toBe(1);
    expect(secondsToNextSol(FOUND, FOUND + MS_PER_SOL)).toBe(86400);
  });

  it("resolveFoundingMs persists the founding instant on first boot and reuses it after", () => {
    const mem: Record<string, string> = {};
    const store = {
      getItem: (k: string) => (k in mem ? mem[k]! : null),
      setItem: (k: string, v: string) => {
        mem[k] = v;
      },
    };
    const first = resolveFoundingMs(store, FOUND);
    expect(first).toBe(FOUND);
    // a later boot at a different now must reuse the stored founding, so sols keep counting from day 0
    const second = resolveFoundingMs(store, FOUND + 10 * MS_PER_SOL);
    expect(second).toBe(FOUND);
    expect(solCount(second, FOUND + 10 * MS_PER_SOL)).toBe(10);
  });

  it("resolveFoundingMs falls back to now when no store is present", () => {
    expect(resolveFoundingMs(undefined, FOUND)).toBe(FOUND);
  });
});
