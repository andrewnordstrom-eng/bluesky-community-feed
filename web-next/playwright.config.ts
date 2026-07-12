import { defineConfig, devices } from "@playwright/test"

const baseURL = process.env.CORGI_BASE_URL ?? "https://feed.corgi.network"

export default defineConfig({
  testDir: "./e2e",
  testMatch: "production-hard-refresh.spec.ts",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 120_000,
  reporter: "line",
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL,
    channel: "chrome",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop-chrome",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "mobile-chrome",
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 390, height: 900 },
      },
    },
  ],
})
