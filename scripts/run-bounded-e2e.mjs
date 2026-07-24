#!/usr/bin/env node
// PLAYER.MOBILE.E2E.1 — OS-level backstop around the mobile/touch UAT harness.
//
// Playwright's own `test.setTimeout` bounds each test, and playwright.mobile-harness.config.ts
// bounds the whole run, but both rely on Playwright's own graceful teardown succeeding. The
// PLAYER.GARAGE.1.FIX1 incident showed that is not guaranteed: a runaway page can leave a
// Chromium renderer alive well past the configured test timeout. This wrapper spawns the
// Playwright test process as its own process-tree root, races it against one hard wall-clock
// timer (no polling, no shell loop, no grep-on-output wait), and on timeout forcibly kills the
// entire descendant tree — Node, Vite dev server, Chromium, everything this run spawned.
//
// Usage: node scripts/run-bounded-e2e.mjs [--config <path>] [--hang-canary]
import { spawn, execFileSync } from "node:child_process";

const HARD_TIMEOUT_MS = Number(
  process.env.MOBILE_HARNESS_HARD_TIMEOUT_MS ?? 150_000,
);

const args = process.argv.slice(2);
let configPath = "playwright.mobile-harness.config.ts";
let includeHangCanary = false;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--config") {
    configPath = args[i + 1];
    i += 1;
  } else if (args[i] === "--hang-canary") {
    includeHangCanary = true;
  }
}

function killTree(pid) {
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
      });
    } catch {
      // Already gone — not an error for our purposes.
    }
  } else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
  }
}

const child = spawn("npx", ["playwright", "test", "--config", configPath], {
  stdio: "inherit",
  env: {
    ...process.env,
    ...(includeHangCanary ? { MOBILE_HARNESS_INCLUDE_HANG_CANARY: "1" } : {}),
  },
  // POSIX: make the child its own process-group leader so -pid kills the whole tree.
  // Windows: `shell: true` is required to resolve npx.cmd at all; tree-kill on timeout goes
  // through `taskkill /T`, which walks descendants by PID regardless of the shell hop.
  detached: process.platform !== "win32",
  shell: process.platform === "win32",
});

let settled = false;

const hardTimer = setTimeout(() => {
  if (settled) return;
  settled = true;
  console.error(
    `[run-bounded-e2e] hard timeout of ${HARD_TIMEOUT_MS}ms reached — killing process tree (pid ${child.pid})`,
  );
  killTree(child.pid);
  // Give the OS a moment to actually finish reaping before we report the timeout exit code.
  setTimeout(() => process.exit(124), 2_000);
}, HARD_TIMEOUT_MS);
hardTimer.unref?.();

function forwardSignal(signal) {
  if (settled) return;
  settled = true;
  clearTimeout(hardTimer);
  killTree(child.pid);
  process.exit(1);
}
process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));

child.on("exit", (code, signal) => {
  if (settled) return;
  settled = true;
  clearTimeout(hardTimer);
  if (signal) {
    console.error(`[run-bounded-e2e] child exited via signal ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});

child.on("error", (err) => {
  if (settled) return;
  settled = true;
  clearTimeout(hardTimer);
  console.error(
    `[run-bounded-e2e] failed to launch playwright: ${err.message}`,
  );
  process.exit(1);
});
