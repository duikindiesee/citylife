// CI.BOOT.COST.1 — the vitest worker pool must stay bounded.
//
// This suite is CPU-BOUND, not IO-bound. Measured on a 12-core machine: one `new ColonyRuntime()`
// costs ~700-1000 ms, 75 test files construct one, 234 constructions in total — about 3.3 minutes of
// pure world generation.
//
// Vitest's default pool is `cpus - 1` (eleven here) and nothing capped it. Eleven concurrent world
// generations saturate the box; two suites at once is 22 CPU-bound workers on 12 cores. The result,
// six times in one day across hosted CI and two local machines, always a different victim:
//
//   districtDeterminism        6 boots, ~5 s solo   ->    330,581 ms on hosted CI
//   worldPlacement             2 boots              ->    140,114 ms on hosted CI
//   worldLayoutImportPreflight 4 boots              ->  2,502,862 ms locally (41.7 min)
//
// A 66x amplification is contention, not workload. This test exists so a future "let's use all the
// cores" change has to argue with the measurement rather than silently reintroduce the thrash.
import { describe, expect, it } from "vitest";

const CONFIG_MODULE = "../vite.config";
const OS_MODULE = "node:os";

async function testConfig(): Promise<Record<string, unknown>> {
  const mod = await import(CONFIG_MODULE);
  const factory = mod.default as (env: { mode: string }) => {
    test?: Record<string, unknown>;
  };
  return (factory({ mode: "test" }).test ?? {}) as Record<string, unknown>;
}

describe("CI.BOOT.COST.1 — the worker pool is capped", () => {
  it("sets an explicit maxWorkers rather than taking the default", async () => {
    const cfg = await testConfig();
    expect(
      cfg.maxWorkers,
      "an unset maxWorkers means cpus-1 CPU-bound world generations at once",
    ).toBeDefined();
  });

  it("leaves real headroom — at most half the cores, and never fewer than two", async () => {
    const cfg = await testConfig();
    const workers = Number(cfg.maxWorkers);
    const os = (await import(OS_MODULE)) as { cpus: () => unknown[] };
    const cores = os.cpus().length || 4;
    expect(workers).toBeGreaterThanOrEqual(2);
    expect(
      workers,
      `${workers} of ${cores} cores leaves no headroom for a second suite`,
    ).toBeLessThanOrEqual(Math.max(2, Math.ceil(cores / 2)));
  });

  it("does NOT solve contention by loosening the timeout", async () => {
    const cfg = await testConfig();
    // Raising testTimeout again would have hidden the thrash instead of fixing it. 60s is the value
    // spec CI.E2E.TIMEOUT.1 justified with its own measurement; this change must not touch it.
    expect(cfg.testTimeout).toBe(60000);
  });
});
