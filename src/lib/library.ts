import { parseBlob } from 'music-metadata';

export type Track = {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  artwork?: string;
  color: string;
  addedAt: number;
  favorite: boolean;
  fileName: string;
  size: number;
  source: 'upload' | 'demo';
  url?: string;
};

export type TrackPatch = Partial<Pick<Track, 'title' | 'artist' | 'album' | 'favorite'>>;

type StoredTrack = Track & { fingerprint: string };

const DATABASE_NAME = 'media-thingy-library';
const DATABASE_VERSION = 1;
const AUDIO_EXTENSIONS = /\.(mp3|wav|wave|m4a|aac|ogg|oga|flac|webm|opus|aiff|aif|mp4)$/i;
const COVER_COLORS = ['#d5c7e8', '#c4d5dd', '#e8c8b9', '#cbd7bd', '#d8c7c3', '#c5cbed'];
let databasePromise: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) {
    return Promise.reject(new Error('Your browser cannot save music locally. Try a current browser with site storage enabled.'));
  }
  if (!databasePromise) {
    databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      let blocked = false;
      request.onupgradeneeded = () => {
        const database = request.result;
        const tracks = database.createObjectStore('tracks', { keyPath: 'id' });
        tracks.createIndex('fingerprint', 'fingerprint', { unique: true });
        database.createObjectStore('audio');
      };
      request.onsuccess = () => {
        const database = request.result;
        if (blocked) {
          database.close();
          return;
        }
        database.onversionchange = () => {
          database.close();
          databasePromise = undefined;
        };
        resolve(database);
      };
      request.onerror = () => reject(new Error('Your music library could not be opened. Check that site storage is enabled.'));
      request.onblocked = () => {
        blocked = true;
        reject(new Error('Close other Media-thingy tabs, then try opening your library again.'));
      };
    }).catch((error: unknown) => {
      databasePromise = undefined;
      throw error;
    });
  }
  return databasePromise;
}

function readRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('The music library could not be read.'));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('The music library could not be saved.'));
  });
}

function publicTrack(track: StoredTrack): Track {
  const { fingerprint: _fingerprint, ...result } = track;
  return result;
}

function fingerprint(file: File): string {
  return `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
}

function coverColor(fileName: string): string {
  let hash = 0;
  for (const character of fileName) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return COVER_COLORS[(hash >>> 0) % COVER_COLORS.length];
}

function artworkDataUrl(pictures: { format: string; data: Uint8Array }[] | undefined): string | undefined {
  const picture = pictures?.find((item) => /^image\/(jpeg|jpg|png|webp|gif|avif)$/i.test(item.format) && item.data.length <= 5_000_000);
  if (!picture) return undefined;
  let binary = '';
  for (let offset = 0; offset < picture.data.length; offset += 8192) {
    binary += String.fromCharCode(...picture.data.subarray(offset, offset + 8192));
  }
  return `data:${picture.format};base64,${btoa(binary)}`;
}

function browserDuration(file: File): Promise<number> {
  if (typeof document === 'undefined') return Promise.resolve(0);
  return new Promise((resolve) => {
    const audio = document.createElement('audio');
    const url = URL.createObjectURL(file);
    let finished = false;
    const finish = (duration: number) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      audio.onloadedmetadata = null;
      audio.onerror = null;
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(duration) && duration > 0 ? duration : 0);
    };
    const timeout = setTimeout(() => finish(0), 8000);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => finish(audio.duration);
    audio.onerror = () => finish(0);
    audio.src = url;
  });
}

/** Uploaded music stays in this browser's IndexedDB, including the original audio. */
export async function listTracks(): Promise<Track[]> {
  const database = await openDatabase();
  const transaction = database.transaction('tracks', 'readonly');
  const tracks = await readRequest<StoredTrack[]>(transaction.objectStore('tracks').getAll());
  return tracks.map(publicTrack).sort((a, b) => b.addedAt - a.addedAt || a.title.localeCompare(b.title));
}

/** Imports independently so one unsupported or duplicate file cannot discard other songs. */
export async function importFiles(files: File[]): Promise<{ tracks: Track[]; errors: string[] }> {
  const tracks: Track[] = [];
  const errors: string[] = [];
  const database = await openDatabase();
  for (const file of files) {
    if (!file.type.startsWith('audio/') && !AUDIO_EXTENSIONS.test(file.name)) {
      errors.push(`${file.name}: choose an audio file such as MP3, M4A, WAV, OGG, or FLAC.`);
      continue;
    }
    if (!file.size) {
      errors.push(`${file.name}: this file is empty.`);
      continue;
    }
    try {
      const fileFingerprint = fingerprint(file);
      const lookup = database.transaction('tracks', 'readonly');
      const existing = await readRequest(lookup.objectStore('tracks').index('fingerprint').getKey(fileFingerprint));
      if (existing !== undefined) {
        errors.push(`${file.name} is already in your library.`);
        continue;
      }
      let title = file.name.replace(/\.[^.]+$/, '');
      let artist = 'Unknown artist';
      let album = 'Your uploads';
      let duration = 0;
      let artwork: string | undefined;
      let hasAudioEvidence = false;
      try {
        const metadata = await parseBlob(file, { duration: true });
        title = metadata.common.title?.trim() || title;
        artist = metadata.common.artist?.trim() || metadata.common.artists?.join(', ') || artist;
        album = metadata.common.album?.trim() || album;
        duration = metadata.format.duration ?? 0;
        artwork = artworkDataUrl(metadata.common.picture);
        // A parser can resolve with an empty format for malformed bytes when the
        // file supplies an audio MIME type. Resolution alone does not validate audio.
        hasAudioEvidence = Boolean(metadata.format.codec && metadata.format.container && metadata.format.hasAudio !== false);
      } catch {
        // Some browser-playable formats have incomplete tags. Use the filename and decoder.
      }
      if (!Number.isFinite(duration) || duration <= 0) duration = await browserDuration(file);
      if (!hasAudioEvidence && !duration) {
        errors.push(`${file.name}: the audio could not be read. Try another copy or format.`);
        continue;
      }
      const track: StoredTrack = {
        id: crypto.randomUUID(),
        title,
        artist,
        album,
        duration,
        ...(artwork ? { artwork } : {}),
        color: coverColor(file.name),
        addedAt: Date.now(),
        favorite: false,
        fileName: file.name,
        size: file.size,
        source: 'upload',
        fingerprint: fileFingerprint,
      };
      const transaction = database.transaction(['tracks', 'audio'], 'readwrite');
      const complete = transactionComplete(transaction);
      transaction.objectStore('tracks').add(track);
      transaction.objectStore('audio').add(file, track.id);
      await complete;
      tracks.push(publicTrack(track));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        errors.push(`${file.name}: your browser storage is full. Remove a few songs or free some device space.`);
      } else if (error instanceof DOMException && error.name === 'ConstraintError') {
        errors.push(`${file.name} is already in your library.`);
      } else {
        errors.push(`${file.name}: could not save this song. Check your browser's site storage and try again.`);
      }
    }
  }
  return { tracks, errors };
}

export async function getTrackBlob(id: string): Promise<Blob | null> {
  const database = await openDatabase();
  const transaction = database.transaction('audio', 'readonly');
  return (await readRequest<Blob | undefined>(transaction.objectStore('audio').get(id))) ?? null;
}

export async function deleteTrack(id: string): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(['tracks', 'audio'], 'readwrite');
  const complete = transactionComplete(transaction);
  transaction.objectStore('tracks').delete(id);
  transaction.objectStore('audio').delete(id);
  await complete;
}

export async function updateTrack(id: string, patch: TrackPatch): Promise<Track> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('tracks', 'readwrite');
    const store = transaction.objectStore('tracks');
    const request: IDBRequest<StoredTrack | undefined> = store.get(id);
    let updated: StoredTrack | undefined;
    request.onsuccess = () => {
      if (!request.result) {
        transaction.abort();
        return;
      }
      updated = { ...request.result };
      if (typeof patch.favorite === 'boolean') updated.favorite = patch.favorite;
      for (const field of ['title', 'artist', 'album'] as const) {
        const value = patch[field]?.trim();
        if (value) updated[field] = value;
      }
      store.put(updated);
    };
    transaction.oncomplete = () => updated ? resolve(publicTrack(updated)) : reject(new Error('This song is no longer in your library.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('This song is no longer in your library.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('The song could not be updated.'));
  });
}
