import { test, expect, type Page } from "@playwright/test";
import path from "node:path";

const password = "my music password 123";
const song = path.resolve("public/demo/soft-focus.wav");
const unique = () =>
  `listener_${crypto.randomUUID().replaceAll("-", "").slice(0, 14)}`;
async function settings(page: Page) {
  await page
    .getByRole("button", { name: "Open settings", exact: true })
    .click();
}
async function register(page: Page, username: string) {
  await settings(page);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Username", exact: true })
    .fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Create my account", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function login(page: Page, username: string) {
  await settings(page);
  await page
    .getByRole("textbox", { name: "Username", exact: true })
    .fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Sign in to my account", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test("an account restores real audio, favorites, playlists, and covers in a separate browser", async ({
  page,
  browser,
}) => {
  const username = unique();
  await page.goto("/");
  await register(page, username);
  await page
    .getByLabel("Choose audio files", { exact: true })
    .setInputFiles(song);
  const row = page.locator(".track-row").filter({ hasText: "soft-focus" });
  await expect(row).toHaveCount(1);
  await row
    .getByRole("button", { name: "Favorite soft-focus", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Make your first mix", exact: true })
    .click();
  await page.getByLabel("Playlist name").fill("Across devices");
  await page
    .getByRole("dialog", { name: "Create a playlist", exact: true })
    .getByRole("button", { name: "Create playlist", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Across devices.", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Your library", exact: false })
    .first()
    .click();
  await row.getByRole("button", { name: /More options/ }).click();
  await page.getByRole("button", { name: /Add to playlist/ }).click();
  await page
    .getByRole("button", { name: /Across devices/ })
    .last()
    .click();
  await row.getByRole("button", { name: /More options/ }).click();
  await page
    .getByRole("button", { name: "Change song cover", exact: true })
    .click();
  await page.getByLabel("Choose song cover", { exact: true }).setInputFiles({
    name: "cover.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(row.locator("img")).toHaveAttribute(
    "src",
    /\/api\/media\/.+\/song\//,
  );
  await settings(page);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.locator(".track-row").filter({ hasText: "soft-focus" }),
  ).toHaveCount(0);

  const other = await browser.newContext();
  const second = await other.newPage();
  await second.goto("/");
  await login(second, username);
  const restored = second
    .locator(".track-row")
    .filter({ hasText: "soft-focus" });
  await expect(restored).toHaveCount(1);
  await expect(
    restored.getByRole("button", {
      name: "Unfavorite soft-focus",
      exact: true,
    }),
  ).toBeVisible();
  await expect(restored.locator("img")).toHaveAttribute(
    "src",
    /\/api\/media\/.+\/song\//,
  );
  await restored.getByRole("button", { name: /Play soft-focus by/ }).click();
  await expect(
    second.getByRole("button", { name: "Pause playback", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () =>
      Number(
        await second.getByLabel("Seek playback", { exact: true }).inputValue(),
      ),
    )
    .toBeGreaterThan(0.2);
  await second
    .getByRole("button", { name: "Across devices", exact: true })
    .click();
  await expect(
    second.locator(".track-row").filter({ hasText: "soft-focus" }),
  ).toHaveCount(1);
  await second.reload();
  await expect(second.locator(".storage-status")).toContainText(username);
  await other.close();
});

test("device songs copy safely without exposing them to another account, on a phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const username = unique();
  await page.goto("/");
  await page
    .getByLabel("Choose audio files", { exact: true })
    .setInputFiles(song);
  await expect(
    page.locator(".track-row").filter({ hasText: "soft-focus" }),
  ).toHaveCount(1);
  await register(page, username);
  await expect(
    page.locator(".track-row").filter({ hasText: "soft-focus" }),
  ).toHaveCount(0);
  await settings(page);
  await page
    .getByRole("button", {
      name: "Copy this device’s songs to account",
      exact: true,
    })
    .click();
  await expect(
    page.getByText("1 song copied. Your device library is still here.", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Copy this device’s songs to account",
      exact: true,
    })
    .click();
  await expect(
    page.getByText("0 songs copied. Your device library is still here.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.locator(".track-row").filter({ hasText: "soft-focus" }),
  ).toHaveCount(1);
  await register(page, unique());
  await expect(
    page.locator(".track-row").filter({ hasText: "soft-focus" }),
  ).toHaveCount(0);
  await settings(page);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login(page, username);
  await expect(
    page.locator(".track-row").filter({ hasText: "soft-focus" }),
  ).toHaveCount(1);
});

test("the setup page copies database SQL without GitHub access and fits a phone", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/setup.html");
  const copy = page.getByRole("button", {
    name: "Copy database SQL",
    exact: true,
  });
  await expect(copy).toBeEnabled();
  await copy.click();
  await expect(page.getByRole("status")).toContainText("Copied.");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("create schema if not exists media_thingy");
  expect(copied).toContain(
    "grant execute on function public.media_queries(jsonb) to service_role",
  );
  expect(copied.trim()).toMatch(/commit;$/);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});
