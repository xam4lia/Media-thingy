import { useCallback, useEffect, useRef, useState } from "react";
import { getTrackBlob, type Track } from "./library";

export type RepeatMode = "off" | "all" | "one";

interface PlayerState {
  current: Track | null;
  playing: boolean;
  loading: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  error: string | null;
  queue: Track[];
}

const VOLUME_KEY = "media-thingy.volume";
const clamp = (value: number, max = 1) =>
  Math.min(max, Math.max(0, Number.isFinite(value) ? value : 0));

function savedVolume() {
  try {
    const saved = localStorage.getItem(VOLUME_KEY);
    return saved === null ? 0.75 : clamp(Number(saved));
  } catch {
    return 0.75;
  }
}

function playbackMessage(error: unknown) {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Your browser paused playback. Press play to start listening.";
  }
  return "This song could not be played. Try an MP3 or WAV file supported by your browser.";
}

export function usePlayer(beatGlow = false) {
  const [state, setState] = useState<PlayerState>(() => ({
    current: null,
    playing: false,
    loading: false,
    currentTime: 0,
    duration: 0,
    volume: savedVolume(),
    muted: false,
    shuffle: false,
    repeat: "off",
    error: null,
    queue: [],
  }));
  const stateRef = useRef(state);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const requestRef = useRef(0);
  const shufflePlayedRef = useRef(new Set<string>());
  const wantsPlaybackRef = useRef(false);
  const advanceRef = useRef<(automatic: boolean) => void>(() => {});
  const previousRef = useRef<() => void>(() => {});
  const toggleRef = useRef<() => void>(() => {});
  const mountedRef = useRef(false);
  const beatGlowRef = useRef(beatGlow);
  const prepareBeatGlowRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    beatGlowRef.current = beatGlow;
    if (beatGlow && stateRef.current.playing)
      void prepareBeatGlowRef.current();
    if (!beatGlow)
      document.documentElement.style.setProperty("--beat-pulse", "0");
  }, [beatGlow]);

  const update = useCallback((patch: Partial<PlayerState>) => {
    stateRef.current = { ...stateRef.current, ...patch };
    if (mountedRef.current) setState(stateRef.current);
  }, []);

  const attemptPlayback = useCallback(
    async (request: number) => {
      const audio = audioRef.current;
      if (!audio || !wantsPlaybackRef.current) return;
      try {
        if (beatGlowRef.current) await prepareBeatGlowRef.current();
        await audio.play();
        if (request === requestRef.current)
          update({ loading: false, error: null });
      } catch (error) {
        if (request !== requestRef.current || !wantsPlaybackRef.current) return;
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        wantsPlaybackRef.current = false;
        update({
          playing: false,
          loading: false,
          error: playbackMessage(error),
        });
      }
    },
    [update],
  );

  const loadTrack = useCallback(
    async (track: Track, tracks?: Track[]) => {
      const audio = audioRef.current;
      if (!audio) return;
      const request = ++requestRef.current;
      wantsPlaybackRef.current = true;
      shufflePlayedRef.current.add(track.id);
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      const queue = tracks?.length
        ? [...tracks]
        : stateRef.current.queue.some((item) => item.id === track.id)
          ? stateRef.current.queue
          : [track];
      update({
        current: track,
        queue,
        playing: false,
        loading: true,
        currentTime: 0,
        duration: track.duration || 0,
        error: null,
      });
      try {
        let url = track.url;
        if (track.source === "upload") {
          const blob = await getTrackBlob(track.id);
          if (request !== requestRef.current) return;
          if (!blob)
            throw new Error(
              "The audio file is no longer available. Please upload this song again.",
            );
          url = URL.createObjectURL(blob);
          objectUrlRef.current = url;
        }
        if (request !== requestRef.current) return;
        if (!url)
          throw new Error(
            "The audio file is missing. Please upload this song again.",
          );
        audio.src = url;
        audio.load();
        if (wantsPlaybackRef.current) await attemptPlayback(request);
        else update({ loading: false });
      } catch (error) {
        if (request !== requestRef.current) return;
        wantsPlaybackRef.current = false;
        update({
          loading: false,
          playing: false,
          error:
            error instanceof Error
              ? error.message
              : "This song could not be loaded.",
        });
      }
    },
    [attemptPlayback, update],
  );

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !stateRef.current.current) return;
    if (wantsPlaybackRef.current || !audio.paused) {
      wantsPlaybackRef.current = false;
      audio.pause();
      update({
        playing: false,
        loading: false,
        currentTime: audio.currentTime || 0,
      });
      return;
    }
    wantsPlaybackRef.current = true;
    if (stateRef.current.loading && !audio.getAttribute("src")) return;
    if (audio.ended) audio.currentTime = 0;
    if (!audio.getAttribute("src")) {
      void loadTrack(stateRef.current.current);
      return;
    }
    update({ loading: true, error: null });
    void attemptPlayback(requestRef.current);
  }, [attemptPlayback, loadTrack, update]);
  toggleRef.current = toggle;

  const play = useCallback(
    (track: Track, tracks?: Track[]) => {
      if (stateRef.current.current?.id === track.id) {
        if (tracks?.length) update({ queue: [...tracks] });
        toggle();
      } else {
        shufflePlayedRef.current = new Set();
        void loadTrack(track, tracks);
      }
    },
    [loadTrack, toggle, update],
  );

  const advance = useCallback(
    (automatic: boolean) => {
      const { current, queue, repeat, shuffle } = stateRef.current;
      const audio = audioRef.current;
      if (!current || !queue.length) return;
      if (automatic && repeat === "one" && audio) {
        audio.currentTime = 0;
        wantsPlaybackRef.current = true;
        void attemptPlayback(requestRef.current);
        return;
      }
      const index = queue.findIndex((track) => track.id === current.id);
      if (shuffle && queue.length > 1) {
        let choices = queue.filter(
          (track) => !shufflePlayedRef.current.has(track.id),
        );
        if (!choices.length) {
          if (automatic && repeat === "off") {
            wantsPlaybackRef.current = false;
            update({ playing: false, loading: false });
            return;
          }
          shufflePlayedRef.current = new Set([current.id]);
          choices = queue.filter((track) => track.id !== current.id);
        }
        void loadTrack(
          choices[Math.floor(Math.random() * choices.length)],
          queue,
        );
        return;
      }
      if (automatic && index >= queue.length - 1 && repeat === "off") {
        wantsPlaybackRef.current = false;
        update({ playing: false, loading: false });
        return;
      }
      void loadTrack(queue[(index + 1) % queue.length], queue);
    },
    [attemptPlayback, loadTrack, update],
  );
  advanceRef.current = advance;

  const next = useCallback(() => advance(false), [advance]);
  const previous = useCallback(() => {
    const audio = audioRef.current;
    const { current, queue } = stateRef.current;
    if (!audio || !current || !queue.length) return;
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      update({ currentTime: 0 });
      return;
    }
    const index = queue.findIndex((track) => track.id === current.id);
    void loadTrack(queue[(index - 1 + queue.length) % queue.length], queue);
  }, [loadTrack, update]);
  previousRef.current = previous;

  const seek = useCallback(
    (seconds: number) => {
      const audio = audioRef.current;
      if (!audio || !stateRef.current.current || !audio.getAttribute("src"))
        return;
      const duration = Number.isFinite(audio.duration)
        ? audio.duration
        : stateRef.current.duration;
      const target = clamp(seconds, duration);
      try {
        audio.currentTime = target;
        update({ currentTime: target });
      } catch {
        // A stream may not be seekable until its metadata has loaded.
      }
    },
    [update],
  );

  const setVolume = useCallback(
    (value: number) => {
      const volume = clamp(value);
      if (audioRef.current) {
        audioRef.current.volume = volume;
        if (volume > 0) audioRef.current.muted = false;
      }
      update({ volume, ...(volume > 0 ? { muted: false } : {}) });
      try {
        localStorage.setItem(VOLUME_KEY, String(volume));
      } catch {
        /* Private browsing can disable storage. */
      }
    },
    [update],
  );

  const toggleMute = useCallback(() => {
    const muted = !stateRef.current.muted;
    if (audioRef.current) audioRef.current.muted = muted;
    update({ muted });
  }, [update]);

  const toggleShuffle = useCallback(() => {
    shufflePlayedRef.current = new Set(
      stateRef.current.current ? [stateRef.current.current.id] : [],
    );
    update({ shuffle: !stateRef.current.shuffle });
  }, [update]);
  const cycleRepeat = useCallback(() => {
    const modes: RepeatMode[] = ["off", "all", "one"];
    update({
      repeat:
        modes[(modes.indexOf(stateRef.current.repeat) + 1) % modes.length],
    });
  }, [update]);
  const clearError = useCallback(() => update({ error: null }), [update]);
  const stop = useCallback(() => {
    ++requestRef.current;
    shufflePlayedRef.current = new Set();
    wantsPlaybackRef.current = false;
    const audio = audioRef.current;
    audio?.pause();
    audio?.removeAttribute("src");
    audio?.load();
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
    update({
      current: null,
      queue: [],
      playing: false,
      loading: false,
      currentTime: 0,
      duration: 0,
      error: null,
    });
  }, [update]);

  const removeFromQueue = useCallback(
    (id: string) => {
      if (stateRef.current.current?.id === id) {
        stop();
        return;
      }
      shufflePlayedRef.current.delete(id);
      update({
        queue: stateRef.current.queue.filter((track) => track.id !== id),
      });
    },
    [stop, update],
  );

  const syncArtwork = useCallback(
    (trackId: string, artwork: string | undefined) => {
      const { current, queue } = stateRef.current;
      const currentChanged =
        current?.id === trackId && current.artwork !== artwork;
      const queueChanged = queue.some(
        (track) => track.id === trackId && track.artwork !== artwork,
      );
      if (!currentChanged && !queueChanged) return;
      update({
        ...(currentChanged && current
          ? { current: { ...current, artwork } }
          : {}),
        ...(queueChanged
          ? {
              queue: queue.map((track) =>
                track.id === trackId ? { ...track, artwork } : track,
              ),
            }
          : {}),
      });
    },
    [update],
  );

  useEffect(() => {
    mountedRef.current = true;
    const audio = new Audio();
    audio.preload = "metadata";
    audio.volume = stateRef.current.volume;
    audio.muted = stateRef.current.muted;
    audioRef.current = audio;

    let audioContext: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let spectrum: Uint8Array<ArrayBuffer> | null = null;
    let beatFrame = 0;
    let rollingEnergy = 45;
    let flash = 0;
    let lastFlash = -Infinity;
    const root = document.documentElement;
    const paintBeatGlow = (pulse: number) => {
      root.style.setProperty("--beat-pulse", pulse.toFixed(3));
      root.style.setProperty("--beat-brightness", (1 + pulse * 0.58).toFixed(3));
      root.style.setProperty("--beat-saturation", `${140 + pulse * 105}%`);
      root.style.setProperty("--beat-opacity", (0.68 + pulse * 0.28).toFixed(3));
      root.style.setProperty(
        "--beat-opacity-three",
        (0.5 + pulse * 0.24).toFixed(3),
      );
      root.style.setProperty("--beat-shell-alpha", (pulse * 0.38).toFixed(3));
      root.style.setProperty("--beat-flash-overlay", (pulse * 0.28).toFixed(3));
    };
    const stopBeatGlow = () => {
      if (beatFrame) cancelAnimationFrame(beatFrame);
      beatFrame = 0;
      paintBeatGlow(0);
    };
    const drawBeatGlow = () => {
      if (!beatGlowRef.current || audio.paused || !analyser || !spectrum) {
        stopBeatGlow();
        return;
      }
      analyser.getByteFrequencyData(spectrum);
      const end = Math.min(16, spectrum.length);
      let total = 0;
      let peak = 0;
      for (let index = 1; index < end; index++) {
        const value = spectrum[index];
        total += value;
        peak = Math.max(peak, value);
      }
      const average = total / Math.max(1, end - 1);
      const energy = peak * 0.68 + average * 0.32;
      const now = performance.now();
      const level = Math.min(1, Math.max(0, (energy - 8) / 145));
      if (
        energy > Math.max(52, rollingEnergy * 1.24) &&
        now - lastFlash >= 360
      ) {
        flash = 1;
        lastFlash = now;
      } else {
        flash *= 0.82;
      }
      rollingEnergy = rollingEnergy * 0.94 + energy * 0.06;
      const pulse = Math.max(flash, level * 0.28);
      paintBeatGlow(pulse);
      beatFrame = requestAnimationFrame(drawBeatGlow);
    };
    const startBeatGlow = () => {
      if (!beatFrame) beatFrame = requestAnimationFrame(drawBeatGlow);
    };
    const prepareBeatGlow = async () => {
      if (
        !beatGlowRef.current ||
        matchMedia("(prefers-reduced-motion: reduce)").matches ||
        typeof AudioContext === "undefined"
      ) {
        stopBeatGlow();
        return;
      }
      try {
        if (!audioContext) {
          audioContext = new AudioContext();
          analyser = audioContext.createAnalyser();
          analyser.fftSize = 512;
          analyser.smoothingTimeConstant = 0.45;
          spectrum = new Uint8Array(analyser.frequencyBinCount);
          const source = audioContext.createMediaElementSource(audio);
          source.connect(analyser);
          analyser.connect(audioContext.destination);
        }
        if (audioContext.state === "suspended") await audioContext.resume();
        startBeatGlow();
      } catch {
        stopBeatGlow();
      }
    };
    prepareBeatGlowRef.current = prepareBeatGlow;

    const timeUpdate = () => update({ currentTime: audio.currentTime || 0 });
    const metadata = () => {
      if (Number.isFinite(audio.duration)) update({ duration: audio.duration });
    };
    const playing = () => {
      update({ playing: true, loading: false, error: null });
      void prepareBeatGlow();
    };
    const pause = () => {
      stopBeatGlow();
      update({ playing: false, currentTime: audio.currentTime || 0 });
    };
    const waiting = () => {
      if (wantsPlaybackRef.current) update({ loading: true });
    };
    const ended = () => advanceRef.current(true);
    const error = () => {
      if (!stateRef.current.current || !audio.getAttribute("src")) return;
      wantsPlaybackRef.current = false;
      update({
        loading: false,
        playing: false,
        error:
          "This audio format could not be played. Try an MP3 or WAV file supported by your browser.",
      });
    };
    audio.addEventListener("timeupdate", timeUpdate);
    audio.addEventListener("loadedmetadata", metadata);
    audio.addEventListener("durationchange", metadata);
    audio.addEventListener("playing", playing);
    audio.addEventListener("pause", pause);
    audio.addEventListener("waiting", waiting);
    audio.addEventListener("ended", ended);
    audio.addEventListener("error", error);

    const session = navigator.mediaSession;
    const setMediaAction = (
      action: MediaSessionAction,
      handler: MediaSessionActionHandler | null,
    ) => {
      try {
        session?.setActionHandler(action, handler);
      } catch {
        /* Some browsers implement only a subset of media actions. */
      }
    };
    if (session) {
      setMediaAction("play", () => {
        if (!stateRef.current.playing) toggleRef.current();
      });
      setMediaAction("pause", () => {
        if (wantsPlaybackRef.current) toggleRef.current();
      });
      setMediaAction("nexttrack", () => advanceRef.current(false));
      setMediaAction("previoustrack", () => previousRef.current());
      setMediaAction("seekto", (details) => {
        if (details.seekTime !== undefined) seek(details.seekTime);
      });
    }
    return () => {
      mountedRef.current = false;
      ++requestRef.current;
      wantsPlaybackRef.current = false;
      audio.removeEventListener("timeupdate", timeUpdate);
      audio.removeEventListener("loadedmetadata", metadata);
      audio.removeEventListener("durationchange", metadata);
      audio.removeEventListener("playing", playing);
      audio.removeEventListener("pause", pause);
      audio.removeEventListener("waiting", waiting);
      audio.removeEventListener("ended", ended);
      audio.removeEventListener("error", error);
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      stopBeatGlow();
      prepareBeatGlowRef.current = async () => {};
      if (audioContext) void audioContext.close();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
      audioRef.current = null;
      if (session) {
        for (const action of [
          "play",
          "pause",
          "nexttrack",
          "previoustrack",
          "seekto",
        ] as const) {
          setMediaAction(action, null);
        }
        session.metadata = null;
        session.playbackState = "none";
      }
    };
  }, [seek, update]);

  useEffect(() => {
    if (!navigator.mediaSession) return;
    const track = state.current;
    navigator.mediaSession.metadata = track
      ? new MediaMetadata({
          title: track.title,
          artist: track.artist,
          album: track.album,
          ...(track.artwork
            ? {
                artwork: [
                  { src: new URL(track.artwork, window.location.href).href },
                ],
              }
            : {}),
        })
      : null;
  }, [state.current]);

  useEffect(() => {
    if (navigator.mediaSession) {
      navigator.mediaSession.playbackState = state.current
        ? state.playing
          ? "playing"
          : "paused"
        : "none";
    }
  }, [state.current, state.playing]);

  return {
    ...state,
    play,
    toggle,
    next,
    previous,
    seek,
    setVolume,
    toggleMute,
    toggleShuffle,
    cycleRepeat,
    clearError,
    stop,
    removeFromQueue,
    syncArtwork,
  };
}
