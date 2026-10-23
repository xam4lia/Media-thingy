-- Media Thingy: run the generated public/setup-supabase.sql in a NEW Supabase Free project.
-- No email provider, public music bucket, D1 database, or R2 bucket is required.
begin;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists media_thingy;
revoke all on schema media_thingy from public, anon, authenticated;

create table if not exists media_thingy.users (
  id text primary key, username text not null, password_hash text not null,
  created_at bigint not null, used_bytes bigint not null default 0 check (used_bytes >= 0)
);
create unique index if not exists usernames_lower on media_thingy.users (lower(username));
create table if not exists media_thingy.sessions (
  token_hash text primary key, user_id text not null references media_thingy.users(id) on delete cascade,
  expires_at bigint not null
);
create index if not exists sessions_user on media_thingy.sessions(user_id);
create table if not exists media_thingy.tracks (
  user_id text not null references media_thingy.users(id) on delete cascade,
  id text not null, fingerprint text not null, metadata text not null,
  primary key (user_id, id), unique (user_id, fingerprint)
);
create table if not exists media_thingy.media (
  user_id text not null references media_thingy.users(id) on delete cascade,
  kind text not null, id text not null, object_key text not null unique,
  size bigint not null, content_type text not null, updated_at text not null,
  primary key (user_id, kind, id)
);
create table if not exists media_thingy.library_state (
  user_id text primary key references media_thingy.users(id) on delete cascade,
  value text not null, version integer not null default 0
);
create table if not exists media_thingy.auth_limits (
  key text primary key, attempts integer not null, expires_at bigint not null
);
create table if not exists media_thingy.storage_usage (
  id integer primary key check (id = 1), used_bytes bigint not null default 0
);
insert into media_thingy.storage_usage(id) values (1) on conflict do nothing;

-- One shared budget prevents multiple accounts from each claiming the whole Free storage allowance.
create or replace function media_thingy.check_storage_budget() returns trigger
language plpgsql set search_path = media_thingy, pg_catalog as $$
declare difference bigint;
begin
  difference := new.used_bytes - old.used_bytes;
  update storage_usage set used_bytes = greatest(0, used_bytes + difference)
    where id = 1 and used_bytes + difference <= 950000000;
  if not found then raise exception 'Shared free storage is full' using errcode = 'P0002'; end if;
  return new;
end;
$$;
drop trigger if exists storage_budget on media_thingy.users;
create trigger storage_budget after update of used_bytes on media_thingy.users
  for each row execute function media_thingy.check_storage_budget();

-- Server-only password hashing runs in Postgres, outside Cloudflare Free's CPU allowance.
-- SHA-256 prehashing preserves all 128 supported characters before bcrypt's 72-byte limit.
create or replace function public.media_hash_password(password text) returns text
language plpgsql security definer set search_path = pg_catalog, extensions as $$
begin
  -- The account API validates 12–128 UTF-16 code units, including Unicode passwords.
  if password is null or length(password) = 0 or octet_length(password) > 512 then raise exception 'Invalid password length'; end if;
  return 'bcrypt-sha256:' || extensions.crypt(encode(sha256(convert_to(password, 'UTF8')), 'hex'), extensions.gen_salt('bf', 12));
end;
$$;
create or replace function public.media_check_password(password text, stored_hash text) returns boolean
language plpgsql security definer set search_path = pg_catalog, extensions as $$
declare bcrypt_hash text; matches boolean;
begin
  if password is null or length(password) = 0 or octet_length(password) > 512 then return false; end if;
  if stored_hash like 'bcrypt-sha256:$2%' then bcrypt_hash := substring(stored_hash from 15);
  else bcrypt_hash := '$2a$12$abcdefghijklmnopqrstuu' || repeat('x', 31); end if;
  matches := extensions.crypt(encode(sha256(convert_to(password, 'UTF8')), 'hex'), bcrypt_hash) = bcrypt_hash;
  return matches and stored_hash like 'bcrypt-sha256:$2%';
end;
$$;
revoke all on function public.media_hash_password(text) from public, anon, authenticated;
revoke all on function public.media_check_password(text, text) from public, anon, authenticated;
grant execute on function public.media_hash_password(text) to service_role;
grant execute on function public.media_check_password(text, text) to service_role;

-- RLS plus a private schema keep account records unavailable to browser/API clients.
alter table media_thingy.users enable row level security;
alter table media_thingy.sessions enable row level security;
alter table media_thingy.tracks enable row level security;
alter table media_thingy.media enable row level security;
alter table media_thingy.library_state enable row level security;
alter table media_thingy.auth_limits enable row level security;
alter table media_thingy.storage_usage enable row level security;
revoke all on all tables in schema media_thingy from public, anon, authenticated;
revoke all on all functions in schema media_thingy from public, anon, authenticated;

insert into storage.buckets(id, name, public, file_size_limit)
  values ('media-thingy-music', 'media-thingy-music', false, 52428800)
  on conflict(id) do update set public = false, file_size_limit = 52428800;

-- QUERY_FUNCTION is generated from the exact statements used by server/api.ts.

create or replace function public.media_queries(statements jsonb) returns jsonb
language plpgsql security definer set search_path = media_thingy, pg_catalog as $function$
declare
  allowed_sql constant jsonb := $queries$[
  "SELECT users.id, users.username FROM sessions JOIN users ON users.id = sessions.user_id WHERE token_hash = ? AND expires_at > ?",
  "DELETE FROM sessions WHERE expires_at < ?",
  "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
  "DELETE FROM sessions WHERE token_hash = ?",
  "INSERT INTO auth_limits (key, attempts, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET attempts = CASE WHEN auth_limits.expires_at < ? THEN 1 ELSE auth_limits.attempts + 1 END, expires_at = CASE WHEN auth_limits.expires_at < ? THEN excluded.expires_at ELSE auth_limits.expires_at END RETURNING attempts",
  "DELETE FROM auth_limits WHERE expires_at < ?",
  "UPDATE users SET used_bytes = used_bytes + ? WHERE id = ? AND used_bytes + ? <= ?",
  "UPDATE users SET used_bytes = MAX(0, used_bytes - ?) WHERE id = ?",
  "SELECT * FROM media WHERE user_id = ? AND kind = ? AND id = ?",
  "INSERT INTO media (user_id, kind, id, object_key, size, content_type, updated_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE COALESCE((SELECT object_key FROM media WHERE user_id = ? AND kind = ? AND id = ?), '') = ? AND (? != 'song' OR ? LIKE 'demo-%' OR EXISTS (SELECT 1 FROM tracks WHERE user_id = ? AND id = ?)) ON CONFLICT(user_id, kind, id) DO UPDATE SET object_key = excluded.object_key, size = excluded.size, content_type = excluded.content_type, updated_at = excluded.updated_at WHERE media.object_key = ?",
  "INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)",
  "INSERT INTO library_state (user_id, value) VALUES (?, ?)",
  "SELECT id, username, password_hash FROM users WHERE username = ? COLLATE NOCASE",
  "SELECT tracks.id, tracks.metadata, media.updated_at AS artwork_version FROM tracks LEFT JOIN media ON tracks.user_id = media.user_id AND tracks.id = media.id AND media.kind = 'original' WHERE tracks.user_id = ?",
  "SELECT value, version FROM library_state WHERE user_id = ?",
  "SELECT used_bytes FROM users WHERE id = ?",
  "UPDATE library_state SET value = ?, version = version + 1 WHERE user_id = ? AND version = ?",
  "SELECT id FROM tracks WHERE user_id = ? AND (fingerprint = ? OR id = ?)",
  "INSERT INTO tracks (user_id, id, fingerprint, metadata) VALUES (?, ?, ?, ?)",
  "SELECT metadata FROM tracks WHERE user_id = ? AND id = ?",
  "UPDATE tracks SET metadata = ? WHERE user_id = ? AND id = ?",
  "DELETE FROM tracks WHERE user_id = ? AND id = ?",
  "DELETE FROM media WHERE user_id = ? AND id = ? AND kind IN ('audio', 'original', 'song') RETURNING object_key, size",
  "SELECT id, updated_at FROM media WHERE user_id = ? AND kind = ?",
  "SELECT id FROM tracks WHERE user_id = ? AND id = ?",
  "UPDATE users SET used_bytes = MAX(0, used_bytes - ?) WHERE id = ? AND EXISTS (SELECT 1 FROM media WHERE object_key = ?)",
  "DELETE FROM media WHERE user_id = ? AND kind = ? AND id = ? AND object_key = ? RETURNING object_key, size"
]$queries$::jsonb;
  statement jsonb; original_sql text; translated_sql text; expanded_sql text;
  parts text[]; i integer; rows jsonb; affected bigint; results jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(statements) <> 'array' or jsonb_array_length(statements) not between 1 and 20 then
    raise exception 'Invalid query batch';
  end if;
  for statement in select value from jsonb_array_elements(statements) loop
    original_sql := statement->>'sql';
    if original_sql is null or not (allowed_sql ? original_sql) then raise exception 'Query is not allowed'; end if;
    translated_sql := replace(original_sql, 'username = ? COLLATE NOCASE', 'lower(username) = lower(?)');
    translated_sql := replace(translated_sql, 'MAX(0,', 'GREATEST(0,');
    parts := string_to_array(translated_sql, '?');
    if jsonb_typeof(statement->'params') <> 'array' or jsonb_array_length(statement->'params') <> cardinality(parts) - 1 then
      raise exception 'Invalid query arguments';
    end if;
    expanded_sql := parts[1];
    for i in 1..cardinality(parts) - 1 loop
      expanded_sql := expanded_sql || format('%L', statement->'params'->>(i - 1)) || parts[i + 1];
    end loop;
    if original_sql like 'SELECT %' then
      execute 'select coalesce(jsonb_agg(to_jsonb(q)), ''[]''::jsonb) from (' || expanded_sql || ') q' into rows;
      affected := 0;
    elsif original_sql like '% RETURNING %' then
      execute 'with q as (' || expanded_sql || ') select coalesce(jsonb_agg(to_jsonb(q)), ''[]''::jsonb) from q' into rows;
      affected := jsonb_array_length(rows);
    else
      execute expanded_sql;
      get diagnostics affected = row_count;
      rows := '[]'::jsonb;
    end if;
    results := results || jsonb_build_array(jsonb_build_object('results', rows, 'meta', jsonb_build_object('changes', affected)));
  end loop;
  return results;
end;
$function$;
revoke all on function public.media_queries(jsonb) from public, anon, authenticated;
grant execute on function public.media_queries(jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
