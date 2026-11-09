import { execFileSync, spawn } from 'child_process';
import crypto from 'crypto';
import { app, BrowserWindow, ipcMain } from 'electron';
import fs from 'fs';
import http, { type IncomingMessage, type ServerResponse } from 'http';
import * as musicMetadata from 'music-metadata';
import NodeID3 from 'node-id3';
import path from 'path';

import { getSharedStore } from './config';
import { recordErrorReport } from './errorReporter';
import {
  extractVideoId,
  mapAndGroupFormats,
  type YtFormatsResult,
  type YtSearchResult
} from './youtubeFormats';

import type {
  YtStreamUrlResult,
  YtDownloadOptions,
  YtDownloadProgress,
  YtBinaryStatus
} from './youtubeFormats';

export type {
  YtStreamUrlResult,
  YtDownloadOptions,
  YtDownloadProgress,
  YtBinaryStatus
};

// Active background downloads
const activeDownloads = new Map<string, ReturnType<typeof spawn>>();

// Stream URL cache (~4 hours TTL)
const CACHE_TTL_MS = 4 * 60 * 60 * 1000;
interface CacheEntry {
  result: YtStreamUrlResult;
  timestamp: number;
}
const streamUrlCache = new Map<string, CacheEntry>();

// Proxy streaming sessions
interface StreamSession {
  videoUrl: string;
  audioUrl: string;
  headers?: Record<string, string>;
  createdAt: number;
}
const streamSessions = new Map<string, StreamSession>();
let proxyServer: http.Server | null = null;
let proxyServerPort = 0;

/**
 * Resolves the path to yt-dlp binary.
 */
export function getYtDlpPath(): string {
  const binaryName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const resourceRoot = app.isPackaged
    ? process.resourcesPath
    : path.join(__dirname, '../../resources');

  const binPath = path.join(resourceRoot, 'bin', binaryName);
  if (fs.existsSync(binPath)) {
    return binPath;
  }

  // Fallback check in project root resources/bin
  const altPath = path.join(app.getAppPath(), 'resources', 'bin', binaryName);
  if (fs.existsSync(altPath)) {
    return altPath;
  }

  return binPath;
}

/**
 * Resolves the path to the single bundled ffmpeg binary.
 *
 * This is the only ffmpeg in the app. `resources/bin/ffmpeg.exe` is seeded by
 * `scripts/fetch-binaries.mjs` and shipped once via `extraResources.bin`, so
 * every caller must go through here rather than bundling its own copy.
 */
export function getFfmpegPath(): string {
  const binaryName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const resourceRoot = app.isPackaged
    ? process.resourcesPath
    : path.join(__dirname, '../../resources');

  return path.join(resourceRoot, 'bin', binaryName);
}

/**
 * Inspects binary availability and versions.
 */
export function getBinaryStatus(): YtBinaryStatus {
  const ytDlpPath = getYtDlpPath();
  const ffmpegPath = getFfmpegPath();

  let ytDlpInstalled = fs.existsSync(ytDlpPath);
  let ytDlpVersion: string | null = null;
  if (ytDlpInstalled) {
    try {
      const v = execFileSync(ytDlpPath, ['--version'], { encoding: 'utf8', timeout: 5000 });
      ytDlpVersion = v.trim();
    } catch {
      ytDlpInstalled = false;
    }
  }

  let ffmpegInstalled = fs.existsSync(ffmpegPath);
  let ffmpegVersion: string | null = null;
  if (ffmpegInstalled) {
    try {
      const out = execFileSync(ffmpegPath, ['-version'], { encoding: 'utf8', timeout: 5000 });
      const firstLine = out.split('\n')[0] || '';
      const match = firstLine.match(/ffmpeg version\s+([^\s]+)/i);
      ffmpegVersion = match ? match[1] : firstLine.trim();
    } catch {
      ffmpegInstalled = false;
    }
  }

  return {
    ytDlp: {
      installed: ytDlpInstalled,
      path: ytDlpPath,
      version: ytDlpVersion
    },
    ffmpeg: {
      installed: ffmpegInstalled,
      path: ffmpegPath,
      version: ffmpegVersion
    }
  };
}

/**
 * Self-updates yt-dlp using `yt-dlp -U`.
 */
export async function updateYtDlpBinary(): Promise<{
  success: boolean;
  output: string;
  version: string | null;
}> {
  const ytDlpPath = getYtDlpPath();
  if (!fs.existsSync(ytDlpPath)) {
    return { success: false, output: `yt-dlp binary not found at ${ytDlpPath}`, version: null };
  }

  return new Promise((resolve) => {
    try {
      const child = spawn(ytDlpPath, ['-U'], { windowsHide: true });
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (d) => {
        stdout += d.toString();
      });
      child.stderr.on('data', (d) => {
        stderr += d.toString();
      });

      child.on('close', (code) => {
        const fullOutput = (stdout + '\n' + stderr).trim();
        const status = getBinaryStatus();
        resolve({
          success: code === 0,
          output: fullOutput,
          version: status.ytDlp.version
        });
      });

      child.on('error', (err) => {
        resolve({
          success: false,
          output: err.message,
          version: null
        });
      });
    } catch (err: any) {
      resolve({
        success: false,
        output: err.message || String(err),
        version: null
      });
    }
  });
}

/**
 * Starts the local HTTP proxy/muxing server on 127.0.0.1 (ephemeral port).
 */
export function ensureProxyServer(): Promise<number> {
  if (proxyServer && proxyServerPort > 0) {
    return Promise.resolve(proxyServerPort);
  }

  return new Promise((resolve, reject) => {
    proxyServer = http.createServer((req: IncomingMessage, res: ServerResponse) => {
      const reqUrl = new URL(req.url || '', `http://127.0.0.1:${proxyServerPort}`);
      if (reqUrl.pathname !== '/stream') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }

      const sessionId = reqUrl.searchParams.get('sessionId');
      if (!sessionId || !streamSessions.has(sessionId)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Invalid or expired stream session');
        return;
      }

      const session = streamSessions.get(sessionId)!;
      const ffmpegPath = getFfmpegPath();

      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'none',
        'Transfer-Encoding': 'chunked',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });

      // Spawn ffmpeg to mux video and audio on the fly
      const ffmpegArgs = [
        '-reconnect',
        '1',
        '-reconnect_streamed',
        '1',
        '-reconnect_delay_max',
        '5',
        '-i',
        session.videoUrl,
        '-reconnect',
        '1',
        '-reconnect_streamed',
        '1',
        '-reconnect_delay_max',
        '5',
        '-i',
        session.audioUrl,
        '-c',
        'copy',
        '-f',
        'mp4',
        '-movflags',
        'frag_keyframe+empty_moov+default_base_moof',
        'pipe:1'
      ];

      const ff = spawn(ffmpegPath, ffmpegArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });

      ff.stdout.pipe(res);

      req.on('close', () => {
        try {
          ff.kill();
        } catch {
          // ignore
        }
      });

      res.on('error', () => {
        try {
          ff.kill();
        } catch {
          // ignore
        }
      });

      ff.on('error', (err) => {
        console.error('[yt:proxy] ffmpeg stream error:', err);
      });
    });

    proxyServer.listen(0, '127.0.0.1', () => {
      const addr = proxyServer?.address();
      if (addr && typeof addr === 'object') {
        proxyServerPort = addr.port;
        resolve(proxyServerPort);
      } else {
        reject(new Error('Failed to bind proxy server port'));
      }
    });

    proxyServer.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Registers a stream session for proxy muxing.
 */
export function registerStreamSession(
  sessionId: string,
  videoUrl: string,
  audioUrl: string,
  headers?: Record<string, string>
): void {
  streamSessions.set(sessionId, {
    videoUrl,
    audioUrl,
    headers,
    createdAt: Date.now()
  });

  // Prune expired sessions older than 4h
  const now = Date.now();
  for (const [id, s] of streamSessions.entries()) {
    if (now - s.createdAt > CACHE_TTL_MS) {
      streamSessions.delete(id);
    }
  }
}

/**
 * Executes yt-dlp with arguments and returns stdout string.
 */
async function runYtDlp(args: string[]): Promise<string> {
  const ytDlpPath = getYtDlpPath();
  if (!fs.existsSync(ytDlpPath)) {
    throw new Error(`yt-dlp binary not found at ${ytDlpPath}`);
  }

  return new Promise((resolve, reject) => {
    const child = spawn(ytDlpPath, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr || stdout || `yt-dlp exited with code ${code}`));
      }
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Executes yt-dlp -J to extract metadata and formats.
 * Uses a robust client fallback chain to maximize format height coverage
 * (1080p/720p/480p/360p/240p/144p + audio) while avoiding bot blocks and 429 throttling.
 */
export async function getYtDlpJson(idOrUrl: string): Promise<any> {
  const videoId = extractVideoId(idOrUrl) || idOrUrl;
  const target = videoId.startsWith('http')
    ? videoId
    : `https://www.youtube.com/watch?v=${videoId}`;

  const baseArgs = [target, '-J'];

  // Client fallback chain:
  // 1. 'all': extracts formats across simulated clients (visionos, mweb, web_safari, tv, android, etc.) -> full 1080p..144p ladder
  // 2. 'default,tv,web_safari,mweb': broad client chain
  // 3. 'tv,android': robust tv/android combination
  // 4. 'youtube:player_skip=webpage,configs;player_client=android': extreme fallback when web IP blocked
  // 5. []: default yt-dlp
  const clientAttempts: string[][] = [
    ['--extractor-args', 'youtube:player_client=all'],
    ['--extractor-args', 'youtube:player_client=default,tv,web_safari,mweb'],
    ['--extractor-args', 'youtube:player_client=tv,android'],
    ['--extractor-args', 'youtube:player_skip=webpage,configs;player_client=android'],
    []
  ];

  let bestData: any = null;
  let maxHeightsFound = 0;
  let lastError: Error | null = null;

  for (const clientArgs of clientAttempts) {
    try {
      const fullArgs = [...baseArgs, ...clientArgs];
      const out = await runYtDlp(fullArgs);
      const parsed = JSON.parse(out);

      const formats: any[] = Array.isArray(parsed.formats) ? parsed.formats : [];
      const heights = new Set(
        formats.filter((f) => f.vcodec && f.vcodec !== 'none' && f.height > 0).map((f) => f.height)
      );

      if (heights.size >= 4) {
        // Full adaptive ladder found
        return parsed;
      }

      if (heights.size > maxHeightsFound || !bestData) {
        bestData = parsed;
        maxHeightsFound = heights.size;
      }
    } catch (err: any) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 600));
    }
  }

  if (bestData) {
    return bestData;
  }

  throw lastError || new Error(`Failed to extract formats for ${idOrUrl}`);
}

/**
 * Searches YouTube / YouTube Music.
 */
export async function searchYouTube(
  query: string,
  options?: { limit?: number; type?: 'video' | 'music' }
): Promise<YtSearchResult[]> {
  const limit = options?.limit || 15;
  const type = options?.type || 'video';
  const trimmed = query.trim();
  if (!trimmed) return [];

  let searchTarget = '';
  if (type === 'music') {
    searchTarget = `ytsearch${limit}:${trimmed} audio`;
  } else {
    searchTarget = `ytsearch${limit}:${trimmed}`;
  }

  const args = [
    searchTarget,
    '--flat-playlist',
    '-J',
    '--extractor-args',
    'youtube:player_skip=webpage,configs;player_client=android'
  ];

  let stdout = '';
  try {
    stdout = await runYtDlp(args);
  } catch {
    // Retry without player_client arg
    stdout = await runYtDlp([searchTarget, '--flat-playlist', '-J']);
  }

  const parsed = JSON.parse(stdout);
  const entries: any[] = Array.isArray(parsed.entries) ? parsed.entries : [];

  return entries.map((e) => {
    const id = e.id || '';
    let thumb = '';
    if (Array.isArray(e.thumbnails) && e.thumbnails.length > 0) {
      thumb = e.thumbnails[e.thumbnails.length - 1]?.url || '';
    }
    if (!thumb) {
      thumb = e.thumbnail || (id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : '');
    }

    return {
      id,
      title: e.title || '',
      channel: e.channel || e.uploader || '',
      durationSec: typeof e.duration === 'number' ? Math.round(e.duration) : 0,
      viewCount: typeof e.view_count === 'number' ? e.view_count : 0,
      uploadDate: e.upload_date || undefined,
      thumbnail: thumb,
      url: e.url || (id ? `https://www.youtube.com/watch?v=${id}` : '')
    };
  });
}

/**
 * Retrieves formatted formats list for a video ID or URL.
 */
export async function getFormats(idOrUrl: string): Promise<YtFormatsResult> {
  const raw = await getYtDlpJson(idOrUrl);
  return mapAndGroupFormats(raw);
}

/**
 * Resolves direct stream URLs or muxed local proxy URL with ~4h caching.
 */
export async function getStreamUrl(
  idOrUrl: string,
  options?: {
    kind?: 'audio' | 'video';
    height?: number;
    preferProgressive?: boolean;
    videoOnly?: boolean;
  }
): Promise<YtStreamUrlResult> {
  const kind = options?.kind || 'video';
  const reqHeight = options?.height;
  const preferProgressive = Boolean(options?.preferProgressive);
  const videoOnly = Boolean(options?.videoOnly);
  const videoId = extractVideoId(idOrUrl) || idOrUrl;
  const cacheKey = `${videoId}_${kind}_${reqHeight || 'any'}${preferProgressive ? '_prog' : ''}${
    videoOnly ? '_vo' : ''
  }`;

  // Check cache
  const cached = streamUrlCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.result;
  }

  const raw = await getYtDlpJson(idOrUrl);
  const formats: any[] = Array.isArray(raw.formats) ? raw.formats : [];

  // Filter out storyboards
  const validFormats = formats.filter(
    (f) => f.protocol !== 'mhtml' && f.format_note !== 'storyboard' && f.ext !== 'mhtml' && f.url
  );

  let result: YtStreamUrlResult;

  if (kind === 'audio') {
    // Audio formats: acodec !== 'none' and vcodec === 'none' (or progressive formats)
    const audioFormats = validFormats.filter(
      (f) => (f.vcodec === 'none' || !f.vcodec) && f.acodec && f.acodec !== 'none'
    );
    audioFormats.sort((a, b) => (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0));

    const bestAudio =
      audioFormats[0] ||
      validFormats.find((f) => f.acodec && f.acodec !== 'none') ||
      validFormats[0];
    if (!bestAudio || !bestAudio.url) {
      throw new Error(`No audio stream available for ${idOrUrl}`);
    }

    result = {
      videoUrl: bestAudio.url,
      audioUrl: bestAudio.url,
      headers: bestAudio.http_headers || undefined,
      isMuxedProxy: false
    };
  } else {
    // Video requested
    const videoFormats = validFormats.filter((f) => f.vcodec && f.vcodec !== 'none');

    if (videoOnly && !preferProgressive) {
      // Linked A/V playback: the renderer plays the song's own audio and shows
      // this stream muted, so a video-only format is enough — no ffmpeg muxing
      // (which also makes the stream directly seekable over HTTP range).
      const videoOnlyFormats = videoFormats.filter((f) => !f.acodec || f.acodec === 'none');
      let chosen: any = null;
      if (reqHeight) {
        const matches = videoOnlyFormats.filter((f) => Math.abs((f.height || 0) - reqHeight) <= 4);
        matches.sort(
          (a, b) => (b.fps || 0) - (a.fps || 0) || (b.vbr || b.tbr || 0) - (a.vbr || a.tbr || 0)
        );
        chosen = matches[0];
      }
      if (!chosen) {
        const sorted = [...videoOnlyFormats].sort((a, b) => (b.height || 0) - (a.height || 0));
        // Never upscale past the requested height when falling back.
        chosen =
          (reqHeight ? sorted.find((f) => (f.height || 0) <= reqHeight + 4) : null) || sorted[0];
      }
      if (chosen && chosen.url) {
        result = {
          videoUrl: chosen.url,
          headers: chosen.http_headers || undefined,
          isMuxedProxy: false
        };
        streamUrlCache.set(cacheKey, { result, timestamp: Date.now() });
        return result;
      }
      // No video-only format available — fall through to progressive/muxed.
    }

    // 1. If height requested, check if a progressive format (format 18, 22 or hasAudio: true) matches
    let progressiveMatch: any = null;
    if (preferProgressive) {
      // Seeking fallback: pick the highest muxed A/V format, which is natively seekable.
      const progressiveList = videoFormats.filter((f) => f.acodec && f.acodec !== 'none');
      progressiveList.sort((a, b) => (b.height || 0) - (a.height || 0));
      progressiveMatch = progressiveList[0] || null;
    } else if (reqHeight) {
      progressiveMatch = videoFormats.find(
        (f) => Math.abs((f.height || 0) - reqHeight) <= 4 && f.acodec && f.acodec !== 'none'
      );
    } else {
      // Pick best progressive format
      const progressiveList = videoFormats.filter((f) => f.acodec && f.acodec !== 'none');
      progressiveList.sort((a, b) => (b.height || 0) - (a.height || 0));
      progressiveMatch = progressiveList[0];
    }

    if (progressiveMatch && progressiveMatch.url) {
      // Direct progressive stream can be played natively by Chromium <video>
      result = {
        videoUrl: progressiveMatch.url,
        headers: progressiveMatch.http_headers || undefined,
        isMuxedProxy: false
      };
    } else {
      // DASH stream: video and audio are separate (e.g. 1080p)
      // Pick best video for height
      let chosenVideo: any = null;
      if (reqHeight) {
        const matches = videoFormats.filter((f) => Math.abs((f.height || 0) - reqHeight) <= 4);
        matches.sort(
          (a, b) => (b.fps || 0) - (a.fps || 0) || (b.vbr || b.tbr || 0) - (a.vbr || a.tbr || 0)
        );
        chosenVideo = matches[0];
      }
      if (!chosenVideo) {
        videoFormats.sort((a, b) => (b.height || 0) - (a.height || 0));
        chosenVideo = videoFormats[0];
      }

      // Pick best audio format
      const audioFormats = validFormats.filter(
        (f) => (f.vcodec === 'none' || !f.vcodec) && f.acodec && f.acodec !== 'none'
      );
      audioFormats.sort((a, b) => (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0));
      const chosenAudio =
        audioFormats[0] || validFormats.find((f) => f.acodec && f.acodec !== 'none');

      if (chosenVideo && chosenAudio && chosenVideo.url && chosenAudio.url) {
        // Start proxy server and create streaming session
        const port = await ensureProxyServer();
        const sessionId =
          typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        registerStreamSession(
          sessionId,
          chosenVideo.url,
          chosenAudio.url,
          chosenVideo.http_headers
        );
        const proxyUrl = `http://127.0.0.1:${port}/stream?sessionId=${sessionId}`;

        result = {
          videoUrl: proxyUrl,
          audioUrl: chosenAudio.url,
          headers: chosenVideo.http_headers || undefined,
          isMuxedProxy: true
        };
      } else if (chosenVideo && chosenVideo.url) {
        result = {
          videoUrl: chosenVideo.url,
          headers: chosenVideo.http_headers || undefined,
          isMuxedProxy: false
        };
      } else {
        throw new Error(`No video stream available for ${idOrUrl}`);
      }
    }
  }

  // Cache result
  streamUrlCache.set(cacheKey, {
    result,
    timestamp: Date.now()
  });

  return result;
}

/**
 * Resolves the target download directory based on settings and context file.
 */
export function resolveDownloadDir(contextFilePath?: string): string {
  try {
    const store = getSharedStore();
    const mediaDownloadDir = store.get('set.mediaDownloadDir') as string;
    if (
      mediaDownloadDir &&
      typeof mediaDownloadDir === 'string' &&
      mediaDownloadDir.trim() &&
      mediaDownloadDir.trim().toLowerCase() !== 'auto'
    ) {
      const customDir = mediaDownloadDir.trim();
      if (!fs.existsSync(customDir)) {
        fs.mkdirSync(customDir, { recursive: true });
      }
      return customDir;
    }
  } catch (err) {
    console.error('[yt] Failed to read mediaDownloadDir from store:', err);
  }

  // Auto mode
  let targetDir = '';
  if (contextFilePath && typeof contextFilePath === 'string') {
    try {
      const dir = path.dirname(contextFilePath);
      if (fs.existsSync(dir)) {
        targetDir = dir;
      }
    } catch {
      // ignore
    }
  }

  if (!targetDir) {
    try {
      const musicPath = app.getPath('music');
      targetDir = path.join(musicPath, 'Music Manager');
    } catch {
      targetDir = path.join(process.cwd(), 'Music Manager');
    }
  }

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  return targetDir;
}

/**
 * Reads YouTube URL from a file's tags (ID3, Vorbis, mp4 comments).
 */
export async function readLink(filePath: string): Promise<string | null> {
  if (!fs.existsSync(filePath)) return null;

  const ext = path.extname(filePath).toLowerCase();

  // 1. Try node-id3 for MP3
  if (ext === '.mp3') {
    try {
      const tags = NodeID3.read(filePath);
      if (tags) {
        // Check userDefinedUrl (WXXX)
        if (Array.isArray(tags.userDefinedUrl)) {
          for (const u of tags.userDefinedUrl) {
            const id = extractVideoId(u.url);
            if (id) return `https://youtu.be/${id}`;
          }
        }
        // Check comment (COMM)
        if (tags.comment?.text) {
          const id = extractVideoId(tags.comment.text);
          if (id) return `https://youtu.be/${id}`;
        }
      }
    } catch {
      // continue to metadata parser
    }
  }

  // 2. Parse tags via music-metadata
  try {
    const meta = await musicMetadata.parseFile(filePath, { skipCovers: true });

    // Check common comments
    if (Array.isArray(meta.common.comment)) {
      for (const c of meta.common.comment) {
        const text = typeof c === 'string' ? c : (c as any)?.text || '';
        const id = extractVideoId(text);
        if (id) return `https://youtu.be/${id}`;
      }
    }

    // Check native metadata entries
    for (const tagType of Object.keys(meta.native || {})) {
      const tagList = meta.native[tagType];
      if (Array.isArray(tagList)) {
        for (const tag of tagList) {
          const val = typeof tag.value === 'string' ? tag.value : String(tag.value || '');
          const id = extractVideoId(val);
          if (id) return `https://youtu.be/${id}`;
        }
      }
    }
  } catch (err) {
    console.error(`[yt:readLink] Error reading tags from ${filePath}:`, err);
  }

  return null;
}

/**
 * Writes YouTube URL into a file's tags.
 */
export async function writeLink(
  filePath: string,
  youtubeUrl: string
): Promise<{ ok: boolean; error?: string }> {
  if (!fs.existsSync(filePath)) {
    return { ok: false, error: `File not found: ${filePath}` };
  }

  const videoId = extractVideoId(youtubeUrl);
  if (!videoId) {
    return { ok: false, error: `Invalid YouTube URL or ID: ${youtubeUrl}` };
  }
  const canonicalUrl = `https://youtu.be/${videoId}`;
  const ext = path.extname(filePath).toLowerCase();

  try {
    if (ext === '.mp3') {
      const tags = NodeID3.read(filePath) || {};
      const userDefinedUrl = Array.isArray(tags.userDefinedUrl)
        ? tags.userDefinedUrl.filter((u) => u.description?.toLowerCase() !== 'youtube')
        : [];
      userDefinedUrl.push({ description: 'YouTube', url: canonicalUrl });

      const commentText = tags.comment?.text
        ? tags.comment.text.includes('youtu')
          ? canonicalUrl
          : `${tags.comment.text} | ${canonicalUrl}`
        : canonicalUrl;

      NodeID3.update(
        {
          userDefinedUrl,
          comment: { language: 'eng', text: commentText }
        },
        filePath
      );
      return { ok: true };
    }

    if (ext === '.m4a' || ext === '.mp4' || ext === '.flac') {
      const ffmpegPath = getFfmpegPath();
      const tempPath = `${filePath}.tmp_${Date.now()}${ext}`;

      const commentKey = ext === '.flac' ? 'COMMENT' : 'comment';
      const args = [
        '-y',
        '-i',
        filePath,
        '-c',
        'copy',
        '-metadata',
        `${commentKey}=${canonicalUrl}`,
        '-metadata',
        `purl=${canonicalUrl}`,
        tempPath
      ];

      await new Promise<void>((resolve, reject) => {
        const ff = spawn(ffmpegPath, args, { windowsHide: true });
        ff.on('close', (code) => {
          if (code === 0 && fs.existsSync(tempPath)) {
            try {
              fs.copyFileSync(tempPath, filePath);
              fs.unlinkSync(tempPath);
              resolve();
            } catch (copyErr) {
              reject(copyErr);
            }
          } else {
            reject(new Error(`ffmpeg exited with code ${code}`));
          }
        });
        ff.on('error', (err) => reject(err));
      });

      return { ok: true };
    }

    return { ok: false, error: `Unsupported file format: ${ext}` };
  } catch (err: any) {
    const errorMsg = err.message || String(err);
    recordErrorReport({
      source: 'main',
      severity: 'error',
      message: `Failed to write YouTube link to ${filePath}: ${errorMsg}`,
      context: { filePath, youtubeUrl }
    });
    return { ok: false, error: errorMsg };
  }
}

/**
 * Broadcasts download progress to all open Electron windows.
 */
function broadcastDownloadProgress(progress: YtDownloadProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('yt:download-progress', progress);
    }
  }
}

/**
 * Downloads a video or audio from YouTube.
 */
export async function downloadMedia(idOrUrl: string, options: YtDownloadOptions): Promise<string> {
  const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const videoId = extractVideoId(idOrUrl) || idOrUrl;
  const targetDir = resolveDownloadDir(options.targetDir);
  const ytDlpPath = getYtDlpPath();
  const ffmpegPath = getFfmpegPath();

  if (!fs.existsSync(ytDlpPath)) {
    throw new Error(`yt-dlp binary not found at ${ytDlpPath}`);
  }

  const outTemplate = options.fileBaseName
    ? path.join(targetDir, `${options.fileBaseName}.%(ext)s`)
    : path.join(targetDir, '%(title)s.%(ext)s');

  const args = [
    '--ffmpeg-location',
    ffmpegPath,
    '-o',
    outTemplate,
    '--newline',
    '--embed-metadata',
    '--embed-thumbnail',
    '--extractor-args',
    'youtube:player_client=all'
  ];

  if (options.kind === 'video') {
    if (options.formatId) {
      // Exact variant picked in the qualities list (per-height, per-codec).
      if (options.videoOnly) {
        args.push('-f', options.formatId);
      } else {
        args.push('-f', `${options.formatId}+bestaudio/best`);
        args.push('--merge-output-format', 'mp4');
      }
    } else if (options.videoOnly) {
      // Video-only: the audio is a separate file (linked A/V playback), so no
      // audio track is muxed in — smaller files, no duplicated audio.
      args.push(
        '-f',
        `bestvideo[height<=${options.height || 99999}]/best[height<=${options.height || 99999}]/best`
      );
    } else if (options.height) {
      args.push(
        '-f',
        `bestvideo[height<=${options.height}]+bestaudio/best[height<=${options.height}]/best`
      );
      args.push('--merge-output-format', 'mp4');
    } else {
      args.push('-f', 'bestvideo+bestaudio/best');
      args.push('--merge-output-format', 'mp4');
    }
  } else {
    const audioFmt = options.audioFormat || 'm4a';
    args.push('-x', '--audio-format', audioFmt);
  }

  const targetUrl = videoId.startsWith('http')
    ? videoId
    : `https://www.youtube.com/watch?v=${videoId}`;
  args.push(targetUrl);

  broadcastDownloadProgress({
    jobId,
    percent: 0,
    speed: '0B/s',
    eta: '--:--',
    state: 'queued'
  });

  const child = spawn(ytDlpPath, args, { windowsHide: true });
  activeDownloads.set(jobId, child);

  let capturedFilePath = '';

  child.stdout.on('data', (chunk) => {
    const lines = chunk.toString().split(/[\r\n]+/);
    for (const line of lines) {
      if (!line.trim()) continue;

      // Detect download destination
      const destMatch = line.match(/\[(?:download|Merger|ExtractAudio)\] Destination:\s+(.*)/i);
      if (destMatch && destMatch[1]) {
        capturedFilePath = destMatch[1].trim();
      }
      const mergeMatch = line.match(/\[Merger\] Merging formats into "([^"]+)"/i);
      if (mergeMatch && mergeMatch[1]) {
        capturedFilePath = mergeMatch[1].trim();
      }

      // Detect progress
      // e.g. [download]  45.2% of ~  25.40MiB at    2.45MiB/s ETA 00:06
      const progMatch = line.match(
        /\[download\]\s+([\d.]+)%\s+of\s+(?:~?\s*[\d.]+[A-Za-z]+)?\s+at\s+([^\s]+)\s+ETA\s+([^\s]+)/i
      );
      if (progMatch) {
        const percent = parseFloat(progMatch[1]);
        const speed = progMatch[2];
        const eta = progMatch[3];

        broadcastDownloadProgress({
          jobId,
          percent: isNaN(percent) ? 0 : percent,
          speed,
          eta,
          state: percent >= 100 ? 'processing' : 'downloading',
          filePath: capturedFilePath || undefined
        });
      }
    }
  });

  child.stderr.on('data', (chunk) => {
    const errText = chunk.toString();
    console.warn(`[yt:download stderr ${jobId}]:`, errText);
  });

  child.on('close', async (code) => {
    activeDownloads.delete(jobId);

    if (code === 0) {
      // If embedLink requested and we know the file and videoId, embed link tag
      if (
        options.embedLink !== false &&
        capturedFilePath &&
        fs.existsSync(capturedFilePath) &&
        videoId
      ) {
        try {
          await writeLink(capturedFilePath, `https://youtu.be/${videoId}`);
        } catch {
          // non-fatal
        }
      }

      broadcastDownloadProgress({
        jobId,
        percent: 100,
        speed: '0B/s',
        eta: '00:00',
        state: 'completed',
        filePath: capturedFilePath || undefined
      });
    } else {
      const errMsg = `Download failed with exit code ${code}`;
      broadcastDownloadProgress({
        jobId,
        percent: 0,
        speed: '0B/s',
        eta: '00:00',
        state: 'error',
        error: errMsg
      });
      recordErrorReport({
        source: 'main',
        severity: 'error',
        message: `YouTube download failed (${jobId}): ${errMsg}`,
        context: { jobId, idOrUrl, options }
      });
    }
  });

  child.on('error', (err) => {
    activeDownloads.delete(jobId);
    const errMsg = err.message || String(err);
    broadcastDownloadProgress({
      jobId,
      percent: 0,
      speed: '0B/s',
      eta: '00:00',
      state: 'error',
      error: errMsg
    });
    recordErrorReport({
      source: 'main',
      severity: 'error',
      message: `YouTube download process error (${jobId}): ${errMsg}`,
      context: { jobId, idOrUrl, options }
    });
  });

  return jobId;
}

/**
 * Cancels an active download.
 */
export function cancelDownload(jobId: string): boolean {
  const child = activeDownloads.get(jobId);
  if (child) {
    try {
      child.kill('SIGTERM');
    } catch {
      // ignore
    }
    activeDownloads.delete(jobId);
    broadcastDownloadProgress({
      jobId,
      percent: 0,
      speed: '0B/s',
      eta: '00:00',
      state: 'cancelled'
    });
    return true;
  }
  return false;
}

/**
 * Initializes all IPC handlers for YouTube backend.
 */
export function initializeYoutube(): void {
  ipcMain.handle(
    'yt:search',
    async (_, query: string, options?: { limit?: number; type?: 'video' | 'music' }) => {
      try {
        return await searchYouTube(query, options);
      } catch (err: any) {
        recordErrorReport({
          source: 'main',
          severity: 'error',
          message: `yt:search failed for "${query}": ${err.message || String(err)}`,
          context: { query, options }
        });
        throw err;
      }
    }
  );

  ipcMain.handle('yt:formats', async (_, idOrUrl: string) => {
    try {
      return await getFormats(idOrUrl);
    } catch (err: any) {
      recordErrorReport({
        source: 'main',
        severity: 'error',
        message: `yt:formats failed for "${idOrUrl}": ${err.message || String(err)}`,
        context: { idOrUrl }
      });
      throw err;
    }
  });

  ipcMain.handle(
    'yt:streamUrl',
    async (_, idOrUrl: string, options?: { kind?: 'audio' | 'video'; height?: number }) => {
      try {
        return await getStreamUrl(idOrUrl, options);
      } catch (err: any) {
        recordErrorReport({
          source: 'main',
          severity: 'error',
          message: `yt:streamUrl failed for "${idOrUrl}": ${err.message || String(err)}`,
          context: { idOrUrl, options }
        });
        throw err;
      }
    }
  );

  ipcMain.handle('yt:download', async (_, idOrUrl: string, options: YtDownloadOptions) => {
    try {
      return await downloadMedia(idOrUrl, options);
    } catch (err: any) {
      recordErrorReport({
        source: 'main',
        severity: 'error',
        message: `yt:download failed for "${idOrUrl}": ${err.message || String(err)}`,
        context: { idOrUrl, options }
      });
      throw err;
    }
  });

  ipcMain.handle('yt:cancelDownload', async (_, jobId: string) => {
    return cancelDownload(jobId);
  });

  ipcMain.handle('yt:readLink', async (_, filePath: string) => {
    try {
      return await readLink(filePath);
    } catch (err: any) {
      recordErrorReport({
        source: 'main',
        severity: 'error',
        message: `yt:readLink failed for "${filePath}": ${err.message || String(err)}`,
        context: { filePath }
      });
      return null;
    }
  });

  ipcMain.handle('yt:writeLink', async (_, filePath: string, youtubeUrl: string) => {
    try {
      return await writeLink(filePath, youtubeUrl);
    } catch (err: any) {
      recordErrorReport({
        source: 'main',
        severity: 'error',
        message: `yt:writeLink failed for "${filePath}": ${err.message || String(err)}`,
        context: { filePath, youtubeUrl }
      });
      return { ok: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('yt:resolveDownloadDir', async (_, contextFilePath?: string) => {
    return resolveDownloadDir(contextFilePath);
  });

  ipcMain.handle('yt:binaryStatus', async () => {
    return getBinaryStatus();
  });

  ipcMain.handle('yt:updateBinary', async () => {
    try {
      return await updateYtDlpBinary();
    } catch (err: any) {
      recordErrorReport({
        source: 'main',
        severity: 'error',
        message: `yt:updateBinary failed: ${err.message || String(err)}`
      });
      return { success: false, output: err.message || String(err), version: null };
    }
  });
}
