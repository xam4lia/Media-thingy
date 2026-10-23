import { defineConfig } from "@playwright/test";
import accounts from "./playwright.accounts.config";

export default defineConfig({
  ...accounts,
  outputDir: "supabase-test-results",
  use: { ...accounts.use, baseURL: "http://127.0.0.1:8790" },
  webServer: {
    command: "npm run build && node scripts/dev-supabase-test.mjs",
    url: "http://127.0.0.1:8790/api/auth/session",
    reuseExistingServer: false,
    timeout: 90_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
  },
});
