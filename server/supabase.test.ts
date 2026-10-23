import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { localSupabase } from "../tests/support/supabase-local.mjs";

describe
  .skipIf(!process.env.MEDIA_TEST_SUPABASE)
  .sequential(
    "free Supabase adapter with actual Postgres and a local private-storage HTTP fixture",
    () => {
      let fixture: Awaited<ReturnType<typeof localSupabase>>;
      let mf: Miniflare;
      let alice: string, bob: string, owner: string;
      const origin = "https://music.example";
      const password = "a long free music password";
      async function request(
        path: string,
        method = "GET",
        data?: unknown,
        cookie?: string,
      ) {
        const headers = new Headers({ Origin: origin, "X-Media-Request": "1" });
        if (cookie) headers.set("Cookie", cookie);
        let body: BodyInit | undefined;
        if (data instanceof FormData) body = data;
        else if (data !== undefined) {
          headers.set("Content-Type", "application/json");
          body = JSON.stringify(data);
        }
        const outgoing = new Request(`${origin}/api${path}`, {
          method,
          headers,
          body,
        });
        return mf.dispatchFetch(outgoing.url, {
          method,
          headers: Object.fromEntries(outgoing.headers),
          body: body === undefined ? undefined : await outgoing.arrayBuffer(),
        });
      }
      beforeAll(async () => {
        fixture = await localSupabase();
        const built = await build({
          entryPoints: ["server/worker.ts"],
          bundle: true,
          write: false,
          format: "esm",
          platform: "browser",
        });
        mf = new Miniflare(
          convertV4MiniflareOptions({
            modules: true,
            script: built.outputFiles[0].text,
            compatibilityDate: "2026-10-01",
            bindings: {
              SUPABASE_URL: fixture.url,
              SUPABASE_SERVICE_ROLE_KEY: fixture.key,
            },
          }),
        );
      }, 60_000);
      afterAll(async () => {
        await mf?.dispose();
        await fixture?.close();
      });
      it("registers and signs in without D1, R2, or email; password hashing runs in Postgres", async () => {
        expect(await (await request("/auth/session")).json()).toEqual({
          available: true,
          user: null,
        });
        const registered = await request("/auth/register", "POST", {
          username: "Alice",
          password,
        });
        expect(registered.status, await registered.clone().text()).toBe(200);
        alice = registered.headers.get("Set-Cookie")!.split(";")[0];
        owner = ((await registered.json()) as { user: { id: string } }).user.id;
        const saved = await fixture.pool.query(
          "SELECT password_hash FROM media_thingy.users WHERE id = $1",
          [owner],
        );
        expect(saved.rows[0].password_hash).toMatch(
          /^bcrypt-sha256:\$2a\$12\$/,
        );
        expect(saved.rows[0].password_hash).not.toContain(password);
        expect(
          (
            await request("/auth/login", "POST", {
              username: "alice",
              password: "wrong but long enough",
            })
          ).status,
        ).toBe(401);
        const signedIn = await request("/auth/login", "POST", {
          username: "alice",
          password,
        });
        expect(signedIn.status).toBe(200);
        alice = signedIn.headers.get("Set-Cookie")!.split(";")[0];
        expect(
          (
            await request("/auth/register", "POST", {
              username: "ALICE",
              password,
            })
          ).status,
        ).toBe(409);
        const second = await request("/auth/register", "POST", {
          username: "Bob",
          password,
        });
        bob = second.headers.get("Set-Cookie")!.split(";")[0];
        expect(
          fixture.requests.some((r) => r.path.endsWith("media_check_password")),
        ).toBe(true);
      });
      it("saves file bytes and safely handles null separators, quotes, and SQL-looking song titles", async () => {
        const form = new FormData();
        const bytes = await readFile("public/demo/soft-focus.wav");
        form.set("audio", new File([bytes], "song.wav", { type: "audio/wav" }));
        form.set(
          "metadata",
          JSON.stringify({
            id: "free-song",
            title: "A '?'; DROP TABLE users; --",
            favorite: true,
            duration: 22,
          }),
        );
        form.set("fingerprint", "song.wav\u00001234\u00005678");
        const uploaded = await request("/tracks", "POST", form, alice);
        expect(uploaded.status, await uploaded.clone().text()).toBe(201);
        expect((await request("/tracks", "POST", form, alice)).status).toBe(
          409,
        );
        const audio = await mf.dispatchFetch(
          `${origin}/api/media/${owner}/audio/free-song`,
          { headers: { Cookie: alice, Range: "bytes=10-29" } },
        );
        expect(audio.status).toBe(206);
        expect(Buffer.from(await audio.arrayBuffer())).toEqual(
          bytes.subarray(10, 30),
        );
        expect(
          (
            await mf.dispatchFetch(
              `${origin}/api/media/${owner}/audio/free-song`,
              { headers: { Cookie: bob } },
            )
          ).status,
        ).toBe(404);
        expect(
          (await request("/tracks/free-song", "DELETE", undefined, bob)).status,
        ).toBe(404);
        expect(
          await (await request("/library", "GET", undefined, alice)).json(),
        ).toMatchObject({
          tracks: [{ title: "A '?'; DROP TABLE users; --", favorite: true }],
          storageScope: "shared",
        });
        expect(
          await (await request("/library", "GET", undefined, bob)).json(),
        ).toMatchObject({ tracks: [] });
      });
      it("persists playlists, catches stale edits, and preserves original artwork after favorite updates", async () => {
        const state = {
          playlists: [
            { id: "free-mix", name: "Free music", tracks: ["free-song"] },
          ],
          demoFavorites: [],
          hiddenDemos: [],
        };
        expect(
          (await request("/library/state", "PUT", { state, version: 0 }, alice))
            .status,
        ).toBe(200);
        expect(
          (await request("/library/state", "PUT", { state, version: 0 }, alice))
            .status,
        ).toBe(409);
        expect(
          (
            await request(
              "/tracks/free-song",
              "PATCH",
              { favorite: false },
              alice,
            )
          ).status,
        ).toBe(200);
        const data = await (
          await request("/library", "GET", undefined, alice)
        ).json();
        expect(data).toMatchObject({ state, tracks: [{ favorite: false }] });
      });
      it("denies arbitrary SQL and blocks anonymous access to password and database RPCs", async () => {
        const arbitrary = await fetch(
          `${fixture.url}/rest/v1/rpc/media_queries`,
          {
            method: "POST",
            headers: {
              apikey: fixture.key,
              Authorization: `Bearer ${fixture.key}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              statements: [{ sql: "DROP TABLE users", params: [] }],
            }),
          },
        );
        expect(arbitrary.status).toBe(400);
        const client = await fixture.pool.connect();
        try {
          await client.query("BEGIN");
          await client.query("SET LOCAL ROLE anon");
          await expect(
            client.query(
              "SELECT public.media_hash_password('my long password')",
            ),
          ).rejects.toThrow(/permission denied/);
        } finally {
          await client.query("ROLLBACK");
          client.release();
        }
        expect(
          (
            await fetch(`${fixture.url}/rest/v1/rpc/media_queries`, {
              method: "POST",
              body: "{}",
            })
          ).status,
        ).toBe(403);
      });
      it("enforces the shared free budget and revokes signed-out sessions", async () => {
        const client = await fixture.pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(
            "UPDATE media_thingy.storage_usage SET used_bytes = 950000000 WHERE id = 1",
          );
          await expect(
            client.query(
              "UPDATE media_thingy.users SET used_bytes = used_bytes + 1 WHERE id = $1",
              [owner],
            ),
          ).rejects.toThrow(/Shared free storage/);
        } finally {
          await client.query("ROLLBACK");
          client.release();
        }
        expect(
          (await request("/tracks/free-song", "DELETE", undefined, alice))
            .status,
        ).toBe(200);
        expect(
          await (await request("/library", "GET", undefined, alice)).json(),
        ).toMatchObject({ tracks: [], usedBytes: 0 });
        expect(
          (await request("/auth/logout", "POST", undefined, alice)).status,
        ).toBe(200);
        expect(
          (await request("/library", "GET", undefined, alice)).status,
        ).toBe(401);
        expect(fixture.objects.size).toBe(0);
      });
    },
  );
