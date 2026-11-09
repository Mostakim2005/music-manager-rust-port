/**
 * Pure format parsing, estimation and URL extraction utilities for YouTube media.
 * Free of Electron dependencies so it can be tested directly in Vitest.
 */

export interface YtAudioFormat {
  formatId: string;
  ext: string;
  abrKbps: number;
  sizeBytes: number;
  /** Normalized codec name (aac, opus, mp3, …). */
  acodec: string;
}

export interface YtVideoFormat {
  formatId: string;
  height: number;
  fps: number;
  ext: string;
  vbrKbps: number;
  sizeBytes: number;
  hasAudio: boolean;
  /** Normalized codec name (h264, av01, vp9, …). */
  vcodec: string;
}

export interface YtFormatsResult {
  id: string;
  title: string;
  durationSec: number;
  thumbnail: string;
  audio: YtAudioFormat[];
  video: YtVideoFormat[];
}

export interface YtSearchResult {
  id: string;
  title: string;
  channel: string;
  durationSec: number;
  viewCount: number;
  uploadDate?: string;
  thumbnail: string;
  url: string;
}

/**
 * Standard YouTube video quality heights in descending order.
 */

export interface YtStreamUrlResult {
  videoUrl: string;
  audioUrl?: string;
  headers?: Record<string, string>;
  isMuxedProxy?: boolean;
}

export interface YtDownloadOptions {
  kind: 'audio' | 'video';
  height?: number;
  formatId?: string;
  videoOnly?: boolean;
  audioFormat?: 'm4a' | 'mp3' | 'opus';
  targetDir?: string;
  fileBaseName?: string;
  embedLink?: boolean;
}

export interface YtDownloadProgress {
  jobId: string;
  percent: number;
  speed: string;
  eta: string;
  state: 'queued' | 'downloading' | 'processing' | 'completed' | 'cancelled' | 'error';
  filePath?: string;
  error?: string;
}

export interface YtBinaryStatus {
  ytDlp: {
    installed: boolean;
    path: string;
    version: string | null;
  };
  ffmpeg: {
    installed: boolean;
    path: string;
    version: string | null;
  };
}

export const STANDARD_HEIGHTS = [1080, 720, 480, 360, 240, 144] as const;

/**
 * Extracts an 11-character YouTube video ID from a URL or raw ID string.
 * Supports:
 * - Direct ID (11 chars)
 * - https://www.youtube.com/watch?v=ID
 * - https://youtu.be/ID
 * - https://music.youtube.com/watch?v=ID
 * - https://www.youtube.com/shorts/ID
 * - https://www.youtube.com/embed/ID
 * - URLs with additional query parameters or timestamps
 */
export function extractVideoId(input: string | null | undefined): string | null {
  if (!input || typeof input !== 'string') return null;

  const trimmed = input.trim();
  if (!trimmed) return null;

  // Direct 11-character video ID regex (alphanumeric, dash, underscore)
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  // URL matching patterns
  const patterns = [
    /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|shorts\/|watch\?v=|watch\?.+&v=))([a-zA-Z0-9_-]{11})/i,
    /music\.youtube\.com\/watch\?(?:.*&)?v=([a-zA-Z0-9_-]{11})/i
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}

/**
 * Normalizes a raw yt-dlp codec string to a short display name.
 * e.g. "av01.0.08M.08" -> "av01", "vp09.00.10.08" -> "vp9", "avc1.640028" -> "h264".
 */
export function normalizeCodec(raw: string | null | undefined): string {
  if (!raw || raw === 'none') return 'unknown';
  const lower = raw.toLowerCase();
  if (lower.startsWith('av01')) return 'av01';
  if (lower.startsWith('vp09') || lower.startsWith('vp9')) return 'vp9';
  if (lower.startsWith('vp08') || lower.startsWith('vp8')) return 'vp8';
  if (lower.startsWith('avc1') || lower.startsWith('avc')) return 'h264';
  if (lower.startsWith('hev1') || lower.startsWith('hvc1') || lower.startsWith('hevc')) return 'hevc';
  if (lower.startsWith('mp4a') || lower.startsWith('aac')) return 'aac';
  if (lower.startsWith('opus')) return 'opus';
  if (lower.startsWith('mp3')) return 'mp3';
  if (lower.startsWith('vorbis')) return 'vorbis';
  if (lower.startsWith('flac')) return 'flac';
  if (lower.startsWith('ac-3') || lower.startsWith('ac3')) return 'ac3';
  // Generic fallback: the raw codec family without profile/level suffixes.
  return raw.split('.')[0].toLowerCase();
}

/**
 * Estimates file size in bytes if not explicitly provided.
 */
export function estimateSizeBytes(
  filesize: number | null | undefined,
  filesizeApprox: number | null | undefined,
  bitrateKbps: number | null | undefined,
  durationSec: number | null | undefined
): number {
  if (typeof filesize === 'number' && filesize > 0) {
    return filesize;
  }
  if (typeof filesizeApprox === 'number' && filesizeApprox > 0) {
    return filesizeApprox;
  }
  if (
    typeof bitrateKbps === 'number' &&
    bitrateKbps > 0 &&
    typeof durationSec === 'number' &&
    durationSec > 0
  ) {
    // kbps -> bytes per second: (kbps * 1000) / 8
    return Math.round(((bitrateKbps * 1000) / 8) * durationSec);
  }
  return 0;
}

/**
 * Maps and groups formats from raw yt-dlp -J output.
 * Groups videos by standard heights (1080/720/480/360/240/144) picking the best per height.
 * Formats audio tracks sorted descending by abrKbps.
 */
export function mapAndGroupFormats(raw: any): YtFormatsResult {
  const id = raw.id || '';
  const title = raw.title || '';
  const durationSec = typeof raw.duration === 'number' ? Math.round(raw.duration) : 0;

  // Choose the best thumbnail URL
  let thumbnail = '';
  if (Array.isArray(raw.thumbnails) && raw.thumbnails.length > 0) {
    // Pick the highest resolution thumbnail or the last in the array
    const sorted = [...raw.thumbnails].sort(
      (a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0)
    );
    thumbnail = sorted[0]?.url || '';
  }
  if (!thumbnail) {
    thumbnail = raw.thumbnail || (id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : '');
  }

  const formats: any[] = Array.isArray(raw.formats) ? raw.formats : [];

  // Parse audio formats: formats that have acodec !== 'none' and vcodec === 'none' (or ext in audio types)
  const audioList: YtAudioFormat[] = [];
  const audioSeen = new Set<string>();

  for (const f of formats) {
    // Skip storyboards or protocol mhtml
    if (f.protocol === 'mhtml' || f.format_note === 'storyboard' || f.ext === 'mhtml') continue;

    const isAudioOnly = (f.vcodec === 'none' || !f.vcodec) && f.acodec && f.acodec !== 'none';

    if (isAudioOnly) {
      const abr =
        typeof f.abr === 'number' && f.abr > 0
          ? Math.round(f.abr)
          : typeof f.tbr === 'number' && f.tbr > 0
            ? Math.round(f.tbr)
            : 128;

      const sizeBytes = estimateSizeBytes(f.filesize, f.filesize_approx, abr, durationSec);
      const ext = f.ext || 'm4a';
      const acodec = normalizeCodec(f.acodec);
      const key = `${ext}_${abr}_${acodec}`;

      if (!audioSeen.has(key)) {
        audioSeen.add(key);
        audioList.push({
          formatId: String(f.format_id),
          ext,
          abrKbps: abr,
          sizeBytes,
          acodec
        });
      }
    }
  }

  // Sort audio by abrKbps descending
  audioList.sort((a, b) => b.abrKbps - a.abrKbps);

  // Parse video formats
  // We collect all valid video formats (vcodec !== 'none' and height > 0)
  const videoCandidates: Array<{
    formatId: string;
    height: number;
    fps: number;
    ext: string;
    vbrKbps: number;
    sizeBytes: number;
    hasAudio: boolean;
    vcodec: string;
  }> = [];

  for (const f of formats) {
    if (f.protocol === 'mhtml' || f.format_note === 'storyboard' || f.ext === 'mhtml') continue;

    const height = typeof f.height === 'number' ? f.height : 0;
    if (height <= 0) continue;

    const hasVideo = f.vcodec && f.vcodec !== 'none';
    if (!hasVideo) continue;

    const hasAudio = !!(f.acodec && f.acodec !== 'none');
    const fps = typeof f.fps === 'number' ? Math.round(f.fps) : 30;
    const vbr =
      typeof f.vbr === 'number' && f.vbr > 0
        ? Math.round(f.vbr)
        : typeof f.tbr === 'number' && f.tbr > 0
          ? Math.round(f.tbr)
          : 0;

    const sizeBytes = estimateSizeBytes(f.filesize, f.filesize_approx, vbr, durationSec);

    videoCandidates.push({
      formatId: String(f.format_id),
      height,
      fps,
      ext: f.ext || 'mp4',
      vbrKbps: vbr,
      sizeBytes,
      hasAudio,
      vcodec: normalizeCodec(f.vcodec)
    });
  }

  // Group by standard heights (1080, 720, 480, 360, 240, 144), one entry per
  // (height, codec) pair: the same resolution can arrive in several codecs with
  // different bitrates and sizes, and each becomes its own selectable row.
  // For any candidate, map its height to the closest standard height
  // (e.g. 1080p, 720p, etc.) or match exact
  const videoMap = new Map<string, (typeof videoCandidates)[0]>();

  for (const stdHeight of STANDARD_HEIGHTS) {
    // Find candidates whose height matches stdHeight (or close within ±4px)
    const matches = videoCandidates.filter((v) => Math.abs(v.height - stdHeight) <= 4);
    if (matches.length > 0) {
      const byCodec = new Map<string, (typeof videoCandidates)[0][]>();
      for (const m of matches) {
        const list = byCodec.get(m.vcodec) || [];
        list.push(m);
        byCodec.set(m.vcodec, list);
      }

      for (const [codec, list] of byCodec.entries()) {
        // Pick best candidate per codec:
        // Preference:
        // 1. Higher FPS (e.g. 60 vs 30)
        // 2. Higher vbrKbps
        // 3. Progressive (hasAudio = true) if bitrates are similar
        // 4. ext == 'mp4' for best compatibility in Chromium
        list.sort((a, b) => {
          if (b.fps !== a.fps) return b.fps - a.fps;
          if (b.vbrKbps !== a.vbrKbps) return b.vbrKbps - a.vbrKbps;
          if (a.hasAudio !== b.hasAudio) return a.hasAudio ? -1 : 1;
          if (a.ext === 'mp4' && b.ext !== 'mp4') return -1;
          if (b.ext === 'mp4' && a.ext !== 'mp4') return 1;
          return 0;
        });

        const best = list[0];
        videoMap.set(`${stdHeight}|${codec}`, {
          ...best,
          height: stdHeight // normalize to standard height label
        });
      }
    }
  }

  // If a video has other distinct heights (e.g. 1440, 2160) not matched by standard,
  // we can also include them or keep the standard set.
  // The spec: "Group the video list by height (1080/720/480/360/240/144), picking the best per height."
  const videoList: YtVideoFormat[] = [];
  for (const h of STANDARD_HEIGHTS) {
    const codecEntries = [...videoMap.entries()]
      .filter(([key]) => key.startsWith(`${h}|`))
      .map(([, v]) => v);
    // Within one height, strongest variant first (highest bitrate).
    codecEntries.sort((a, b) => b.vbrKbps - a.vbrKbps);
    videoList.push(...codecEntries);
  }

  // If no video matched standard heights (e.g. only non-standard height present), include available
  if (videoList.length === 0 && videoCandidates.length > 0) {
    videoCandidates.sort((a, b) => b.height - a.height || b.vbrKbps - a.vbrKbps);
    const seenHC = new Set<string>();
    for (const v of videoCandidates) {
      const key = `${v.height}|${v.vcodec}`;
      if (!seenHC.has(key)) {
        seenHC.add(key);
        videoList.push(v);
      }
    }
  }

  return {
    id,
    title,
    durationSec,
    thumbnail,
    audio: audioList,
    video: videoList
  };
}
