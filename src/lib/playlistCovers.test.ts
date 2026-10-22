import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  deletePlaylistCoverBlob,
  listPlaylistCoverBlobs,
  preparePlaylistCover,
  savePlaylistCoverBlob,
} from "./playlistCovers";

beforeEach(async () => {
  const covers = await listPlaylistCoverBlobs();
  await Promise.all(Object.keys(covers).map(deletePlaylistCoverBlob));
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
