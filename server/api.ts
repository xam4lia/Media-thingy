/// <reference types="@cloudflare/workers-types" />
import {
  StorageLimitError,
  supabaseEnvironment,
  type SupabaseConfig,
} from "./supabase";

export interface Env {
  DB: D1Database;
  MUSIC: R2Bucket;
  PASSWORDS?: {
    hash(password: string): Promise<string>;
    check(password: string, stored: string): Promise<boolean>;
  };
  storageScope?: "shared";
}
type User = { id: string; username: string };
type Media = {
  object_key: string;
  size: number;
  content_type: string;
  updated_at: string;
};
const COOKIE = "media_session";
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const ACCOUNT_BYTES = 1024 * 1024 * 1024;
const MAX_AUDIO = 50 * 1024 * 1024;
const MAX_IMAGE = 7 * 1024 * 1024;
const encoder = new TextEncoder();

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
function fail(status: number, message: string): never {
  throw new ApiError(status, message);
}
function json(value: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}
function hex(bytes: ArrayBuffer | Uint8Array) {
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
async function digest(value: string) {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}
async function passwordHash(
  password: string,
  salt = hex(crypto.getRandomValues(new Uint8Array(16))),
) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: encoder.encode(salt),
      iterations: 600_000,
    },
    key,
    256,
  );
  return `pbkdf2-sha256:600000:${salt}:${hex(bits)}`;
}
async function checkPassword(password: string, stored: string) {
  const calculated = await passwordHash(password, stored.split(":")[2]);
  let difference = calculated.length ^ stored.length;
  for (let i = 0; i < calculated.length; i++)
    difference |= calculated.charCodeAt(i) ^ (stored.charCodeAt(i) || 0);
  return difference === 0;
}
function cookie(request: Request, token: string, seconds = SESSION_SECONDS) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${seconds}${secure}`;
}
function sessionToken(request: Request) {
  return request.headers
    .get("Cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
}
async function userFor(request: Request, env: Env): Promise<User | null> {
  const token = sessionToken(request);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return env.DB.prepare(
    "SELECT users.id, users.username FROM sessions JOIN users ON users.id = sessions.user_id WHERE token_hash = ? AND expires_at > ?",
  )
    .bind(await digest(token), Date.now())
    .first<User>();
}
async function startSession(request: Request, env: Env, user: User) {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const old = sessionToken(request);
  const statements = [
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(
      Date.now(),
    ),
    env.DB.prepare(
      "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
    ).bind(await digest(token), user.id, Date.now() + SESSION_SECONDS * 1000),
  ];
  if (old)
    statements.push(
      env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(
        await digest(old),
      ),
    );
  await env.DB.batch(statements);
  return json({ user }, 200, { "Set-Cookie": cookie(request, token) });
}
async function rateLimit(env: Env, key: string, maximum: number) {
  const now = Date.now();
  const row = await env.DB.prepare(
    `INSERT INTO auth_limits (key, attempts, expires_at) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET attempts = CASE WHEN auth_limits.expires_at < ? THEN 1 ELSE auth_limits.attempts + 1 END,
    expires_at = CASE WHEN auth_limits.expires_at < ? THEN excluded.expires_at ELSE auth_limits.expires_at END RETURNING attempts`,
  )
    .bind(key, now + 15 * 60_000, now, now)
    .first<{ attempts: number }>();
  if (!row || row.attempts > maximum)
    fail(429, "Too many attempts. Try again in 15 minutes.");
  // Expired records contain only hashed keys; remove them rather than retaining an IP history.
  await env.DB.prepare("DELETE FROM auth_limits WHERE expires_at < ?")
    .bind(now)
    .run();
}
async function body(
  request: Request,
  limit = 64_000,
): Promise<Record<string, unknown>> {
  const raw = new TextDecoder().decode(await readLimited(request, limit));
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value))
      fail(400, "Invalid request.");
    return value;
  } catch {
    return fail(400, "Invalid request.");
  }
}
function limitStream(stream: ReadableStream<Uint8Array>, limit: number) {
  let size = 0;
  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        size += chunk.byteLength;
        if (size > limit) fail(413, "This request is too large.");
        controller.enqueue(chunk);
      },
    }),
  );
}
async function readLimited(request: Request, limit: number) {
  if (!request.body) return new ArrayBuffer(0);
  return new Response(limitStream(request.body, limit)).arrayBuffer();
}
function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function validId(id: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) fail(400, "Invalid item.");
}
function mediaUrl(user: User, kind: string, id: string, version = "") {
  return `/api/media/${user.id}/${kind}/${id}${version ? `?v=${version}` : ""}`;
}
async function reserve(env: Env, user: User, bytes: number) {
  const result = await env.DB.prepare(
    "UPDATE users SET used_bytes = used_bytes + ? WHERE id = ? AND used_bytes + ? <= ?",
  )
    .bind(bytes, user.id, bytes, ACCOUNT_BYTES)
    .run();
  if (!result.meta.changes)
    fail(
      413,
      "Your account's 1 GB storage is full. Remove some songs before adding more.",
    );
}
async function release(env: Env, user: User, bytes: number) {
  await env.DB.prepare(
    "UPDATE users SET used_bytes = MAX(0, used_bytes - ?) WHERE id = ?",
  )
    .bind(bytes, user.id)
    .run();
}
function imageType(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (hex(bytes.slice(0, 8)) === "89504e470d0a1a0a") return "image/png";
  if (new TextDecoder().decode(bytes.slice(0, 3)) === "GIF") return "image/gif";
  if (
    new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
  )
    return "image/webp";
  if (
    new TextDecoder().decode(bytes.slice(4, 8)) === "ftyp" &&
    /avif|avis/.test(new TextDecoder().decode(bytes.slice(8, 32)))
  )
    return "image/avif";
  return null;
}
async function mediaRecord(env: Env, user: User, kind: string, id: string) {
  return env.DB.prepare(
    "SELECT * FROM media WHERE user_id = ? AND kind = ? AND id = ?",
  )
    .bind(user.id, kind, id)
    .first<Media>();
}
function insertMedia(
  env: Env,
  user: User,
  kind: string,
  id: string,
  key: string,
  size: number,
  type: string,
  version: string,
  previousKey?: string,
) {
  return env.DB.prepare(
    `INSERT INTO media (user_id, kind, id, object_key, size, content_type, updated_at)
    SELECT ?, ?, ?, ?, ?, ?, ? WHERE COALESCE((SELECT object_key FROM media WHERE user_id = ? AND kind = ? AND id = ?), '') = ?
    AND (? != 'song' OR ? LIKE 'demo-%' OR EXISTS (SELECT 1 FROM tracks WHERE user_id = ? AND id = ?))
    ON CONFLICT(user_id, kind, id) DO UPDATE SET object_key = excluded.object_key, size = excluded.size, content_type = excluded.content_type, updated_at = excluded.updated_at
    WHERE media.object_key = ?`,
  ).bind(
    user.id,
    kind,
    id,
    key,
    size,
    type,
    version,
    user.id,
    kind,
    id,
    previousKey || "",
    kind,
    id,
    user.id,
    id,
    previousKey || "",
  );
}

async function route(
  request: Request,
  env: Env & SupabaseConfig,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "");
  const method = request.method;
  if (
    url.protocol !== "https:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    fail(400, "Open this site with HTTPS before using accounts.");
  if (!env.DB || !env.MUSIC) {
    if (path === "/api/auth/session" && method === "GET") {
      const missingConfiguration = [
        !env.SUPABASE_URL && "SUPABASE_URL",
        !env.SUPABASE_SERVICE_ROLE_KEY && "SUPABASE_SERVICE_ROLE_KEY",
      ].filter(Boolean);
      return json({ available: false, user: null, missingConfiguration });
    }
    return fail(
      503,
      "Accounts are not connected yet. Your device library still works.",
    );
  }
  if (!["GET", "HEAD"].includes(method)) {
    if (
      request.headers.get("Origin") !== url.origin ||
      request.headers.get("X-Media-Request") !== "1"
    )
      fail(403, "This request was blocked. Refresh the page and try again.");
    const length = Number(request.headers.get("Content-Length"));
    if (length > MAX_AUDIO + MAX_IMAGE + 100_000)
      fail(413, "Choose an audio file smaller than 50 MB.");
  }
  if (path === "/api/auth/session" && method === "GET")
    return json({ available: true, user: await userFor(request, env) });
  if (
    ["/api/auth/register", "/api/auth/login"].includes(path) &&
    method === "POST"
  ) {
    const data = await body(request, 2048);
    const username = text(data.username, 33);
    const password = typeof data.password === "string" ? data.password : "";
    if (!/^[a-zA-Z0-9_]{3,32}$/.test(username))
      fail(400, "Use 3–32 letters, numbers, or underscores for your username.");
    if (password.length < 12 || password.length > 128)
      fail(400, "Use a password between 12 and 128 characters.");
    const ip = request.headers.get("CF-Connecting-IP") || "local";
    await rateLimit(env, `ip:${await digest(ip)}`, 30);
    await rateLimit(
      env,
      `username:${await digest(username.toLowerCase())}`,
      10,
    );
    if (path.endsWith("register")) {
      await rateLimit(env, `signup:${await digest(ip)}`, 5);
      const user = { id: crypto.randomUUID(), username };
      const hash = env.PASSWORDS
        ? await env.PASSWORDS.hash(password)
        : await passwordHash(password);
      try {
        await env.DB.batch([
          env.DB.prepare(
            "INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)",
          ).bind(user.id, username, hash, Date.now()),
          env.DB.prepare(
            "INSERT INTO library_state (user_id, value) VALUES (?, ?)",
          ).bind(
            user.id,
            JSON.stringify({
              playlists: [],
              demoFavorites: [],
              hiddenDemos: [],
            }),
          ),
        ]);
      } catch (error) {
        if (String(error).includes("UNIQUE"))
          fail(409, "That username is already taken.");
        throw error;
      }
      return startSession(request, env, user);
    }
    const row = await env.DB.prepare(
      "SELECT id, username, password_hash FROM users WHERE username = ? COLLATE NOCASE",
    )
      .bind(username)
      .first<User & { password_hash: string }>();
    // Match the expensive work for unknown users to reduce username enumeration by timing.
    const dummy =
      "pbkdf2-sha256:600000:00000000000000000000000000000000:" + "0".repeat(64);
    const matches = env.PASSWORDS
      ? await env.PASSWORDS.check(password, row?.password_hash || dummy)
      : await checkPassword(password, row?.password_hash || dummy);
    if (!row || !matches) fail(401, "Username or password is incorrect.");
    return startSession(request, env, { id: row.id, username: row.username });
  }
  const user = await userFor(request, env);
  if (!user) fail(401, "Sign in again to open your account library.");
  if (path === "/api/auth/logout" && method === "POST") {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
      .bind(await digest(sessionToken(request)!))
      .run();
    return json({ ok: true }, 200, { "Set-Cookie": cookie(request, "", 0) });
  }
  if (path === "/api/library" && method === "GET") {
    const rows = await env.DB.prepare(
      `SELECT tracks.id, tracks.metadata, media.updated_at AS artwork_version FROM tracks
      LEFT JOIN media ON tracks.user_id = media.user_id AND tracks.id = media.id AND media.kind = 'original'
      WHERE tracks.user_id = ?`,
    )
      .bind(user.id)
      .all<{ id: string; metadata: string; artwork_version: string | null }>();
    const state = await env.DB.prepare(
      "SELECT value, version FROM library_state WHERE user_id = ?",
    )
      .bind(user.id)
      .first<{ value: string; version: number }>();
    const quota = await env.DB.prepare(
      "SELECT used_bytes FROM users WHERE id = ?",
    )
      .bind(user.id)
      .first<{ used_bytes: number }>();
    return json({
      tracks: rows.results.map((row) => ({
        ...JSON.parse(row.metadata),
        source: "cloud",
        url: mediaUrl(user, "audio", row.id),
        artwork: row.artwork_version
          ? mediaUrl(user, "original", row.id, row.artwork_version)
          : undefined,
      })),
      state: JSON.parse(state!.value),
      version: state!.version,
      usedBytes: quota!.used_bytes,
      limitBytes: ACCOUNT_BYTES,
      storageScope: env.storageScope || "account",
    });
  }
  if (path === "/api/library/state" && method === "PUT") {
    const data = await body(request);
    const state = data.state as Record<string, unknown> | undefined;
    if (
      !state ||
      !Array.isArray(state.playlists) ||
      state.playlists.length > 100 ||
      !Number.isInteger(data.version)
    )
      fail(400, "Invalid library settings.");
    const playlists = state.playlists.map((p: unknown) => {
      const item = p as Record<string, unknown>;
      if (
        !item ||
        typeof item !== "object" ||
        !Array.isArray(item.tracks) ||
        item.tracks.length > 5000
      )
        fail(400, "Invalid playlist.");
      const id = text(item.id, 100);
      validId(id);
      const name = text(item.name, 100);
      if (!name) fail(400, "Give the playlist a name.");
      return {
        id,
        name,
        tracks: item.tracks.filter(
          (s): s is string => typeof s === "string" && /^[\w-]{1,100}$/.test(s),
        ),
      };
    });
    const demoIds = (v: unknown) =>
      Array.isArray(v)
        ? v
            .filter(
              (s): s is string =>
                typeof s === "string" && /^demo-[\w-]+$/.test(s),
            )
            .slice(0, 10)
        : [];
    const value = JSON.stringify({
      playlists,
      demoFavorites: demoIds(state.demoFavorites),
      hiddenDemos: demoIds(state.hiddenDemos),
    });
    const result = await env.DB.prepare(
      "UPDATE library_state SET value = ?, version = version + 1 WHERE user_id = ? AND version = ?",
    )
      .bind(value, user.id, data.version)
      .run();
    if (!result.meta.changes)
      fail(
        409,
        "Your library changed in another tab or device. Refresh before editing playlists again.",
      );
    return json({ version: Number(data.version) + 1 });
  }
  if (path === "/api/tracks" && method === "POST") {
    if (!request.body) fail(400, "Choose an audio file.");
    const bounded = new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: limitStream(request.body, MAX_AUDIO + MAX_IMAGE + 100_000),
    });
    let form: FormData;
    try {
      form = await bounded.formData();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      return fail(400, "The song upload could not be read. Try again.");
    }
    const audio = form.get("audio");
    const original = form.get("artwork");
    const raw = form.get("metadata");
    if (!(audio instanceof File) || !audio.size || audio.size > MAX_AUDIO)
      fail(413, "Choose an audio file smaller than 50 MB.");
    if (
      !/\.(mp3|wav|wave|m4a|aac|ogg|oga|flac|webm|opus|aiff|aif|mp4)$/i.test(
        audio.name,
      ) &&
      !audio.type.startsWith("audio/")
    )
      fail(400, "Choose an audio file.");
    if (typeof raw !== "string" || raw.length > 10_000)
      fail(400, "Invalid song details.");
    let meta: Record<string, unknown>;
    try {
      meta = JSON.parse(raw);
    } catch {
      return fail(400, "Invalid song details.");
    }
    const id = text(meta.id, 100);
    validId(id);
    const rawFingerprint = text(form.get("fingerprint"), 1024);
    if (!rawFingerprint) fail(400, "Missing song fingerprint.");
    // Postgres text cannot contain NUL separators used by the browser's file fingerprint.
    const fingerprint = env.PASSWORDS
      ? await digest(rawFingerprint)
      : rawFingerprint;
    const duplicate = await env.DB.prepare(
      "SELECT id FROM tracks WHERE user_id = ? AND (fingerprint = ? OR id = ?)",
    )
      .bind(user.id, fingerprint, id)
      .first();
    if (duplicate) fail(409, "This song is already in your account library.");
    let image: ArrayBuffer | null = null,
      imageContentType = "";
    if (original instanceof File && original.size) {
      if (original.size > MAX_IMAGE) fail(413, "This cover is too large.");
      image = await original.arrayBuffer();
      imageContentType = imageType(new Uint8Array(image)) || "";
      if (!imageContentType) fail(400, "Choose a supported cover image.");
    }
    const metadata = {
      id,
      title: text(meta.title, 500) || audio.name,
      artist: text(meta.artist, 500) || "Unknown artist",
      album: text(meta.album, 500) || "Your uploads",
      duration:
        typeof meta.duration === "number" && Number.isFinite(meta.duration)
          ? Math.max(0, meta.duration)
          : 0,
      color: /^#[a-f0-9]{6}$/i.test(String(meta.color))
        ? meta.color
        : "#c5cbed",
      addedAt: Date.now(),
      favorite: meta.favorite === true,
      fileName: audio.name.slice(0, 500),
      size: audio.size,
    };
    const bytes = audio.size + (image?.byteLength || 0);
    await reserve(env, user, bytes);
    const version = crypto.randomUUID();
    const audioKey = `${user.id}/audio/${id}/${version}`;
    const imageKey = `${user.id}/original/${id}/${version}`;
    try {
      await env.MUSIC.put(audioKey, audio.stream(), {
        httpMetadata: { contentType: "application/octet-stream" },
      });
      const statements = [
        env.DB.prepare(
          "INSERT INTO tracks (user_id, id, fingerprint, metadata) VALUES (?, ?, ?, ?)",
        ).bind(user.id, id, fingerprint, JSON.stringify(metadata)),
        insertMedia(
          env,
          user,
          "audio",
          id,
          audioKey,
          audio.size,
          audio.type.startsWith("audio/")
            ? audio.type
            : "application/octet-stream",
          version,
        ),
      ];
      if (image) {
        await env.MUSIC.put(imageKey, image);
        statements.push(
          insertMedia(
            env,
            user,
            "original",
            id,
            imageKey,
            image.byteLength,
            imageContentType,
            version,
          ),
        );
      }
      await env.DB.batch(statements);
    } catch (error) {
      await env.MUSIC.delete([audioKey, imageKey]);
      await release(env, user, bytes);
      if (String(error).includes("UNIQUE"))
        fail(409, "This song is already in your account library.");
      throw error;
    }
    return json(
      {
        track: {
          ...metadata,
          source: "cloud",
          url: mediaUrl(user, "audio", id),
          artwork: image ? mediaUrl(user, "original", id, version) : undefined,
        },
      },
      201,
    );
  }
  const trackMatch = /^\/api\/tracks\/([\w-]+)$/.exec(path);
  if (trackMatch) {
    const id = trackMatch[1];
    validId(id);
    const row = await env.DB.prepare(
      "SELECT metadata FROM tracks WHERE user_id = ? AND id = ?",
    )
      .bind(user.id, id)
      .first<{ metadata: string }>();
    if (!row) fail(404, "This song is no longer in your library.");
    if (method === "PATCH") {
      const patch = await body(request, 10_000);
      const metadata = JSON.parse(row.metadata);
      if (typeof patch.favorite === "boolean")
        metadata.favorite = patch.favorite;
      for (const field of ["title", "artist", "album"])
        if (text(patch[field], 500)) metadata[field] = text(patch[field], 500);
      await env.DB.prepare(
        "UPDATE tracks SET metadata = ? WHERE user_id = ? AND id = ?",
      )
        .bind(JSON.stringify(metadata), user.id, id)
        .run();
      const original = await mediaRecord(env, user, "original", id);
      return json({
        track: {
          ...metadata,
          source: "cloud",
          url: mediaUrl(user, "audio", id),
          artwork: original
            ? mediaUrl(user, "original", id, original.updated_at)
            : undefined,
        },
      });
    }
    if (method === "DELETE") {
      const results = await env.DB.batch<Media>([
        env.DB.prepare("DELETE FROM tracks WHERE user_id = ? AND id = ?").bind(
          user.id,
          id,
        ),
        env.DB.prepare(
          "DELETE FROM media WHERE user_id = ? AND id = ? AND kind IN ('audio', 'original', 'song') RETURNING object_key, size",
        ).bind(user.id, id),
      ]);
      const removed = results[1].results;
      await release(
        env,
        user,
        removed.reduce((n, m) => n + m.size, 0),
      );
      if (removed.length)
        await env.MUSIC.delete(removed.map((m) => m.object_key));
      return json({ ok: true });
    }
  }
  const covers = /^\/api\/covers\/(song|playlist)$/.exec(path);
  if (covers && method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT id, updated_at FROM media WHERE user_id = ? AND kind = ?",
    )
      .bind(user.id, covers[1])
      .all<{ id: string; updated_at: string }>();
    return json({
      covers: Object.fromEntries(
        rows.results.map((row) => [
          row.id,
          mediaUrl(user, covers[1], row.id, row.updated_at),
        ]),
      ),
    });
  }
  const cover = /^\/api\/covers\/(song|playlist)\/([\w-]+)$/.exec(path);
  if (cover) {
    const [, kind, id] = cover;
    validId(id);
    const previous = await mediaRecord(env, user, kind, id);
    if (method === "PUT") {
      if (
        kind === "song" &&
        !id.startsWith("demo-") &&
        !(await env.DB.prepare(
          "SELECT id FROM tracks WHERE user_id = ? AND id = ?",
        )
          .bind(user.id, id)
          .first())
      )
        fail(404, "Song not found.");
      const image = await readLimited(request, MAX_IMAGE);
      if (!image.byteLength || image.byteLength > MAX_IMAGE)
        fail(413, "Choose a smaller cover image.");
      const type = imageType(new Uint8Array(image));
      if (!type) fail(400, "Choose a JPEG, PNG, WebP, GIF, or AVIF cover.");
      await reserve(env, user, image.byteLength);
      const version = crypto.randomUUID();
      const key = `${user.id}/${kind}/${id}/${version}`;
      try {
        await env.MUSIC.put(key, image);
        const result = await env.DB.batch([
          insertMedia(
            env,
            user,
            kind,
            id,
            key,
            image.byteLength,
            type,
            version,
            previous?.object_key,
          ),
          env.DB.prepare(
            "UPDATE users SET used_bytes = MAX(0, used_bytes - ?) WHERE id = ? AND EXISTS (SELECT 1 FROM media WHERE object_key = ?)",
          ).bind(previous?.size || 0, user.id, key),
        ]);
        if (!result[0].meta.changes)
          fail(
            409,
            "This cover changed in another tab. Refresh before replacing it.",
          );
      } catch (error) {
        await env.MUSIC.delete(key);
        await release(env, user, image.byteLength);
        throw error;
      }
      if (previous) await env.MUSIC.delete(previous.object_key);
      return json({ url: mediaUrl(user, kind, id, version) });
    }
    if (method === "DELETE") {
      if (previous) {
        const removed = await env.DB.prepare(
          "DELETE FROM media WHERE user_id = ? AND kind = ? AND id = ? AND object_key = ? RETURNING object_key, size",
        )
          .bind(user.id, kind, id, previous.object_key)
          .first<Media>();
        if (removed) {
          await release(env, user, removed.size);
          await env.MUSIC.delete(removed.object_key);
        } else
          fail(
            409,
            "This cover changed in another tab. Refresh before removing it.",
          );
      }
      return json({ ok: true });
    }
  }
  const media =
    /^\/api\/media\/([\w-]+)\/(audio|original|song|playlist)\/([\w-]+)$/.exec(
      path,
    );
  if (media && ["GET", "HEAD"].includes(method)) {
    const [, owner, kind, id] = media;
    if (owner !== user.id) fail(404, "File not found.");
    const row = await mediaRecord(env, user, kind, id);
    if (!row) fail(404, "File not found.");
    const headers = new Headers({
      "Content-Type": row.content_type,
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    });
    const range = request.headers.get("Range");
    let start = 0,
      end = row.size - 1;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2]))
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${row.size}` },
        });
      start = match[1]
        ? Number(match[1])
        : Math.max(0, row.size - Number(match[2]));
      end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
      if (start > end || start >= row.size)
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${row.size}` },
        });
      headers.set("Content-Range", `bytes ${start}-${end}/${row.size}`);
    }
    headers.set("Content-Length", String(end - start + 1));
    const object =
      method === "HEAD"
        ? null
        : await env.MUSIC.get(row.object_key, {
            range: { offset: start, length: end - start + 1 },
          });
    if (method !== "HEAD" && !object) fail(404, "File not found.");
    return new Response(object?.body ?? null, {
      status: range ? 206 : 200,
      headers,
    });
  }
  return fail(404, "This action is not available.");
}

export async function handleApi(request: Request, env: Env & SupabaseConfig) {
  let response: Response;
  try {
    response = await route(request, supabaseEnvironment(env));
  } catch (error) {
    if (error instanceof ApiError)
      response = json({ error: error.message }, error.status);
    else if (error instanceof StorageLimitError)
      response = json({ error: error.message }, 413);
    else {
      console.error(
        "Account service error",
        error instanceof Error ? error.message : "Unknown error",
      );
      response = json(
        {
          error:
            "Your account library could not be reached. Try again shortly.",
        },
        503,
      );
    }
  }
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(response.body, { status: response.status, headers });
}
