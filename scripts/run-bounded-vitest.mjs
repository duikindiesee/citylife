import { spawnSync } from "node:child_process";

const THIRTY_THREE_MINUTES_MS = 33 * 60 * 1000;

const args = [
  "vitest",
  "run",
  "--retry=0",
  "--reporter=default",
  "--maxWorkers=50%",
];

const startedAt = Date.now();
const result = spawnSync("npx", args, {
  stdio: "inherit",
  shell: process.platform === "win32",
  timeout: THIRTY_THREE_MINUTES_MS,
});

const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);

if (result.error?.code === "ETIMEDOUT") {
  console.error(
    `CityLife bounded Vitest exceeded ${THIRTY_THREE_MINUTES_MS / 60000} minutes after ${elapsedSeconds}s; failing before the hosted one-hour job ceiling.`,
  );
  process.exit(124);
}

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);