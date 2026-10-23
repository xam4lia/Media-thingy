import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseBlob } from 'music-metadata';
import { deleteTrack, getTrackBlob, importFiles, listTracks, updateTrack } from './library';

vi.mock('music-metadata', () => ({ parseBlob: vi.fn() }));

const metadata = {
  common: { title: 'A little sunlight', artist: 'An artist', album: 'An album' },
  format: { duration: 122.5 },
};

beforeEach(async () => {
  vi.mocked(parseBlob).mockReset();
  vi.mocked(parseBlob).mockResolvedValue(metadata as Awaited<ReturnType<typeof parseBlob>>);
  await Promise.all((await listTracks()).map((track) => deleteTrack(track.id)));
});

describe('local music library', () => {
  it('stores an uploaded audio file, its tags, and its bytes for a subsequent visit', async () => {
    const file = new File(['audio bytes'], 'sunlight.mp3', { type: 'audio/mpeg', lastModified: 42 });
    const result = await importFiles([file]);
    expect(result.errors).toEqual([]);
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0]).toMatchObject({ title: 'A little sunlight', artist: 'An artist', album: 'An album', duration: 122.5, source: 'upload' });
    const saved = await listTracks();
    expect(saved).toEqual(result.tracks);
    expect(await (await getTrackBlob(saved[0].id))?.text()).toBe('audio bytes');
    expect(saved[0]).not.toHaveProperty('fingerprint');
  });

  it('rejects a duplicate without losing the first copy', async () => {
    const file = new File(['song'], 'song.flac', { lastModified: 123 });
    await importFiles([file]);
    const repeated = await importFiles([file]);
    expect(repeated.tracks).toEqual([]);
    expect(repeated.errors[0]).toContain('already in your library');
    expect(await listTracks()).toHaveLength(1);
  });

  it('does not create duplicate songs when two imports happen at once', async () => {
    const file = new File(['song'], 'concurrent.mp3', { lastModified: 123 });
    const results = await Promise.all([importFiles([file]), importFiles([file])]);
    expect(results.flatMap((result) => result.tracks)).toHaveLength(1);
    expect(results.flatMap((result) => result.errors)[0]).toContain('already in your library');
    expect(await listTracks()).toHaveLength(1);
  });

  it('continues importing valid songs when other files are empty or not audio', async () => {
    const result = await importFiles([
      new File(['hello'], 'notes.txt', { type: 'text/plain' }),
      new File([], 'empty.mp3', { type: 'audio/mpeg' }),
      new File(['audio'], 'valid.wav', { type: 'audio/wav' }),
    ]);
    expect(result.tracks).toHaveLength(1);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toContain('choose an audio file');
    expect(result.errors[1]).toContain('empty');
  });

  it('persists favorite changes and deletes both song metadata and audio', async () => {
    const { tracks: [track] } = await importFiles([new File(['audio'], 'favorite.ogg')]);
    expect(await updateTrack(track.id, { favorite: true })).toMatchObject({ favorite: true });
    expect((await listTracks())[0].favorite).toBe(true);
    await deleteTrack(track.id);
    expect(await listTracks()).toEqual([]);
    expect(await getTrackBlob(track.id)).toBeNull();
    await expect(updateTrack(track.id, { favorite: false })).rejects.toThrow('no longer in your library');
  });

  it('saves normalized lyrics with a song and removes them again', async () => {
    const { tracks: [track] } = await importFiles([new File(['audio'], 'lyrics.ogg')]);
    expect(await updateTrack(track.id, { lyrics: '[00:01.00] First\r\n[00:02.00] Second ' })).toMatchObject({
      lyrics: '[00:01.00] First\n[00:02.00] Second',
    });
    expect((await listTracks())[0].lyrics).toContain('Second');
    expect(await updateTrack(track.id, { lyrics: '  ' })).not.toHaveProperty('lyrics');
  });

  it('uses the filename when the audio has no title tag and stores embedded artwork', async () => {
    vi.mocked(parseBlob).mockResolvedValue({ common: { picture: [{ format: 'image/png', data: new Uint8Array([1, 2, 3]) }] }, format: { duration: 42 } } as Awaited<ReturnType<typeof parseBlob>>);
    const { tracks: [track] } = await importFiles([new File(['audio'], 'My recording.m4a')]);
    expect(track).toMatchObject({ title: 'My recording', artist: 'Unknown artist', artwork: 'data:image/png;base64,AQID' });
  });

  it('reports unreadable audio rather than storing a broken file', async () => {
    vi.mocked(parseBlob).mockRejectedValue(new Error('Invalid audio'));
    const result = await importFiles([new File(['not actually an mp3'], 'broken.mp3')]);
    expect(result.tracks).toEqual([]);
    expect(result.errors[0]).toContain('audio could not be read');
    expect(await listTracks()).toEqual([]);
  });

  it('rejects malformed audio even when the actual parser resolves an empty format', async () => {
    const actual = await vi.importActual<typeof import('music-metadata')>('music-metadata');
    vi.mocked(parseBlob).mockImplementation(actual.parseBlob);
    const result = await importFiles([
      new File(['not a valid waveform'], 'broken.wav', { type: 'audio/wav' }),
      new File(['not valid MPEG audio'], 'broken.mp3', { type: 'audio/mpeg' }),
    ]);
    expect(result.tracks).toEqual([]);
    expect(result.errors).toHaveLength(2);
    expect(result.errors.every((error) => error.includes('audio could not be read'))).toBe(true);
    expect(await listTracks()).toEqual([]);
  });

  it('keeps browser-playable audio when tags cannot be parsed', async () => {
    vi.mocked(parseBlob).mockRejectedValue(new Error('Unsupported tag format'));
    const audio = {
      duration: 23,
      onloadedmetadata: null as (() => void) | null,
      onerror: null as (() => void) | null,
      preload: '',
      removeAttribute: vi.fn(),
      load: vi.fn(),
      set src(_value: string) { queueMicrotask(() => this.onloadedmetadata?.()); },
    };
    vi.stubGlobal('document', { createElement: () => audio });
    try {
      const { tracks, errors } = await importFiles([new File(['browser-playable audio'], 'Recording.opus', { type: 'audio/ogg' })]);
      expect(errors).toEqual([]);
      expect(tracks[0]).toMatchObject({ title: 'Recording', duration: 23 });
      expect(audio.removeAttribute).toHaveBeenCalledWith('src');
      expect(audio.load).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('imports an actual WAV through the installed metadata parser', async () => {
    const actual = await vi.importActual<typeof import('music-metadata')>('music-metadata');
    vi.mocked(parseBlob).mockImplementation(actual.parseBlob);
    const sampleRate = 8000;
    const sampleCount = 800;
    const bytes = new Uint8Array(44 + sampleCount * 2);
    const view = new DataView(bytes.buffer);
    const text = (offset: number, value: string) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
    text(0, 'RIFF');
    view.setUint32(4, bytes.length - 8, true);
    text(8, 'WAVE');
    text(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    text(36, 'data');
    view.setUint32(40, sampleCount * 2, true);
    const { tracks, errors } = await importFiles([new File([bytes], 'Recording.wav', { type: 'audio/wav' })]);
    expect(errors).toEqual([]);
    expect(tracks[0]).toMatchObject({ title: 'Recording', duration: 0.1, source: 'upload' });
    expect((await getTrackBlob(tracks[0].id))?.size).toBe(bytes.length);
  });
});
