/**
 * Unified Song Library (B1–B4)
 * Dexie database: 'musicManagerLibrary'
 * Lazy initialization (no top-level await to prevent white-screen TDZ).
 */
import Dexie, { type Table } from 'dexie';
import Database from '@tauri-apps/plugin-sql';

import { compareFingerprints } from '../../shared/acousticFingerprint';
import { type DuplicatePair, findFingerprintDuplicatePairs } from '../../shared/duplicateDetection';

export interface Song {
  id: string; // uuid
  title: string;
  artist: string;
  album?: string;
  durationSec: number;
  normKey: string;
  youtubeId?: string;
  coverPath?: string;
  primaryColor?: string;
  backgroundColor?: string;
  /** Acoustic fingerprint (loudness envelope) used to recognise the recording. */
  fingerprint?: string;
  fingerprintDurationSec?: number;
  lastPositionSec?: number;
  lastPlayedAt?: number;
  createdAt: number;
}

export interface Variant {
  id: string;
  songId: string;
  kind: 'audio' | 'video' | 'lyrics';
  source: 'local' | 'youtube' | 'download';
  path?: string;
  url?: string;
  container?: string;
  bitrateKbps?: number;
  height?: number;
  /** Normalized codec name (h264, av01, vp9, aac, opus, …). */
  codec?: string;
  /** Exact yt-dlp format id this variant was downloaded from. */
  formatId?: string;
  sizeBytes?: number;
  addedAt: number;
}

export interface PlaybackPositionRecord {
  key: string;
  positionSec: number;
  updatedAt: number;
}

export interface IngestTrackInput {
  path: string;
  title: string;
  artist: string;
  album?: string;
  durationSec: number;
  bitrate?: number;
  container?: string;
  hasVideo?: boolean;
  youtubeId?: string;
  fingerprint?: string;
  fingerprintDurationSec?: number;
}

export interface IngestResult {
  songId: string;
  matched: 'exact' | 'fuzzy' | 'fingerprint' | 'new';
  candidates?: Song[];
}

export class MusicManagerLibraryDB extends Dexie {
  songs!: Table<Song, string>;
  variants!: Table<Variant, string>;
  playbackPositions!: Table<PlaybackPositionRecord, string>;

  constructor(customIndexedDB?: any) {
    super('musicManagerLibrary', customIndexedDB ? { indexedDB: customIndexedDB } : undefined);

    this.version(2).stores({
      songs: '&id, normKey, youtubeId, fingerprint, createdAt',
      variants: '&id, songId, path, kind, addedAt',
      playbackPositions: '&key, updatedAt'
    });
  }
}

let dbInstance: MusicManagerLibraryDB | null = null;

export function getLibraryDB(customIndexedDB?: any): MusicManagerLibraryDB {
  if (customIndexedDB) {
    return new MusicManagerLibraryDB(customIndexedDB);
  }
  if (!dbInstance) {
    dbInstance = new MusicManagerLibraryDB();
  }
  return dbInstance;
}

export function resetLibraryDBInstance(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

/**
 * UUID generator with fallback
 */
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Strip bracketed tags such as (Official Video), (Lyrics), [HD], (Remastered 2011)
 * and featuring credits like (feat. Artist), [ft. Artist].
 */
export function stripBracketsAndTags(text: string): string {
  if (!text) return '';

  let cleaned = text;

  // Bracket keywords to strip when inside (), [], or {}
  const bracketKeywords = [
    'official\\s*video',
    'official\\s*music\\s*video',
    'official\\s*audio',
    'official\\s*lyric\\s*video',
    'official',
    'music\\s*video',
    'video',
    'audio',
    'lyrics?',
    'lyric\\s*video',
    'hd',
    'hq',
    '4k',
    '1080p',
    'remaster(?:ed)?(?:\\s*\\d+)?',
    '\\d+\\s*remaster(?:ed)?',
    'mv',
    'visualizer',
    'live(?:\\s+at\\s+.*)?',
    'clip',
    'version',
    'edit',
    'deluxe(?:\\s+edition)?',
    'bonus(?:\\s+track)?',
    'explicit',
    'clean',
    'feat\\.?',
    'ft\\.?',
    'featuring'
  ].join('|');

  const bracketRegex = new RegExp(
    `[\\(\\[\\{][^\\)\\]\\}]*?(?:${bracketKeywords})[^\\)\\]\\}]*?[\\)\\]\\}]`,
    'gi'
  );

  let prev = '';
  while (prev !== cleaned) {
    prev = cleaned;
    cleaned = cleaned.replace(bracketRegex, ' ');
  }

  // Strip trailing hyphen/dash suffixes like "- Remastered 2011", "- Official Video", "- Lyrics"
  cleaned = cleaned.replace(
    /\s*[-–—]\s*(?:official\s*(?:video|audio|music\s*video|track)?|lyrics?|remaster(?:ed)?(?:\s*\d+)?|\d+\s*remaster(?:ed)?|hd|4k|mv|audio)\s*$/gi,
    ' '
  );

  // Strip remaining unbracketed featuring credits, e.g. "feat. Rihanna", "ft. DaBaby", "featuring Drake"
  cleaned = cleaned.replace(/\s*(?:feat\.?|ft\.?|featuring)\b.*$/gi, ' ');

  return cleaned;
}

/**
 * Remove punctuation, normalize whitespace and lowercase
 */
export function cleanString(text: string): string {
  if (!text) return '';
  const withoutBrackets = stripBracketsAndTags(text);
  // Replace punctuation characters with space
  const noPunct = withoutBrackets.replace(/[^\p{L}\p{N}\s]/gu, ' ');
  // Collapse whitespace and trim, lowercase
  return noPunct.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Compute normalized normKey in format "artist|title"
 */
export function computeNormKey(artist: string, title: string): string {
  const normArtist = cleanString(artist || '');
  const normTitle = cleanString(title || '');
  return `${normArtist}|${normTitle}`;
}

/**
 * Token Jaccard similarity across two normKeys
 */
export function tokenJaccardSimilarity(key1: string, key2: string): number {
  const tokenize = (k: string) =>
    new Set(
      k
        .toLowerCase()
        .split(/[\s|]+/)
        .filter((tok) => tok.length > 0)
    );
  const t1 = tokenize(key1);
  const t2 = tokenize(key2);
  if (t1.size === 0 && t2.size === 0) return 1.0;
  if (t1.size === 0 || t2.size === 0) return 0.0;

  let intersectionCount = 0;
  for (const token of t1) {
    if (t2.has(token)) {
      intersectionCount++;
    }
  }
  const unionCount = t1.size + t2.size - intersectionCount;
  return unionCount === 0 ? 1.0 : intersectionCount / unionCount;
}

function getExtension(filePath: string): string {
  const dotIndex = filePath.lastIndexOf('.');
  if (dotIndex !== -1 && dotIndex < filePath.length - 1) {
    return filePath.slice(dotIndex + 1).toLowerCase();
  }
  return 'mp3';
}

/**
 * Ingest a local track into the unified song library.
 * Matching:
 *  - same path -> exact match to that variant
 *  - else same youtubeId -> exact match to that song
 *  - else same normKey & |duration diff| <= 3s -> merge exact match
 *  - if normKey is similar (token Jaccard >= 0.8) & |duration diff| <= 3s -> fuzzy match with candidates (do not auto-merge)
 *  - else create new Song and Variant -> 'new'
 */
export async function ingestLocalTrack(
  track: IngestTrackInput,
  options?: { forceNew?: boolean }
): Promise<IngestResult> {
  const db = getLibraryDB();

  // 1. Same path -> existing variant
  const existingVariant = await db.variants.where('path').equals(track.path).first();
  if (existingVariant) {
    return { songId: existingVariant.songId, matched: 'exact' };
  }

  // 2. Same youtubeId
  if (track.youtubeId) {
    const matchByYt = await db.songs.where('youtubeId').equals(track.youtubeId).first();
    if (matchByYt) {
      await linkVariant(matchByYt.id, {
        kind: track.hasVideo ? 'video' : 'audio',
        source: 'local',
        path: track.path,
        container: track.container || getExtension(track.path),
        bitrateKbps: track.bitrate,
        addedAt: Date.now()
      });
      return { songId: matchByYt.id, matched: 'exact' };
    }
  }

  // 3. Same normKey and |duration diff| <= 3s
  const normKey = computeNormKey(track.artist, track.title);

  // 3a. Acoustic fingerprint: recognises the same recording across qualities,
  // containers and renamed files even when metadata was rewritten.
  if (track.fingerprint) {
    const fingerprinted = await db.songs.filter((s) => Boolean(s.fingerprint)).toArray();
    let best: { song: Song; score: number } | null = null;
    for (const candidate of fingerprinted) {
      const score = compareFingerprints(candidate.fingerprint, track.fingerprint);
      if (!best || score > best.score) {
        best = { song: candidate, score };
      }
    }

    if (best && best.score >= 0.8) {
      await linkVariant(best.song.id, {
        kind: track.hasVideo ? 'video' : 'audio',
        source: 'local',
        path: track.path,
        container: track.container || getExtension(track.path),
        bitrateKbps: track.bitrate,
        addedAt: Date.now()
      });
      const updates: Partial<Song> = {};
      if (!best.song.fingerprint) updates.fingerprint = track.fingerprint;
      if (track.fingerprintDurationSec && !best.song.fingerprintDurationSec) {
        updates.fingerprintDurationSec = track.fingerprintDurationSec;
      }
      if (track.youtubeId && !best.song.youtubeId) updates.youtubeId = track.youtubeId;
      if (Object.keys(updates).length > 0) {
        await db.songs.update(best.song.id, updates);
      }
      return { songId: best.song.id, matched: 'fingerprint' };
    }
  }

  const sameKeySongs = await db.songs.where('normKey').equals(normKey).toArray();
  const exactCandidate = sameKeySongs.find((s) => Math.abs(s.durationSec - track.durationSec) <= 3);

  if (exactCandidate) {
    await linkVariant(exactCandidate.id, {
      kind: track.hasVideo ? 'video' : 'audio',
      source: 'local',
      path: track.path,
      container: track.container || getExtension(track.path),
      bitrateKbps: track.bitrate,
      addedAt: Date.now()
    });
    if (track.youtubeId && !exactCandidate.youtubeId) {
      await db.songs.update(exactCandidate.id, { youtubeId: track.youtubeId });
    }
    return { songId: exactCandidate.id, matched: 'exact' };
  }

  // 4. Fuzzy match: token Jaccard >= 0.8 and duration diff <= 3s
  if (!options?.forceNew) {
    const allSongs = await db.songs.toArray();
    const fuzzyCandidates: Song[] = [];
    for (const s of allSongs) {
      if (Math.abs(s.durationSec - track.durationSec) <= 3) {
        if (tokenJaccardSimilarity(s.normKey, normKey) >= 0.8) {
          fuzzyCandidates.push(s);
        }
      }
    }

    if (fuzzyCandidates.length > 0) {
      return {
        songId: '',
        matched: 'fuzzy',
        candidates: fuzzyCandidates
      };
    }
  }

  // 5. New song and variant
  const newSongId = generateUUID();
  const newSong: Song = {
    id: newSongId,
    title: track.title,
    artist: track.artist,
    album: track.album || '',
    durationSec: track.durationSec,
    normKey,
    youtubeId: track.youtubeId,
    fingerprint: track.fingerprint,
    fingerprintDurationSec: track.fingerprintDurationSec,
    createdAt: Date.now()
  };
  await db.songs.add(newSong);

  const newVariant: Variant = {
    id: generateUUID(),
    songId: newSongId,
    kind: track.hasVideo ? 'video' : 'audio',
    source: 'local',
    path: track.path,
    container: track.container || getExtension(track.path),
    bitrateKbps: track.bitrate,
    addedAt: Date.now()
  };
  await db.variants.add(newVariant);

  return { songId: newSongId, matched: 'new' };
}

/**
 * Link a new or existing variant to a Song record
 */
export async function linkVariant(
  songId: string,
  variant: Omit<Variant, 'id' | 'songId' | 'addedAt'> & { id?: string; addedAt?: number }
): Promise<Variant> {
  const db = getLibraryDB();
  const variantRecord: Variant = {
    id: variant.id || generateUUID(),
    songId,
    kind: variant.kind,
    source: variant.source,
    path: variant.path,
    url: variant.url,
    container: variant.container,
    bitrateKbps: variant.bitrateKbps,
    height: variant.height,
    codec: variant.codec,
    formatId: variant.formatId,
    sizeBytes: variant.sizeBytes,
    addedAt: variant.addedAt || Date.now()
  };
  await db.variants.put(variantRecord);
  return variantRecord;
}

/**
 * Merge two songs: moves all variants of dropId to keepId, carries metadata, then removes dropId
 */
export async function mergeSongs(keepId: string, dropId: string): Promise<void> {
  const db = getLibraryDB();
  const [keepSong, dropSong] = await Promise.all([db.songs.get(keepId), db.songs.get(dropId)]);
  if (!keepSong || !dropSong) return;

  const dropVariants = await db.variants.where('songId').equals(dropId).toArray();
  for (const variant of dropVariants) {
    await db.variants.update(variant.id, { songId: keepId });
  }

  const updates: Partial<Song> = {};
  if (!keepSong.youtubeId && dropSong.youtubeId) {
    updates.youtubeId = dropSong.youtubeId;
  }
  if (!keepSong.coverPath && dropSong.coverPath) {
    updates.coverPath = dropSong.coverPath;
  }
  if (
    (dropSong.lastPlayedAt ?? 0) > (keepSong.lastPlayedAt ?? 0) &&
    dropSong.lastPositionSec !== undefined
  ) {
    updates.lastPositionSec = dropSong.lastPositionSec;
    updates.lastPlayedAt = dropSong.lastPlayedAt;
  }

  if (Object.keys(updates).length > 0) {
    await db.songs.update(keepId, updates);
  }

  await db.songs.delete(dropId);
}

/**
 * Unlink (delete) a variant
 */
export async function unlinkVariant(variantId: string): Promise<void> {
  const db = getLibraryDB();
  await db.variants.delete(variantId);
}

/**
 * Retrieve a song by ID
 */
export async function getSong(songId: string): Promise<Song | undefined> {
  const db = getLibraryDB();
  return db.songs.get(songId);
}

/**
 * Retrieve all variants of a song, sorted:
 *  - video variants first, sorted by height descending
 *  - audio variants second, sorted by bitrateKbps descending
 */
export async function getVariants(songId: string): Promise<Variant[]> {
  const db = getLibraryDB();
  const list = await db.variants.where('songId').equals(songId).toArray();
  return list.sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === 'video' ? -1 : 1;
    }
    if (a.kind === 'video') {
      return (b.height ?? 0) - (a.height ?? 0);
    }
    return (b.bitrateKbps ?? 0) - (a.bitrateKbps ?? 0);
  });
}

/**
 * Find a variant and its parent Song by file path
 */
export async function findSongByPath(
  path: string
): Promise<{ song: Song; variant: Variant } | undefined> {
  const db = getLibraryDB();
  const variant = await db.variants.where('path').equals(path).first();
  if (!variant) return undefined;
  const song = await db.songs.get(variant.songId);
  if (!song) return undefined;
  return { song, variant };
}

/**
 * Store/replace the acoustic fingerprint for a song.
 */
export async function setSongFingerprint(
  songId: string,
  fingerprint: string,
  durationSec?: number
): Promise<void> {
  const db = getLibraryDB();
  const updates: Partial<Song> = { fingerprint };
  if (typeof durationSec === 'number' && durationSec > 0) {
    updates.fingerprintDurationSec = durationSec;
  }
  await db.songs.update(songId, updates);
}

/**
 * Store a fingerprint on whichever Song owns the given file path.
 * Returns the song ID when the path is linked, otherwise undefined.
 */
export async function setFingerprintForPath(
  filePath: string,
  fingerprint: string,
  durationSec?: number
): Promise<string | undefined> {
  const match = await findSongByPath(filePath);
  if (!match) return undefined;
  await setSongFingerprint(match.song.id, fingerprint, durationSec);
  return match.song.id;
}

export type FingerprintExtractor = (
  filePath: string
) => Promise<{ fingerprint: string; durationSec: number } | null>;

/**
 * Backfill fingerprints for library songs that were added before the acoustic
 * index existed (for example downloads that are not part of a scanned folder).
 * Prefers an audio variant, then falls back to any variant with a local path.
 */
export async function backfillLibraryFingerprints(
  extract: FingerprintExtractor,
  options: { concurrency?: number } = {}
): Promise<{ indexed: number; failed: number; skipped: number }> {
  const db = getLibraryDB();
  const [songs, variants] = await Promise.all([db.songs.toArray(), db.variants.toArray()]);
  const variantsBySong = new Map<string, Variant[]>();
  for (const variant of variants) {
    if (!variant.path) continue;
    const list = variantsBySong.get(variant.songId) || [];
    list.push(variant);
    variantsBySong.set(variant.songId, list);
  }

  const queue: Array<{ songId: string; path: string }> = [];
  let skipped = 0;
  for (const song of songs) {
    if (song.fingerprint) continue;
    const candidates = variantsBySong.get(song.id) || [];
    const preferred = candidates.find((v) => v.kind === 'audio') || candidates[0];
    if (!preferred?.path) {
      skipped += 1;
      continue;
    }
    queue.push({ songId: song.id, path: preferred.path });
  }

  let indexed = 0;
  let failed = 0;
  const worker = async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      try {
        const result = await extract(item.path);
        if (result?.fingerprint) {
          await setSongFingerprint(item.songId, result.fingerprint, result.durationSec);
          indexed += 1;
        } else {
          failed += 1;
        }
      } catch {
        failed += 1;
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(options.concurrency ?? 2, queue.length || 1) }, worker)
  );
  return { indexed, failed, skipped };
}

/**
 * Find songs whose acoustic fingerprints identify the same recording.
 * The pair always names the record with more variants as the survivor.
 */
export async function findDuplicateRecordings(): Promise<DuplicatePair[]> {
  const db = getLibraryDB();
  const [songs, variants] = await Promise.all([db.songs.toArray(), db.variants.toArray()]);
  const variantCounts = new Map<string, number>();
  for (const variant of variants) {
    variantCounts.set(variant.songId, (variantCounts.get(variant.songId) ?? 0) + 1);
  }

  return findFingerprintDuplicatePairs(
    songs.map((song) => ({
      ...song,
      variantCount: variantCounts.get(song.id) ?? 0
    }))
  );
}

/**
 * Set or update the YouTube ID associated with a Song
 */
export async function setYoutubeId(songId: string, id: string): Promise<void> {
  const db = getLibraryDB();
  await db.songs.update(songId, { youtubeId: id });
}

/**
 * Save playback position for a song key.
 * Works for local files (paths), unified song IDs, and online keys (yt:<id>, netease:<id>).
 */
export async function savePosition(songKey: string, sec: number): Promise<void> {
  if (!songKey || typeof indexedDB === 'undefined' || !Number.isFinite(sec) || sec < 0) return;
  try {
    const db = getLibraryDB();
    const roundedSec = Math.round(sec * 100) / 100;
    const now = Date.now();

    await db.playbackPositions.put({
      key: songKey,
      positionSec: roundedSec,
      updatedAt: now
    });

    // If songKey maps to a song in songs table
    let song = await db.songs.get(songKey);
    if (!song) {
      const match = await findSongByPath(songKey);
      if (match) song = match.song;
    }
    if (song) {
      await db.songs.update(song.id, {
        lastPositionSec: roundedSec,
        lastPlayedAt: now
      });
    }
  } catch (err) {
    console.debug('[songLibrary] savePosition failed:', err);
  }
}

/**
 * Retrieve saved playback position for a song key.
 */
export async function getPosition(songKey: string): Promise<number> {
  if (!songKey || typeof indexedDB === 'undefined') return 0;
  try {
    const db = getLibraryDB();
    const rec = await db.playbackPositions.get(songKey);
    if (rec && Number.isFinite(rec.positionSec)) {
      return rec.positionSec;
    }

    let song = await db.songs.get(songKey);
    if (!song) {
      const match = await findSongByPath(songKey);
      if (match) song = match.song;
    }
    if (song && Number.isFinite(song.lastPositionSec)) {
      return song.lastPositionSec!;
    }
  } catch (err) {
    console.debug('[songLibrary] getPosition failed:', err);
  }
  return 0;
}

/**
 * Resolve a uniform song key from a song object / path / online ID.
 */
export function getSongKey(track: any): string {
  if (!track) return '';
  if (track.path) return String(track.path);
  if (track.localPath) return String(track.localPath);
  if (typeof track.playMusicUrl === 'string' && track.playMusicUrl.startsWith('local://')) {
    try {
      return decodeURIComponent(track.playMusicUrl.replace(/^local:\/\//, ''));
    } catch {
      return track.playMusicUrl.replace(/^local:\/\//, '');
    }
  }
  if (track.youtubeId) return `yt:${track.youtubeId}`;
  if (track.source === 'youtube') return `yt:${track.id}`;
  if (track.source === 'netease') return `netease:${track.id}`;
  if (
    typeof track.id === 'string' &&
    (track.id.startsWith('yt:') || track.id.startsWith('netease:'))
  ) {
    return track.id;
  }
  if (track.id !== undefined && track.id !== null) {
    return String(track.id);
  }
  return '';
}

/**
 * Helper to get the current song key from audioService
 */
export function getCurrentSongKey(): string {
  try {
    const { audioService } = require('@/services/audioService');
    const track = audioService?.getCurrentTrack();
    return getSongKey(track);
  } catch {
    return '';
  }
}


// ============================================================================
// SQLITE DATABASE & ONE-TIME DEXIE MIGRATION
// ============================================================================

let dbPromise: Promise<Database> | null = null;

export async function getLibraryDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load('sqlite:music_manager.db').then(async (db) => {
      await migrateDexieToSqliteOnce(db);
      return db;
    });
  }
  return dbPromise;
}

/** One-time automatic migration from legacy Dexie IndexedDB (`musicManagerLibrary`) into SQLite */
export async function migrateDexieToSqliteOnce(sqlDb: Database): Promise<void> {
  const MIGRATION_FLAG = 'mm_dexie_to_sqlite_v1_done';
  if (typeof localStorage !== 'undefined' && localStorage.getItem(MIGRATION_FLAG) === 'true') {
    return;
  }

  try {
    const exists = await Dexie.exists('musicManagerLibrary');
    if (!exists) {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(MIGRATION_FLAG, 'true');
      }
      return;
    }

    const legacyDb = new Dexie('musicManagerLibrary');
    legacyDb.version(2).stores({
      songs: '&id, normKey, youtubeId, fingerprint, createdAt',
      variants: '&id, songId, path, kind, addedAt',
      playbackPositions: '&key, updatedAt'
    });

    const songs = await legacyDb.table<Song>('songs').toArray();
    const variants = await legacyDb.table<Variant>('variants').toArray();
    const positions = await legacyDb.table<PlaybackPositionRecord>('playbackPositions').toArray();

    for (const s of songs) {
      await sqlDb.execute(
        `INSERT OR IGNORE INTO songs (
          id, title, artist, album, durationSec, normKey, youtubeId, coverPath,
          primaryColor, backgroundColor, fingerprint, fingerprintDurationSec,
          lastPositionSec, lastPlayedAt, createdAt
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          s.id,
          s.title,
          s.artist,
          s.album ?? null,
          s.durationSec,
          s.normKey,
          s.youtubeId ?? null,
          s.coverPath ?? null,
          s.primaryColor ?? null,
          s.backgroundColor ?? null,
          s.fingerprint ?? null,
          s.fingerprintDurationSec ?? null,
          s.lastPositionSec ?? null,
          s.lastPlayedAt ?? null,
          s.createdAt
        ]
      );
    }

    for (const v of variants) {
      await sqlDb.execute(
        `INSERT OR IGNORE INTO variants (
          id, songId, kind, source, path, url, container, bitrateKbps,
          height, codec, formatId, sizeBytes, addedAt
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          v.id,
          v.songId,
          v.kind,
          v.source,
          v.path ?? null,
          v.url ?? null,
          v.container ?? null,
          v.bitrateKbps ?? null,
          v.height ?? null,
          v.codec ?? null,
          v.formatId ?? null,
          v.sizeBytes ?? null,
          v.addedAt
        ]
      );
    }

    for (const p of positions) {
      await sqlDb.execute(
        `INSERT OR REPLACE INTO playback_positions (key, positionSec, updatedAt) VALUES ($1,$2,$3)`,
        [p.key, p.positionSec, p.updatedAt]
      );
    }

    legacyDb.close();
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(MIGRATION_FLAG, 'true');
    }
  } catch (err) {
    console.warn('[SQLite Migration] Non-fatal Dexie import warning:', err);
  }
}

export async function getOrComputeWaveformPeaks(
  filePath: string,
  buckets = 180
): Promise<number[]> {
  const db = await getLibraryDb();
  const rows = await db.select<Array<{ peaksJson: string }>>(
    `SELECT peaksJson FROM waveforms WHERE filePath = $1 LIMIT 1`,
    [filePath]
  );
  if (rows.length > 0) {
    try {
      return JSON.parse(rows[0].peaksJson);
    } catch {
      // Fall through to recompute
    }
  }

  const peaks = await (window as any).api.generateWaveformPeaks(filePath, buckets);
  await db.execute(
    `INSERT OR REPLACE INTO waveforms (filePath, peaksJson, updatedAt) VALUES ($1, $2, $3)`,
    [filePath, JSON.stringify(peaks), Date.now()]
  );
  return peaks;
}
