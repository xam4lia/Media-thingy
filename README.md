# media.

A quiet little home for your music. A personal music player with neutral grey frosted glass, a charcoal dark mode, and a clean library inspired by familiar music apps.

## Open it as a website

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
- Built-in covers and the illustrated record sleeve switch to darker artwork in dark mode.
- Open a playlist and choose **Change cover** to pick a photo from your device. Covers are cropped to a square, saved in this browser, and shown in the playlist, sidebar, and playlist picker. JPEG, PNG, WebP, GIF, and AVIF images up to 10 MB are supported; **Remove cover** restores the default.
- Upload several songs at once, or drag audio files into the app.
- Embedded tags provide song titles, artists, albums, and cover artwork; untagged songs use their filenames.
- Listen with play/pause, seeking, volume, shuffle, and repeat. The spacebar pauses or resumes playback when a control or dialog is not focused.
- Save favorites, create playlists, and add songs using their **…** menus.
- Search by title, artist, or album, and sort your collection.
- Three original ambient demos are included so you can try the player before uploading. Regenerate them with `python3 scripts/generate-demo.py`.

Music files are stored in **IndexedDB in this browser on this device**. Favorites, playlists, cover images, and interface preferences also remain locally. There is no account, server upload, or cross-device sync. Clearing site data removes the saved library, so keep your original audio files. Playback support for MP3, WAV, FLAC, M4A, AAC, OGG, and other audio formats depends on the browser's codecs.

Fonts, icons, artwork, and demo audio are served locally; no third-party service or API key is required.

## Validate

```sh
npm test
npm run build
npm run test:e2e
```

Unit tests cover real audio metadata parsing, IndexedDB persistence, artwork, duplicate handling, favorites, and removal. Browser tests cover real decoded playback, seek and transport controls, upload persistence, playlists, validation, mobile navigation, saved light/dark appearance preferences, percentage scaling, dark artwork, and custom playlist cover persistence.

The browser tests use `/usr/bin/chromium` in the cloud environment. To use another installed Chromium:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chromium npm run test:e2e
```

For a standard Playwright installation, run `npx playwright install chromium`, then set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to the browser's installed executable.

## Project

Built with React, TypeScript, Vite, Lucide icons, and music-metadata. The frontend has no backend dependencies. `src/lib/library.ts` handles uploads and storage; `src/lib/usePlayer.ts` owns audio playback; `src/App.tsx` and `src/styles.css` provide the interface.
