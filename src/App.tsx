import { useCallback, useEffect, useRef, useState } from "react";
import type { DragEvent, ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronDown,
  Disc3,
  FolderPlus,
  Headphones,
  Heart,
  Library,
  ListMusic,
  LoaderCircle,
  Menu,
  MoreHorizontal,
  Moon,
  Music2,
  Pause,
  Play,
  Plus,
  Repeat,
  Repeat1,
  Search,
  ShieldCheck,
  Shuffle,
  SkipBack,
  SkipForward,
  Sun,
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
import { usePlayer } from "./lib/usePlayer";
import { useTheme } from "./lib/useTheme";

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
function time(seconds: number) {
  const n = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
}

function Artwork({
  track,
  className = "",
}: {
  track?: Track | null;
  className?: string;
}) {
  return (
    <div
      className={`artwork ${className}`}
      style={{ backgroundColor: track?.color ?? "var(--artwork-placeholder)" }}
    >
      {track?.artwork ? (
        <img src={track.artwork} alt="" loading="lazy" />
      ) : (
        <>
          <span className="artwork-orbit" />
          <Disc3 size={32} strokeWidth={1.1} />
        </>
      )}
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
            'button:not(:disabled), input, [tabindex="0"]',
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
  const { theme, toggleTheme } = useTheme();
  const [uploaded, setUploaded] = useState<Track[]>([]);
  const [demoFavorites, setDemoFavorites] = useState<string[]>(() =>
    readSaved("media-demo-favorites", []),
  );
  const [hiddenDemos, setHiddenDemos] = useState<string[]>(() =>
    readSaved("media-hidden-demos", []),
  );
  const [playlists, setPlaylists] = useState<Playlist[]>(() =>
    readSaved("media-playlists", []),
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
  const [deleteTarget, setDeleteTarget] = useState<Track | null>(null);
  const [deletePlaylist, setDeletePlaylist] = useState<Playlist | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const dragCount = useRef(0);
  const player = usePlayer();
  const tracks = [
    ...uploaded,
    ...demos
      .filter((t) => !hiddenDemos.includes(t.id))
      .map((t) => ({ ...t, favorite: demoFavorites.includes(t.id) })),
  ];
  const activePlaylist = playlists.find((p) => p.id === view);
  const notify = useCallback(
    (message: string, error = false) => setToast({ message, error }),
    [],
  );

  useEffect(() => {
    listTracks()
      .then(setUploaded)
      .catch(() =>
        notify(
          "Your library could not be opened. Check that browser storage is available.",
          true,
        ),
      )
      .finally(() => setLibraryLoading(false));
  }, [notify]);
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
        const result = await importFiles(files);
        setUploaded(await listTracks());
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
    [uploading, notify],
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
        store("media-demo-favorites", next);
      } else {
        const updated = await updateTrack(track.id, {
          favorite: !track.favorite,
        });
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
      if (track.source === "demo") {
        const next = [...hiddenDemos, track.id];
        setHiddenDemos(next);
        store("media-hidden-demos", next);
      } else {
        await deleteTrack(track.id);
        setUploaded((previous) => previous.filter((t) => t.id !== track.id));
      }
      if (player.current?.id === track.id) player.stop();
      player.removeFromQueue(track.id);
      const next = playlists.map((p) => ({
        ...p,
        tracks: p.tracks.filter((id) => id !== track.id),
      }));
      setPlaylists(next);
      store("media-playlists", next);
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
    store("media-playlists", next);
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
    store("media-playlists", next);
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
    store("media-playlists", next);
    notify("Song removed from playlist.");
  }

  let visible =
    view === "library"
      ? uploaded
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
  visible = [...visible].sort((a, b) =>
    sort === "title"
      ? a.title.localeCompare(b.title)
      : sort === "artist"
        ? a.artist.localeCompare(b.artist)
        : b.addedAt - a.addedAt,
  );
  const title =
    view === "home"
      ? "Listen now"
      : view === "library"
        ? "Your library"
        : view === "favorites"
          ? "Favorites"
          : (activePlaylist?.name ?? "Your library");
  const current =
    tracks.find((t) => t.id === player.current?.id) ?? player.current;
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
  const closeInfo = useCallback(() => setInfoOpen(false), []);

  return (
    <>
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
                <Headphones size={19} />
                Listen now{view === "home" && <span className="nav-dot" />}
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
              {playlists.length ? (
                playlists.map((p) => (
                  <button
                    key={p.id}
                    className={`nav-item playlist-item ${view === p.id ? "selected" : ""}`}
                    onClick={() => navigate(p.id)}
                  >
                    <span className="playlist-icon">
                      <ListMusic size={15} />
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
              onClick={() => setInfoOpen(true)}
            >
              <span className="status-dot" />
              Stored on this device
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
                onClick={() => setInfoOpen(true)}
                aria-label="About your listening space"
              >
                <Headphones size={18} />
              </button>
            </div>
          </header>
          <div className="page-content">
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
            {view === "home" && !search && (
              <>
                <section
                  className="hero"
                  aria-label="Welcome to your music space"
                >
                  <div className="hero-copy">
                    <span className="hero-eyebrow">
                      <span />
                      LESS SCROLLING. MORE LISTENING.
                    </span>
                    <h2>
                      A little space
                      <br />
                      for your sound.
                    </h2>
                    <p>
                      The songs you love, in a place that feels like you.
                      <br className="desktop-break" /> Bring your collection.
                      Find your flow.
                    </p>
                    <button
                      className="button button-dark"
                      onClick={() => setUploadOpen(true)}
                    >
                      <Upload size={16} />
                      Upload your music
                      <ArrowRight size={16} />
                    </button>
                    <div className="hero-formats">
                      MP3, FLAC, WAV & all your favorites
                    </div>
                  </div>
                  <div className="hero-visual" aria-hidden="true">
                    <div className="hero-orbit orbit-1" />
                    <div className="hero-orbit orbit-2" />
                    <div className="hero-spark spark-one">✧</div>
                    <div className="hero-spark spark-two">✦</div>
                    <div className="vinyl">
                      <div className="vinyl-groove" />
                      <div className="vinyl-label">
                        <span />
                      </div>
                    </div>
                    <div className="hero-cover">
                      <div className="hero-cover-sky" />
                      <div className="hero-cover-sun" />
                      <div className="hero-cover-hill hill-back" />
                      <div className="hero-cover-hill hill-front" />
                      <span className="hero-cover-label">
                        a feeling
                        <br />
                        on repeat.
                      </span>
                      <span className="cover-bottom">
                        VOLUME 01 <span>33⅓ RPM</span>
                      </span>
                    </div>
                    <div className="floating-sound">
                      <span className="sound-icon">
                        <Music2 size={18} />
                      </span>
                      <div>
                        <span>YOUR MUSIC, YOUR MOOD</span>
                        <strong>A good place to get lost.</strong>
                      </div>
                      <div className="mini-wave">
                        {[8, 18, 12, 24, 15, 20, 9].map((n, i) => (
                          <span key={i} style={{ height: n }} />
                        ))}
                      </div>
                    </div>
                  </div>
                </section>
                <section className="discovery-section">
                  <div className="section-heading">
                    <div>
                      <h2>
                        A little inspiration
                        <span className="tiny-spark">✦</span>
                      </h2>
                      <p>Some original sounds to settle into.</p>
                    </div>
                  </div>
                  <div className="album-grid">
                    {demos
                      .filter((t) => !hiddenDemos.includes(t.id))
                      .map((raw) => {
                        const track =
                          tracks.find((t) => t.id === raw.id) ?? raw;
                        const isPlaying =
                          current?.id === track.id && player.playing;
                        return (
                          <article className="album-card" key={track.id}>
                            <button
                              className={`album-art-button ${isPlaying ? "is-playing" : ""}`}
                              onClick={() => player.play(track, tracks)}
                              aria-label={`${isPlaying ? "Pause" : "Play"} ${track.title}`}
                            >
                              <Artwork track={track} />
                              <span className="demo-label">ORIGINAL DEMO</span>
                              <span className="album-play">
                                {isPlaying ? (
                                  <Pause size={20} fill="currentColor" />
                                ) : (
                                  <Play size={20} fill="currentColor" />
                                )}
                              </span>
                            </button>
                            <div className="album-caption">
                              <div>
                                <h3>{track.title}</h3>
                                <p>
                                  {track.id === "demo-soft-focus"
                                    ? "A softer kind of day"
                                    : track.id === "demo-blue-hour"
                                      ? "For the in-between hours"
                                      : "Stay a little longer"}
                                </p>
                              </div>
                              <IconButton
                                label={`${track.favorite ? "Unfavorite" : "Favorite"} ${track.title}`}
                                active={track.favorite}
                                onClick={() => void favorite(track)}
                              >
                                <Heart
                                  size={17}
                                  fill={
                                    track.favorite ? "currentColor" : "none"
                                  }
                                />
                              </IconButton>
                            </div>
                          </article>
                        );
                      })}
                    <button
                      className="add-album"
                      onClick={() => setUploadOpen(true)}
                    >
                      <span className="add-album-symbol">
                        <Plus size={26} strokeWidth={1.2} />
                      </span>
                      <strong>Your next favorite</strong>
                      <span>is already yours.</span>
                      <span className="add-album-link">
                        Add your own music
                        <ArrowRight size={14} />
                      </span>
                    </button>
                  </div>
                </section>
              </>
            )}
            {view !== "home" && (
              <section
                className={`collection-banner ${view === "favorites" ? "favorite-banner" : ""}`}
              >
                <span className="collection-banner-icon">
                  {view === "favorites" ? (
                    <Heart size={35} strokeWidth={1.2} fill="currentColor" />
                  ) : activePlaylist ? (
                    <ListMusic size={37} strokeWidth={1.3} />
                  ) : (
                    <Library size={37} strokeWidth={1.3} />
                  )}
                </span>
                <div>
                  <span className="section-eyebrow">
                    {activePlaylist
                      ? "YOUR PLAYLIST"
                      : view === "favorites"
                        ? "A LITTLE CLOSER TO THE HEART"
                        : "COLLECT MOMENTS, KEEP THE MUSIC"}
                  </span>
                  <h2>
                    {view === "favorites"
                      ? "The ones you come back to."
                      : activePlaylist
                        ? activePlaylist.name
                        : "Every song has a home."}
                  </h2>
                  <p>
                    {visible.length} {visible.length === 1 ? "song" : "songs"}
                    {totalDuration > 0 &&
                      ` · ${Math.max(1, Math.round(totalDuration / 60))} min of good company`}
                  </p>
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
            <section className="tracks-section">
              <div className="section-heading tracks-heading">
                <div>
                  <h2>
                    {search
                      ? "Search results"
                      : view === "home"
                        ? "In your rotation"
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
                    <span className="date-column">ADDED</span>
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
                          {track.source === "demo"
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
                                setMenuTrack(
                                  menuTrack === track.id ? null : track.id,
                                );
                              }}
                            >
                              <MoreHorizontal size={19} />
                            </IconButton>
                            {menuTrack === track.id && (
                              <div className="track-menu">
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
                      : view === "favorites"
                        ? "Keep the good ones close."
                        : activePlaylist
                          ? "Every good mix starts somewhere."
                          : "Your collection starts with you."}
                  </h3>
                  <p>
                    {search
                      ? `No songs match “${search}”. Try another title or artist.`
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
            <Artwork track={current} />
            <div className="now-playing-info">
              <strong>{current?.title ?? "Find your next feeling"}</strong>
              <span>{current?.artist ?? "Pick a song. Make a moment."}</span>
            </div>
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
              active={queueOpen}
              aria-expanded={queueOpen}
              onClick={() => setQueueOpen(!queueOpen)}
            >
              <ListMusic size={20} />
            </IconButton>
          </div>
        </footer>
        {queueOpen && (
          <aside className="queue-panel" aria-label="Play queue">
            <div className="queue-heading">
              <div>
                <span className="section-eyebrow">KEEP THE FEELING GOING</span>
                <h2>Up next</h2>
              </div>
              <IconButton
                label="Close queue"
                onClick={() => setQueueOpen(false)}
              >
                <X size={19} />
              </IconButton>
            </div>
            <p className="queue-description">
              A little journey through your sound.
            </p>
            <div className="queue-list">
              {(player.queue.length ? player.queue : tracks)
                .filter((t) => tracks.some((existing) => existing.id === t.id))
                .map((track, index) => (
                  <button
                    key={`${track.id}-${index}`}
                    className={`queue-track ${current?.id === track.id ? "selected" : ""}`}
                    onClick={() =>
                      player.play(
                        track,
                        player.queue.length ? player.queue : tracks,
                      )
                    }
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
            <span>Just yours. Saved in this browser, on this device.</span>
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
                <ListMusic size={20} />
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
            Remove “{deleteTarget.title}” from your library and playlists? Your
            original file stays on your device.
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
              onClick={() => {
                const next = playlists.filter(
                  (p) => p.id !== deletePlaylist.id,
                );
                setPlaylists(next);
                store("media-playlists", next);
                setDeletePlaylist(null);
                navigate("home");
                notify("Playlist deleted. Your music is still here.");
              }}
            >
              <Trash2 size={16} />
              Delete playlist
            </button>
          </div>
        </Modal>
      )}
      {infoOpen && (
        <Modal title="Your listening space" close={closeInfo}>
          <span className="modal-illustration">
            <Headphones size={30} strokeWidth={1.3} />
          </span>
          <span className="section-eyebrow">A PLACE THAT’S JUST YOURS</span>
          <h2>Your music. Your space.</h2>
          <p>
            Upload your own songs, make a few mixes, and stay for a while. No
            account needed.
          </p>
          <div className="info-card">
            <ShieldCheck size={23} strokeWidth={1.4} />
            <div>
              <strong>At home on this device</strong>
              <p>
                Your uploads are saved in this browser. They stay here when you
                return, but won’t sync to other devices. Clearing browser data
                removes this library.
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
              setInfoOpen(false);
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
