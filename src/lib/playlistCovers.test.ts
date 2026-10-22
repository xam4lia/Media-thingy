import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteCoverBlob,
  deletePlaylistCoverBlob,
  listCoverBlobs,
  listPlaylistCoverBlobs,
  preparePlaylistCover,
  saveCoverBlob,
  savePlaylistCoverBlob,
} from "./playlistCovers";

beforeEach(async () => {
  for (const kind of ["playlist", "song"] as const) {
    const covers = await listCoverBlobs(kind);
    await Promise.all(Object.keys(covers).map((id) => deleteCoverBlob(id, kind)));
  }
});

describe("song cover storage", () => {
  it("keeps same-ID song and playlist covers separate when replacing or deleting a song cover", async () => {
    await saveCoverBlob(
      "same-id",
      new Blob(["playlist artwork"], { type: "image/webp" }),
      "playlist",
    );
    await saveCoverBlob(
      "same-id",
      new Blob(["song artwork"], { type: "image/jpeg" }),
      "song",
    );

    expect(await (await listCoverBlobs("playlist"))["same-id"].text()).toBe(
      "playlist artwork",
    );
    expect(await (await listCoverBlobs("song"))["same-id"].text()).toBe(
      "song artwork",
    );

    await saveCoverBlob(
      "same-id",
      new Blob(["replacement song artwork"], { type: "image/webp" }),
      "song",
    );
    expect(await (await listCoverBlobs("song"))["same-id"].text()).toBe(
      "replacement song artwork",
    );
    expect(await (await listCoverBlobs("playlist"))["same-id"].text()).toBe(
      "playlist artwork",
    );

    await deleteCoverBlob("same-id", "song");
    expect(await listCoverBlobs("song")).toEqual({});
    const playlistCovers = await listCoverBlobs("playlist");
    expect(Object.keys(playlistCovers)).toEqual(["same-id"]);
    expect(await playlistCovers["same-id"].text()).toBe("playlist artwork");
  });

  it("restores song cover bytes from storage after a fresh module load and preserves them after invalid image preparation", async () => {
    await saveCoverBlob(
      "my-song",
      new Blob(["saved song cover"], { type: "image/webp" }),
      "song",
    );
    vi.resetModules();
    const freshStorage = await import("./playlistCovers");
    const restored = await freshStorage.listCoverBlobs("song");
    expect(Object.keys(restored)).toEqual(["my-song"]);
    expect(restored["my-song"].type).toBe("image/webp");
    expect(await restored["my-song"].text()).toBe("saved song cover");

    const invalidCover = new File(
      ['<svg xmlns="http://www.w3.org/2000/svg"/>'],
      "new-cover.png",
      { type: "image/png" },
    );
    await expect(preparePlaylistCover(invalidCover)).rejects.toThrow(
      /JPEG|PNG|WebP|supported|image/i,
    );
    const saved = await freshStorage.listCoverBlobs("song");
    expect(Object.keys(saved)).toEqual(["my-song"]);
    expect(await saved["my-song"].text()).toBe("saved song cover");
  });
});

describe("playlist cover storage", () => {
  it("persists separate cover blobs and restores their bytes on a later read", async () => {
    await savePlaylistCoverBlob(
      "morning",
      new Blob(["morning cover"], { type: "image/webp" }),
    );
    await savePlaylistCoverBlob(
      "evening",
      new Blob(["evening cover"], { type: "image/jpeg" }),
    );

    const saved = await listPlaylistCoverBlobs();
    expect(Object.keys(saved).sort()).toEqual(["evening", "morning"]);
    expect(await saved.morning.text()).toBe("morning cover");
    expect(saved.morning.type).toBe("image/webp");
    expect(await saved.evening.text()).toBe("evening cover");
    expect(saved.evening.type).toBe("image/jpeg");
  });

  it("replaces one playlist cover without changing another playlist", async () => {
    await savePlaylistCoverBlob(
      "first",
      new Blob(["old cover"], { type: "image/jpeg" }),
    );
    await savePlaylistCoverBlob(
      "second",
      new Blob(["other cover"], { type: "image/webp" }),
    );
    await savePlaylistCoverBlob(
      "first",
      new Blob(["replacement"], { type: "image/webp" }),
    );

    const saved = await listPlaylistCoverBlobs();
    expect(Object.keys(saved)).toHaveLength(2);
    expect(await saved.first.text()).toBe("replacement");
    expect(saved.first.type).toBe("image/webp");
    expect(await saved.second.text()).toBe("other cover");
  });

  it("removes only the selected cover and allows removing a missing cover", async () => {
    await savePlaylistCoverBlob(
      "remove-me",
      new Blob(["cover one"], { type: "image/webp" }),
    );
    await savePlaylistCoverBlob(
      "keep-me",
      new Blob(["cover two"], { type: "image/jpeg" }),
    );

    await deletePlaylistCoverBlob("remove-me");
    await deletePlaylistCoverBlob("already-gone");
    const saved = await listPlaylistCoverBlobs();
    expect(Object.keys(saved)).toEqual(["keep-me"]);
    expect(await saved["keep-me"].text()).toBe("cover two");
  });

  it("rejects SVG, disguised SVG, empty images, and oversized files while preserving an existing cover", async () => {
    await savePlaylistCoverBlob(
      "existing",
      new Blob(["previous cover"], { type: "image/webp" }),
    );
    const svg = new File(
      ['<svg xmlns="http://www.w3.org/2000/svg"/>'],
      "cover.svg",
      { type: "image/svg+xml" },
    );
    const disguisedSvg = new File(
      ['<svg xmlns="http://www.w3.org/2000/svg"/>'],
      "cover.png",
      { type: "image/png" },
    );
    const empty = new File([], "empty.jpg", { type: "image/jpeg" });
    const oversized = new File(
      [new Uint8Array(10 * 1024 * 1024 + 1)],
      "large.png",
      { type: "image/png" },
    );

    await expect(preparePlaylistCover(svg)).rejects.toThrow(
      /JPEG|PNG|WebP|supported|image/i,
    );
    await expect(preparePlaylistCover(disguisedSvg)).rejects.toThrow(
      /JPEG|PNG|WebP|supported|image/i,
    );
    await expect(preparePlaylistCover(empty)).rejects.toThrow(/empty|image/i);
    await expect(preparePlaylistCover(oversized)).rejects.toThrow(
      /10|large|size/i,
    );
    const saved = await listPlaylistCoverBlobs();
    expect(Object.keys(saved)).toEqual(["existing"]);
    expect(await saved.existing.text()).toBe("previous cover");
  });
});
