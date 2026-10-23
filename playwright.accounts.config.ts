import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  testMatch: "accounts.spec.ts",
  testIgnore: [],
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  outputDir: "account-test-results",
  use: { ...base.use, baseURL: "http://127.0.0.1:8789" },
  webServer: {
    command: "npm run build && node scripts/dev-accounts.mjs --test",
    url: "http://127.0.0.1:8789/api/auth/session",
    reuseExistingServer: false,
    timeout: 90_000,
  },
});
