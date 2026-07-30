import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:3100";
const isCi = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: isCi,
  retries: isCi ? 2 : 0,
  workers: isCi ? 1 : undefined,
  reporter: isCi ? "github" : "list",
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
  webServer: {
    command: isCi
      ? "npx --no-install vinext start -H 127.0.0.1 -p 3100"
      : "npx --no-install vinext dev -H 127.0.0.1 -p 3100",
    url: baseURL,
    reuseExistingServer: !isCi,
    timeout: 120_000,
  },
});
