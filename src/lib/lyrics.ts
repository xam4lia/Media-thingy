export const MAX_LYRICS_LENGTH = 100_000;

export type LyricLine = {
  text: string;
  time?: number;
};

export type ParsedLyrics = {
  synced: boolean;
  lines: LyricLine[];
};

const timestamp = /\[(?:(\d{1,2}):)?(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const metadata = /^\[(?:ar|al|au|by|length|re|ti|tool|ve):.*\]$/i;

export function normalizeLyricsText(value: string) {
  return value.replace(/\r\n?/g, "\n").trim();
}

function fraction(value = "") {
  if (!value) return 0;
  return Number(value) / 10 ** value.length;
}

export function parseLyrics(value: string): ParsedLyrics {
  const source = normalizeLyricsText(value);
  if (!source) return { synced: false, lines: [] };

  const offsetMatch = source.match(/^\[offset:([+-]?\d+)\]$/im);
  const offset = offsetMatch ? Number(offsetMatch[1]) / 1000 : 0;
  const timed: Array<LyricLine & { order: number }> = [];

  source.split("\n").forEach((raw, order) => {
    const stamps = [...raw.matchAll(timestamp)];
    if (!stamps.length) return;
    const lyric = raw.replace(timestamp, "").trim();
    for (const match of stamps) {
      const hours = Number(match[1] || 0);
      const minutes = Number(match[2]);
      const seconds = Number(match[3]);
      const time = Math.max(
        0,
        hours * 3600 + minutes * 60 + seconds + fraction(match[4]) + offset,
      );
      timed.push({ time, text: lyric, order });
    }
  });

  if (timed.length) {
    timed.sort((a, b) => (a.time! - b.time!) || a.order - b.order);
    return {
      synced: true,
      lines: timed.map(({ order: _order, ...line }) => line),
    };
  }

  return {
    synced: false,
    lines: source
      .split("\n")
      .filter((line) => !metadata.test(line.trim()) && !/^\[offset:/i.test(line.trim()))
      .map((line) => ({ text: line.trim() })),
  };
}
