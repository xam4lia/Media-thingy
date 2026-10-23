# Activate username/password accounts

For the **free** option, use [Cloudflare Pages + Supabase Free](free-accounts.md). The D1/R2 instructions below are for the older paid backend.

The source includes Cloudflare Pages Functions for accounts. **Accounts are not live until the database and storage below are connected.** Existing device libraries keep working without them. GitHub Pages and Netlify static deployments support the device library only.

Cloudflare may require billing to enable R2. Use the **Workers Paid plan** for this backend: the password hashing deliberately uses 600,000 PBKDF2-SHA-256 iterations, which can exceed the Free plan's 10 ms CPU allowance. Check Cloudflare's current [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) and [R2 pricing](https://developers.cloudflare.com/r2/pricing/) before enabling paid services. No resources or paid plans are created by the repository's build or by local tests.

## One-time Cloudflare setup

Keep the Pages Git deployment on `main`, build command `npm run build`, output directory `dist`, and repository root blank.

1. In the [Cloudflare dashboard](https://dash.cloudflare.com/), open **Storage & databases → D1 → Create database**. Name it `media-thingy-accounts`.
2. Open that database's **Console** and run the SQL in [`migrations/0001_accounts.sql`](../migrations/0001_accounts.sql). This creates empty account, session, and library tables; it contains no credentials. Do this once before using accounts.
3. Open **R2 object storage → Create bucket**. Name it `media-thingy-music`. Keep the bucket private: no public `r2.dev` access or public custom domain is needed.
4. Open **Workers & Pages → your Pages project → Settings → Bindings**. Under **Production**, add these bindings:

   | Binding type | Variable name (exact spelling) | Resource                |
   | ------------ | ------------------------------ | ----------------------- |
   | D1 database  | `DB`                           | `media-thingy-accounts` |
   | R2 bucket    | `MUSIC`                        | `media-thingy-music`    |

5. In the project's **Settings → Runtime → Compatibility date**, set `2026-10-01` or later. Redeploy the latest `main` commit under **Deployments → Retry deployment** so the functions receive the bindings. No API key, Google configuration, email service, or password secret is needed in the frontend.
6. Visit the actual `pages.dev` address shown by Cloudflare. Open **Settings → Your account → Create account**. Create a username and password, upload a song, sign out, then sign back in from a different browser to check it returns and plays.

Production data belongs to the D1 database and R2 bucket in your Cloudflare account. Use separate test resources for preview deployments; leave preview bindings unset if previews should offer only the device library.

## Using accounts

- Usernames contain 3–32 letters, numbers, or underscores, and are case insensitive. Passwords contain 12–128 characters. There is no email reset; keep the password safe.
- While signed in, uploaded audio, favorites, playlists, and custom song/playlist covers save to that account. Signing in fetches its saved library. Refresh to load subsequent changes made on another device.
- The initial limit is **1 GB per account** and **50 MB per audio file**. Limits are enforced by the backend; originals on your device are unaffected. The limits are defined in `server/api.ts`.
- Existing songs are not silently mixed into an account. After signing in, choose **Copy this device’s songs to account** in Settings. This copies songs, their favorites, embedded art, and custom song covers, leaving the device copies in place. Device playlists stay in the device library; create account playlists after copying. Failed copies can be retried without duplicating successful songs.
- The copy button can only see the device library at the current website address. Open the site/browser that contains those songs, or add the original audio files to the new account directly.
- Signing out stops playback and returns to the separate device library. Another account starts with its own library. Appearance and interface size remain device preferences.
- Account playback requires an internet connection. This is not an offline download feature.
- Playlist edits are saved in order. Conflicting changes from another tab/device produce a visible error instead of overwriting its playlists; refresh before editing again.

## Local development and checks

```sh
npm ci --cache /tmp/media-thingy-npm-cache
npm run dev:accounts
```

This builds the frontend, applies migrations to a **local** D1 database, and runs Pages Functions with local R2 on port 8788. It never connects to your production database or bucket. Local data stays in the ignored `.wrangler` directory. `npm run dev` still runs the guest/device frontend by itself.

```sh
npm test
npm run build
npm run test:e2e
npm run test:accounts
```

The account API tests use workerd with actual local D1/R2 emulation. Browser account tests create isolated temporary local resources on port 8789; they do not clear the normal development library. They check signup, sign-in from a fresh browser, real audio playback, restored favorites/playlists/covers, sign-out isolation, and repeatable device imports.

Passwords are salted and hashed; session tokens are random, stored as hashes in D1, and sent using HttpOnly/SameSite cookies (Secure on HTTPS). Sessions expire after 30 days and sign-out revokes the current session. Account APIs validate ownership for metadata and private media, reject cross-site writes, rate limit authentication attempts, and return `private, no-store` responses. R2 audio supports byte ranges for seeking. Cloudflare access and database/storage administration remain with the site owner.
