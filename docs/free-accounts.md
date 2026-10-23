# Free account setup: Cloudflare Pages + Supabase

Use the Free plan on both services. The app has a Supabase adapter, so Workers Paid, D1, and R2 are not needed for this setup. Your website keeps its existing `pages.dev` address. Visitors create usernames and passwords; they do not need email or Google sign-in.

## Connect the services

1. Wait for the latest `main` deployment to finish in Cloudflare. The build command stays `npm run build`, output `dist`, root directory blank.
2. Open your website with **`/setup.html`** added to the address, for example `https://YOUR-SITE.pages.dev/setup.html`. The page has a **Copy database SQL** button so you do not need GitHub access to copy the setup file.
3. Sign up at [Supabase](https://supabase.com/dashboard). Create a **Free** organization/project named `media-thingy`, choose a database password, and wait for it to start. Use a new, dedicated project.
4. On the website's setup page, click **Copy database SQL**. In Supabase, open **SQL Editor → New query**, paste it, and click **Run**. It creates the private account tables, server password functions, and private `media-thingy-music` storage bucket. No separate Storage or Authentication settings are needed. You can also copy [the SQL file](../public/setup-supabase.sql) directly.
5. Copy your **Project URL** from Supabase's **Connect → App Frameworks** panel or **Settings → Data API**. Under **Settings → API Keys → Legacy API Keys**, reveal and copy the key labeled **`service_role`**.
6. Open **Cloudflare → Workers & Pages → your Pages project → Settings → Variables and Secrets → Production**. Add and save:

   | Name                        | Value                                                          | Type               |
   | --------------------------- | -------------------------------------------------------------- | ------------------ |
   | `SUPABASE_URL`              | Your Supabase Project URL (`https://YOUR-PROJECT.supabase.co`) | Text               |
   | `SUPABASE_SERVICE_ROLE_KEY` | The private legacy `service_role` key                          | Secret / encrypted |

   These values are server settings. Do not use `VITE_` variables. Do not put the key in chat, source code, or the website's setup page. The database password you chose when creating the project is not the service key.

7. Under **Deployments**, retry/redeploy the latest `main` deployment so the Functions receive these values. Refresh the website, open **Settings → Your account → Create account**, then add a song. Sign in from another browser to verify it returns and plays.
8. To import existing device songs, sign in in the browser that contains them, then use **Settings → Copy this device's songs to account**. The copy preserves local songs; it does not import local playlists. Libraries saved at another website address cannot be read automatically—upload those original audio files to the account.

## Free limits and existing installations

- Supabase Free currently includes **1 GB of file storage** and **5 GB of monthly egress**, shared across the organization. The app enforces a **950 MB shared file budget across all accounts**, leaving headroom under the storage allowance; individual audio files may be up to 50 MB. Use a dedicated project and monitor Supabase's Usage page. Playing music uses transfer allowance. Free projects may pause after inactivity, and exceeding free limits can restrict service. Do not enable paid add-ons.
- Both the app API and private audio are served through your Cloudflare site's address. The browser does not need to contact Supabase directly. School access still depends on the school's policy.
- Supabase is selected when both server variables are set. The older D1/R2 adapter remains available for existing paid installations. This does not copy users/files from a D1/R2 installation into Supabase; keep existing data until any move is complete. It also does not change or cancel an existing Cloudflare subscription. If you already upgraded, manage that subscription in Cloudflare's billing dashboard.
- App accounts are in the private `media_thingy` database schema, rather than Supabase's Authentication user list. Passwords are salted bcrypt hashes of SHA-256 prehashes. Password hashing runs inside Postgres, so Cloudflare does not perform the expensive password work. Session cookies, ownership checks, and authentication rate limits remain in the account API. There is no email password reset.
- The bucket stays private. Only server-side RPCs and storage calls use the service key; anonymous and signed-in Supabase API roles cannot execute the app's database/password functions. No public storage policies are required.

## Troubleshooting

- **`/setup.html` does not open:** check that the newest source from `main` has successfully deployed to the Pages project. Use the production website address Cloudflare shows.
- **Accounts are not connected:** check both variable names and Production environment, then redeploy. GitHub Pages/static-only hosting cannot run the server functions.
- **Account service unavailable:** confirm the project is active, SQL ran successfully, and the value is the legacy `service_role` key. Copy the full project URL without a path. Look at Cloudflare Function logs for the HTTP status; do not share credentials or request bodies.
- **The database schema changed with an update:** run the current setup SQL again. Tables use `IF NOT EXISTS`; functions are replaced. The SQL does not clear your library.

## Development checks

`npm run generate:supabase` generates the public SQL file from the schema template and the exact fixed queries in `server/api.ts`. `npm run build` rejects stale generated SQL.

```sh
npm test
npm run build
npm run test:supabase
npm run test:supabase:e2e
```

The two Supabase test commands require Docker and pull/use `postgres:17-alpine`. They run real Postgres migrations, RPCs, hashes, permissions, transactions, and shared quotas, with a local HTTP storage fixture. The browser tests exercise the same signup, restored playback, covers, playlists, and device-copy flows as the D1/R2 adapter. They do not connect to a real Supabase project or verify a live deployment; final verification happens after you connect your own free project.
