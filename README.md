# media.

A quiet little home for your music. A personal music player with neutral grey frosted glass, a charcoal dark mode, and a clean library inspired by familiar music apps.

## Open on Cloudflare Pages

Cloudflare Pages can host this app at a free `pages.dev` address. Set up the Git connection once, and later pushes to `main` deploy automatically.

1. Sign in at [Cloudflare](https://dash.cloudflare.com/), then open **Workers & Pages → Create application → Pages → Import an existing Git repository**.
2. Connect GitHub and choose **xam4lia/Media-thingy**. Use these settings:

| Setting                | Value                                         |
| ---------------------- | --------------------------------------------- |
| Project name           | `mediathingy` (or another available name)     |
| Production branch      | `main`                                        |
| Framework preset       | None; enter the build settings below manually |
| Build command          | `npm run build`                               |
| Build output directory | `dist`                                        |
| Root directory         | Leave blank (the repository root)             |

3. Select **Save and Deploy**. Cloudflare will show the actual website address when the deployment succeeds, such as `https://mediathingy.pages.dev` if that project name is available.

Use the regular `npm run build` command for this host: it produces root-relative assets, artwork, and demo audio. The separate `build:pages` command targets the GitHub Pages subdirectory.

The initial GitHub authorization must happen on a device/network where GitHub access is permitted. Once deployed, the app is served entirely by Cloudflare and does not need a connection to GitHub to play music. School access still depends on the school's domain policy.

For free username/password accounts with saved libraries across devices, follow the [Supabase Free setup](docs/free-accounts.md). Open `/setup.html` on your deployed website to copy the database setup SQL without GitHub access. Connect two server settings to Cloudflare Pages; no Workers Paid, D1, or R2 setup is required. Until connected, the app continues to offer its device library. Existing D1/R2 installations can use the [older account setup](docs/cloudflare-accounts.md).

If the Cloudflare address ends in `workers.dev`, use the repository's Worker deployment instead. Set the build command to `npm run build` and the deploy command to `npx wrangler deploy`. The included `wrangler.jsonc` serves the website files and sends `/api/*` to the account API on the same free Worker. Dashboard variables are preserved between deployments.

Device libraries belong to the current browser/site address. A new Cloudflare address starts with a new device library. Keep the originals on your device.

## Open on GitHub Pages

The ready-built website is published to the `gh-pages` branch. Enable it once in this repository's **Settings → Pages**:

1. Under **Build and deployment**, choose **Deploy from a branch**.
2. Select the **gh-pages** branch and **/(root)** folder, then **Save**.
3. Wait for GitHub's Pages deployment to finish. The website address will be **https://xam4lia.github.io/Media-thingy/**.

Visitors use the site in their browser; they do not need to download or install the source code. GitHub hosts the app, while uploaded songs remain in each visitor's browser.

To publish later updates from a checkout with GitHub push access:

```sh
npm ci --cache /tmp/media-thingy-npm-cache
npm run deploy
```

This builds the app for the `/Media-thingy/` path and updates `gh-pages` without changing the source branch. `npm run build` still builds for a site's root path, suitable for other hosts.

## Run locally

Requires Node.js 22.12 or later (developed on Node 24).

```sh
npm ci --cache /tmp/media-thingy-npm-cache
npm run dev
```

Vite serves the app on port 5173. To create a production bundle:

```sh
npm run build
npm run preview
```

## Make it yours

- Use the sun/moon button in the header to switch between grey glass and charcoal dark mode. It follows your device's appearance initially and remembers your choice in this browser.
- Open **Settings** with the gear in the header to adjust **Interface size** from 100% to 150%. The default is 115%, and your percentage is remembered. The app fills the window with only a small outer margin.
- Built-in covers switch to darker artwork in dark mode.
- Open a playlist and choose **Change cover** to pick a photo from your device. Covers are cropped to a square, saved to the current library, and shown in the playlist, sidebar, and playlist picker. JPEG, PNG, WebP, GIF, and AVIF images up to 10 MB are supported; **Remove cover** restores the default.
- Upload several songs at once, or drag audio files into the app.
- Embedded tags provide song titles, artists, albums, and cover artwork; untagged songs use their filenames.
- Use a song’s **… → Change song cover** menu to choose a photo from your device. The custom cover appears in the library, favorites, playlists, player, and queue, and stays saved after reload. **Reset song cover** restores its embedded artwork or default cover. Song and playlist covers are stored independently.
- Click the artwork or song title in the bottom player to open **Now playing**, with a large cover, title, artist, playback controls, and a shortcut to change the cover. Switch between the **Now playing** and **Queue** tabs in the glass panel; close it with **×** or Escape.
- Listen with play/pause, seeking, volume, shuffle, and repeat. The spacebar pauses or resumes playback when a control or dialog is not focused.
- Save favorites, create playlists, and add songs using their **…** menus.
- Search by title, artist, or album, and sort your collection.
- Three original ambient demos are included so you can try the player before uploading. Regenerate them with `python3 scripts/generate-demo.py`.

Without signing in, music files are stored in **IndexedDB in this browser on this device**. Clearing site data removes this device library, so keep your original audio files. On a configured Cloudflare deployment, open **Settings → Your account** to create a username/password account: songs, favorites, playlists, and covers then save privately to that account and return when you sign in elsewhere. Existing device songs can be copied into the account from Settings. Appearance and interface size remain device preferences. See [free account setup and limits](docs/free-accounts.md).

Playback support for MP3, WAV, FLAC, M4A, AAC, OGG, and other audio formats depends on the browser's codecs.

Fonts, icons, artwork, and demo audio are served by the site. The device library needs no external service or API key. Free account libraries use Supabase and Cloudflare Pages Functions. The original D1/R2 adapter remains supported.

## Validate

```sh
npm test
npm run build
npm run test:e2e
npm run test:accounts
```

Unit tests cover real audio metadata parsing, IndexedDB persistence, artwork, duplicate handling, favorites, and removal. Browser tests cover real decoded playback, seek and transport controls, upload persistence, playlists, validation, mobile navigation, saved light/dark appearance preferences, percentage scaling, dark artwork, custom playlist and song cover persistence, and the large-cover now-playing panel.

The browser tests use `/usr/bin/chromium` in the cloud environment. To use another installed Chromium:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chromium npm run test:e2e
```

For a standard Playwright installation, run `npx playwright install chromium`, then set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to the browser's installed executable.

## Project

Built with React, TypeScript, Vite, Lucide icons, and music-metadata. `src/lib/library.ts` handles local uploads and storage; `src/lib/cloud.ts` connects account libraries; `server/api.ts` implements the Cloudflare account API; `src/lib/usePlayer.ts` owns audio playback; `src/App.tsx` and `src/styles.css` provide the interface.
