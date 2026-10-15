import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import {
  getVitestExecutable,
  buildPhaseArgs,
  runChildCommand,
  executeUnitSuite,
} from "./run-unit-suite.mjs";

function createMockChild({ status, signal = null, error = null } = {}) {
  const emitter = new EventEmitter();
  process.nextTick(() => {
    if (error) {
      emitter.emit("error", error);
    } else {
      emitter.emit("close", status, signal);
    }
  });
  return emitter;
}

test("runChildCommand preserves arguments verbatim without shell distortion", async () => {
  // Directly exercises runChildCommand with real child process and shell: false
  const testPayload = 'seed 4242.*(builds|pins) > "quote" & | ;';
  let capturedOutput = "";

  const customSpawn = (cmd, args, opts) => {
    const child = spawn(cmd, args, opts);
    child.stdout?.on("data", (chunk) => {
      capturedOutput += chunk.toString("utf8");
    });
    return child;
  };

  const result = await runChildCommand(
    customSpawn,
    process.execPath,
    ["-e", "process.stdout.write(process.argv[1])", testPayload],
    { stdio: ["ignore", "pipe", "ignore"] },
  );

  assert.equal(result.status, 0);
  assert.equal(result.error, null);
  assert.equal(
    capturedOutput,
    testPayload,
    "runChildCommand must pass verbatim argument array to child without shell expansion",
  );
});

test("runChildCommand fails closed on absent, null, undefined, or signal status", async () => {
  // Null status without signal must not silently resolve to 0
  const nullStatusChild = () => createMockChild({ status: null, signal: null });
  const resultNull = await runChildCommand(nullStatusChild, "mock", []);
  assert.equal(resultNull.status, 1, "Null status must resolve to 1");

  // Undefined status must fail closed
  const undefinedStatusChild = () => createMockChild({ status: undefined, signal: null });
  const resultUndefined = await runChildCommand(undefinedStatusChild, "mock", []);
  assert.equal(resultUndefined.status, 1, "Undefined status must resolve to 1");

  // Signal termination must fail closed
  const signalChild = () => createMockChild({ status: null, signal: "SIGTERM" });
  const resultSignal = await runChildCommand(signalChild, "mock", []);
  assert.equal(resultSignal.status, 1, "Signal termination must resolve to non-zero");
  assert.equal(resultSignal.signal, "SIGTERM");

  // Valid 0 status resolves to 0
  const zeroChild = () => createMockChild({ status: 0, signal: null });
  const resultZero = await runChildCommand(zeroChild, "mock", []);
  assert.equal(resultZero.status, 0, "Valid 0 status must resolve to 0");
});

test("buildPhaseArgs generates exact non-overlapping phase argument sets", () => {
  const coldArgs = buildPhaseArgs("cold");
  assert.deepEqual(coldArgs, [
    "run",
    "tests/mallAnchorShell.test.ts",
    "tests/districtDeterminism.test.ts",
    "--maxWorkers=2",
  ]);

  const remainderArgs = buildPhaseArgs("remainder");
  assert.deepEqual(remainderArgs, [
    "run",
    "--exclude",
    "tests/mallAnchorShell.test.ts",
    "--exclude",
    "tests/districtDeterminism.test.ts",
  ]);
});

test("plain invocation runs cold phase then remainder phase and aggregates failures", async () => {
  // Case A: Cold-phase failure still executes remainder and exits non-zero
  const callsA = [];
  const mockSpawnA = (cmd, args) => {
    callsA.push({ cmd, args });
    if (callsA.length === 1) return createMockChild({ status: 1 });
    return createMockChild({ status: 0 });
  };

  const exitCodeA = await executeUnitSuite([], mockSpawnA);
  assert.equal(callsA.length, 2, "Remainder must execute even after cold phase failure");
  assert.ok(callsA[0].args.includes("tests/mallAnchorShell.test.ts"));
  assert.ok(callsA[1].args.includes("--exclude"));
  assert.equal(exitCodeA, 1, "Must aggregate cold phase failure");

  // Case B: Remainder failure after cold-phase success reports non-zero exit code
  const callsB = [];
  const mockSpawnB = (cmd, args) => {
    callsB.push({ cmd, args });
    if (callsB.length === 1) return createMockChild({ status: 0 });
    return createMockChild({ status: 2 });
  };

  const exitCodeB = await executeUnitSuite([], mockSpawnB);
  assert.equal(callsB.length, 2);
  assert.equal(exitCodeB, 2, "Must propagate remainder failure exit code");

  // Case C: Both succeed
  const callsC = [];
  const mockSpawnC = (cmd, args) => {
    callsC.push({ cmd, args });
    return createMockChild({ status: 0 });
  };

  const exitCodeC = await executeUnitSuite([], mockSpawnC);
  assert.equal(callsC.length, 2);
  assert.equal(exitCodeC, 0);
});

test("spawn error and thrown spawn fail closed and still execute remainder phase", async () => {
  // Subtest 1: Child process emits error event
  const callsEmitted = [];
  const mockSpawnEmitted = (cmd, args) => {
    callsEmitted.push({ cmd, args });
    if (callsEmitted.length === 1) {
      return createMockChild({ error: new Error("ENOENT: vitest binary not found") });
    }
    return createMockChild({ status: 0 });
  };

  const exitCodeEmitted = await executeUnitSuite([], mockSpawnEmitted);
  assert.equal(callsEmitted.length, 2, "Remainder must still execute when cold phase emits spawn error");
  assert.notEqual(exitCodeEmitted, 0, "Emitted spawn error must yield non-zero aggregate exit code");

  // Subtest 2: spawnFn throws synchronously
  const callsThrown = [];
  const mockSpawnThrown = (cmd, args) => {
    callsThrown.push({ cmd, args });
    if (callsThrown.length === 1) {
      throw new Error("EACCES: permission denied");
    }
    return createMockChild({ status: 0 });
  };

  const exitCodeThrown = await executeUnitSuite([], mockSpawnThrown);
  assert.equal(callsThrown.length, 2, "Remainder must still execute when cold phase throws on spawn");
  assert.notEqual(exitCodeThrown, 0, "Thrown spawn error must yield non-zero aggregate exit code");
});

test("any explicit user args delegate once directly to Vitest preserving all args untouched", async () => {
  const testCases = [
    ["tests/scale.test.ts"],
    ["-t", "seed 4242.*(builds|pins)"],
    ["--reporter=json", "--outputFile=test-results/report.json"],
    ["tests/colony"],
    ["scale"],
  ];

  for (const userArgs of testCases) {
    const calls = [];
    const mockSpawn = (cmd, args) => {
      calls.push({ cmd, args });
      return createMockChild({ status: 0 });
    };

    const exitCode = await executeUnitSuite(userArgs, mockSpawn);
    assert.equal(calls.length, 1, `Targeted invocation for ${JSON.stringify(userArgs)} must execute exactly once`);
    assert.equal(calls[0].cmd, process.execPath);
    assert.ok(calls[0].args[0].endsWith("vitest.mjs"));
    assert.equal(calls[0].args[1], "run");
    assert.deepEqual(calls[0].args.slice(2), userArgs, "All user arguments must be preserved untouched");
    assert.equal(exitCode, 0);
  }
});

