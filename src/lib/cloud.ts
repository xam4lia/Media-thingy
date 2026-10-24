import type { Track, TrackPatch } from "./library";
import { getTrackBlob, importFiles, listTracks } from "./library";
import { listCoverBlobs } from "./playlistCovers";

export type AccountUser = { id: string; username: string };
export type LibraryState = {
  playlists: { id: string; name: string; tracks: string[] }[];
  demoFavorites: string[];
  hiddenDemos: string[];
  playCounts?: Record<string, number>;
  listeningHistory?: { date: string; tracks: Record<string, number> }[];
};
export type CloudLibrary = {
  tracks: Track[];
  state: LibraryState;
  version: number;
  usedBytes: number;
  limitBytes: number;
};

export class AccountError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("X-Media-Request", "1");
  const response = await fetch(`/api${path}`, {
    ...options,
    headers,
    credentials: "same-origin",
    cache: "no-store",
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data)
    throw new AccountError(
      data?.error ||
        "The account service could not be reached. Try again shortly.",
      response.status,
    );
  return data as T;
}
export function jsonOptions(method: string, value: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  };
}
export const cloudLibrary = () => api<CloudLibrary>("/library");
export const updateCloudTrack = async (id: string, patch: TrackPatch) =>
  (await api<{ track: Track }>(`/tracks/${id}`, jsonOptions("PATCH", patch)))
    .track;
export const deleteCloudTrack = (id: string) =>
  api(`/tracks/${id}`, { method: "DELETE" });

async function uploadTrack(track: Track, audio: Blob, fingerprint: string) {
  const form = new FormData();
  form.append("audio", audio, track.fileName);
  form.append("fingerprint", fingerprint);
  const { artwork, url: _url, ...metadata } = track;
  form.append("metadata", JSON.stringify(metadata));
  if (artwork?.startsWith("data:image/"))
    form.append("artwork", await (await fetch(artwork)).blob(), "cover");
  return (
    await api<{ track: Track }>("/tracks", { method: "POST", body: form })
  ).track;
}
export const importCloudFiles = (files: File[]) =>
  importFiles(files, {
    // The server enforces uniqueness across tabs and devices after parsing the metadata.
    has: async () => false,
    save: uploadTrack,
  });

/** Copies original bytes, leaving the guest/device library intact. Safe to retry after partial failure. */
export async function copyDeviceSongs(
  progress: (message: string) => void,
): Promise<{ copied: number; errors: string[] }> {
  const local = await listTracks();
  const existing = new Set((await cloudLibrary()).tracks.map((t) => t.id));
  const covers = await listCoverBlobs("song");
  const errors: string[] = [];
  let copied = 0;
  for (const [index, track] of local.entries()) {
    progress(`Copying ${index + 1} of ${local.length}: ${track.title}`);
    try {
      if (!existing.has(track.id)) {
        const blob = await getTrackBlob(track.id);
        if (!blob) throw new Error("The device copy is missing.");
        const fingerprint = `${track.fileName}\u0000${blob.size}\u0000${blob instanceof File ? blob.lastModified : track.addedAt}`;
        try {
          await uploadTrack(track, blob, fingerprint);
        } catch (error) {
          // A copy uploaded normally has a different ID but the same file fingerprint.
          if (error instanceof AccountError && error.status === 409) continue;
          throw error;
        }
        copied++;
      }
      if (covers[track.id])
        await api(`/covers/song/${track.id}`, {
          method: "PUT",
          body: covers[track.id],
        });
    } catch (error) {
      errors.push(
        `${track.title}: ${error instanceof Error ? error.message : "Could not copy this song."}`,
      );
    }
  }
  return { copied, errors };
}
