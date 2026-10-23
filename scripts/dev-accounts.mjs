import { spawn } from "node:child_process";
import { resolve } from "node:path";

const env = {
  ...process.env,
  WRANGLER_SEND_METRICS: "false",
  XDG_CONFIG_HOME: resolve(".wrangler/config"),
  WRANGLER_LOG_PATH: resolve(".wrangler/logs"),
};
const wrangler = resolve("node_modules/wrangler/bin/wrangler.js");
const testing = process.argv.includes("--test");
const persistence = testing
  ? resolve(`.wrangler/test-state/${process.pid}`)
  : resolve(".wrangler/state");
function run(args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [wrangler, ...args], {
      stdio: "inherit",
      env,
    });
    const stop = () => child.kill("SIGTERM");
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
    child.on("error", reject);
    child.on("exit", (code) => {
      process.removeListener("SIGTERM", stop);
      process.removeListener("SIGINT", stop);
      code === 0
        ? resolveRun()
        : reject(new Error(`Local account service exited with ${code}.`));
    });
  });
}
await run([
  "d1",
  "migrations",
  "apply",
  "DB",
  "--local",
  "--config",
  "wrangler.local.jsonc",
  "--persist-to",
  persistence,
  "--install-skills=false",
]);
await run([
  "pages",
  "dev",
  "dist",
  "--d1",
  "DB=00000000-0000-0000-0000-000000000001",
  "--r2",
  "MUSIC=media-thingy-local",
  "--compatibility-date",
  "2026-10-01",
  "--port",
  testing ? "8789" : "8788",
  "--persist-to",
  persistence,
  "--install-skills=false",
]);
