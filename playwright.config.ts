import { defineConfig, devices } from "@playwright/test";

// The dev-server port defaults to 5191 (unchanged for CI) but can be overridden so a governed worker
// can keep e2e inside its own allocated port range and never collide with another worker's server.
const PORT = Number(process.env.CITYLIFE_E2E_PORT) || 5191;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: process.env.CITYLIFE_HARDWARE_WEBGL
          ? {
              args: [
                "--enable-gpu",
                "--ignore-gpu-blocklist",
                "--use-angle=d3d11",
              ],
            }
          : undefined,
      },
    },
  ],
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${PORT}`,
    url: `${BASE_URL}/?skipauth=1`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
