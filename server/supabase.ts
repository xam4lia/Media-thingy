import type { Env } from "./api";

export type SupabaseConfig = {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
};
type Result<T = Record<string, unknown>> = {
  results: T[];
  meta: { changes: number };
};
type Statement = { sql: string; params: unknown[] };

/** The existing account API uses this small subset of D1 and R2. The SQL RPC only
 * accepts the exact statements shipped with the app, and executes batches atomically. */
export function supabaseEnvironment(
  env: Env & SupabaseConfig,
): Env & SupabaseConfig {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return env;
  const base = new URL(env.SUPABASE_URL);
  if (
    base.protocol !== "https:" &&
    !["localhost", "127.0.0.1"].includes(base.hostname)
  )
    throw new Error("Supabase needs an HTTPS project URL.");
  if (
    base.pathname !== "/" ||
    base.search ||
    base.hash ||
    base.username ||
    base.password
  )
    throw new Error("Use your Supabase project URL without a path.");
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  async function remote(path: string, options: RequestInit = {}) {
    const headers = new Headers(options.headers);
    headers.set("apikey", key!);
    headers.set("Authorization", `Bearer ${key}`);
    const response = await fetch(`${base.origin}${path}`, {
      ...options,
      headers,
      redirect: "manual",
    });
    if (!response.ok) {
      const problem = (await response.json().catch(() => ({}))) as {
        code?: string;
        message?: string;
      };
      // Preserve only errors the account API deliberately understands; do not log keys or SQL arguments.
      if (problem.code === "23505")
        throw new Error("UNIQUE: this item already exists.");
      if (problem.code === "P0002") throw new StorageLimitError();
      throw new Error(
        `Supabase account service failed (${response.status}). Check the project setup and server credentials.`,
      );
    }
    return response;
  }
  async function rpc<T>(name: string, data: unknown): Promise<T> {
    const response = await remote(`/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return response.json() as Promise<T>;
  }
  function execute(statements: Statement[]) {
    return rpc<Result[]>("media_queries", { statements });
  }
  function prepare(sql: string) {
    const statement: Statement = {
      sql: sql.replace(/\s+/g, " ").trim(),
      params: [],
    };
    const prepared = {
      ...statement,
      bind(...params: unknown[]) {
        return bound({ ...statement, params });
      },
    };
    function bound(value: Statement): typeof prepared & {
      first<T>(): Promise<T | null>;
      all<T>(): Promise<Result<T>>;
      run(): Promise<Result>;
    } {
      return {
        ...prepared,
        ...value,
        async first<T>() {
          return ((await execute([value]))[0].results[0] as T) ?? null;
        },
        async all<T>() {
          return (await execute([value]))[0] as Result<T>;
        },
        async run() {
          return (await execute([value]))[0];
        },
      };
    }
    return bound(statement);
  }
  const DB = { prepare, batch: execute } as unknown as D1Database;
  const bucket = "/storage/v1/object/media-thingy-music";
  const objectPath = (name: string) =>
    `${bucket}/${name.split("/").map(encodeURIComponent).join("/")}`;
  const MUSIC = {
    async put(
      name: string,
      value: BodyInit | ReadableStream,
      options?: { httpMetadata?: { contentType?: string } },
    ) {
      await remote(objectPath(name), {
        method: "POST",
        headers: {
          "Content-Type":
            options?.httpMetadata?.contentType || "application/octet-stream",
          "x-upsert": "false",
        },
        body: value,
      });
    },
    async delete(names: string | string[]) {
      const prefixes = typeof names === "string" ? [names] : names;
      if (prefixes.length)
        await remote(bucket, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prefixes }),
        });
    },
    async get(
      name: string,
      options?: { range?: { offset: number; length: number } },
    ) {
      const headers = new Headers();
      if (options?.range)
        headers.set(
          "Range",
          `bytes=${options.range.offset}-${options.range.offset + options.range.length - 1}`,
        );
      // Supabase's authenticated object endpoint is private; this response is streamed through Pages.
      const response = await remote(objectPath(name), { headers });
      return { body: response.body };
    },
  } as unknown as R2Bucket;
  return {
    ...env,
    DB,
    MUSIC,
    storageScope: "shared",
    PASSWORDS: {
      hash: (password) => rpc<string>("media_hash_password", { password }),
      check: (password, stored) =>
        rpc<boolean>("media_check_password", { password, stored_hash: stored }),
    },
  };
}

export class StorageLimitError extends Error {
  constructor() {
    super(
      "The free site's shared music storage is full. Remove some songs before adding more.",
    );
  }
}
