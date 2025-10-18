import os from "node:os";
import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

const port = Number.parseInt(process.env.PLAYWRIGHT_PORT ?? "4300", 10);
const dataDir = path.join(os.tmpdir(), `bot-assist-playwright-${process.pid}`);

export default defineConfig({
  testDir: "./playwright/tests",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: false,
  reporter: process.env.CI
    ? [["junit", { outputFile: "playwright-report/results.xml" }], ["list"]]
    : [["html", { outputFolder: "playwright-report", open: "never" }], ["list"]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "on-first-retry",
    video: "off",
  },
  webServer: {
    command:
      "node --loader ts-node/esm --experimental-specifier-resolution=node src/server.ts",
    port,
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
    env: {
      PORT: String(port),
      BOT_DATA_DIR: dataDir,
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
