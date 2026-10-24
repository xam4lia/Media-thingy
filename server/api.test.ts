import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

let mf: Miniflare;
let alice: string;
let bob: string;
let aliceId: string;
const password = "a good password 1234";
const origin = "https://music.example";
async function request(
  path: string,
  method = "GET",
  data?: unknown,
  session?: string,
) {
  const headers = new Headers({ Origin: origin, "X-Media-Request": "1" });
  if (session) headers.set("Cookie", session);
  let body: string | FormData | undefined;
  if (data instanceof FormData) body = data;
  else if (data !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(data);
  }
  // Node and workerd use separate FormData implementations; serialize through HTTP bytes.
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
const session = (response: Response) =>
  response.headers.get("Set-Cookie")!.split(";")[0];
beforeAll(async () => {
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
      d1Databases: { DB: "test-accounts" },
      r2Buckets: ["MUSIC"],
    }),
  );
  const db = await mf.getD1Database("DB");
  for (const sql of (await readFile("migrations/0001_accounts.sql", "utf8"))
    .split(";")
    .filter((s) => s.trim()))
    await db.prepare(sql).run();
}, 30_000);
afterAll(async () => {
  await mf?.dispose();
});

describe.sequential("private account library on real local D1 and R2", () => {
  it("registers password accounts and sets an HttpOnly, Secure session; never stores raw passwords", async () => {
    const response = await request("/auth/register", "POST", {
      username: "Alice",
      password,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toContain(
      "HttpOnly; SameSite=Lax",
    );
    expect(response.headers.get("Set-Cookie")).toContain("Secure");
    alice = session(response as unknown as Response);
    aliceId = ((await response.json()) as { user: { id: string } }).user.id;
    const db = await mf.getD1Database("DB");
    const saved = await db
      .prepare("SELECT password_hash FROM users WHERE username = 'Alice'")
      .first<{ password_hash: string }>();
    expect(saved!.password_hash).toMatch(/^pbkdf2-sha256:600000:/);
    expect(saved!.password_hash).not.toContain(password);
    expect(
      await (await request("/auth/session", "GET", undefined, alice)).json(),
    ).toMatchObject({ user: { username: "Alice" } });
    bob = session(
      (await request("/auth/register", "POST", {
        username: "Bob",
        password,
      })) as unknown as Response,
    );
  });
  it("rejects duplicate usernames, wrong passwords, short passwords, and cross-site writes", async () => {
    expect(
      (await request("/auth/register", "POST", { username: "alice", password }))
        .status,
    ).toBe(409);
    expect(
      (
        await request("/auth/login", "POST", {
          username: "Alice",
          password: "incorrect but long",
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await request("/auth/register", "POST", {
          username: "Short",
          password: "123",
        })
      ).status,
    ).toBe(400);
    const forged = await mf.dispatchFetch(`${origin}/api/auth/logout`, {
      method: "POST",
      headers: {
        Cookie: alice,
        Origin: "https://other.example",
        "X-Media-Request": "1",
      },
    });
    expect(forged.status).toBe(403);
  });
  it("saves actual audio bytes and favorites, streams ranges, and isolates every owner's files", async () => {
    const bytes = await readFile("public/demo/soft-focus.wav");
    const form = new FormData();
    form.set("audio", new File([bytes], "my-song.wav", { type: "audio/wav" }));
    form.set(
      "metadata",
      JSON.stringify({
        id: "my-song",
        title: "My song",
        artist: "Me",
        duration: 22,
        favorite: true,
      }),
    );
    form.set("fingerprint", "my-song-fingerprint");
    const response = await request("/tracks", "POST", form, alice);
    expect(response.status, await response.clone().text()).toBe(201);
    const track = ((await response.json()) as { track: { url: string } }).track;
    const audio = await mf.dispatchFetch(`${origin}${track.url}`, {
      headers: { Cookie: alice, Range: "bytes=20-39" },
    });
    expect(audio.status).toBe(206);
    expect(audio.headers.get("Content-Range")).toBe(
      `bytes 20-39/${bytes.length}`,
    );
    expect(Buffer.from(await audio.arrayBuffer())).toEqual(
      bytes.subarray(20, 40),
    );
    expect(
      (
        await mf.dispatchFetch(`${origin}${track.url}`, {
          headers: { Cookie: bob },
        })
      ).status,
    ).toBe(404);
    expect((await mf.dispatchFetch(`${origin}${track.url}`)).status).toBe(401);
    const lyrics = "[00:01.00] First line\r\n[00:05.50] Second line";
    const updated = await request(
      "/tracks/my-song",
      "PATCH",
      { lyrics },
      alice,
    );
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      track: { lyrics: "[00:01.00] First line\n[00:05.50] Second line" },
    });
    expect(
      (await request("/tracks/my-song", "PATCH", { favorite: false }, bob))
        .status,
    ).toBe(404);
    expect(
      (await request("/tracks/my-song", "DELETE", undefined, bob)).status,
    ).toBe(404);
    expect(
      await (await request("/library", "GET", undefined, bob)).json(),
    ).toMatchObject({ tracks: [] });
    expect(
      await (await request("/library", "GET", undefined, alice)).json(),
    ).toMatchObject({ tracks: [{ lyrics: expect.stringContaining("Second line") }] });
    expect((await request("/tracks", "POST", form, alice)).status).toBe(409);
  });
  it("persists playlists with conflict detection and returns only each account's covers", async () => {
    expect(
      (
        await request(
          "/library/state",
          "PUT",
          {
            state: {
              playlists: [{ id: "mix", name: "My mix", tracks: ["my-song"] }],
              playCounts: { "my-song": 7 },
            },
            version: 0,
          },
          alice,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          "/library/state",
          "PUT",
          { state: { playlists: [] }, version: 0 },
          alice,
        )
      ).status,
    ).toBe(409);
    const png = Uint8Array.from(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    const response = await mf.dispatchFetch(
      `${origin}/api/covers/song/my-song`,
      {
        method: "PUT",
        headers: { Origin: origin, "X-Media-Request": "1", Cookie: alice },
        body: png,
      },
    );
    expect(response.status).toBe(200);
    expect(
      await (await request("/covers/song", "GET", undefined, bob)).json(),
    ).toEqual({ covers: {} });
    expect(
      await (await request("/covers/song", "GET", undefined, alice)).json(),
    ).toMatchObject({
      covers: {
        "my-song": expect.stringContaining(`/api/media/${aliceId}/song/`),
      },
    });
  });
  it("keeps storage usage correct when tabs replace or remove the same cover concurrently", async () => {
    const png = Uint8Array.from(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    const put = () =>
      mf.dispatchFetch(`${origin}/api/covers/playlist/race-cover`, {
        method: "PUT",
        headers: { Origin: origin, "X-Media-Request": "1", Cookie: alice },
        body: png,
      });
    const db = await mf.getD1Database("DB");
    for (let i = 0; i < 4; i++) {
      const responses = await Promise.all(
        i % 2
          ? [
              put(),
              request(
                "/covers/playlist/race-cover",
                "DELETE",
                undefined,
                alice,
              ),
            ]
          : [put(), put()],
      );
      expect(
        responses.every((response) => [200, 409].includes(response.status)),
      ).toBe(true);
      const usage = await db
        .prepare(
          "SELECT used_bytes, (SELECT COALESCE(SUM(size), 0) FROM media WHERE user_id = users.id) AS actual FROM users WHERE id = ?",
        )
        .bind(aliceId)
        .first<{ used_bytes: number; actual: number }>();
      expect(usage!.used_bytes).toBe(usage!.actual);
    }
    await request("/covers/playlist/race-cover", "DELETE", undefined, alice);
  });
  it("restores the library on a fresh login and revokes logged-out and expired sessions", async () => {
    expect(
      (await request("/auth/logout", "POST", undefined, alice)).status,
    ).toBe(200);
    expect((await request("/library", "GET", undefined, alice)).status).toBe(
      401,
    );
    const signedIn = await request("/auth/login", "POST", {
      username: "alice",
      password,
    });
    expect(signedIn.status).toBe(200);
    alice = session(signedIn as unknown as Response);
    const library = await (
      await request("/library", "GET", undefined, alice)
    ).json();
    expect(library).toMatchObject({
      tracks: [{ title: "My song", favorite: true }],
      state: {
        playlists: [{ name: "My mix" }],
        playCounts: { "my-song": 7 },
      },
    });
    expect(
      (await request("/tracks/my-song", "DELETE", undefined, alice)).status,
    ).toBe(200);
    expect(
      await (await request("/library", "GET", undefined, alice)).json(),
    ).toMatchObject({ tracks: [], usedBytes: 0 });
    const db = await mf.getD1Database("DB");
    await db
      .prepare("UPDATE sessions SET expires_at = 0 WHERE user_id = ?")
      .bind(aliceId)
      .run();
    expect((await request("/library", "GET", undefined, alice)).status).toBe(
      401,
    );
  });
  it("rejects oversized and malformed requests without creating another account", async () => {
    const oversized = await mf.dispatchFetch(`${origin}/api/auth/register`, {
      method: "POST",
      headers: {
        Origin: origin,
        "X-Media-Request": "1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: "TooLarge",
        password,
        extra: "x".repeat(3000),
      }),
    });
    expect(oversized.status).toBe(413);
    const malformed = await request(
      "/library/state",
      "PUT",
      { state: { playlists: [null] }, version: 0 },
      bob,
    );
    expect(malformed.status).toBe(400);
    expect(malformed.headers.get("Cache-Control")).toBe("private, no-store");
    const unencrypted = await mf.dispatchFetch(
      "http://music.example/api/auth/session",
    );
    expect(unencrypted.status).toBe(400);
  });
  it("rate limits repeated login guesses before doing further password work", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++)
      statuses.push(
        (
          await request("/auth/login", "POST", {
            username: "GuessTarget",
            password,
          })
        ).status,
      );
    expect(statuses[0]).toBe(401);
    expect(statuses.at(-1)).toBe(429);
  });
});
