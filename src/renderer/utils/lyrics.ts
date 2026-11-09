/**
 * Romanized & Translated Lyrics Engine
 * Ported from YesPlayMusic/src/utils/lyrics.js with TypeScript support
 * Supports standard LRC, tlyric (translation), and romalyric (Romanization / phonetic subtitles)
 */

export interface ParsedLyric {
  time: number;
  rawTime: string;
  content: string;
}

export interface RawLyricField {
  version?: number;
  lyric?: string;
}

export interface RawLyricResponse {
  lrc?: RawLyricField;
  tlyric?: RawLyricField;
  romalrc?: RawLyricField;
  yrc?: RawLyricField;
  ytlrc?: RawLyricField;
  yromalrc?: RawLyricField;
  lyricUser?: unknown;
  transUser?: unknown;
}

export interface LyricParserResult {
  lyric: ParsedLyric[];
  tlyric: ParsedLyric[];
  romalyric: ParsedLyric[];
  lyricuser?: unknown;
  transuser?: unknown;
}

// regexr.com/6e52n
const extractLrcRegex = /^(?<lyricTimestamps>(?:\[.+?\])+)(?!\[)(?<content>.+)$/gm;
const extractTimestampRegex = /\[(?<min>\d+):(?<sec>\d+)(?:\.|:)*(?<ms>\d+)*\]/g;

/**
 * Parse a raw lyric response object into structured lyric, tlyric, and romalyric arrays.
 */
export function lyricParser(lrc: RawLyricResponse | null | undefined): LyricParserResult {
  return {
    lyric: parseLyric(lrc?.lrc?.lyric || ''),
    tlyric: parseLyric(lrc?.tlyric?.lyric || lrc?.ytlrc?.lyric || ''),
    romalyric: parseLyric(lrc?.romalrc?.lyric || lrc?.yromalrc?.lyric || ''),
    lyricuser: lrc?.lyricUser,
    transuser: lrc?.transUser
  };
}

/**
 * Parse an LRC formatted string into a time-sorted array of ParsedLyric items.
 *
 * @param lrc The raw LRC string input.
 * @returns Sorted array of ParsedLyric items.
 * @example parseLyric("[00:00.00] Hello, World!\n[00:00.10] Test\n");
 */
export function parseLyric(lrc: string): ParsedLyric[] {
  if (!lrc || typeof lrc !== 'string') {
    return [];
  }

  const parsedLyrics: ParsedLyric[] = [];

  const binarySearch = (lyric: ParsedLyric): number => {
    const time = lyric.time;

    let low = 0;
    let high = parsedLyrics.length - 1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const midTime = parsedLyrics[mid].time;
      if (midTime === time) {
        return mid;
      } else if (midTime < time) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return low;
  };

  for (const line of lrc.trim().matchAll(extractLrcRegex)) {
    const groups = line.groups;
    if (!groups) continue;
    const { lyricTimestamps, content } = groups;

    for (const timestamp of lyricTimestamps.matchAll(extractTimestampRegex)) {
      const tsGroups = timestamp.groups;
      if (!tsGroups) continue;
      const { min, sec, ms } = tsGroups;
      const validMs = ms?.slice(0, 2) ?? '00';
      const rawTime = `[${min}:${sec}.${validMs}]`;
      const time = Number(min) * 60 + Number(sec) + Number(validMs) * 0.01;

      const parsedLyric: ParsedLyric = { rawTime, time, content: trimContent(content) };
      parsedLyrics.splice(binarySearch(parsedLyric), 0, parsedLyric);
    }
  }

  return parsedLyrics;
}

function trimContent(content: string): string {
  const t = content.trim();
  return t.length < 1 ? content : t;
}

/**
 * Align secondary lyrics (translation or romanization) to primary lyric timestamps.
 * Supports 1:1 index matching when line counts match and fuzzy timestamp matching (<= 2.0s tolerance).
 */
export function alignSubLyrics(
  primaryTimes: number[],
  primaryTexts: string[],
  subLyrics: Array<{ time: number; content: string }>
): string[] {
  if (!subLyrics.length || !primaryTimes.length) {
    return primaryTimes.map(() => '');
  }

  if (subLyrics.length === primaryTimes.length) {
    return primaryTexts.map((text, index) =>
      text && subLyrics[index] ? subLyrics[index].content : ''
    );
  }

  const subMap = new Map<number, string>();
  for (const item of subLyrics) {
    if (item.content && Number.isFinite(item.time)) {
      subMap.set(item.time, item.content);
    }
  }

  return primaryTimes.map((currentTime, index) => {
    if (!primaryTexts[index]) return '';
    let closestTime = -1;
    let minDiff = 2.0;

    for (const [sTime] of subMap.entries()) {
      const diff = Math.abs(sTime - currentTime);
      if (diff < minDiff) {
        minDiff = diff;
        closestTime = sTime;
      }
    }

    return closestTime !== -1 ? subMap.get(closestTime) || '' : '';
  });
}

/**
 * Copy lyric text to the system clipboard with fallback support.
 */
export async function copyLyric(lyric: string): Promise<boolean> {
  const textToCopy = lyric;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(textToCopy);
      return true;
    } catch {
      return false;
    }
  } else {
    const tempInput = document.createElement('textarea');
    tempInput.value = textToCopy;
    tempInput.style.position = 'absolute';
    tempInput.style.left = '-9999px';
    document.body.appendChild(tempInput);
    tempInput.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    document.body.removeChild(tempInput);
    return ok;
  }
}

/**
 * Format raw seconds into standard LRC timestamp string "[mm:ss.xx]"
 * Example: 65.34 -> "[01:05.34]"
 * Pass `precision: 3` for extended LRC milliseconds ("[01:05.340]").
 */
export function formatLrcTimestamp(seconds: number, precision: 2 | 3 = 2): string {
  if (isNaN(seconds) || seconds < 0) seconds = 0;
  const scale = precision === 3 ? 1000 : 100;
  const mins = Math.floor(seconds / 60);
  const remSecs = seconds % 60;
  const wholeSecs = Math.floor(remSecs);
  let frac = Math.round((remSecs - wholeSecs) * scale);
  let finalSecs = wholeSecs;
  let finalMins = mins;

  if (frac >= scale) {
    frac = 0;
    finalSecs += 1;
  }
  if (finalSecs >= 60) {
    finalSecs = 0;
    finalMins += 1;
  }

  const mStr = String(finalMins).padStart(2, '0');
  const sStr = String(finalSecs).padStart(2, '0');
  const msStr = String(frac).padStart(precision, '0');
  return `[${mStr}:${sStr}.${msStr}]`;
}

/**
 * Format seconds as a compact "mm:ss,ms" line-time label (milliseconds with a
 * comma separator), e.g. 15.59 -> "00:15,590". Pass `brackets: true` to get
 * "[00:15,590]".
 */
export function formatLrcTimestampMs(
  seconds: number,
  opts?: { brackets?: boolean }
): string {
  if (isNaN(seconds) || seconds < 0) seconds = 0;
  const mins = Math.floor(seconds / 60);
  const remSecs = seconds % 60;
  const wholeSecs = Math.floor(remSecs);
  let ms = Math.round((remSecs - wholeSecs) * 1000);
  let finalSecs = wholeSecs;
  let finalMins = mins;
  if (ms >= 1000) {
    ms = 0;
    finalSecs += 1;
  }
  if (finalSecs >= 60) {
    finalSecs = 0;
    finalMins += 1;
  }
  const mStr = String(finalMins).padStart(2, '0');
  const sStr = String(finalSecs).padStart(2, '0');
  const msStr = String(ms).padStart(3, '0');
  return opts?.brackets ? `[${mStr}:${sStr},${msStr}]` : `${mStr}:${sStr},${msStr}`;
}

/**
 * Stamp a timestamp onto a lyric line, replacing any existing leading timestamp.
 */
export function stampLyricLine(line: string, timestampOrSeconds: string | number): string {
  const ts =
    typeof timestampOrSeconds === 'number'
      ? formatLrcTimestamp(timestampOrSeconds)
      : timestampOrSeconds;
  const cleanLine = line.replace(/^(?:\[\d+:\d+(?:\.\d+)?\]\s*)+/g, '').trimStart();
  return `${ts}${cleanLine}`;
}

/**
 * Strip all leading timestamps from lyric lines.
 */
export function stripLrcTimestamps(lrcText: string): string {
  if (!lrcText) return '';
  return lrcText
    .split('\n')
    .map((line) => line.replace(/^(?:\[\d+:\d+(?:\.\d+)?\]\s*)+/g, '').trim())
    .join('\n');
}

/**
 * Parse an LRC timestamp string "[mm:ss.xx]", "mm:ss.xx" or the millisecond
 * form "mm:ss,ms" into raw seconds. Returns NaN if the timestamp cannot be
 * parsed.
 *
 * @example parseLrcTimestamp("[01:05.34]") // 65.34
 * @example parseLrcTimestamp("00:02.500") // 2.5
 * @example parseLrcTimestamp("00:15,590") // 15.59
 */
export function parseLrcTimestamp(timestamp: string): number {
  if (!timestamp || typeof timestamp !== 'string') return NaN;
  const match = timestamp.trim().match(/\[?(\d+):(\d+)(?:[.,](\d+))?\]?/);
  if (!match) return NaN;

  const mins = parseInt(match[1], 10);
  const secs = parseInt(match[2], 10);
  let fraction = 0;
  if (match[3]) {
    const rawFrac = match[3];
    if (rawFrac.length === 1) {
      fraction = parseInt(rawFrac, 10) / 10;
    } else if (rawFrac.length === 2) {
      fraction = parseInt(rawFrac, 10) / 100;
    } else {
      fraction = parseInt(rawFrac.slice(0, 3), 10) / 1000;
    }
  }

  return mins * 60 + secs + fraction;
}

/**
 * Nudge a single timestamp by a positive or negative delta (in seconds), clamping at 0.
 *
 * @example nudgeTimestamp("[01:00.00]", 0.5) // "[01:00.50]"
 * @example nudgeTimestamp("[00:00.20]", -0.5) // "[00:00.00]"
 */
export function nudgeTimestamp(timestamp: string, deltaSeconds: number): string {
  const current = parseLrcTimestamp(timestamp);
  const base = isNaN(current) ? 0 : current;
  const target = Math.max(0, base + deltaSeconds);
  return formatLrcTimestamp(target);
}

/**
 * Shift all timestamp markers inside an LRC text string by a global offset (in seconds).
 * Clamps all resulting timestamps at 0.
 *
 * @param lrcText Full multiline LRC text
 * @param offsetSeconds Global offset shift (e.g. +0.5, -0.2, or +1.0)
 * @returns Updated LRC text with all timestamps shifted and clamped
 */
export function shiftAllLrcTimestamps(lrcText: string, offsetSeconds: number): string {
  if (!lrcText || typeof lrcText !== 'string') return '';
  return lrcText.replace(/\[(\d+):(\d+)(?:\.(\d+))?\]/g, (match) => {
    return nudgeTimestamp(match, offsetSeconds);
  });
}

/**
 * Shift line-based timestamp array items by a given offset in seconds.
 */
export function shiftLinesTimestamps(
  lines: Array<{ timestamp: string; text: string }>,
  offsetSeconds: number
): Array<{ timestamp: string; text: string }> {
  if (!Array.isArray(lines)) return [];
  return lines.map((l) => ({
    timestamp: l.timestamp ? nudgeTimestamp(l.timestamp, offsetSeconds) : '',
    text: l.text
  }));
}


/**
 * Calculates syllable/word fill progress (0.0 to 1.0) for word-by-word karaoke glow.
 */
export function getWordFillProgress(
  word: { startTime: number; duration: number },
  currentTimeMs: number
): number {
  if (currentTimeMs <= word.startTime) return 0;
  if (currentTimeMs >= word.startTime + word.duration) return 1;
  return (currentTimeMs - word.startTime) / Math.max(1, word.duration);
}
