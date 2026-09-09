// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: Playwright runs directly, outside Turbo.
import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PUSHDOCS_E2E_BASE_URL;
if (!baseURL || !["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname)) {
  throw new Error("Set PUSHDOCS_E2E_BASE_URL to a disposable local installation");
}
const phase = process.env.PUSHDOCS_E2E_RESTORED === "1" ? "restored" : "install";

export default defineConfig({
  testDir: "./tests/e2e",
  forbidOnly: Boolean(process.env.CI),
  workers: 1,
  retries: 0,
  timeout: 60_000,
  globalTimeout: 180_000,
  outputDir: `output/ci/${phase}/results`,
  reporter: [["list"], ["html", { outputFolder: `output/ci/${phase}/report`, open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: devices["Desktop Chrome"] }],
});
