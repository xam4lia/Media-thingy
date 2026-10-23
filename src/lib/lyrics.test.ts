import { describe, expect, it } from "vitest";
import { normalizeLyricsText, parseLyrics } from "./lyrics";

describe("lyrics", () => {
  it("parses, sorts, and offsets timed LRC lines", () => {
    expect(
      parseLyrics(
        "[ar:Someone]\n[offset:+250]\n[00:03.50][00:07.5]Again\r\n[00:01.05]First",
      ),
    ).toEqual({
      synced: true,
      lines: [
        { time: 1.3, text: "First" },
        { time: 3.75, text: "Again" },
        { time: 7.75, text: "Again" },
      ],
    });
  });

  it("supports hour timestamps and never creates negative times", () => {
    expect(parseLyrics("[offset:-2000]\n[00:01.00]Start\n[1:02:03.125]Later").lines).toEqual([
      { time: 0, text: "Start" },
      { time: 3721.125, text: "Later" },
    ]);
  });

  it("keeps ordinary lyrics and removes LRC metadata", () => {
    expect(parseLyrics("[ti:A title]\nFirst line\n\nSecond line")).toEqual({
      synced: false,
      lines: [{ text: "First line" }, { text: "" }, { text: "Second line" }],
    });
    expect(normalizeLyricsText(" One\r\nTwo \n")).toBe("One\nTwo");
  });
});
