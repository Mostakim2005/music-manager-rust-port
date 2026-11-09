import { ElectronAPI } from '@electron-toolkit/preload';

import type { AppUpdateState } from '../shared/appUpdate';

interface API {
  /** Loopback HTTP origin for local media playback ('' when the server is unavailable). */
  localMediaBaseUrl: string;
  /** Computes an acoustic fingerprint used to match the same recording across qualities. */
  getAudioFingerprint: (
    filePath: string
  ) => Promise<{ fingerprint: string; durationSec: number; windows: number } | null>;
  /** Deletes a downloaded or local variant file from disk. */
  deleteVariantFile: (
    filePath: string
  ) => Promise<{ ok: boolean; deleted?: boolean; error?: string }>;
  minimize: () => void;
  maximize: () => void;
  isMaximized: () => Promise<boolean>;
  onWindowMaximizedState: (callback: (maximized: boolean) => void) => () => void;
  toggleFullScreen: () => void;
  isFullScreen: () => Promise<boolean>;
  onWindowFullScreenState: (callback: (fullscreen: boolean) => void) => () => void;
  close: () => void;
  quitApp: () => void;
  dragStart: (data: any) => void;
  miniTray: () => void;
  miniWindow: () => void;
  restore: () => void;
  restart: () => void;
  resizeWindow: (width: number, height: number) => void;
  resizeMiniWindow: (showPlaylist: boolean) => void;
  openLyric: () => void;
  sendLyric: (data: any) => void;
  sendSong: (data: any) => void;
  unblockMusic: (id: number, data: any, enabledSources?: string[]) => Promise<any>;
  onLyricWindowClosed: (callback: () => void) => void;
  onLyricWindowReady: (callback: () => void) => void;
  getAppUpdateState: () => Promise<AppUpdateState>;
  checkAppUpdate: (manual?: boolean) => Promise<AppUpdateState>;
  downloadAppUpdate: () => Promise<AppUpdateState>;
  installAppUpdate: () => Promise<boolean>;
  openAppUpdatePage: () => Promise<boolean>;
  onAppUpdateState: (callback: (state: AppUpdateState) => void) => void;
  removeAppUpdateListeners: () => void;
  onLanguageChanged: (callback: (locale: string) => void) => void;
  importCustomApiPlugin: () => Promise<{ name: string; content: string } | null>;
  importLxMusicScript: () => Promise<{ name: string; content: string } | null>;
  importMusicSourcePlugin: () => Promise<{ name: string; content: string; path?: string } | null>;
  fetchMusicSourcePlugin: (url: string) => Promise<{ name: string; content: string; url: string }>;
  reportError: (entry: any) => Promise<any>;
  invoke: (channel: string, ...args: any[]) => Promise<any>;
  getSearchSuggestions: (keyword: string) => Promise<any>;
  lxMusicHttpRequest: (request: { url: string; options: any; requestId: string }) => Promise<any>;
  lxMusicHttpCancel: (requestId: string) => Promise<void>;
  scanLocalMusic: (folderPath: string) => Promise<{ files: string[]; count: number }>;
  scanLocalMusicWithStats: (
    folderPath: string
  ) => Promise<{ files: { path: string; modifiedTime: number }[]; count: number }>;
  parseLocalMusicMetadata: (
    filePaths: string[]
  ) => Promise<import('../renderer/types/localMusic').LocalMusicMeta[]>;
  fetchOnlineMetadata: (query: { title: string; artist?: string; album?: string }) => Promise<{
    results: Array<{
      title: string;
      artist: string;
      album: string;
      year: string;
      genre: string;
      trackNumber: number;
      coverUrl: string;
      source: 'iTunes' | 'MusicBrainz';
    }>;
  }>;
  fetchMultiSourceLyrics: (query: {
    title: string;
    artist?: string;
    album?: string;
    durationSec?: number;
  }) => Promise<{
    lrc: string;
    tlyric: string;
    romalrc: string;
    source: string;
    candidates: Array<{
      id: number | string;
      trackName: string;
      artistName: string;
      albumName: string;
      syncedLyrics: string;
      plainLyrics: string;
      source: string;
    }>;
  }>;
  updateLocalMusicTagsAndFile: (payload: {
    filePath: string;
    newFileName?: string;
    title: string;
    artist: string;
    album: string;
    year?: string;
    genre?: string;
    lyrics?: string;
    coverDataUrlOrPath?: string;
    saveSidecarLrc?: boolean;
  }) => Promise<{
    ok: boolean;
    updatedEntry?: import('../renderer/types/localMusic').LocalMusicMeta;
    error?: string;
  }>;
  saveSyncedLyrics: (params: {
    filePath: string;
    lyrics: string;
    saveSidecar?: boolean;
  }) => Promise<{ ok: boolean; error?: string }>;
  selectCoverFile: () => Promise<{
    canceled: boolean;
    filePath: string | null;
    dataUrl: string | null;
  }>;
  exportM3u8: (params: {
    tracks: Array<{ filePath: string; title?: string; artist?: string; duration?: number }>;
    defaultName?: string;
  }) => Promise<{ ok?: boolean; canceled?: boolean; filePath?: string; error?: string }>;
  importM3u8: () => Promise<{
    ok?: boolean;
    canceled?: boolean;
    filePaths?: string[];
    playlistFilePath?: string;
    error?: string;
  }>;
  exportBackupJson: (params: {
    payload: Record<string, any>;
    defaultName?: string;
  }) => Promise<{ ok?: boolean; canceled?: boolean; filePath?: string; error?: string }>;
  importBackupJson: () => Promise<{
    ok?: boolean;
    canceled?: boolean;
    data?: any;
    filePath?: string;
    error?: string;
  }>;
  // Download manager
  downloadAdd: (task: any) => Promise<string>;
  downloadAddBatch: (tasks: any) => Promise<{ batchId: string; taskIds: string[] }>;
  downloadPause: (taskId: string) => Promise<void>;
  downloadResume: (taskId: string) => Promise<void>;
  downloadCancel: (taskId: string) => Promise<void>;
  downloadCancelAll: () => Promise<void>;
  downloadGetQueue: () => Promise<any[]>;
  downloadSetConcurrency: (n: number) => void;
  downloadGetCompleted: () => Promise<any[]>;
  downloadDeleteCompleted: (filePath: string) => Promise<boolean>;
  downloadClearCompleted: () => Promise<boolean>;
  getEmbeddedLyrics: (filePath: string) => Promise<string | null>;
  downloadProvideUrl: (taskId: string, url: string) => Promise<void>;
  onDownloadProgress: (cb: (data: any) => void) => void;
  onDownloadStateChange: (cb: (data: any) => void) => void;
  onDownloadBatchComplete: (cb: (data: any) => void) => void;
  onDownloadRequestUrl: (cb: (data: any) => void) => void;
  removeDownloadListeners: () => void;
  sendMediaPlay?: (data: any) => void;
  onMediaPauseAll?: (callback: (data: any) => void) => () => void;
  selectDirectory: () => Promise<{ canceled: boolean; filePaths: string[] }>;
  saveLyricFile: (params: {
    filename: string;
    lrcContent: string;
    targetDir?: string;
  }) => Promise<{ success: boolean; path?: string; error?: string }>;
  youtube: YouTubeBridge;
}

export interface YouTubeBridge {
  search: (
    query: string,
    options?: { limit?: number; type?: 'video' | 'music' }
  ) => Promise<import('../main/modules/youtubeFormats').YtSearchResult[]>;
  formats: (idOrUrl: string) => Promise<import('../main/modules/youtubeFormats').YtFormatsResult>;
  streamUrl: (
    idOrUrl: string,
    options?: { kind?: 'audio' | 'video'; height?: number }
  ) => Promise<import('../main/modules/youtubeFormats').YtStreamUrlResult>;
  download: (
    idOrUrl: string,
    options: import('../main/modules/youtubeFormats').YtDownloadOptions
  ) => Promise<string>;
  cancelDownload: (jobId: string) => Promise<boolean>;
  readLink: (filePath: string) => Promise<string | null>;
  writeLink: (filePath: string, youtubeUrl: string) => Promise<{ ok: boolean; error?: string }>;
  resolveDownloadDir: (contextFilePath?: string) => Promise<string>;
  binaryStatus: () => Promise<import('../main/modules/youtubeFormats').YtBinaryStatus>;
  updateBinary: () => Promise<{ success: boolean; output: string; version: string | null }>;
  onDownloadProgress: (
    callback: (progress: import('../main/modules/youtubeFormats').YtDownloadProgress) => void
  ) => () => void;
}

interface IpcRenderer {
  send: (channel: string, ...args: any[]) => void;
  reportError: (entry: any) => Promise<any>;
  invoke: (channel: string, ...args: any[]) => Promise<any>;
  on: (channel: string, listener: (...args: any[]) => void) => () => void;
  removeAllListeners: (channel: string) => void;
}

declare global {
  interface Window {
    electron: ElectronAPI;
    api: API;
    youtube: YouTubeBridge;
    ipcRenderer: IpcRenderer;
    $message: any;
  }
}
