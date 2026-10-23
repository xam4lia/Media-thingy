import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import pg from "pg";

const exec = promisify(execFile);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export async function localSupabase() {
  // Disposable test database only: no host data volumes and no production credentials.
  const { stdout } = await exec("docker", [
    "run",
    "--rm",
    "--detach",
    "--name",
    `media-supabase-test-${process.pid}-${Date.now()}`,
    "--publish",
    "127.0.0.1::5432",
    "--env",
    "POSTGRES_PASSWORD=media-local-test-only",
    "postgres:17-alpine",
  ]);
  const container = stdout.trim();
  let pool, server;
  async function close() {
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    await pool?.end();
    await exec("docker", ["stop", "--time", "1", container]).catch(
      () => undefined,
    );
  }
  try {
    const inspected = await exec("docker", [
      "inspect",
      "--format",
      '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}',
      container,
    ]);
    pool = new pg.Pool({
      host: "127.0.0.1",
      port: Number(inspected.stdout.trim()),
      user: "postgres",
      password: "media-local-test-only",
      database: "postgres",
      max: 8,
    });
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        await pool.query("SELECT 1");
        ready = true;
        break;
      } catch {
        await delay(100);
      }
    }
    if (!ready) throw new Error("Local Postgres did not start.");
    await pool.query(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA storage; CREATE TABLE storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);`);
    await pool.query(await readFile("public/setup-supabase.sql", "utf8"));
    const objects = new Map();
    const requests = [];
    const key = "media-local-service-role-test-only";
    server = createServer(async (request, response) => {
      try {
        if (
          request.headers.apikey !== key ||
          request.headers.authorization !== `Bearer ${key}`
        ) {
          response.writeHead(403);
          response.end("{}");
          return;
        }
        const path = new URL(request.url, "http://localhost").pathname;
        requests.push({ method: request.method, path });
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const bytes = Buffer.concat(chunks);
        if (path.startsWith("/rest/v1/rpc/")) {
          const data = JSON.parse(bytes.toString());
          const client = await pool.connect();
          try {
            await client.query("BEGIN");
            await client.query("SET LOCAL ROLE service_role");
            let result;
            if (path.endsWith("media_queries"))
              result = await client.query(
                "SELECT public.media_queries($1::jsonb) AS data",
                [JSON.stringify(data.statements)],
              );
            else if (path.endsWith("media_hash_password"))
              result = await client.query(
                "SELECT public.media_hash_password($1) AS data",
                [data.password],
              );
            else if (path.endsWith("media_check_password"))
              result = await client.query(
                "SELECT public.media_check_password($1, $2) AS data",
                [data.password, data.stored_hash],
              );
            else throw new Error("Unknown RPC");
            await client.query("COMMIT");
            response.writeHead(200, { "Content-Type": "application/json" });
            response.end(JSON.stringify(result.rows[0].data));
          } catch (error) {
            await client.query("ROLLBACK");
            response.writeHead(error.code === "23505" ? 409 : 400, {
              "Content-Type": "application/json",
            });
            response.end(
              JSON.stringify({ code: error.code, message: error.message }),
            );
          } finally {
            client.release();
          }
          return;
        }
        const bucket = "/storage/v1/object/media-thingy-music";
        if (path === bucket && request.method === "DELETE") {
          for (const prefix of JSON.parse(bytes.toString()).prefixes)
            objects.delete(prefix);
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end("[]");
          return;
        }
        if (path.startsWith(`${bucket}/`)) {
          const object = decodeURIComponent(path.slice(bucket.length + 1));
          if (request.method === "POST") {
            if (objects.has(object)) {
              response.writeHead(409);
              response.end("{}");
              return;
            }
            objects.set(object, bytes);
            response.writeHead(200, { "Content-Type": "application/json" });
            response.end("{}");
            return;
          }
          if (request.method === "GET" && objects.has(object)) {
            const value = objects.get(object);
            const range = /^bytes=(\d+)-(\d+)$/.exec(
              request.headers.range || "",
            );
            response.writeHead(range ? 206 : 200, {
              "Content-Type": "application/octet-stream",
            });
            response.end(
              range
                ? value.subarray(Number(range[1]), Number(range[2]) + 1)
                : value,
            );
            return;
          }
        }
        response.writeHead(404, { "Content-Type": "application/json" });
        response.end("{}");
      } catch {
        response.writeHead(500, { "Content-Type": "application/json" });
        response.end("{}");
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    return {
      pool,
      objects,
      requests,
      url: `http://127.0.0.1:${server.address().port}`,
      key,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
