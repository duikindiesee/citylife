#!/usr/bin/env node
// CI.SCHEDULING.COLD_BOOT.1 — Bounded concurrency cold-boot scheduling group.
//
// Rationale:
// `mallAnchorShell.test.ts` and `districtDeterminism.test.ts` execute multiple independent
// constructions of `new ColonyRuntime(seed)` across seeds 4242, 42, 7. Bounded empirical
// measurements show their setup hooks consume ~19–21s of the declared 30.00s hook deadline.
//
// Phasing Boundary:
// - Plain `npm test` (zero CLI arguments, as invoked by standard CI, Trusted Main, and Docker):
//   Executes in two sequential non-overlapping phases:
//     Phase 1: Cold-boot group (mallAnchorShell + districtDeterminism) capped at 2 workers.
//     Phase 2: Remaining unit pool (all other unit tests with cold-boot files excluded).
//   Sequential phasing guarantees cold-boot setup hooks do not compete with the broader suite.
//   Failure aggregation: Phase 2 ALWAYS executes even if Phase 1 fails (no fail-fast masking).
//   Fails closed: non-zero exit code if either phase fails, errors, receives a signal, or returns invalid status.
//
// - Targeted / Explicit CLI runs (any user-supplied arguments, e.g. path, directory, -t, --reporter):
//   Delegates ONCE directly to the installed Vitest CLI, preserving all arguments untouched.
//   Avoids splitting custom test filters, overriding requested directories, or colliding report outputs.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createRequire } from "node:module";

export const COLD_BOOT_FILES = [
  "tests/mallAnchorShell.test.ts",
  "tests/districtDeterminism.test.ts",
];

const require = createRequire(import.meta.url);

export function getVitestExecutable() {
  try {
    return require.resolve("vitest/vitest.mjs");
  } catch {
    return resolve(process.cwd(), "node_modules/vitest/vitest.mjs");
  }
}

export function buildPhaseArgs(phase) {
  if (phase === "cold") {
    return ["run", ...COLD_BOOT_FILES, "--maxWorkers=2"];
  }
  if (phase === "remainder") {
    const excludeArgs = COLD_BOOT_FILES.flatMap((file) => ["--exclude", file]);
    return ["run", ...excludeArgs];
  }
  throw new Error(`Unknown phase: ${phase}`);
}

export async function runChildCommand(spawnFn, cmd, args, options = {}) {
  return new Promise((resolvePromise) => {
    try {
      const child = spawnFn(cmd, args, {
        stdio: "inherit",
        shell: false,
        ...options,
      });

      child.on("error", (error) => {
        resolvePromise({ status: 1, signal: null, error });
      });

      child.on("close", (status, signal) => {
        // Fail closed: status must be a non-negative number; null/undefined/signal is treated as 1
        const resolvedStatus =
          typeof status === "number" && status >= 0 && !signal
            ? status
            : 1;
        resolvePromise({ status: resolvedStatus, signal: signal ?? null, error: null });
      });
    } catch (error) {
      resolvePromise({ status: 1, signal: null, error });
    }
  });
}

export async function executeUnitSuite(userArgs = [], spawnFn = spawn) {
  const vitestBin = getVitestExecutable();

  // Smallest compatible boundary: any explicit user argument delegates directly to Vitest
  if (userArgs.length > 0) {
    const directResult = await runChildCommand(
      spawnFn,
      process.execPath,
      [vitestBin, "run", ...userArgs],
    );
    return directResult.status !== 0 ? directResult.status : 0;
  }

  // Phase 1: Cold-boot group (capped at 2 workers)
  console.log("[run-unit-suite] Running Phase 1 (cold-boot group: mallAnchorShell + districtDeterminism, capped 2 workers)...");
  const coldArgs = buildPhaseArgs("cold");
  const coldResult = await runChildCommand(spawnFn, process.execPath, [vitestBin, ...coldArgs]);

  if (coldResult.error) {
    console.error("[run-unit-suite] Phase 1 encountered spawn error:", coldResult.error.message || coldResult.error);
  } else if (coldResult.status !== 0) {
    console.warn(`[run-unit-suite] Phase 1 failed with exit code ${coldResult.status} (signal: ${coldResult.signal}). Proceeding to Phase 2 to ensure complete suite execution...`);
  }

  // Phase 2: Remaining unit pool (cold-boot group excluded)
  console.log("[run-unit-suite] Running Phase 2 (remaining unit pool, cold-boot group excluded)...");
  const remainderArgs = buildPhaseArgs("remainder");
  const remainderResult = await runChildCommand(spawnFn, process.execPath, [vitestBin, ...remainderArgs]);

  if (remainderResult.error) {
    console.error("[run-unit-suite] Phase 2 encountered spawn error:", remainderResult.error.message || remainderResult.error);
  }

  // Aggregate failures: non-zero if either phase failed, errored, or had null/signal status
  const aggregateExitCode =
    coldResult.status !== 0
      ? coldResult.status
      : remainderResult.status !== 0
        ? remainderResult.status
        : 0;

  if (aggregateExitCode !== 0) {
    console.error(`[run-unit-suite] Suite failed. Phase 1 status: ${coldResult.status}, Phase 2 status: ${remainderResult.status}`);
  } else {
    console.log("[run-unit-suite] Both phases completed successfully.");
  }

  return aggregateExitCode;
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const exitCode = await executeUnitSuite(process.argv.slice(2));
  process.exit(exitCode);
}
