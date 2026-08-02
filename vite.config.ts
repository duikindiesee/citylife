import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import http from "node:http";
import https from "node:https";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { cpus } from "node:os";

/**
 * UI.VERSION.1 — resolve the identity of THIS build, at build time.
 *
 * Deliberately env-first, git-second. The Docker build cannot use git at all: `.dockerignore`
 * excludes `.git`, so inside the image there is no repository to ask. CI therefore passes the
 * values in as build args (see Dockerfile + .github/workflows/docker.yml), and the git lookup
 * exists only so a developer running `npm run dev` still sees a truthful SHA instead of a blank.
 *
 * Nothing here is hand-maintained: a stale value cannot be committed, because there is no
 * constant to forget to update.
 */
function resolveBuildStamp(env: Record<string, string>) {
  const pkgVersion = (() => {
    try {
      return JSON.parse(readFileSync("package.json", "utf8")).version || "";
    } catch {
      return "";
    }
  })();
  const gitSha = () => {
    try {
      return execFileSync("git", ["rev-parse", "--short=7", "HEAD"], {
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim();
    } catch {
      // No .git — the Docker build path. CI supplies VITE_BUILD_SHA instead.
      return "";
    }
  };
  return {
    version: env.VITE_APP_VERSION || pkgVersion,
    sha: env.VITE_BUILD_SHA || gitSha(),
    builtAt: env.VITE_BUILD_TIME || new Date().toISOString(),
  };
}

// Vite + Vitest config. Sim/engine tests run in the node environment (no DOM).
// Dev reads KOOKER_GATEWAY from .env.local (see .env.example); the deploy image bakes the public
// gateway as its default (Dockerfile). The gateway is the same public endpoint the kooker web app
// calls from browsers — never put credentials or internal cluster hostnames in this repo.
// Browser -> Vite proxy -> kooker APISIX gateway (avoids CORS).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const kookerGateway = env.KOOKER_GATEWAY || "http://localhost:8081";
  // Pin the dev proxy to IPv4. api.kooker.co.za (AWS) publishes both A and AAAA records; on a host
  // without working IPv6 egress, node connects to the IPv6 address first and hangs (ETIMEDOUT), so
  // the proxy returns a silent 502 even though the gateway is healthy and curl (Happy Eyeballs ->
  // IPv4) works. family:4 makes node behave like curl. See the reboot-IPv6 incident, 2026-06-01.
  const ipv4Agent = kookerGateway.startsWith("https")
    ? new https.Agent({ family: 4 })
    : new http.Agent({ family: 4 });
  const buildStamp = resolveBuildStamp(env);
  return {
    plugins: [react()],
    // Inlined as literals so the shipped bundle carries its own identity with no runtime fetch.
    define: {
      __BUILD_VERSION__: JSON.stringify(buildStamp.version),
      __BUILD_SHA__: JSON.stringify(buildStamp.sha),
      __BUILD_TIME__: JSON.stringify(buildStamp.builtAt),
    },
    build: {
      rollupOptions: {
        // Multipage: the colony game plus the spec-077 House Builder (town.html is the legacy v1 page),
        // and ask-kooker.html — the public Ask-Kooker board with a login-walled Your-answers panel.
        input: {
          index: "index.html",
          builder: "builder.html",
          kookerbook: "kookerbook.html",
          town: "town.html",
          askkooker: "ask-kooker.html",
        },
      },
    },
    server: {
      port: 5188,
      // SECURITY: bind to localhost only by default. A DEV build can auto-login with the operator
      // creds from .env.local, and a VITE_CITYLIFE_PAT is reachable in the dev runtime, so a server
      // bound to 0.0.0.0 would let any device on the same LAN open it, auto-login as the operator and
      // spend the operator's inference. Opt into LAN exposure deliberately with VITE_LAN=1 (e.g. to
      // test from a phone). Deployed bundles are unaffected (DEV is false, creds are nginx-injected).
      host:
        env.VITE_LAN === "1" || env.VITE_LAN === "true" ? true : "127.0.0.1",
      proxy: {
        // Anchored with the trailing slash so only /kooker/api/... API calls proxy to the gateway —
        // a bare /kooker prefix also swallowed /kookerbook.html (the spec 082 page) into APISIX.
        "^/kooker/": {
          target: kookerGateway,
          changeOrigin: true,
          secure: true,
          agent: ipv4Agent,
          headers: { "ngrok-skip-browser-warning": "true" },
          rewrite: (p) => p.replace(/^\/kooker/, ""),
          // Make upstream failures visible in the vite terminal instead of a silent 502.
          configure: (proxy) => {
            proxy.on("error", (err) => {
              // eslint-disable-next-line no-console
              console.error(
                "[kooker proxy] upstream error:",
                (err as NodeJS.ErrnoException).code || err.message,
                "->",
                kookerGateway,
              );
            });
          },
        },
      },
    },
    test: {
      environment: "node",
      include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
      // CI.BOOT.COST.1 — bound the worker pool, because this suite is CPU-bound, not IO-bound.
      //
      // MEASURED, on a 12-core machine:
      //   one `new ColonyRuntime()` boot          ~700-1000 ms (850 ms typical, 688 ms warm)
      //   test files that construct one            75
      //   total constructions across the suite    234
      //   => ~3.3 MINUTES of pure world generation, all of it CPU-bound
      //
      // Vitest's default pool is `cpus - 1`, i.e. ELEVEN workers here, and nothing capped it. Eleven
      // concurrent world generations saturate a 12-core box on their own; run two suites at once — a
      // second branch's CI job, or a developer running `npm test` while CI does — and it is 22
      // CPU-bound workers on 12 cores. That is not slow, it is thrashing, and the numbers show it:
      //
      //   districtDeterminism.test.ts   6 boots, ~5 s of boot solo   ->    330,581 ms on hosted CI
      //   worldPlacement.test.ts        2 boots                      ->    140,114 ms on hosted CI
      //   worldLayoutImportPreflight    4 boots                      ->  2,502,862 ms locally (41.7 min)
      //
      // A 66x amplification is contention, not workload. Six timeout failures in one day across
      // hosted CI and two local machines, each time a DIFFERENT victim and everything else green —
      // the signature of a resource problem rather than a broken test.
      //
      // Half the cores leaves genuine parallelism while keeping headroom for the OS, the GPU runner's
      // other jobs, and a second suite. This does NOT mask anything: a hung test still hangs, and
      // `testTimeout` is untouched. Raising the timeout again would have masked it; this addresses the
      // cause. `retry: 2` below stays as the last line of defence, not the first.
      maxWorkers: Math.max(2, Math.floor((cpus().length || 4) / 2)),
      // Spec 086 — a ColonyRuntime boot now builds a whole distributed city (a primary + several
      // satellite hamlets + trunk-road routing), so a construction is far heavier than one cheap
      // neighbourhood. Under parallel-suite CPU contention that brushed the 5s default; 20s gives the
      // city-builders room without masking a genuine hang. (Supersedes Codex's 15s from the lighthouse
      // merge — the distributed-city boot is the heavier of the two.)
      //
      // CI.E2E.TIMEOUT.1 — raised again, 20s -> 60s, for the same reason and with the same shape of
      // evidence. The world kept growing after that note was written. Measured on a developer
      // machine with nothing competing, `worldLayoutAcceptance` — a boot-heavy suite — spends
      // 19.84s of test time across 5 tests, and its single heaviest case takes 5685ms ALONE, i.e.
      // 28% of the old budget before any contention at all. On CI, running 246 files in parallel,
      // that same case timed out at 20000ms and failed ALL THREE retries, while the identical
      // commit's siblings (PRs 459 and 461) passed — the signature of contention, not a hang.
      //
      // 60s keeps roughly a 10x margin over the measured solo cost while still reporting a genuine
      // hang inside a minute. It does not weaken a single assertion: a test that passes cannot be
      // made to fail by a longer budget, and one that truly hangs still fails, just later.
      testTimeout: 60000,
      // Spec 150 — ship-CI resilience for the v3->main cutover. A couple of runtime suites
      // (rally-spur seed coverage, road-connectivity) are order/seed-sensitive: they pass in
      // isolation but occasionally flip under full-parallel-suite contention. `npm test` on
      // main's CI has no retry, so a single flake would falsely redden the release build.
      // Two retries lets a genuine flake self-heal while a real breakage (fails all 3 tries)
      // still fails. NOTE: this is a stopgap — the proper fix is to make those suites fully
      // deterministic (seed the last Math.random paths in the city/road generation).
      retry: 2,
    },
  };
});
