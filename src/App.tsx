import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  Camera,
  Check,
  ChevronDown,
  Disc3,
  FolderPlus,
  Heart,
  House,
  Library,
  ListMusic,
  LoaderCircle,
  Menu,
  Minus,
  MoreHorizontal,
  Moon,
  Music2,
  MicVocal,
  Palette,
  Pause,
  Play,
  Plus,
  Repeat,
  Repeat1,
  Search,
  Settings2,
  ShieldCheck,
  Shuffle,
  SkipBack,
  SkipForward,
  Sun,
  Trophy,
  Trash2,
  Upload,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  deleteTrack,
  importFiles,
  listTracks,
  updateTrack,
} from "./lib/library";
import type { Track } from "./lib/library";
import { usePlayer, type BeatMode } from "./lib/usePlayer";
import { useTheme } from "./lib/useTheme";
import {
  DEFAULT_SCALE,
  MAX_SCALE,
  MIN_SCALE,
  useDisplayScale,
} from "./lib/useDisplayScale";
import { useGlassHue } from "./lib/useGlassHue";
import {
  MAX_LYRICS_LENGTH,
  normalizeLyricsText,
  parseLyrics,
} from "./lib/lyrics";
import { usePlaylistCovers } from "./lib/usePlaylistCovers";
import { useSongCovers } from "./lib/useSongCovers";
import { useAccount } from "./lib/AccountContext";
import { AccountSettings } from "./components/AccountSettings";
import {
  api,
  cloudLibrary,
  deleteCloudTrack,
  importCloudFiles,
  jsonOptions,
  updateCloudTrack,
} from "./lib/cloud";

const huePresets = [
  { name: "Ocean", value: 205 },
  { name: "Violet", value: 265 },
  { name: "Rose", value: 335 },
  { name: "Amber", value: 35 },
  { name: "Forest", value: 145 },
] as const;

const demos: Track[] = [
  {
    id: "demo-soft-focus",
    title: "Soft Focus",
    artist: "media originals",
    album: "A little room to listen",
    duration: 22,
    artwork: `${import.meta.env.BASE_URL}demo/soft-focus.svg`,
    color: "#ddc3b7",
    addedAt: 3,
    favorite: false,
    fileName: "soft-focus.wav",
    size: 0,
    source: "demo",
    url: `${import.meta.env.BASE_URL}demo/soft-focus.wav`,
  },
  {
    id: "demo-blue-hour",
    title: "Blue Hour",
    artist: "media originals",
    album: "A little room to listen",
    duration: 22,
    artwork: `${import.meta.env.BASE_URL}demo/blue-hour.svg`,
    color: "#b9bfde",
    addedAt: 2,
    favorite: false,
    fileName: "blue-hour.wav",
    size: 0,
    source: "demo",
    url: `${import.meta.env.BASE_URL}demo/blue-hour.wav`,
  },
  {
    id: "demo-afterglow",
    title: "Afterglow",
    artist: "media originals",
    album: "A little room to listen",
    duration: 22,
    artwork: `${import.meta.env.BASE_URL}demo/afterglow.svg`,
    color: "#d6b29a",
    addedAt: 1,
    favorite: false,
    fileName: "afterglow.wav",
    size: 0,
    source: "demo",
    url: `${import.meta.env.BASE_URL}demo/afterglow.wav`,
  },
];

type Playlist = { id: string; name: string; tracks: string[] };
type View = "home" | "library" | "favorites" | string;
type PlayCounts = Record<string, number>;
type DailyListening = { date: string; tracks: PlayCounts };
type HomeSection = "weekly" | "top" | "rotation";
type Customization = {
  glass: number;
  accentHue: number;
  backgroundStyle: "liquid" | "gradient" | "solid" | "artwork" | "image";
  beatMode: BeatMode;
  playerSize: "compact" | "standard" | "large";
  artworkShape: "square" | "rounded" | "circle";
  density: "compact" | "comfortable" | "spacious";
  homeOrder: HomeSection[];
  homeVisible: Record<HomeSection, boolean>;
  backgroundImage: string;
  backgroundBlur: number;
  backgroundDim: number;
  greeting: string;
  profileHue: number;
  profileImage: string;
};
const TOP_SONGS_VIEW = "top-songs";
const CUSTOMIZATION_KEY = "media-customization-v1";
const defaultCustomization: Customization = {
  glass: 70,
  accentHue: 205,
  backgroundStyle: "liquid",
  beatMode: "off",
  playerSize: "standard",
  artworkShape: "rounded",
  density: "comfortable",
  homeOrder: ["weekly", "top", "rotation"],
  homeVisible: { weekly: true, top: true, rotation: true },
  backgroundImage: "",
  backgroundBlur: 18,
  backgroundDim: 42,
  greeting: "",
  profileHue: 205,
  profileImage: "",
};
const acceptAudio =
  "audio/*,.mp3,.flac,.wav,.m4a,.aac,.ogg,.opus,.webm,.aiff,.aif";
function readSaved<T>(key: string, fallback: T): T {
  try {
    const saved = localStorage.getItem(key);
    return saved ? (JSON.parse(saved) as T) : fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Library audio storage reports its own errors. */
  }
}

function savedCustomization(): Customization {
  const saved = readSaved<Partial<Customization>>(CUSTOMIZATION_KEY, {});
  return {
    ...defaultCustomization,
    ...saved,
    beatMode:
      saved.beatMode ??
      (readSaved("media-beat-glow", false) ? "strobe" : "off"),
    homeOrder:
      Array.isArray(saved.homeOrder) && saved.homeOrder.length === 3
        ? saved.homeOrder
        : defaultCustomization.homeOrder,
    homeVisible: {
      ...defaultCustomization.homeVisible,
      ...(saved.homeVisible ?? {}),
    },
  };
}

async function resizedImage(file: File, maxDimension: number, quality = 0.82) {
  if (!file.type.startsWith("image/"))
    throw new Error("Choose a JPG, PNG, WebP, GIF, or AVIF image.");
  if (file.size > 12 * 1024 * 1024)
    throw new Error("Choose an image smaller than 12 MB.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) => (value ? resolve(value) : reject(new Error("The image could not be prepared."))),
      "image/webp",
      quality,
    ),
  );
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("The image could not be read."));
    reader.readAsDataURL(blob);
  });
}

function normalizedPlayCounts(value: unknown): PlayCounts {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([id, count]) =>
          /^[a-zA-Z0-9_-]{1,100}$/.test(id) &&
          typeof count === "number" &&
          Number.isInteger(count) &&
          count > 0,
      )
      .slice(0, 1000)
      .map(([id, count]) => [id, Math.min(count as number, 1_000_000)]),
  );
}

function dayKey(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function normalizedListeningHistory(value: unknown): DailyListening[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (day): day is { date: string; tracks: unknown } =>
        !!day &&
        typeof day === "object" &&
        typeof day.date === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(day.date),
    )
    .map((day) => ({
      date: day.date,
      tracks: normalizedPlayCounts(day.tracks),
    }))
    .filter((day) => Object.keys(day.tracks).length > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-14);
}

function recentDays(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - (count - index - 1));
    return {
      key: dayKey(date),
      label: new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(
        date,
      ),
    };
  });
}
function time(seconds: number) {
  const n = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
}

function Artwork({
  track,
  className = "",
  alt = "",
}: {
  track?: Track | null;
  className?: string;
  alt?: string;
}) {
  return (
    <div
      className={`artwork ${className}`}
      style={{ backgroundColor: track?.color ?? "var(--artwork-placeholder)" }}
    >
      {track?.artwork ? (
        <img src={track.artwork} alt={alt} loading="lazy" />
      ) : (
        <>
          <span className="artwork-orbit" />
          <Disc3 size={32} strokeWidth={1.1} />
        </>
      )}
    </div>
  );
}

function LyricsView({
  track,
  currentTime,
  onSeek,
  onEdit,
}: {
  track?: Track | null;
  currentTime: number;
  onSeek: (seconds: number) => void;
  onEdit: (track: Track) => void;
}) {
  const parsed = useMemo(() => parseLyrics(track?.lyrics ?? ""), [track?.lyrics]);
  const active = parsed.synced
    ? parsed.lines.reduce(
        (found, line, index) =>
          (line.time ?? Infinity) <= currentTime + 0.05 ? index : found,
        -1,
      )
    : -1;
  const activeLine = useRef<HTMLButtonElement>(null);
  const lyricsScroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scroller = lyricsScroller.current;
    const line = activeLine.current;
    if (active >= 0 && scroller && line) {
      const scrollerTop = scroller.getBoundingClientRect().top;
      const lineTop = line.getBoundingClientRect().top;
      scroller.scrollTo({
        top:
          scroller.scrollTop +
          lineTop -
          scrollerTop -
          scroller.clientHeight / 2 +
          line.clientHeight / 2,
        behavior: "smooth",
      });
    }
  }, [active]);

  if (!track) {
    return (
      <div className="lyrics-empty">
        <MicVocal size={36} strokeWidth={1.2} />
        <h2>Choose a song first.</h2>
        <p>Play something from your library to open its lyrics.</p>
      </div>
    );
  }

  if (!track.lyrics || !parsed.lines.length) {
    return (
      <div className="lyrics-empty">
        <MicVocal size={36} strokeWidth={1.2} />
        <h2>No lyrics yet.</h2>
        <p>
          {track.source === "demo"
            ? "The preview songs do not have lyrics. Play one of your uploaded songs to add your own."
            : "Paste ordinary lyrics or upload a timed LRC file."}
        </p>
        {track.source !== "demo" && (
          <button className="button button-dark" onClick={() => onEdit(track)}>
            <Plus size={16} />
            Add lyrics
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="lyrics-view">
      <div className="lyrics-heading">
        <div>
          <span className="section-eyebrow">
            {parsed.synced ? "FOLLOWING THE MUSIC" : "LYRICS"}
          </span>
          <h2>{track.title}</h2>
          <p>{track.artist}</p>
        </div>
        <button
          className="button button-glass lyrics-edit"
          aria-label={`Edit lyrics for ${track.title}`}
          onClick={() => onEdit(track)}
        >
          Edit
        </button>
      </div>
      <Artwork
        track={track}
        className="now-playing-large-cover lyrics-song-cover"
        alt={`Cover for ${track.title}`}
      />
      <div
        ref={lyricsScroller}
        className={`lyrics-lines ${parsed.synced ? "is-synced" : "is-plain"}`}
      >
        {parsed.lines.map((line, index) =>
          parsed.synced ? (
            <button
              key={`${line.time}-${index}`}
              ref={index === active ? activeLine : undefined}
              className={index === active ? "active" : ""}
              aria-current={index === active ? "true" : undefined}
              aria-label={`${line.text || "Instrumental"}, ${time(line.time ?? 0)}`}
              onClick={() => onSeek(line.time ?? 0)}
            >
              {line.text || <span aria-label="Instrumental">♪</span>}
            </button>
          ) : (
            <p key={index}>{line.text || "\u00a0"}</p>
          ),
        )}
      </div>
      {parsed.synced && <p className="lyrics-hint">Tap a line to jump there.</p>}
    </div>
  );
}
function IconButton({
  children,
  label,
  active = false,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  label: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${active ? "active" : ""} ${className}`}
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </button>
  );
}
function Modal({
  children,
  title,
  close,
  className = "",
}: {
  children: ReactNode;
  title: string;
  close: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const el = ref.current;
    el?.focus();
    function key(event: KeyboardEvent) {
      if (event.key === "Escape") close();
      if (event.key === "Tab" && el) {
        const items = [
          ...el.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input, textarea, [tabindex="0"]',
          ),
        ];
        const first = items[0];
        const last = items.at(-1);
        if (
          event.shiftKey &&
          (document.activeElement === first || document.activeElement === el)
        ) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [close]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`modal ${className}`}
        ref={ref}
        tabIndex={-1}
      >
        <IconButton
          label="Close dialog"
          className="modal-close"
          onClick={close}
        >
          <X size={20} />
        </IconButton>
        {children}
      </div>
    </div>
  );
}

export default function App() {
  const account = useAccount();
  const remote = !!account.user;
  const { theme, toggleTheme } = useTheme();
  const { scale, setScale } = useDisplayScale();
  const { hue, setHue } = useGlassHue();
  const [customization, setCustomization] = useState(savedCustomization);
  const playlistCovers = usePlaylistCovers();
  const songCovers = useSongCovers();
  const [uploaded, setUploaded] = useState<Track[]>([]);
  const [demoFavorites, setDemoFavorites] = useState<string[]>(() =>
    remote ? [] : readSaved("media-demo-favorites", []),
  );
  const [hiddenDemos, setHiddenDemos] = useState<string[]>(() =>
    remote ? [] : readSaved("media-hidden-demos", []),
  );
  const [playlists, setPlaylists] = useState<Playlist[]>(() =>
    remote ? [] : readSaved("media-playlists", []),
  );
  const [playCounts, setPlayCounts] = useState<PlayCounts>(() =>
    remote
      ? {}
      : normalizedPlayCounts(readSaved("media-play-counts", {})),
  );
  const [listeningHistory, setListeningHistory] = useState<DailyListening[]>(
    () =>
      remote
        ? []
        : normalizedListeningHistory(
            readSaved("media-listening-history", []),
          ),
  );
  const [view, setView] = useState<View>("home");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("recent");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    error?: boolean;
  } | null>(null);
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const [playlistName, setPlaylistName] = useState("");
  const [playlistTarget, setPlaylistTarget] = useState<Track | null>(null);
  const [menuTrack, setMenuTrack] = useState<string | null>(null);
  const [menuOpensUp, setMenuOpensUp] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Track | null>(null);
  const [deletePlaylist, setDeletePlaylist] = useState<Playlist | null>(null);
  const [panelView, setPanelView] = useState<
    "now-playing" | "lyrics" | "queue" | null
  >(null);
  const [lyricsTarget, setLyricsTarget] = useState<Track | null>(null);
  const [lyricsDraft, setLyricsDraft] = useState("");
  const [lyricsSaving, setLyricsSaving] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [libraryError, setLibraryError] = useState("");
  const [cloudStateError, setCloudStateError] = useState("");
  const [cloudSaving, setCloudSaving] = useState(false);
  const cloudVersion = useRef(0);
  const lastSavedState = useRef("");
  const stateQueue = useRef<Promise<void>>(Promise.resolve());
  const stateConflict = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const coverTarget = useRef<string | null>(null);
  const songCoverInput = useRef<HTMLInputElement>(null);
  const songCoverTarget = useRef<string | null>(null);
  const panelTrigger = useRef<HTMLButtonElement | null>(null);
  const lyricsFileInput = useRef<HTMLInputElement>(null);
  const backgroundImageInput = useRef<HTMLInputElement>(null);
  const profileImageInput = useRef<HTMLInputElement>(null);
  const dragCount = useRef(0);
  const recordPlay = useCallback(
    (track: Track) => {
      setPlayCounts((previous) => {
        const next = {
          ...previous,
          [track.id]: Math.min((previous[track.id] ?? 0) + 1, 1_000_000),
        };
        if (!remote) store("media-play-counts", next);
        return next;
      });
      setListeningHistory((previous) => {
        const today = dayKey();
        const existing = previous.find((day) => day.date === today);
        const tracksForToday = {
          ...(existing?.tracks ?? {}),
          [track.id]: Math.min(
            (existing?.tracks[track.id] ?? 0) + 1,
            10_000,
          ),
        };
        const limitedTracks = Object.fromEntries(
          Object.entries(tracksForToday)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 50),
        );
        const next = [
          ...previous.filter((day) => day.date !== today),
          { date: today, tracks: limitedTracks },
        ]
          .sort((a, b) => a.date.localeCompare(b.date))
          .slice(-14);
        if (!remote) store("media-listening-history", next);
        return next;
      });
    },
    [remote],
  );
  const player = usePlayer(customization.beatMode, recordPlay);

  useEffect(() => {
    store(CUSTOMIZATION_KEY, customization);
    const root = document.documentElement;
    root.dataset.beatGlow = customization.beatMode === "off" ? "off" : "on";
    root.dataset.beatMode = customization.beatMode;
    root.dataset.backgroundStyle = customization.backgroundStyle;
    root.dataset.playerSize = customization.playerSize;
    root.dataset.artworkShape = customization.artworkShape;
    root.dataset.density = customization.density;
    root.style.setProperty("--custom-glass", `${customization.glass}%`);
    root.style.setProperty(
      "--custom-glass-blur",
      `${0.75 + customization.glass * 0.0375}rem`,
    );
    root.style.setProperty("--accent-hue", String(customization.accentHue));
    root.style.setProperty("--background-blur", `${customization.backgroundBlur}px`);
    root.style.setProperty("--background-dim", String(customization.backgroundDim / 100));
    root.style.setProperty("--profile-hue", String(customization.profileHue));
    if (customization.beatMode === "off")
      document.documentElement.style.setProperty("--beat-pulse", "0");
  }, [customization]);
  const tracks = [
    ...uploaded,
    ...demos
      .filter((t) => !hiddenDemos.includes(t.id))
      .map((t) => ({
        ...t,
        artwork:
          theme === "dark"
            ? t.artwork?.replace(/\.svg$/, "-dark.svg")
            : t.artwork,
        favorite: demoFavorites.includes(t.id),
      })),
  ].map((track) =>
    songCovers.covers[track.id]
      ? { ...track, artwork: songCovers.covers[track.id] }
      : track,
  );
  const topSongs = [...tracks]
    .filter((track) => (playCounts[track.id] ?? 0) > 0)
    .sort(
      (a, b) =>
        (playCounts[b.id] ?? 0) - (playCounts[a.id] ?? 0) ||
        b.addedAt - a.addedAt,
    )
    .slice(0, 50);
  const availableTrackIds = new Set(tracks.map((track) => track.id));
  const weeklyTrackCounts: PlayCounts = {};
  const weeklyDays = recentDays(7).map((day) => {
    const saved = listeningHistory.find((entry) => entry.date === day.key);
    const plays = Object.entries(saved?.tracks ?? {}).reduce(
      (total, [trackId, count]) => {
        if (availableTrackIds.has(trackId)) {
          weeklyTrackCounts[trackId] =
            (weeklyTrackCounts[trackId] ?? 0) + count;
          return total + count;
        }
        return total;
      },
      0,
    );
    return { ...day, plays };
  });
  const weeklyPlays = weeklyDays.reduce((total, day) => total + day.plays, 0);
  const weeklyActiveDays = weeklyDays.filter((day) => day.plays > 0).length;
  const weeklyTopId = Object.entries(weeklyTrackCounts).sort(
    ([, a], [, b]) => b - a,
  )[0]?.[0];
  const weeklyRankedTracks = Object.keys(weeklyTrackCounts)
    .sort((a, b) => weeklyTrackCounts[b] - weeklyTrackCounts[a])
    .map((id) => tracks.find((track) => track.id === id))
    .filter((track): track is Track => !!track);
  const weeklyTopTrack = weeklyRankedTracks.find(
    (track) => track.id === weeklyTopId,
  );
  const weeklyChartMax = Math.max(1, ...weeklyDays.map((day) => day.plays));
  const isTopSongs = view === TOP_SONGS_VIEW;
  const activePlaylist = playlists.find((p) => p.id === view);
  const notify = useCallback(
    (message: string, error = false) => setToast({ message, error }),
    [],
  );
  const customize = useCallback(
    (patch: Partial<Customization>) =>
      setCustomization((previous) => ({ ...previous, ...patch })),
    [],
  );

  function moveHomeSection(section: HomeSection, direction: -1 | 1) {
    const order = [...customization.homeOrder];
    const index = order.indexOf(section);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    customize({ homeOrder: order });
  }

  async function saveCustomImage(
    file: File,
    target: "backgroundImage" | "profileImage",
  ) {
    try {
      const image = await resizedImage(
        file,
        target === "backgroundImage" ? 1920 : 320,
      );
      customize({
        [target]: image,
        ...(target === "backgroundImage"
          ? { backgroundStyle: "image" as const }
          : {}),
      });
      notify(target === "backgroundImage" ? "Background updated." : "Profile photo updated.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "That image could not be saved.", true);
    }
  }

  useEffect(() => {
    let alive = true;
    (remote
      ? cloudLibrary().then((data) => {
          if (!alive) return;
          setUploaded(data.tracks);
          setPlaylists(data.state.playlists);
          setDemoFavorites(data.state.demoFavorites);
          setHiddenDemos(data.state.hiddenDemos);
          const counts = normalizedPlayCounts(data.state.playCounts);
          const history = normalizedListeningHistory(
            data.state.listeningHistory,
          );
          setPlayCounts(counts);
          setListeningHistory(history);
          cloudVersion.current = data.version;
          lastSavedState.current = JSON.stringify({
            playlists: data.state.playlists,
            demoFavorites: data.state.demoFavorites,
            hiddenDemos: data.state.hiddenDemos,
            playCounts: counts,
            listeningHistory: history,
          });
        })
      : listTracks().then((tracks) => {
          if (alive) setUploaded(tracks);
        })
    )
      .catch((error: unknown) => {
        if (alive)
          setLibraryError(
            error instanceof Error
              ? error.message
              : "Your library could not be opened. Try refreshing the page.",
          );
      })
      .finally(() => {
        if (alive) setLibraryLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [remote]);

  function persist(key: string, value: unknown) {
    if (!remote) store(key, value);
  }
  const saveCloudState = useCallback(() => {
    const state = {
      playlists,
      demoFavorites,
      hiddenDemos,
      playCounts,
      listeningHistory,
    };
    const snapshot = JSON.stringify(state);
    if (!remote || libraryLoading || libraryError) return Promise.resolve();
    const operation = stateQueue.current
      .catch(() => undefined)
      .then(async () => {
        if (stateConflict.current)
          throw new Error(
            "Your library changed in another tab or device. Refresh before editing playlists again.",
          );
        if (snapshot === lastSavedState.current) return;
        setCloudSaving(true);
        try {
          const result = await api<{ version: number }>(
            "/library/state",
            jsonOptions("PUT", { state, version: cloudVersion.current }),
          );
          cloudVersion.current = result.version;
          lastSavedState.current = snapshot;
          setCloudStateError("");
        } catch (error) {
          if (
            error instanceof Error &&
            "status" in error &&
            error.status === 409
          )
            stateConflict.current = true;
          const message =
            error instanceof Error
              ? error.message
              : "Your playlist changes could not be saved. Try again.";
          setCloudStateError(message);
          throw error;
        } finally {
          setCloudSaving(false);
        }
      });
    stateQueue.current = operation;
    return operation;
  }, [
    remote,
    playlists,
    demoFavorites,
    hiddenDemos,
    playCounts,
    listeningHistory,
    libraryLoading,
    libraryError,
  ]);
  useEffect(() => {
    if (!remote || libraryLoading || libraryError) return;
    const timer = setTimeout(() => {
      void saveCloudState().catch(() => undefined);
    }, 400);
    return () => clearTimeout(timer);
  }, [remote, libraryLoading, libraryError, saveCloudState]);

  async function refreshCloudSongs() {
    setUploaded((await cloudLibrary()).tracks);
    await songCovers.refresh();
  }
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.error ? 8500 : 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (player.error) {
      notify(player.error, true);
      player.clearError();
    }
  }, [player.error, player.clearError, notify]);
  useEffect(() => {
    if (playlistCovers.error) {
      notify(playlistCovers.error, true);
      playlistCovers.clearError();
    }
  }, [playlistCovers.error, playlistCovers.clearError, notify]);
  useEffect(() => {
    if (songCovers.error) {
      notify(songCovers.error, true);
      songCovers.clearError();
    }
  }, [songCovers.error, songCovers.clearError, notify]);
  useEffect(() => {
    const close = () => setMenuTrack(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);
  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (
        event.code === "Space" &&
        !["INPUT", "TEXTAREA", "BUTTON", "SELECT"].includes(target.tagName) &&
        !target.isContentEditable &&
        !document.querySelector('[role="dialog"]')
      ) {
        event.preventDefault();
        player.toggle();
      }
    }
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [player.toggle]);

  const handleFiles = useCallback(
    async (files: File[]) => {
      if (!files.length || uploading) return;
      setUploading(true);
      setUploadOpen(true);
      try {
        const result = await (remote
          ? importCloudFiles(files)
          : importFiles(files));
        setUploaded(
          remote ? (await cloudLibrary()).tracks : await listTracks(),
        );
        if (result.tracks.length) {
          notify(
            `${result.tracks.length} ${result.tracks.length === 1 ? "song added" : "songs added"}. Make yourself at home.`,
          );
          setView("library");
          setSearch("");
        }
        if (result.errors.length)
          notify(result.errors.slice(0, 3).join(" "), true);
        if (result.tracks.length) setUploadOpen(false);
      } catch (error) {
        notify(
          error instanceof Error
            ? error.message
            : "We couldn’t save those songs. Please try again.",
          true,
        );
      } finally {
        setUploading(false);
        if (fileInput.current) fileInput.current.value = "";
      }
    },
    [uploading, notify, remote],
  );

  useEffect(() => {
    function enter(e: globalThis.DragEvent) {
      if (e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
        dragCount.current++;
        setDragging(true);
      }
    }
    function leave(e: globalThis.DragEvent) {
      if (e.dataTransfer?.types.includes("Files")) {
        dragCount.current--;
        if (dragCount.current <= 0) setDragging(false);
      }
    }
    function over(e: globalThis.DragEvent) {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    }
    function drop(e: globalThis.DragEvent) {
      if (e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
        dragCount.current = 0;
        setDragging(false);
        void handleFiles(Array.from(e.dataTransfer.files));
      }
    }
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [handleFiles]);

  async function favorite(track: Track) {
    try {
      if (track.source === "demo") {
        const next = demoFavorites.includes(track.id)
          ? demoFavorites.filter((id) => id !== track.id)
          : [...demoFavorites, track.id];
        setDemoFavorites(next);
        persist("media-demo-favorites", next);
      } else {
        const updated = await (remote ? updateCloudTrack : updateTrack)(
          track.id,
          {
            favorite: !track.favorite,
          },
        );
        setUploaded((previous) =>
          previous.map((t) => (t.id === track.id ? updated : t)),
        );
      }
    } catch {
      notify("That favorite couldn’t be saved. Please try again.", true);
    }
  }
  async function remove(track: Track) {
    try {
      await songCovers.removeCover(track.id);
      if (track.source === "demo") {
        const next = [...hiddenDemos, track.id];
        setHiddenDemos(next);
        persist("media-hidden-demos", next);
      } else {
        await (remote ? deleteCloudTrack : deleteTrack)(track.id);
        setUploaded((previous) => previous.filter((t) => t.id !== track.id));
      }
      if (player.current?.id === track.id) player.stop();
      player.removeFromQueue(track.id);
      const next = playlists.map((p) => ({
        ...p,
        tracks: p.tracks.filter((id) => id !== track.id),
      }));
      setPlaylists(next);
      persist("media-playlists", next);
      setPlayCounts((previous) => {
        if (!(track.id in previous)) return previous;
        const counts = { ...previous };
        delete counts[track.id];
        if (!remote) store("media-play-counts", counts);
        return counts;
      });
      setListeningHistory((previous) => {
        const next = previous
          .map((day) => {
            const dayTracks = { ...day.tracks };
            delete dayTracks[track.id];
            return { ...day, tracks: dayTracks };
          })
          .filter((day) => Object.keys(day.tracks).length > 0);
        if (!remote) store("media-listening-history", next);
        return next;
      });
      setDeleteTarget(null);
      notify("Song removed from your library.");
    } catch {
      notify("That song couldn’t be removed. Please try again.", true);
    }
  }
  function navigate(next: View) {
    setView(next);
    setSearch("");
    setMobileNav(false);
  }
  function createPlaylist(e: React.FormEvent) {
    e.preventDefault();
    const name = playlistName.trim();
    if (!name) return;
    const playlist = {
      id: `playlist-${crypto.randomUUID()}`,
      name,
      tracks: playlistTarget ? [playlistTarget.id] : [],
    };
    const next = [...playlists, playlist];
    setPlaylists(next);
    persist("media-playlists", next);
    setPlaylistOpen(false);
    setPlaylistName("");
    setPlaylistTarget(null);
    navigate(playlist.id);
    notify(`“${name}” is ready for your music.`);
  }
  function addToPlaylist(playlist: Playlist, track: Track) {
    if (playlist.tracks.includes(track.id)) {
      notify(`Already in “${playlist.name}”.`);
      setPlaylistTarget(null);
      return;
    }
    const next = playlists.map((p) =>
      p.id === playlist.id ? { ...p, tracks: [...p.tracks, track.id] } : p,
    );
    setPlaylists(next);
    persist("media-playlists", next);
    setPlaylistTarget(null);
    notify(`Added to “${playlist.name}”.`);
  }
  function removeFromPlaylist(track: Track) {
    if (!activePlaylist) return;
    const next = playlists.map((p) =>
      p.id === activePlaylist.id
        ? { ...p, tracks: p.tracks.filter((id) => id !== track.id) }
        : p,
    );
    setPlaylists(next);
    persist("media-playlists", next);
    notify("Song removed from playlist.");
  }

  function chooseCover(playlistId: string) {
    coverTarget.current = playlistId;
    coverInput.current?.click();
  }

  async function saveCover(file: File) {
    const playlistId = coverTarget.current;
    if (!playlistId) return;
    try {
      await playlistCovers.setCover(playlistId, file);
      notify("Playlist cover updated.");
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "This photo couldn’t be saved. Try another image.",
        true,
      );
    } finally {
      if (coverInput.current) coverInput.current.value = "";
      coverTarget.current = null;
    }
  }

  async function removeCover(playlistId: string) {
    try {
      await playlistCovers.removeCover(playlistId);
      notify("Playlist cover removed.");
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "This cover couldn’t be removed. Please try again.",
        true,
      );
    }
  }

  async function removePlaylist(playlist: Playlist) {
    try {
      await playlistCovers.removeCover(playlist.id);
      const next = playlists.filter((p) => p.id !== playlist.id);
      setPlaylists(next);
      persist("media-playlists", next);
      setDeletePlaylist(null);
      navigate("home");
      notify("Playlist deleted. Your music is still here.");
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "This playlist couldn’t be deleted. Please try again.",
        true,
      );
    }
  }

  function chooseSongCover(track: Track) {
    if (songCovers.busyId) return;
    songCoverTarget.current = track.id;
    songCoverInput.current?.click();
  }

  async function saveSongCover(file: File) {
    const trackId = songCoverTarget.current;
    if (!trackId) return;
    try {
      await songCovers.setCover(trackId, file);
      notify("Song cover updated.");
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "This photo couldn’t be saved. Try another image.",
        true,
      );
    } finally {
      if (songCoverInput.current) songCoverInput.current.value = "";
      songCoverTarget.current = null;
    }
  }

  async function resetSongCover(track: Track) {
    try {
      await songCovers.removeCover(track.id);
      notify("Original song cover restored.");
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "This cover couldn’t be reset. Please try again.",
        true,
      );
    }
  }

  function editLyrics(track: Track) {
    if (track.source === "demo") return;
    setLyricsTarget(track);
    setLyricsDraft(track.lyrics ?? "");
  }

  const closeLyrics = useCallback(() => {
    if (lyricsSaving) return;
    setLyricsTarget(null);
    setLyricsDraft("");
  }, [lyricsSaving]);

  async function readLyricsFile(file: File) {
    if (!/\.(lrc|txt)$/i.test(file.name) && file.type !== "text/plain") {
      notify("Choose an LRC or TXT lyrics file.", true);
      return;
    }
    if (file.size > MAX_LYRICS_LENGTH * 4) {
      notify("That lyrics file is too large.", true);
      return;
    }
    const value = normalizeLyricsText(await file.text());
    if (value.length > MAX_LYRICS_LENGTH) {
      notify("Lyrics can contain up to 100,000 characters.", true);
      return;
    }
    setLyricsDraft(value);
  }

  async function saveLyrics(value = lyricsDraft) {
    if (!lyricsTarget || lyricsTarget.source === "demo") return;
    const lyrics = normalizeLyricsText(value);
    if (lyrics.length > MAX_LYRICS_LENGTH) {
      notify("Lyrics can contain up to 100,000 characters.", true);
      return;
    }
    setLyricsSaving(true);
    try {
      const updated = await (remote ? updateCloudTrack : updateTrack)(
        lyricsTarget.id,
        { lyrics },
      );
      setUploaded((previous) =>
        previous.map((track) => (track.id === updated.id ? updated : track)),
      );
      setLyricsTarget(null);
      setLyricsDraft("");
      notify(lyrics ? "Lyrics saved." : "Lyrics removed.");
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Those lyrics couldn’t be saved. Please try again.",
        true,
      );
    } finally {
      setLyricsSaving(false);
    }
  }

  let visible =
    isTopSongs
      ? topSongs
      : view === "library"
        ? tracks.filter((track) => track.source !== "demo")
        : view === "favorites"
          ? tracks.filter((t) => t.favorite)
          : activePlaylist
            ? activePlaylist.tracks
                .map((id) => tracks.find((t) => t.id === id))
                .filter((t): t is Track => !!t)
            : tracks;
  if (search.trim()) {
    const query = search.trim().toLowerCase();
    visible = visible.filter((t) =>
      `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(query),
    );
  }
  if (!isTopSongs)
    visible = [...visible].sort((a, b) =>
      sort === "title"
        ? a.title.localeCompare(b.title)
        : sort === "artist"
          ? a.artist.localeCompare(b.artist)
          : b.addedAt - a.addedAt,
    );
  const title =
    view === "home"
      ? customization.greeting.trim() || "Home"
      : isTopSongs
        ? "Top songs"
        : view === "library"
          ? "Your library"
          : view === "favorites"
            ? "Favorites"
            : (activePlaylist?.name ?? "Your library");
  const current =
    tracks.find((t) => t.id === player.current?.id) ?? player.current;
  const queueTracks = (player.queue.length ? player.queue : tracks)
    .filter((track) => tracks.some((existing) => existing.id === track.id))
    .map(
      (track) => tracks.find((existing) => existing.id === track.id) ?? track,
    );
  useEffect(() => {
    if (current) player.syncArtwork(current.id, current.artwork);
  }, [current?.id, current?.artwork, player.syncArtwork]);
  const totalDuration = visible.reduce((sum, t) => sum + (t.duration || 0), 0);
  const closeUpload = useCallback(() => {
    if (!uploading) setUploadOpen(false);
  }, [uploading]);
  const closePlaylist = useCallback(() => {
    setPlaylistOpen(false);
    setPlaylistName("");
    setPlaylistTarget(null);
  }, []);
  const closePlaylistTarget = useCallback(() => setPlaylistTarget(null), []);
  const closeDelete = useCallback(() => setDeleteTarget(null), []);
  const closeDeletePlaylist = useCallback(() => setDeletePlaylist(null), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const closeListeningPanel = useCallback(() => {
    setPanelView(null);
    panelTrigger.current?.focus();
  }, []);
  useEffect(() => {
    if (!panelView) return;
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector('[role="dialog"]'))
        closeListeningPanel();
    };
    document.addEventListener("keydown", closeWithEscape);
    return () => document.removeEventListener("keydown", closeWithEscape);
  }, [panelView, closeListeningPanel]);

  function movePanelTab(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const tabs = ["now-playing", "lyrics", "queue"] as const;
    const currentIndex = Math.max(0, tabs.indexOf(panelView ?? "now-playing"));
    const next =
      event.key === "Home"
        ? tabs[0]
        : event.key === "End"
          ? tabs.at(-1)!
          : tabs[
              (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
                tabs.length
            ];
    setPanelView(next);
    requestAnimationFrame(() =>
      document.getElementById(`${next}-tab`)?.focus(),
    );
  }

  return (
    <>
      <div
        className="custom-background-layer"
        aria-hidden="true"
        style={{
          backgroundImage:
            customization.backgroundStyle === "image" && customization.backgroundImage
              ? `url(${customization.backgroundImage})`
              : customization.backgroundStyle === "artwork" && current?.artwork
                ? `url(${current.artwork})`
                : undefined,
          backgroundColor:
            customization.backgroundStyle === "artwork" ? current?.color : undefined,
        }}
      />
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <div className="ambient ambient-three" />
      <div className="app-shell">
        {mobileNav && (
          <button
            className="nav-scrim"
            aria-label="Close navigation"
            onClick={() => setMobileNav(false)}
          />
        )}
        <aside className={`sidebar ${mobileNav ? "is-open" : ""}`}>
          <a
            className="brand"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              navigate("home");
            }}
            aria-label="media. home"
          >
            <span className="brand-record">
              <Disc3 size={26} strokeWidth={1.4} />
            </span>
            media<span className="brand-period">.</span>
          </a>
          <div className="nav-group">
            <span className="section-eyebrow">YOUR SPACE</span>
            <nav aria-label="Main navigation">
              <button
                className={`nav-item ${view === "home" ? "selected" : ""}`}
                onClick={() => navigate("home")}
              >
                <House size={19} />
                Home{view === "home" && <span className="nav-dot" />}
              </button>
              <button
                className={`nav-item ${view === "library" ? "selected" : ""}`}
                onClick={() => navigate("library")}
              >
                <Library size={19} />
                Your library
                <span className="nav-count">{uploaded.length || ""}</span>
              </button>
              <button
                className={`nav-item ${view === "favorites" ? "selected" : ""}`}
                onClick={() => navigate("favorites")}
              >
                <Heart size={19} />
                Favorites
                {tracks.filter((t) => t.favorite).length > 0 && (
                  <span className="nav-count">
                    {tracks.filter((t) => t.favorite).length}
                  </span>
                )}
              </button>
            </nav>
          </div>
          <div className="nav-group playlist-nav">
            <div className="section-eyebrow playlist-heading">
              YOUR PLAYLISTS
              <IconButton
                label="Create playlist"
                onClick={() => setPlaylistOpen(true)}
              >
                <Plus size={16} />
              </IconButton>
            </div>
            <div className="playlists-list">
              <button
                className={`nav-item playlist-item automatic-playlist ${isTopSongs ? "selected" : ""}`}
                onClick={() => navigate(TOP_SONGS_VIEW)}
              >
                <span className="playlist-icon">
                  <Trophy size={15} />
                </span>
                <span className="truncate">Top songs</span>
                {topSongs.length > 0 && (
                  <span className="nav-count">{topSongs.length}</span>
                )}
              </button>
              {playlists.length ? (
                playlists.map((p) => (
                  <button
                    key={p.id}
                    className={`nav-item playlist-item ${view === p.id ? "selected" : ""}`}
                    onClick={() => navigate(p.id)}
                  >
                    <span className="playlist-icon">
                      {playlistCovers.covers[p.id] ? (
                        <img src={playlistCovers.covers[p.id]} alt="" />
                      ) : (
                        <ListMusic size={15} />
                      )}
                    </span>
                    <span className="truncate">{p.name}</span>
                  </button>
                ))
              ) : (
                <button
                  className="new-playlist"
                  onClick={() => setPlaylistOpen(true)}
                >
                  <Plus size={15} /> Make your first mix
                </button>
              )}
            </div>
          </div>
          <div className="sidebar-bottom">
            <button
              className="storage-status"
              onClick={() => setSettingsOpen(true)}
              style={{
                color: `hsl(${customization.profileHue} 62% ${theme === "dark" ? 72 : 36}%)`,
              }}
            >
              {customization.profileImage ? (
                <img className="sidebar-profile-image" src={customization.profileImage} alt="" />
              ) : (
                <span className="status-dot" />
              )}
              {account.user ? account.user.username : "Stored on this device"}
              <ShieldCheck size={13} />
            </button>
          </div>
        </aside>
        <main className="main-panel" id="main-content">
          <header className="topbar">
            <div className="topbar-leading">
              <IconButton
                label="Open navigation"
                className="mobile-menu"
                onClick={() => setMobileNav(true)}
              >
                <Menu size={21} />
              </IconButton>
            </div>
            <div className="topbar-actions">
              <label className="search-box">
                <Search size={16} />
                <input
                  type="search"
                  placeholder="Search your music"
                  aria-label="Search your music"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <span className="search-key">⌕</span>
              </label>
              <button
                type="button"
                className="theme-toggle"
                aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
                title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
                onClick={toggleTheme}
              >
                {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
                <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
              </button>
              <button
                className="local-avatar"
                onClick={() => setSettingsOpen(true)}
                aria-label="Open settings"
                title="Settings"
              >
                {customization.profileImage ? (
                  <img src={customization.profileImage} alt="" />
                ) : (
                  <Settings2 size={18} />
                )}
              </button>
            </div>
          </header>
          <div className="page-content">
            {(libraryError || cloudStateError) && (
              <div className="account-sync-error" role="alert">
                <p>{libraryError || cloudStateError}</p>
                <button
                  className="button button-glass"
                  onClick={() => {
                    if (libraryError || stateConflict.current)
                      window.location.reload();
                    else void saveCloudState().catch(() => undefined);
                  }}
                >
                  {libraryError || stateConflict.current
                    ? "Refresh library"
                    : "Retry saving"}
                </button>
              </div>
            )}
            {remote && cloudSaving && (
              <p className="account-save-status" role="status">
                Saving your library…
              </p>
            )}
            <div className="page-title-row">
              <div>
                <div className="page-crumb">YOUR OWN LITTLE UNIVERSE</div>
                <h1>
                  {title}
                  <span className="title-dot">.</span>
                </h1>
              </div>
              <button
                className="button button-glass header-upload"
                onClick={() => setUploadOpen(true)}
              >
                <Plus size={17} />
                Add music
              </button>
            </div>
            <div className={view === "home" ? "home-sections" : ""}>
            {view === "home" && !search.trim() && customization.homeVisible.weekly && (
              <section
                className="weekly-stats"
                aria-labelledby="weekly-title"
                style={{ order: customization.homeOrder.indexOf("weekly") }}
              >
                <div className="weekly-stats-heading">
                  <div>
                    <span className="section-eyebrow">YOUR WEEK IN MUSIC</span>
                    <h2 id="weekly-title">Last 7 days</h2>
                  </div>
                  <span className="weekly-stats-range">
                    Updates when a song starts
                  </span>
                </div>
                <div className="weekly-stats-grid">
                  <div className="weekly-metrics">
                    <div className="weekly-metric">
                      <strong>{weeklyPlays}</strong>
                      <span>{weeklyPlays === 1 ? "play" : "plays"}</span>
                    </div>
                    <div className="weekly-metric">
                      <strong>{Object.keys(weeklyTrackCounts).length}</strong>
                      <span>different songs</span>
                    </div>
                    <div className="weekly-metric">
                      <strong>{weeklyActiveDays}</strong>
                      <span>listening days</span>
                    </div>
                  </div>
                  <div
                    className="weekly-chart"
                    role="img"
                    aria-label={`${weeklyPlays} plays during the last 7 days`}
                  >
                    {weeklyDays.map((day) => (
                      <div className="weekly-chart-day" key={day.key}>
                        <span className="weekly-chart-value">
                          {day.plays || ""}
                        </span>
                        <span className="weekly-chart-track">
                          <span
                            className="weekly-chart-bar"
                            style={
                              {
                                "--bar-height": `${Math.max(day.plays ? 12 : 3, (day.plays / weeklyChartMax) * 100)}%`,
                              } as React.CSSProperties
                            }
                          />
                        </span>
                        <span className="weekly-chart-label">{day.label}</span>
                      </div>
                    ))}
                  </div>
                  {weeklyTopTrack ? (
                    <button
                      type="button"
                      className="weekly-top-song"
                      onClick={() =>
                        player.play(weeklyTopTrack, weeklyRankedTracks)
                      }
                      aria-label={`Play this week's top song, ${weeklyTopTrack.title}`}
                    >
                      <Artwork track={weeklyTopTrack} />
                      <span>
                        <small>TOP SONG THIS WEEK</small>
                        <strong>{weeklyTopTrack.title}</strong>
                        <em>
                          {weeklyTopTrack.artist} · {weeklyTrackCounts[weeklyTopTrack.id]}{" "}
                          {weeklyTrackCounts[weeklyTopTrack.id] === 1
                            ? "play"
                            : "plays"}
                        </em>
                      </span>
                      <span className="weekly-top-play">
                        <Play size={16} fill="currentColor" />
                      </span>
                    </button>
                  ) : (
                    <div className="weekly-top-song weekly-top-empty">
                      <span className="weekly-empty-icon">
                        <Music2 size={20} />
                      </span>
                      <span>
                        <small>YOUR WEEK STARTS HERE</small>
                        <strong>Play something you love.</strong>
                        <em>Your weekly stats will build automatically.</em>
                      </span>
                    </div>
                  )}
                </div>
              </section>
            )}
            {view === "home" && !search.trim() && customization.homeVisible.top && (
              <section
                className="home-top-songs"
                aria-labelledby="home-top-title"
                style={{ order: customization.homeOrder.indexOf("top") }}
              >
                <div className="section-heading">
                  <div>
                    <h2 id="home-top-title">Top songs</h2>
                    <p>Your most-played music, ready to go again.</p>
                  </div>
                  <button type="button" onClick={() => navigate(TOP_SONGS_VIEW)}>
                    View all <ArrowRight size={14} />
                  </button>
                </div>
                {topSongs.length ? (
                  <div className="home-top-grid">
                    {topSongs.slice(0, 5).map((track, index) => (
                      <button
                        type="button"
                        key={track.id}
                        className="home-top-card"
                        onClick={() => player.play(track, topSongs)}
                      >
                        <Artwork track={track} />
                        <span className="home-top-rank">{index + 1}</span>
                        <span>
                          <strong>{track.title}</strong>
                          <small>{playCounts[track.id]} {playCounts[track.id] === 1 ? "play" : "plays"}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="home-top-placeholder">Your Top songs playlist will appear after you start listening.</p>
                )}
              </section>
            )}
            {view !== "home" && (
              <section
                className={`collection-banner ${view === "favorites" ? "favorite-banner" : ""}`}
              >
                {activePlaylist ? (
                  <button
                    className="playlist-cover-button"
                    aria-label={`Change cover for ${activePlaylist.name}`}
                    onClick={() => chooseCover(activePlaylist.id)}
                    disabled={playlistCovers.busyId === activePlaylist.id}
                  >
                    {playlistCovers.covers[activePlaylist.id] ? (
                      <img
                        className="playlist-cover-image"
                        src={playlistCovers.covers[activePlaylist.id]}
                        alt={`Cover for ${activePlaylist.name}`}
                      />
                    ) : (
                      <ListMusic size={37} strokeWidth={1.3} />
                    )}
                    <span className="playlist-cover-overlay">
                      {playlistCovers.busyId === activePlaylist.id ? (
                        <LoaderCircle className="spin" size={20} />
                      ) : (
                        <Camera size={20} />
                      )}
                      <span>
                        {playlistCovers.busyId === activePlaylist.id
                          ? "Saving…"
                          : "Change cover"}
                      </span>
                    </span>
                  </button>
                ) : (
                  <span className="collection-banner-icon">
                    {view === "favorites" ? (
                      <Heart size={35} strokeWidth={1.2} fill="currentColor" />
                    ) : isTopSongs ? (
                      <Trophy size={35} strokeWidth={1.3} />
                    ) : (
                      <Library size={37} strokeWidth={1.3} />
                    )}
                  </span>
                )}
                <div>
                  <span className="section-eyebrow">
                    {activePlaylist
                      ? "YOUR PLAYLIST"
                      : view === "favorites"
                        ? "A LITTLE CLOSER TO THE HEART"
                        : isTopSongs
                          ? "BASED ON WHAT YOU PLAY"
                          : "COLLECT MOMENTS, KEEP THE MUSIC"}
                  </span>
                  <h2>
                    {view === "favorites"
                      ? "The ones you come back to."
                      : isTopSongs
                        ? "Your most-played songs."
                      : activePlaylist
                        ? activePlaylist.name
                        : "Every song has a home."}
                  </h2>
                  <p>
                    {visible.length} {visible.length === 1 ? "song" : "songs"}
                    {isTopSongs && visible.length > 0 && " · ranked by plays"}
                    {totalDuration > 0 &&
                      ` · ${Math.max(1, Math.round(totalDuration / 60))} min of good company`}
                  </p>
                  {activePlaylist && (
                    <div className="playlist-cover-actions">
                      <button
                        type="button"
                        onClick={() => chooseCover(activePlaylist.id)}
                        disabled={playlistCovers.busyId === activePlaylist.id}
                      >
                        <Camera size={14} />
                        Change cover
                      </button>
                      {playlistCovers.covers[activePlaylist.id] && (
                        <button
                          type="button"
                          onClick={() => void removeCover(activePlaylist.id)}
                          disabled={playlistCovers.busyId === activePlaylist.id}
                        >
                          Remove cover
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div className="collection-banner-actions">
                  {visible.length > 0 && (
                    <button
                      className="round-play"
                      aria-label={`Play ${title}`}
                      onClick={() => player.play(visible[0], visible)}
                    >
                      <Play size={23} fill="currentColor" />
                    </button>
                  )}
                  {activePlaylist && (
                    <IconButton
                      label="Delete playlist"
                      onClick={() => setDeletePlaylist(activePlaylist)}
                    >
                      <Trash2 size={18} />
                    </IconButton>
                  )}
                </div>
              </section>
            )}
            <section
              className={`tracks-section${view === "home" ? " home-tracks" : ""}`}
              hidden={view === "home" && !search.trim() && !customization.homeVisible.rotation}
              style={
                view === "home"
                  ? { order: customization.homeOrder.indexOf("rotation") }
                  : undefined
              }
            >
              <div className="section-heading tracks-heading">
                <div>
                  <h2>
                    {search
                      ? "Search results"
                      : view === "home"
                        ? "In your rotation"
                        : isTopSongs
                          ? "Most played"
                        : view === "favorites"
                          ? "Your favorites"
                          : activePlaylist
                            ? "The tracklist"
                            : "Your collection"}
                    <span className="track-count">{visible.length}</span>
                  </h2>
                  {view === "home" && (
                    <p>A little familiar. A little new. All yours.</p>
                  )}
                </div>
                {!isTopSongs && (
                  <label className="sort-control">
                    <select
                      aria-label="Sort songs"
                      value={sort}
                      onChange={(e) => setSort(e.target.value)}
                    >
                      <option value="recent">Recently added</option>
                      <option value="title">Song title</option>
                      <option value="artist">Artist</option>
                    </select>
                    <ChevronDown size={13} />
                  </label>
                )}
              </div>
              {libraryLoading ? (
                <div className="empty-state">
                  <LoaderCircle className="spin" size={27} />
                  <p>Finding your music…</p>
                </div>
              ) : visible.length ? (
                <div className="track-table">
                  <div className="table-head">
                    <span className="track-number">#</span>
                    <span>TITLE</span>
                    <span className="album-column">ALBUM</span>
                    <span className="date-column">
                      {isTopSongs ? "PLAYS" : "ADDED"}
                    </span>
                    <span className="time-column" aria-label="Duration">
                      TIME
                    </span>
                    <span />
                  </div>
                  {visible.map((track, index) => {
                    const isCurrent = current?.id === track.id;
                    return (
                      <div
                        className={`track-row ${isCurrent ? "current" : ""}`}
                        key={track.id}
                      >
                        <button
                          className="row-play"
                          onClick={() => player.play(track, visible)}
                          aria-label={`${isCurrent && player.playing ? "Pause" : "Play"} ${track.title}`}
                        >
                          <span className="row-number">
                            {isCurrent && player.playing ? (
                              <span className="equalizer">
                                <i />
                                <i />
                                <i />
                              </span>
                            ) : (
                              String(index + 1).padStart(2, "0")
                            )}
                          </span>
                          <span className="row-play-icon">
                            {isCurrent && player.playing ? (
                              <Pause size={14} fill="currentColor" />
                            ) : (
                              <Play size={14} fill="currentColor" />
                            )}
                          </span>
                        </button>
                        <button
                          className="track-identity"
                          onClick={() => player.play(track, visible)}
                          aria-label={`${isCurrent && player.playing ? "Pause" : "Play"} ${track.title} by ${track.artist}`}
                        >
                          <Artwork track={track} />
                          <span className="track-titles">
                            <strong>{track.title}</strong>
                            <span>{track.artist}</span>
                          </span>
                          {track.source === "demo" && (
                            <span className="row-demo">DEMO</span>
                          )}
                        </button>
                        <span className="album-column truncate">
                          {track.album || "—"}
                        </span>
                        <span className="date-column">
                          {isTopSongs
                            ? `${playCounts[track.id]} ${playCounts[track.id] === 1 ? "play" : "plays"}`
                            : track.source === "demo"
                            ? "Just for you"
                            : new Intl.DateTimeFormat(undefined, {
                                month: "short",
                                day: "numeric",
                              }).format(track.addedAt)}
                        </span>
                        <span className="time-column">
                          {time(track.duration)}
                        </span>
                        <div className="row-actions">
                          <IconButton
                            label={`${track.favorite ? "Unfavorite" : "Favorite"} ${track.title}`}
                            active={track.favorite}
                            onClick={() => void favorite(track)}
                          >
                            <Heart
                              size={16}
                              fill={track.favorite ? "currentColor" : "none"}
                            />
                          </IconButton>
                          <div className="track-menu-wrap">
                            <IconButton
                              label={`More options for ${track.title}`}
                              aria-expanded={menuTrack === track.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                const anchor =
                                  e.currentTarget.getBoundingClientRect();
                                const rootSize = Number.parseFloat(
                                  getComputedStyle(document.documentElement)
                                    .fontSize,
                                );
                                const menuHeight =
                                  (3 +
                                    Number(!!songCovers.covers[track.id]) +
                                    Number(!!activePlaylist)) *
                                    2.5 *
                                    rootSize +
                                  12;
                                const bottom =
                                  document
                                    .querySelector(".player")
                                    ?.getBoundingClientRect().top ??
                                  window.innerHeight;
                                setMenuOpensUp(
                                  bottom - anchor.bottom < menuHeight &&
                                    anchor.top > menuHeight,
                                );
                                setMenuTrack(
                                  menuTrack === track.id ? null : track.id,
                                );
                              }}
                            >
                              <MoreHorizontal size={19} />
                            </IconButton>
                            {menuTrack === track.id && (
                              <div
                                className={`track-menu${menuOpensUp ? " track-menu-up" : ""}`}
                              >
                                <button
                                  disabled={songCovers.busyId !== null}
                                  onClick={() => chooseSongCover(track)}
                                >
                                  <Camera size={15} />
                                  Change song cover
                                </button>
                                {songCovers.covers[track.id] && (
                                  <button
                                    disabled={songCovers.busyId !== null}
                                    onClick={() => void resetSongCover(track)}
                                  >
                                    <Disc3 size={15} />
                                    Reset song cover
                                  </button>
                                )}
                                <button
                                  onClick={() => setPlaylistTarget(track)}
                                >
                                  <ListMusic size={15} />
                                  Add to playlist
                                </button>
                                {activePlaylist && (
                                  <button
                                    onClick={() => removeFromPlaylist(track)}
                                  >
                                    <X size={15} />
                                    Remove from playlist
                                  </button>
                                )}
                                <button
                                  className="menu-danger"
                                  onClick={() => setDeleteTarget(track)}
                                >
                                  <Trash2 size={14} />
                                  {track.source === "demo"
                                    ? "Hide demo song"
                                    : "Remove from library"}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-state">
                  <span className="empty-icon">
                    {search ? (
                      <Search size={28} strokeWidth={1.3} />
                    ) : view === "favorites" ? (
                      <Heart size={28} strokeWidth={1.3} />
                    ) : (
                      <Music2 size={28} strokeWidth={1.3} />
                    )}
                  </span>
                  <h3>
                    {search
                      ? "Nothing here just yet."
                      : isTopSongs
                        ? "Your top songs will appear here."
                      : view === "favorites"
                        ? "Keep the good ones close."
                        : activePlaylist
                          ? "Every good mix starts somewhere."
                          : "Your collection starts with you."}
                  </h3>
                  <p>
                    {search
                      ? `No songs match “${search}”. Try another title or artist.`
                      : isTopSongs
                        ? "Play a song and this playlist will build itself automatically."
                      : view === "favorites"
                        ? "Tap the heart on any song to find it here."
                        : activePlaylist
                          ? "Use a song’s menu to add it to this playlist."
                          : "Drop in the songs you love, or choose a few to get started."}
                  </p>
                  {search ? (
                    <button
                      className="button button-glass"
                      onClick={() => setSearch("")}
                    >
                      Clear search
                    </button>
                  ) : activePlaylist || view === "favorites" ? (
                    <button
                      className="button button-glass"
                      onClick={() => navigate("home")}
                    >
                      Find your next favorite
                      <ArrowRight size={15} />
                    </button>
                  ) : (
                    <button
                      className="button button-dark"
                      onClick={() => setUploadOpen(true)}
                    >
                      <Plus size={16} />
                      Add your music
                    </button>
                  )}
                </div>
              )}
            </section>
            </div>
            <footer className="page-footer">
              <span>
                <Disc3 size={13} />A little less noise. A little more you.
              </span>
              <span>MADE FOR YOUR MUSIC</span>
            </footer>
          </div>
        </main>
        <footer className="player" aria-label="Music player">
          <div className="now-playing">
            <button
              type="button"
              className="now-playing-open"
              aria-label="Show now playing"
              aria-expanded={panelView === "now-playing"}
              aria-controls="listening-panel"
              title="Open large song cover"
              onClick={(event) => {
                panelTrigger.current = event.currentTarget;
                setPanelView(
                  panelView === "now-playing" ? null : "now-playing",
                );
              }}
            >
              <Artwork track={current} />
              <div className="now-playing-info">
                <strong>{current?.title ?? "Find your next feeling"}</strong>
                <span>{current?.artist ?? "Pick a song. Make a moment."}</span>
              </div>
            </button>
            {current && (
              <IconButton
                label={`${current.favorite ? "Unfavorite" : "Favorite"} ${current.title}`}
                active={current.favorite}
                onClick={() => void favorite(current)}
              >
                <Heart
                  size={17}
                  fill={current.favorite ? "currentColor" : "none"}
                />
              </IconButton>
            )}
          </div>
          <div className="player-center">
            <div className="transport">
              <IconButton
                label="Shuffle"
                active={player.shuffle}
                aria-pressed={player.shuffle}
                onClick={player.toggleShuffle}
              >
                <Shuffle size={16} />
              </IconButton>
              <IconButton
                label="Previous song"
                onClick={player.previous}
                disabled={!current}
              >
                <SkipBack size={19} fill="currentColor" />
              </IconButton>
              <button
                className="main-play"
                aria-label={
                  player.playing ? "Pause playback" : "Start playback"
                }
                onClick={() =>
                  current
                    ? player.toggle()
                    : tracks[0] && player.play(tracks[0], tracks)
                }
                disabled={player.loading || !tracks.length}
              >
                {player.loading ? (
                  <LoaderCircle size={21} className="spin" />
                ) : player.playing ? (
                  <Pause size={20} fill="currentColor" />
                ) : (
                  <Play size={20} fill="currentColor" />
                )}
              </button>
              <IconButton
                label="Next song"
                onClick={player.next}
                disabled={!current}
              >
                <SkipForward size={19} fill="currentColor" />
              </IconButton>
              <IconButton
                label={`Repeat: ${player.repeat}`}
                active={player.repeat !== "off"}
                onClick={player.cycleRepeat}
              >
                {player.repeat === "one" ? (
                  <Repeat1 size={17} />
                ) : (
                  <Repeat size={17} />
                )}
              </IconButton>
            </div>
            <div className="progress">
              <span>{time(player.currentTime)}</span>
              <input
                type="range"
                aria-label="Seek playback"
                min="0"
                max={player.duration || current?.duration || 1}
                step="0.1"
                value={Math.min(
                  player.currentTime,
                  player.duration || current?.duration || 1,
                )}
                disabled={!current}
                onChange={(e) => player.seek(Number(e.target.value))}
                style={
                  {
                    "--progress": `${player.duration ? (player.currentTime / player.duration) * 100 : 0}%`,
                  } as React.CSSProperties
                }
              />
              <span>{time(player.duration || current?.duration || 0)}</span>
            </div>
          </div>
          <div className="player-right">
            <span className="audio-quality">YOUR SOUND</span>
            <IconButton
              label={player.muted ? "Unmute" : "Mute"}
              onClick={player.toggleMute}
            >
              {player.muted || player.volume === 0 ? (
                <VolumeX size={18} />
              ) : player.volume < 0.5 ? (
                <Volume1 size={18} />
              ) : (
                <Volume2 size={18} />
              )}
            </IconButton>
            <input
              className="volume-range"
              aria-label="Volume"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={player.muted ? 0 : player.volume}
              onChange={(e) => player.setVolume(Number(e.target.value))}
              style={
                {
                  "--progress": `${player.muted ? 0 : player.volume * 100}%`,
                } as React.CSSProperties
              }
            />
            <span className="player-divider" />
            <IconButton
              label="Show play queue"
              active={panelView === "queue"}
              aria-expanded={panelView === "queue"}
              aria-controls="listening-panel"
              onClick={(event) => {
                panelTrigger.current = event.currentTarget;
                setPanelView(panelView === "queue" ? null : "queue");
              }}
            >
              <ListMusic size={20} />
            </IconButton>
          </div>
        </footer>
        {panelView && (
          <aside
            id="listening-panel"
            className="queue-panel listening-panel"
            aria-label={
              panelView === "now-playing"
                ? "Now playing"
                : panelView === "lyrics"
                  ? "Lyrics"
                  : "Play queue"
            }
          >
            <div className="listening-panel-header">
              <div
                className="panel-tabs"
                role="tablist"
                aria-label="Listening panel"
              >
                <button
                  type="button"
                  id="now-playing-tab"
                  className="panel-tab"
                  role="tab"
                  aria-selected={panelView === "now-playing"}
                  aria-controls="now-playing-tabpanel"
                  tabIndex={panelView === "now-playing" ? 0 : -1}
                  onClick={() => setPanelView("now-playing")}
                  onKeyDown={movePanelTab}
                >
                  Now playing
                </button>
                <button
                  type="button"
                  id="lyrics-tab"
                  className="panel-tab"
                  role="tab"
                  aria-selected={panelView === "lyrics"}
                  aria-controls="lyrics-tabpanel"
                  tabIndex={panelView === "lyrics" ? 0 : -1}
                  onClick={() => setPanelView("lyrics")}
                  onKeyDown={movePanelTab}
                >
                  Lyrics
                </button>
                <button
                  type="button"
                  id="queue-tab"
                  className="panel-tab"
                  role="tab"
                  aria-selected={panelView === "queue"}
                  aria-controls="queue-tabpanel"
                  tabIndex={panelView === "queue" ? 0 : -1}
                  onClick={() => setPanelView("queue")}
                  onKeyDown={movePanelTab}
                >
                  Queue
                </button>
              </div>
              <IconButton
                label={
                  panelView === "now-playing"
                    ? "Close now playing"
                    : panelView === "lyrics"
                      ? "Close lyrics"
                      : "Close queue"
                }
                onClick={closeListeningPanel}
              >
                <X size={19} />
              </IconButton>
            </div>
            {panelView === "now-playing" ? (
              <div
                className="now-playing-details"
                role="tabpanel"
                id="now-playing-tabpanel"
                aria-labelledby="now-playing-tab"
                tabIndex={0}
              >
                {current ? (
                  <>
                    <Artwork
                      track={current}
                      className="now-playing-large-cover"
                      alt={`Cover for ${current.title}`}
                    />
                    <div className="now-playing-title-row">
                      <div>
                        <h2>{current.title}</h2>
                        <p>{current.artist}</p>
                      </div>
                      <div className="now-playing-detail-actions">
                        <IconButton
                          label={`${current.favorite ? "Unfavorite" : "Favorite"} ${current.title}`}
                          active={current.favorite}
                          onClick={() => void favorite(current)}
                        >
                          <Heart
                            size={20}
                            fill={current.favorite ? "currentColor" : "none"}
                          />
                        </IconButton>
                        <IconButton
                          label="Change cover for playing song"
                          disabled={songCovers.busyId !== null}
                          onClick={() => chooseSongCover(current)}
                        >
                          <Camera size={19} />
                        </IconButton>
                      </div>
                    </div>
                    <div className="now-playing-status">
                      <span
                        className={player.playing ? "equalizer" : "paused-mark"}
                      >
                        {player.playing ? (
                          <>
                            <i />
                            <i />
                            <i />
                          </>
                        ) : (
                          <Pause size={12} />
                        )}
                      </span>
                      <span>
                        {player.loading
                          ? "Loading your song"
                          : player.playing
                            ? "Playing from your collection"
                            : "Paused"}
                      </span>
                    </div>
                    <div className="now-playing-panel-controls">
                      <IconButton
                        label="Previous in now playing"
                        onClick={player.previous}
                      >
                        <SkipBack size={21} fill="currentColor" />
                      </IconButton>
                      <button
                        type="button"
                        className="main-play"
                        aria-label={
                          player.playing
                            ? "Pause current song"
                            : "Play current song"
                        }
                        onClick={player.toggle}
                        disabled={player.loading}
                      >
                        {player.loading ? (
                          <LoaderCircle size={23} className="spin" />
                        ) : player.playing ? (
                          <Pause size={23} fill="currentColor" />
                        ) : (
                          <Play size={23} fill="currentColor" />
                        )}
                      </button>
                      <IconButton
                        label="Next in now playing"
                        onClick={player.next}
                      >
                        <SkipForward size={21} fill="currentColor" />
                      </IconButton>
                    </div>
                    <div className="now-playing-album">
                      <span>ALBUM</span>
                      <strong>{current.album || "Your collection"}</strong>
                    </div>
                    <button
                      type="button"
                      className="now-playing-queue-link"
                      onClick={() => setPanelView("queue")}
                    >
                      <ListMusic size={20} />
                      <span>
                        <strong>Up next</strong>
                        <small>
                          {queueTracks.length}{" "}
                          {queueTracks.length === 1 ? "song" : "songs"} in your
                          queue
                        </small>
                      </span>
                      <ArrowRight size={17} />
                    </button>
                  </>
                ) : (
                  <div className="now-playing-empty">
                    <Artwork className="now-playing-large-cover" />
                    <h2>Your music, up close.</h2>
                    <p>Choose a song to see its cover here.</p>
                    <button
                      type="button"
                      className="button button-glass"
                      onClick={() => setPanelView("queue")}
                    >
                      Choose from your queue
                      <ArrowRight size={16} />
                    </button>
                  </div>
                )}
              </div>
            ) : panelView === "lyrics" ? (
              <div
                className="lyrics-content"
                role="tabpanel"
                id="lyrics-tabpanel"
                aria-labelledby="lyrics-tab"
                tabIndex={0}
              >
                <LyricsView
                  track={current}
                  currentTime={player.currentTime}
                  onSeek={player.seek}
                  onEdit={editLyrics}
                />
              </div>
            ) : (
              <div
                className="queue-content"
                role="tabpanel"
                id="queue-tabpanel"
                aria-labelledby="queue-tab"
                tabIndex={0}
              >
                <div className="queue-heading">
                  <h2>Up next</h2>
                </div>
                <p className="queue-description">
                  A little journey through your sound.
                </p>
                <div className="queue-list">
                  {queueTracks.map((track, index) => (
                    <button
                      key={`${track.id}-${index}`}
                      className={`queue-track ${current?.id === track.id ? "selected" : ""}`}
                      onClick={() => player.play(track, queueTracks)}
                    >
                      <Artwork track={track} />
                      <span>
                        <strong>{track.title}</strong>
                        <small>{track.artist}</small>
                      </span>
                      {current?.id === track.id && player.playing ? (
                        <span className="equalizer">
                          <i />
                          <i />
                          <i />
                        </span>
                      ) : (
                        <Play size={14} />
                      )}
                    </button>
                  ))}
                  {!tracks.length && (
                    <p className="queue-description">
                      Add some music to start your queue.
                    </p>
                  )}
                </div>
              </div>
            )}
          </aside>
        )}
      </div>
      <input
        ref={fileInput}
        type="file"
        accept={acceptAudio}
        multiple
        className="file-input"
        aria-label="Choose audio files"
        onChange={(e) => void handleFiles(Array.from(e.target.files ?? []))}
      />
      <input
        ref={coverInput}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
        className="file-input"
        aria-label="Choose playlist cover"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void saveCover(file);
        }}
      />
      <input
        ref={songCoverInput}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
        className="file-input"
        aria-label="Choose song cover"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void saveSongCover(file);
        }}
      />
      <input
        ref={backgroundImageInput}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
        className="file-input"
        aria-label="Choose custom background"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void saveCustomImage(file, "backgroundImage");
          event.target.value = "";
        }}
      />
      <input
        ref={profileImageInput}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
        className="file-input"
        aria-label="Choose profile photo"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void saveCustomImage(file, "profileImage");
          event.target.value = "";
        }}
      />
      {uploadOpen && (
        <Modal title="Add your music" close={closeUpload}>
          <span className="modal-illustration">
            <ArrowDownToLine size={30} strokeWidth={1.3} />
          </span>
          <span className="section-eyebrow">MAKE YOURSELF AT HOME</span>
          <h2>Bring your own soundtrack.</h2>
          <p>Your favorite songs deserve a good place to live.</p>
          <button
            className="upload-dropzone"
            disabled={uploading}
            onClick={() => fileInput.current?.click()}
            onDragOver={(e: DragEvent) => e.preventDefault()}
          >
            {uploading ? (
              <LoaderCircle className="spin" size={29} />
            ) : (
              <FolderPlus size={29} strokeWidth={1.3} />
            )}
            <strong>
              {uploading
                ? "Making room for your music…"
                : "Drop your songs here"}
            </strong>
            <span>
              {uploading ? (
                "Reading artwork and finding the details."
              ) : (
                <>
                  or <u>choose files</u> from your device
                </>
              )}
            </span>
            <small>MP3, FLAC, WAV, M4A, OGG & more</small>
          </button>
          <div className="upload-privacy">
            <ShieldCheck size={15} />
            <span>
              {remote
                ? "Saved privately to your account. Up to 50 MB per song."
                : "Just yours. Saved in this browser, on this device."}
            </span>
          </div>
        </Modal>
      )}
      {playlistOpen && (
        <Modal title="Create a playlist" close={closePlaylist}>
          <span className="modal-illustration">
            <ListMusic size={30} strokeWidth={1.3} />
          </span>
          <span className="section-eyebrow">A MIX FOR EVERY MOMENT</span>
          <h2>Give the feeling a name.</h2>
          <p>Late-night drives. Slow Sundays. You know the mood.</p>
          <form onSubmit={createPlaylist} className="playlist-form">
            <label htmlFor="playlist-name">Playlist name</label>
            <input
              id="playlist-name"
              autoFocus
              maxLength={70}
              placeholder="Something worth listening to…"
              value={playlistName}
              onChange={(e) => setPlaylistName(e.target.value)}
              required
            />
            <button
              className="button button-dark"
              type="submit"
              disabled={!playlistName.trim()}
            >
              <Plus size={17} />
              Create playlist
            </button>
          </form>
        </Modal>
      )}
      {playlistTarget && !playlistOpen && (
        <Modal title="Add to playlist" close={closePlaylistTarget}>
          <span className="modal-illustration">
            <ListMusic size={30} strokeWidth={1.3} />
          </span>
          <h2>Find its people.</h2>
          <p>Add “{playlistTarget.title}” to a playlist.</p>
          <div className="playlist-picker">
            {playlists.map((p) => (
              <button
                key={p.id}
                onClick={() => addToPlaylist(p, playlistTarget)}
              >
                <span className="playlist-picker-artwork">
                  {playlistCovers.covers[p.id] ? (
                    <img src={playlistCovers.covers[p.id]} alt="" />
                  ) : (
                    <ListMusic size={20} />
                  )}
                </span>
                <span>
                  {p.name}
                  <small>{p.tracks.length} songs</small>
                </span>
                {p.tracks.includes(playlistTarget.id) ? (
                  <Check size={18} />
                ) : (
                  <Plus size={18} />
                )}
              </button>
            ))}
          </div>
          <button
            className="button button-glass"
            onClick={() => setPlaylistOpen(true)}
          >
            <Plus size={17} />
            Create a new playlist
          </button>
        </Modal>
      )}
      {deleteTarget && (
        <Modal title="Remove song" close={closeDelete}>
          <span className="modal-illustration">
            <Music2 size={27} />
          </span>
          <h2>A little room for something new?</h2>
          <p>
            Remove “{deleteTarget.title}” from your library and playlists?{" "}
            {remote
              ? "This removes the account copy. Your original file stays on your device."
              : "The original file stays on your device."}
          </p>
          <div className="modal-actions">
            <button className="button button-glass" onClick={closeDelete}>
              Keep song
            </button>
            <button
              className="button button-dark"
              onClick={() => void remove(deleteTarget)}
            >
              <Trash2 size={16} />
              Remove song
            </button>
          </div>
        </Modal>
      )}
      {deletePlaylist && (
        <Modal title="Delete playlist" close={closeDeletePlaylist}>
          <span className="modal-illustration">
            <ListMusic size={27} />
          </span>
          <h2>Let this mix go?</h2>
          <p>
            Delete “{deletePlaylist.name}”? All its songs will stay in your
            library.
          </p>
          <div className="modal-actions">
            <button
              className="button button-glass"
              onClick={closeDeletePlaylist}
            >
              Keep playlist
            </button>
            <button
              className="button button-dark"
              onClick={() => void removePlaylist(deletePlaylist)}
            >
              <Trash2 size={16} />
              Delete playlist
            </button>
          </div>
        </Modal>
      )}
      {lyricsTarget && (
        <Modal title={`Lyrics for ${lyricsTarget.title}`} close={closeLyrics}>
          <span className="modal-illustration">
            <MicVocal size={28} strokeWidth={1.3} />
          </span>
          <span className="section-eyebrow">WORDS WITH THE MUSIC</span>
          <h2>{lyricsTarget.lyrics ? "Edit lyrics." : "Add lyrics."}</h2>
          <p>
            Paste ordinary lyrics, or use an LRC file with timestamps for live
            highlighting and auto-scroll.
          </p>
          <form
            className="lyrics-form"
            onSubmit={(event) => {
              event.preventDefault();
              void saveLyrics();
            }}
          >
            <div className="lyrics-file-row">
              <input
                ref={lyricsFileInput}
                type="file"
                accept=".lrc,.txt,text/plain"
                className="file-input"
                aria-label="Choose lyrics file"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void readLyricsFile(file);
                  event.target.value = "";
                }}
              />
              <button
                type="button"
                className="button button-glass"
                onClick={() => lyricsFileInput.current?.click()}
              >
                <Upload size={16} />
                Upload LRC or TXT
              </button>
              <span>
                {lyricsDraft
                  ? parseLyrics(lyricsDraft).synced
                    ? "Timed lyrics detected"
                    : "Plain lyrics"
                  : "No lyrics added"}
              </span>
            </div>
            <label htmlFor="song-lyrics">Lyrics</label>
            <textarea
              id="song-lyrics"
              autoFocus
              maxLength={MAX_LYRICS_LENGTH}
              rows={12}
              value={lyricsDraft}
              onChange={(event) => setLyricsDraft(event.target.value)}
              placeholder={"Paste lyrics here…\n\nFor live lyrics, use timestamps like:\n[00:08.50] First line"}
            />
            <div className="lyrics-count">
              <span>{lyricsDraft.length.toLocaleString()} / 100,000</span>
            </div>
            <div className="modal-actions lyrics-actions">
              {lyricsTarget.lyrics && (
                <button
                  type="button"
                  className="button button-glass"
                  disabled={lyricsSaving}
                  onClick={() => void saveLyrics("")}
                >
                  <Trash2 size={16} />
                  Remove lyrics
                </button>
              )}
              <button
                className="button button-dark"
                type="submit"
                disabled={lyricsSaving || !normalizeLyricsText(lyricsDraft)}
              >
                {lyricsSaving ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <Check size={16} />
                )}
                Save lyrics
              </button>
            </div>
          </form>
        </Modal>
      )}
      {settingsOpen && (
        <Modal
          title="Settings"
          close={closeSettings}
          className="settings-modal"
        >
          <span className="modal-illustration">
            <Settings2 size={28} strokeWidth={1.3} />
          </span>
          <span className="section-eyebrow">YOUR LISTENING SPACE</span>
          <h2>Settings</h2>
          <p>Make this space feel right for you.</p>
          <AccountSettings
            beforeLeave={saveCloudState}
            onImported={refreshCloudSongs}
            busy={
              uploading ||
              libraryLoading ||
              !!songCovers.busyId ||
              !!playlistCovers.busyId
            }
          />
          <section
            className="settings-section"
            aria-labelledby="display-heading"
          >
            <div className="settings-section-heading">
              <div>
                <h3 id="display-heading">Interface size</h3>
                <p>Make text, artwork, and controls larger.</p>
              </div>
            </div>
            <div className="scale-control">
              <IconButton
                label="Decrease interface size"
                onClick={() => setScale(scale - 5)}
                disabled={scale <= MIN_SCALE}
              >
                <Minus size={18} />
              </IconButton>
              <output htmlFor="interface-size" aria-live="polite">
                {scale}%
              </output>
              <IconButton
                label="Increase interface size"
                onClick={() => setScale(scale + 5)}
                disabled={scale >= MAX_SCALE}
              >
                <Plus size={18} />
              </IconButton>
            </div>
            <input
              id="interface-size"
              type="range"
              aria-label="Interface size"
              min={MIN_SCALE}
              max={MAX_SCALE}
              step={5}
              value={scale}
              onChange={(event) => setScale(Number(event.target.value))}
              style={
                {
                  "--progress": `${((scale - MIN_SCALE) / (MAX_SCALE - MIN_SCALE)) * 100}%`,
                } as React.CSSProperties
              }
            />
            <div className="scale-presets">
              {[100, DEFAULT_SCALE, 125, 150].map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-label={`Use ${value}% interface size`}
                  aria-pressed={scale === value}
                  onClick={() => setScale(value)}
                >
                  {value}%{value === DEFAULT_SCALE && <small>Default</small>}
                </button>
              ))}
            </div>
            <p className="settings-hint">
              Your size preference stays saved on this device.
            </p>
          </section>
          <section className="settings-section" aria-labelledby="layout-heading">
            <div className="settings-section-heading">
              <div>
                <h3 id="layout-heading">Layout and artwork</h3>
                <p>Choose the player size, spacing, and cover shape.</p>
              </div>
            </div>
            <h4 className="settings-subheading">Player size</h4>
            <div className="choice-grid choice-grid-three">
              {(["compact", "standard", "large"] as const).map((size) => (
                <button type="button" key={size} aria-label={`Use ${size} player`} aria-pressed={customization.playerSize === size} onClick={() => customize({ playerSize: size })}>
                  {size[0].toUpperCase() + size.slice(1)}
                </button>
              ))}
            </div>
            <h4 className="settings-subheading">Artwork shape</h4>
            <div className="choice-grid choice-grid-three">
              {(["square", "rounded", "circle"] as const).map((shape) => (
                <button type="button" key={shape} aria-label={`Use ${shape} artwork`} aria-pressed={customization.artworkShape === shape} onClick={() => customize({ artworkShape: shape })}>
                  {shape[0].toUpperCase() + shape.slice(1)}
                </button>
              ))}
            </div>
            <h4 className="settings-subheading">Spacing</h4>
            <div className="choice-grid choice-grid-three">
              {(["compact", "comfortable", "spacious"] as const).map((density) => (
                <button type="button" key={density} aria-label={`Use ${density} spacing`} aria-pressed={customization.density === density} onClick={() => customize({ density })}>
                  {density[0].toUpperCase() + density.slice(1)}
                </button>
              ))}
            </div>
            <p className="settings-hint">Interface size above controls text and control size; spacing changes the room between items.</p>
          </section>
          <section
            className="settings-section hue-settings"
            aria-labelledby="hue-heading"
          >
            <div className="settings-section-heading">
              <div>
                <h3 id="hue-heading" className="hue-heading">
                  <Palette size={18} /> Background hue
                </h3>
                <p>Tint the glass and ambient light in both themes.</p>
              </div>
              <output htmlFor="background-hue" aria-live="polite">
                {hue}°
              </output>
            </div>
            <div className="hue-preview" aria-hidden="true">
              <span style={{ background: `hsl(${hue} 78% 58%)` }} />
              <span style={{ background: `hsl(${(hue + 58) % 360} 62% 62%)` }} />
            </div>
            <input
              id="background-hue"
              className="hue-slider"
              type="range"
              aria-label="Background hue"
              min={0}
              max={360}
              step={1}
              value={hue}
              onChange={(event) => setHue(Number(event.target.value))}
              style={{ "--current-hue": hue } as React.CSSProperties}
            />
            <div className="hue-presets">
              {huePresets.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  aria-label={`Use ${preset.name} background hue`}
                  aria-pressed={hue === preset.value}
                  onClick={() => setHue(preset.value)}
                >
                  <span
                    className="hue-swatch"
                    style={{ background: `hsl(${preset.value} 72% 57%)` }}
                  />
                  {preset.name}
                </button>
              ))}
            </div>
            <div className="custom-range-row">
              <label htmlFor="glass-intensity">Glass intensity</label>
              <output htmlFor="glass-intensity">{customization.glass}%</output>
            </div>
            <input
              id="glass-intensity"
              type="range"
              aria-label="Glass intensity"
              min={10}
              max={100}
              value={customization.glass}
              onChange={(event) => customize({ glass: Number(event.target.value) })}
              style={{ "--progress": `${customization.glass}%` } as React.CSSProperties}
            />
            <div className="custom-range-row">
              <label htmlFor="accent-hue">Accent colour</label>
              <output htmlFor="accent-hue">{customization.accentHue}°</output>
            </div>
            <input
              id="accent-hue"
              className="hue-slider"
              type="range"
              aria-label="Accent colour"
              min={0}
              max={360}
              value={customization.accentHue}
              onChange={(event) => customize({ accentHue: Number(event.target.value) })}
              style={{ "--current-hue": customization.accentHue } as React.CSSProperties}
            />
            <h4 className="settings-subheading">Background style</h4>
            <div className="choice-grid choice-grid-five">
              {(["liquid", "gradient", "solid", "artwork", "image"] as const).map((style) => (
                <button
                  type="button"
                  key={style}
                  aria-pressed={customization.backgroundStyle === style}
                  onClick={() => customize({ backgroundStyle: style })}
                >
                  {style === "artwork" ? "Album art" : style[0].toUpperCase() + style.slice(1)}
                </button>
              ))}
            </div>
            {customization.backgroundStyle === "image" && (
              <div className="custom-image-controls">
                <button className="button button-glass" type="button" onClick={() => backgroundImageInput.current?.click()}>
                  <Camera size={16} /> {customization.backgroundImage ? "Change background" : "Choose background"}
                </button>
                {customization.backgroundImage && (
                  <button type="button" onClick={() => customize({ backgroundImage: "" })}>Remove</button>
                )}
              </div>
            )}
            {(["image", "artwork"] as const).includes(customization.backgroundStyle as "image" | "artwork") && (
              <div className="background-image-sliders">
                <div className="custom-range-row">
                  <label htmlFor="background-blur">Background blur</label>
                  <output htmlFor="background-blur">{customization.backgroundBlur}px</output>
                </div>
                <input id="background-blur" type="range" aria-label="Background blur" min={0} max={40} value={customization.backgroundBlur} onChange={(event) => customize({ backgroundBlur: Number(event.target.value) })} style={{ "--progress": `${customization.backgroundBlur * 2.5}%` } as React.CSSProperties} />
                <div className="custom-range-row">
                  <label htmlFor="background-dim">Background dim</label>
                  <output htmlFor="background-dim">{customization.backgroundDim}%</output>
                </div>
                <input id="background-dim" type="range" aria-label="Background dim" min={0} max={80} value={customization.backgroundDim} onChange={(event) => customize({ backgroundDim: Number(event.target.value) })} style={{ "--progress": `${customization.backgroundDim * 1.25}%` } as React.CSSProperties} />
              </div>
            )}
            <h4 className="settings-subheading"><Music2 size={16} /> Beat effect</h4>
            <div className="choice-grid">
              {(["off", "soft", "strong", "strobe"] as BeatMode[]).map((mode) => (
                <button type="button" key={mode} aria-label={`Use ${mode} beat effect`} aria-pressed={customization.beatMode === mode} onClick={() => customize({ beatMode: mode })}>
                  {mode[0].toUpperCase() + mode.slice(1)}
                </button>
              ))}
            </div>
            <p className="settings-hint">
              Appearance choices stay saved on this device.
            </p>
          </section>
          <section className="settings-section" aria-labelledby="home-layout-heading">
            <div className="settings-section-heading">
              <div>
                <h3 id="home-layout-heading">Home layout</h3>
                <p>Show, hide, and reorder the sections on Home.</p>
              </div>
            </div>
            <div className="home-layout-list">
              {customization.homeOrder.map((section, index) => (
                <div key={section}>
                  <button
                    type="button"
                    className="settings-switch"
                    role="switch"
                    aria-label={`Show ${section} on Home`}
                    aria-checked={customization.homeVisible[section]}
                    onClick={() => customize({ homeVisible: { ...customization.homeVisible, [section]: !customization.homeVisible[section] } })}
                  ><span /></button>
                  <strong>{section === "weekly" ? "Weekly stats" : section === "top" ? "Top songs" : "Rotation"}</strong>
                  <div>
                    <IconButton label={`Move ${section} up`} disabled={index === 0} onClick={() => moveHomeSection(section, -1)}><ChevronDown className="move-up" size={16} /></IconButton>
                    <IconButton label={`Move ${section} down`} disabled={index === customization.homeOrder.length - 1} onClick={() => moveHomeSection(section, 1)}><ChevronDown size={16} /></IconButton>
                  </div>
                </div>
              ))}
            </div>
          </section>
          <section className="settings-section" aria-labelledby="profile-heading">
            <div className="settings-section-heading">
              <div>
                <h3 id="profile-heading">Profile appearance</h3>
                <p>Add a local photo, greeting, and username colour.</p>
              </div>
            </div>
            <div className="profile-customizer">
              <button type="button" className="profile-photo-button" onClick={() => profileImageInput.current?.click()} aria-label="Change profile photo">
                {customization.profileImage ? <img src={customization.profileImage} alt="" /> : <Camera size={21} />}
              </button>
              <div>
                <button type="button" className="button button-glass" onClick={() => profileImageInput.current?.click()}>{customization.profileImage ? "Change photo" : "Add photo"}</button>
                {customization.profileImage && <button type="button" onClick={() => customize({ profileImage: "" })}>Remove</button>}
              </div>
            </div>
            <label className="custom-text-field" htmlFor="custom-greeting">Home greeting</label>
            <input id="custom-greeting" className="settings-text-input" maxLength={40} placeholder="Home" value={customization.greeting} onChange={(event) => customize({ greeting: event.target.value })} />
            <div className="custom-range-row">
              <label htmlFor="profile-hue">Username colour</label>
              <output htmlFor="profile-hue">{customization.profileHue}°</output>
            </div>
            <input id="profile-hue" className="hue-slider" type="range" aria-label="Username colour" min={0} max={360} value={customization.profileHue} onChange={(event) => customize({ profileHue: Number(event.target.value) })} style={{ "--current-hue": customization.profileHue } as React.CSSProperties} />
          </section>
          <button
            type="button"
            className="settings-reset"
            onClick={() => setCustomization(defaultCustomization)}
          >
            Reset appearance and layout
          </button>
          <div className="info-card">
            <ShieldCheck size={23} strokeWidth={1.4} />
            <div>
              <strong>
                {remote ? "At home in your account" : "At home on this device"}
              </strong>
              <p>
                {remote
                  ? "Your songs, lyrics, favorites, playlists, and covers are saved to your account. Sign in on another device to open your library."
                  : "Your songs, lyrics, playlist covers, and preferences stay in this browser. Clearing site data removes this library."}
              </p>
            </div>
          </div>
          <div className="info-stats">
            <div>
              <strong>{uploaded.length}</strong>
              <span>songs of your own</span>
            </div>
            <div>
              <strong>
                {(
                  uploaded.reduce((sum, t) => sum + t.size, 0) /
                  1024 /
                  1024
                ).toFixed(1)}{" "}
                <small>MB</small>
              </strong>
              <span>of good company</span>
            </div>
          </div>
          <button
            className="button button-dark"
            onClick={() => {
              setSettingsOpen(false);
              setUploadOpen(true);
            }}
          >
            <Plus size={17} />
            Bring some music
          </button>
        </Modal>
      )}
      {dragging && (
        <div className="drag-overlay">
          <div>
            <Upload size={44} strokeWidth={1.2} />
            <h2>A good place for your music.</h2>
            <p>Drop your songs anywhere to add them.</p>
          </div>
        </div>
      )}
      {toast && (
        <div
          className={`toast ${toast.error ? "toast-error" : ""}`}
          role={toast.error ? "alert" : "status"}
        >
          {toast.error ? <Music2 size={18} /> : <Check size={18} />}
          <span>{toast.message}</span>
          <IconButton
            label="Dismiss notification"
            onClick={() => setToast(null)}
          >
            <X size={16} />
          </IconButton>
        </div>
      )}
    </>
  );
}
