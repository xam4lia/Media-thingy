import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { localSupabase } from "../tests/support/supabase-local.mjs";

const fixture = await localSupabase();
const child = spawn(
  process.execPath,
  [
    resolve("node_modules/wrangler/bin/wrangler.js"),
    "pages",
    "dev",
    "dist",
    "--binding",
    `SUPABASE_URL=${fixture.url}`,
    "--binding",
    `SUPABASE_SERVICE_ROLE_KEY=${fixture.key}`,
    "--compatibility-date",
    "2026-10-01",
    "--port",
    "8790",
    "--install-skills=false",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      WRANGLER_SEND_METRICS: "false",
      XDG_CONFIG_HOME: resolve(".wrangler/config"),
      WRANGLER_LOG_PATH: resolve(".wrangler/logs"),
    },
  },
);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  child.kill("SIGTERM");
  await fixture.close();
}
process.once("SIGTERM", () => void close());
process.once("SIGINT", () => void close());
child.once("exit", async (code) => {
  await close();
  process.exitCode = code || 0;
});
