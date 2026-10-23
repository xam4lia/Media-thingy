import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteCoverBlob,
  listCoverBlobs,
  preparePlaylistCover,
  saveCoverBlob,
} from "./playlistCovers";
import type { CoverKind } from "./playlistCovers";
import { useAccount } from "./AccountContext";
import { api } from "./cloud";

export type PlaylistCovers = {
  covers: Record<string, string>;
  loading: boolean;
  busyId: string | null;
  error: string | null;
  clearError(): void;
  setCover(playlistId: string, file: File): Promise<void>;
  removeCover(playlistId: string): Promise<void>;
  refresh(): Promise<void>;
};

/** Object URLs are session-only; the resized image bytes are persisted in IndexedDB. */
export function usePlaylistCovers(
  kind: CoverKind = "playlist",
): PlaylistCovers {
  const remote = !!useAccount()?.user;
  const [covers, setCovers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const urls = useRef<Record<string, string>>({});
  const generation = useRef(0);
  const mounted = useRef(false);
  const hydration = useRef<Promise<void>>(Promise.resolve());
  const queue = useRef<Promise<void>>(Promise.resolve());
  const sequence = useRef(0);
  const pending = useRef(new Map<number, { id: string; generation: number }>());

  useEffect(() => {
    const current = ++generation.current;
    mounted.current = true;
    setCovers({});
    setLoading(true);
    setBusyId(null);
    setError(null);
    hydration.current = (
      remote
        ? api<{ covers: Record<string, string> }>(`/covers/${kind}`).then(
            (data) => {
              if (mounted.current && generation.current === current)
                setCovers(data.covers);
              return {} as Record<string, Blob>;
            },
          )
        : listCoverBlobs(kind)
    )
      .then((blobs) => {
        if (!mounted.current || generation.current !== current) return;
        if (remote) return;
        const next = { ...urls.current };
        const created: string[] = [];
        try {
          for (const [id, blob] of Object.entries(blobs)) {
            if (next[id]) continue;
            next[id] = URL.createObjectURL(blob);
            created.push(next[id]);
          }
        } catch (cause) {
          created.forEach((url) => URL.revokeObjectURL(url));
          throw cause;
        }
        urls.current = next;
        setCovers({ ...next });
      })
      .catch((cause: unknown) => {
        if (mounted.current && generation.current === current) {
          setError(
            cause instanceof Error
              ? cause.message
              : `Your saved ${kind} covers could not be loaded. Try refreshing the page.`,
          );
        }
      })
      .finally(() => {
        if (mounted.current && generation.current === current)
          setLoading(false);
      });
    return () => {
      mounted.current = false;
      ++generation.current;
      Object.values(urls.current).forEach((url) => URL.revokeObjectURL(url));
      urls.current = {};
    };
  }, [kind, remote]);

  const clearError = useCallback(() => setError(null), []);

  const enqueue = useCallback(
    (
      id: string,
      action: (currentGeneration: number) => Promise<void>,
    ): Promise<void> => {
      const current = generation.current;
      const token = ++sequence.current;
      pending.current.set(token, { id, generation: current });
      const refreshBusy = () => {
        if (!mounted.current || generation.current !== current) return;
        setBusyId(
          [...pending.current.values()].find(
            (item) => item.generation === current,
          )?.id ?? null,
        );
      };
      if (mounted.current) setError(null);
      refreshBusy();
      // Serializing mutations also makes selection-then-removal and rapid replacements deterministic.
      // Finish initial hydration first: even a failed first selection must retain the saved cover.
      const operation = queue.current
        .then(() => hydration.current)
        .then(() => action(current));
      queue.current = operation.catch(() => undefined);
      return operation.finally(() => {
        pending.current.delete(token);
        refreshBusy();
      });
    },
    [],
  );

  const setCover = useCallback(
    (playlistId: string, file: File): Promise<void> =>
      enqueue(playlistId, async (current) => {
        const blob = await preparePlaylistCover(file);
        if (remote) {
          const result = await api<{ url: string }>(
            `/covers/${kind}/${playlistId}`,
            { method: "PUT", body: blob },
          );
          if (mounted.current && generation.current === current)
            setCovers((previous) => ({
              ...previous,
              [playlistId]: result.url,
            }));
          return;
        }
        // Create the display URL before committing; failures leave the existing cover intact.
        const url = URL.createObjectURL(blob);
        try {
          await saveCoverBlob(playlistId, blob, kind);
        } catch (cause) {
          URL.revokeObjectURL(url);
          throw cause;
        }
        if (!mounted.current || generation.current !== current) {
          URL.revokeObjectURL(url);
          return;
        }
        const previous = urls.current[playlistId];
        urls.current = { ...urls.current, [playlistId]: url };
        setCovers({ ...urls.current });
        setError(null);
        if (previous) URL.revokeObjectURL(previous);
      }),
    [enqueue, kind, remote],
  );

  const removeCover = useCallback(
    (playlistId: string): Promise<void> =>
      enqueue(playlistId, async (current) => {
        if (remote) {
          await api(`/covers/${kind}/${playlistId}`, { method: "DELETE" });
          if (mounted.current && generation.current === current)
            setCovers((previous) => {
              const next = { ...previous };
              delete next[playlistId];
              return next;
            });
          return;
        }
        await deleteCoverBlob(playlistId, kind);
        if (!mounted.current || generation.current !== current) return;
        const previous = urls.current[playlistId];
        const next = { ...urls.current };
        delete next[playlistId];
        urls.current = next;
        setCovers({ ...next });
        setError(null);
        if (previous) URL.revokeObjectURL(previous);
      }),
    [enqueue, kind, remote],
  );

  const refresh = useCallback(async () => {
    if (!remote) return;
    const result = await api<{ covers: Record<string, string> }>(
      `/covers/${kind}`,
    );
    if (mounted.current) setCovers(result.covers);
  }, [remote, kind]);

  return {
    covers,
    loading,
    busyId,
    error,
    clearError,
    setCover,
    removeCover,
    refresh,
  };
}
