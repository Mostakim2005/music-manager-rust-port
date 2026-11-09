import { describe, expect, it, vi } from 'vitest';

vi.mock('@/utils', () => ({
  isElectron: false
}));

class MockAudio {
  crossOrigin = '';
  preload = '';
  src = '';
  volume = 1;
  playbackRate = 1;
  currentTime = 0;
  duration = 180;
  paused = true;
  ended = false;
  error = null;
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  load = vi.fn();
  play = vi.fn(async () => {
    this.paused = false;
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
}

vi.stubGlobal('Audio', MockAudio);
vi.stubGlobal('window', {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn()
});
vi.stubGlobal('localStorage', {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn()
});
vi.stubGlobal('navigator', {
  clipboard: {
    writeText: vi.fn(async () => undefined)
  }
});

const loadAudioServiceModule = async () => import('../src/renderer/services/audioService');
import {
  isSupportedAudioFormat,
  parseMultiArtists,
  parseMultiGenres,
  toSongResult
} from '../src/renderer/utils/localMusicUtils';
import {
  alignSubLyrics,
  copyLyric,
  lyricParser,
  parseLyric,
  getWordFillProgress
} from '../src/renderer/utils/lyrics';
import { useLinkedMediaSync } from '../src/renderer/composables/useLinkedMediaSync';

describe('YesPlayMusic Ported Features & Namida Enhancements', () => {
  describe('1. Romanized & Translated Lyrics Engine (YesPlayMusic port)', () => {
    it('parses standard LRC timestamps and strips metadata headers', () => {
      const rawLrc = [
        '[ti:夜に駆ける]',
        '[ar:YOASOBI]',
        '[by:YesPlayMusic]',
        '[00:01.50]沈むように溶けてゆくように',
        '[00:05.20][00:15.20]二人だけの空が広がる夜に'
      ].join('\n');

      const parsed = parseLyric(rawLrc);
      expect(parsed.length).toBe(3);
      expect(parsed[0]).toEqual({
        time: 1.5,
        rawTime: '[00:01.50]',
        content: '沈むように溶けてゆくように'
      });
      expect(parsed[1].time).toBe(5.2);
      expect(parsed[2].time).toBe(15.2);
    });

    it('extracts lyric, tlyric (translation), and romalyric (Romanization) via lyricParser', () => {
      const responseData = {
        lrc: {
          lyric: '[00:01.00]沈むように\n[00:04.50]さよならだけだった'
        },
        tlyric: {
          lyric: '[00:01.00]如同沉溺一般\n[00:04.50]只剩下一句再见'
        },
        romalrc: {
          lyric: '[00:01.00]shizumu you ni\n[00:04.50]sayonara dake datta'
        }
      };

      const result = lyricParser(responseData);
      expect(result.lyric).toHaveLength(2);
      expect(result.tlyric).toHaveLength(2);
      expect(result.romalyric).toHaveLength(2);
      expect(result.romalyric[0].content).toBe('shizumu you ni');
      expect(result.tlyric[1].content).toBe('只剩下一句再见');

      const alignedTrans = alignSubLyrics(
        [1.0, 4.5],
        ['沈むように', 'さよならだけだった'],
        result.tlyric
      );
      const alignedRoma = alignSubLyrics(
        [1.0, 4.5],
        ['沈むように', 'さよならだけだった'],
        result.romalyric
      );

      expect(alignedTrans).toEqual(['如同沉溺一般', '只剩下一句再见']);
      expect(alignedRoma).toEqual(['shizumu you ni', 'sayonara dake datta']);
    });

    it('supports copyLyric helper', async () => {
      const ok = await copyLyric('Line 1\nLine 2');
      expect(ok).toBe(true);
    });
  });

  describe('2. Smooth 200ms Play/Pause Volume Fade Constants & Audio Transitions', () => {
    it('exports PLAY_PAUSE_FADE_DURATION = 200ms matching YesPlayMusic and configures Smart Transitions', async () => {
      const { PLAY_PAUSE_FADE_DURATION, audioService } = await loadAudioServiceModule();
      expect(PLAY_PAUSE_FADE_DURATION).toBe(200);

      const updatedConfig = audioService.setSmartTransitionConfig({
        crossfadeEnabled: true,
        crossfadeDuration: 6,
        skipSilenceEnabled: true,
        replayGainEnabled: true
      });
      expect(updatedConfig.crossfadeEnabled).toBe(true);
      expect(updatedConfig.crossfadeDuration).toBe(6);
      expect(updatedConfig.skipSilenceEnabled).toBe(true);
      expect(updatedConfig.replayGainEnabled).toBe(true);
    });
  });

  describe('3. Namida Multi-Artist & Genre Delimiter Parsing + Unified Audio/Video Queue', () => {
    it('splits multi-artist strings on feat., ft., &, ;, ,, and /', () => {
      const artists = parseMultiArtists('YOASOBI feat. 初音ミク & Kenshi Yonezu; Ado / ZUTOMAYO, Eve');
      expect(artists).toEqual([
        'YOASOBI',
        '初音ミク',
        'Kenshi Yonezu',
        'Ado',
        'ZUTOMAYO',
        'Eve'
      ]);
    });

    it('splits multi-genre strings cleanly', () => {
      const genres = parseMultiGenres('J-Pop; Vocaloid / Synthwave & Electronic, Rock');
      expect(genres).toEqual(['J-Pop', 'Vocaloid', 'Synthwave', 'Electronic', 'Rock']);
    });

    it('supports unified audio and video formats (.opus, .mp4, .webm)', () => {
      expect(isSupportedAudioFormat('C:/Music/song.opus')).toBe(true);
      expect(isSupportedAudioFormat('C:/Music/mv.mp4')).toBe(true);
      expect(isSupportedAudioFormat('C:/Music/live.webm')).toBe(true);

      const videoSong = toSongResult({
        id: 'local-mv-1',
        filePath: 'C:/Music/YOASOBI_Idol.mp4',
        title: 'Idol',
        artist: 'YOASOBI feat. Real Akiba Boyz',
        album: 'THE BOOK 3',
        duration: 213000,
        coverPath: null,
        lyrics: null,
        fileSize: 1024000,
        modifiedTime: Date.now()
      });

      expect(videoSong.ar.map((a) => a.name)).toEqual(['YOASOBI', 'Real Akiba Boyz']);
      expect(videoSong.videoUrl).toBeDefined();
      expect(videoSong.videoUrl).toContain('local://');
    });
  });

  describe('4. Namida Word-by-Word Karaoke Fill Progress', () => {
    it('returns 0 before word starts, 1 after word finishes, and linear ratio in between', () => {
      const word = { startTime: 1000, duration: 500 };
      expect(getWordFillProgress(word, 800)).toBe(0);
      expect(getWordFillProgress(word, 1000)).toBe(0);
      expect(getWordFillProgress(word, 1250)).toBe(0.5);
      expect(getWordFillProgress(word, 1500)).toBe(1);
      expect(getWordFillProgress(word, 1800)).toBe(1);
    });
  });

  describe('5. Proportional Rate-Locked Audio/Video Sync (useLinkedMediaSync)', () => {
    it('enforces that video is strictly muted and volume is 0', () => {
      const mockAudio = { paused: false, currentTime: 10.0, playbackRate: 1.0 } as HTMLAudioElement;
      const mockVideo = {
        paused: false,
        currentTime: 10.0,
        playbackRate: 1.0,
        muted: false,
        volume: 0.8,
        readyState: 4,
        play: vi.fn(),
        pause: vi.fn()
      } as unknown as HTMLVideoElement;

      const { enforceSyncTick } = useLinkedMediaSync(
        () => mockAudio,
        () => mockVideo
      );

      enforceSyncTick();
      expect(mockVideo.muted).toBe(true);
      expect(mockVideo.volume).toBe(0);
    });

    it('proportionally micro-adjusts video playbackRate when drift is between 35ms and 450ms', () => {
      const mockAudio = { paused: false, currentTime: 10.0, playbackRate: 1.0 } as HTMLAudioElement;
      const mockVideo = {
        paused: false,
        currentTime: 10.1, // video is 100ms ahead -> drift = +0.1
        playbackRate: 1.0,
        muted: true,
        volume: 0,
        readyState: 4,
        play: vi.fn(),
        pause: vi.fn()
      } as unknown as HTMLVideoElement;

      const { enforceSyncTick } = useLinkedMediaSync(
        () => mockAudio,
        () => mockVideo
      );

      enforceSyncTick();
      // correction = -0.1 * 0.25 = -0.025 -> new rate = 0.975
      expect(mockVideo.playbackRate).toBe(0.975);
    });

    it('hard-seeks video when drift exceeds 450ms', () => {
      const mockAudio = { paused: false, currentTime: 10.0, playbackRate: 1.0 } as HTMLAudioElement;
      const mockVideo = {
        paused: false,
        currentTime: 12.0, // video is 2.0s ahead -> drift = +2.0
        playbackRate: 1.0,
        muted: true,
        volume: 0,
        readyState: 4,
        play: vi.fn(),
        pause: vi.fn()
      } as unknown as HTMLVideoElement;

      const { enforceSyncTick } = useLinkedMediaSync(
        () => mockAudio,
        () => mockVideo
      );

      enforceSyncTick();
      expect(mockVideo.currentTime).toBe(10.0);
      expect(mockVideo.playbackRate).toBe(1.0);
    });
  });
});
