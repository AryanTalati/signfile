import { defineConfig, devices } from "@playwright/test";

/**
 * E2E tests. By default they build and start the app locally (port 3100,
 * env from .env.local). Set E2E_BASE_URL to run against a deployed URL:
 *   E2E_BASE_URL=https://signfile.onrender.com npx playwright test
 * Every test runs on a desktop browser and a phone-sized one.
 */
const external = process.env.E2E_BASE_URL;
const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  globalTeardown: "./tests/e2e/global-teardown.ts",
  use: {
    baseURL: external ?? `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: external
    ? undefined
    : {
        command: `npm run build && npx next start -p ${PORT}`,
        url: `http://localhost:${PORT}/api/live`,
        timeout: 240_000,
        reuseExistingServer: true,
      },
});
