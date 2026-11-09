// src/renderer/api/tauriBridge.ts
import { invoke } from '@tauri-apps/api/core';
import { listen, emit, type UnlistenFn } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { getStreamBaseUrl } from '../utils/localMediaUrl';

// Keep track of event listeners by channel for removeAllListeners() compatibility
const channelUnlisteners = new Map<string, UnlistenFn[]>();

function registerListener<T = any>(
  channel: string,
  callback: (payload: T) => void
): () => void {
  let unlistenRef: UnlistenFn | null = null;
  let cancelled = false;

  listen<T>(channel, (event) => {
    if (!cancelled) callback(event.payload);
  }).then((unlisten) => {
    if (cancelled) {
      unlisten();
    } else {
      unlistenRef = unlisten;
      const list = channelUnlisteners.get(channel) || [];
      list.push(unlisten);
      channelUnlisteners.set(channel, list);
    }
  });

  return () => {
    cancelled = true;
    if (unlistenRef) unlistenRef();
  };
}

function clearChannelListeners(channel: string) {
  const list = channelUnlisteners.get(channel);
  if (list) {
    list.forEach((fn) => fn());
    channelUnlisteners.delete(channel);
  }
}

// Map hyphenated/colon Electron IPC channel names to Rust snake_case command names
const CHANNEL_TO_RUST_COMMAND: Record<string, string> = {
  'local-music:fingerprint': 'get_audio_fingerprint',
  'library:delete-variant-file': 'delete_variant_file',
  'is-window-maximized': 'is_window_maximized',
  'is-fullscreen': 'is_fullscreen',
  'get-system-fonts': 'get_system_fonts',
  'scan-local-music': 'scan_local_music',
  'scan-local-music-with-stats': 'scan_local_music_with_stats',
  'parse-local-music-metadata': 'parse_local_music_metadata',
  'metadata:fetch-online': 'fetch_online_metadata',
  'lyrics:fetch-multi-source': 'fetch_multi_source_lyrics',
  'local-music:update-tags-and-file': 'update_local_music_tags_and_file',
  'local-music:save-synced-lyrics': 'save_synced_lyrics',
  'library:export-m3u8': 'export_m3u8',
  'library:import-m3u8': 'import_m3u8',
  'library:export-backup-json': 'export_backup_json',
  'library:import-backup-json': 'import_backup_json',
  'get-search-suggestions': 'get_search_suggestions',
  'lx-music-http-request': 'lx_music_http_request',
  'lx-music-http-cancel': 'lx_music_http_cancel',
  'save-lyric-file': 'save_lyric_file',
  'generate-waveform-peaks': 'generate_waveform_peaks',
  'extract-image-palette': 'extract_image_palette',
  'get-lyrics': 'get_lyrics',
  'clear-lyrics-cache': 'clear_lyrics_cache',
  'get-cached-lyric': 'get_cached_lyric',
  'cache-lyric': 'cache_lyric',
  'clear-lyric-cache': 'clear_lyric_cache',
  'error-reporter:get-reports': 'error_reporter_get_reports',
  'error-reporter:report': 'error_reporter_report',
  'error-reporter:clear': 'error_reporter_clear',
  'error-reporter:export': 'error_reporter_export',
  'error-reporter:test': 'error_reporter_test'
};

export const youtube = {
  search: (query: string, options?: { limit?: number; type?: 'video' | 'music' }) =>
    invoke('yt_search', { query, options }),
  formats: (idOrUrl: string) => invoke('yt_formats', { idOrUrl }),
  streamUrl: (idOrUrl: string, options?: { kind?: 'audio' | 'video'; height?: number }) =>
    invoke('yt_stream_url', { idOrUrl, options }),
  download: (idOrUrl: string, options: any) => invoke('yt_download', { idOrUrl, options }),
  cancelDownload: (jobId: string) => invoke('yt_cancel_download', { jobId }),
  readLink: (filePath: string) => invoke('yt_read_link', { filePath }),
  writeLink: (filePath: string, youtubeUrl: string) =>
    invoke('yt_write_link', { filePath, youtubeUrl }),
  resolveDownloadDir: (contextFilePath?: string) =>
    invoke('yt_resolve_download_dir', { contextFilePath }),
  binaryStatus: () => invoke('yt_binary_status'),
  updateBinary: () => invoke('yt_update_binary'),
  onDownloadProgress: (callback: (progress: any) => void) =>
    registerListener('yt:download-progress', callback)
};

export const api = {
  localMediaBaseUrl: getStreamBaseUrl(),
  youtube,

  getAudioFingerprint: (filePath: string) =>
    invoke<{ fingerprint: string; durationSec: number; windows: number } | null>(
      'get_audio_fingerprint',
      { filePath }
    ),

  generateWaveformPeaks: (filePath: string, buckets = 180) =>
    invoke<number[]>('generate_waveform_peaks', { filePath, buckets }),

  extractImagePalette: (imagePath: string) =>
    invoke<[string, string, string[]] | null>('extract_image_palette', { imagePath }),

  deleteVariantFile: (filePath: string) =>
    invoke<{ ok: boolean; deleted?: boolean; error?: string }>('delete_variant_file', {
      filePath
    }),

  // Window Controls
  minimize: () => void invoke('window_minimize'),
  maximize: () => void invoke('window_maximize'),
  isMaximized: () => invoke<boolean>('is_window_maximized'),
  onWindowMaximizedState: (callback: (maximized: boolean) => void) =>
    registerListener<boolean>('window-maximized-state', callback),
  toggleFullScreen: () => void invoke('toggle_fullscreen'),
  isFullScreen: () => invoke<boolean>('is_fullscreen'),
  onWindowFullScreenState: (callback: (fullscreen: boolean) => void) =>
    registerListener<boolean>('window-fullscreen-state', callback),
  close: () => void invoke('close_window'),
  quitApp: () => void invoke('quit_app'),
  dragStart: (data: any) => void emit('drag-start', data),
  miniTray: () => void invoke('close_window'),
  miniWindow: () => void invoke('mini_window'),
  restore: () => void invoke('restore_window'),
  restart: () => window.location.reload(),
  resizeWindow: (width: number, height: number) =>
    void invoke('resize_window', { width, height }),
  resizeMiniWindow: (showPlaylist: boolean) =>
    void invoke('resize_window', { width: 360, height: showPlaylist ? 420 : 120 }),

  // Desktop Lyric Window & Playback Broadcast
  openLyric: () => void emit('open-lyric'),
  sendLyric: (data: any) => void emit('send-lyric', data),
  sendSong: (data: any) => void emit('update-current-song', data),
  unblockMusic: () => Promise.resolve(null),
  onLyricWindowClosed: (callback: () => void) =>
    registerListener('lyric-window-closed', callback),
  onLyricWindowReady: (callback: () => void) =>
    registerListener('lyric-window-ready', callback),

  // Plugins
  importCustomApiPlugin: () => invoke('import_custom_api_plugin'),
  importLxMusicScript: () => invoke('import_lx_music_script'),
  importMusicSourcePlugin: () => invoke('import_music_source_plugin'),
  fetchMusicSourcePlugin: (url: string) => invoke('fetch_music_source_plugin', { url }),

  // App Updater
  getAppUpdateState: () => invoke('app_update_get_state'),
  checkAppUpdate: (manual = false) => invoke('app_update_check', { manual }),
  downloadAppUpdate: () => invoke('app_update_download'),
  installAppUpdate: () => invoke('app_update_quit_and_install'),
  openAppUpdatePage: () => invoke('app_update_open_release_page'),
  onAppUpdateState: (callback: (state: any) => void) =>
    registerListener('app-update:state', callback),
  removeAppUpdateListeners: () => clearChannelListeners('app-update:state'),

  onLanguageChanged: (callback: (locale: string) => void) =>
    registerListener<string>('language-changed', callback),

  reportError: (entry: any) => invoke('error_reporter_report', { entry }),

  // Generic invoke router for legacy validChannels
  invoke: async (channel: string, ...args: any[]) => {
    if (channel === 'select-directory') {
      return open({ directory: true, multiple: false });
    }
    if (channel === 'local-music:select-cover-file') {
      return open({
        multiple: false,
        filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }]
      });
    }
    const rustCmd = CHANNEL_TO_RUST_COMMAND[channel];
    if (!rustCmd) {
      throw new Error(`Unauthorized or unmapped IPC channel: ${channel}`);
    }
    return invoke(rustCmd, { args });
  },

  getSearchSuggestions: (keyword: string) =>
    invoke('get_search_suggestions', { keyword }),
  lxMusicHttpRequest: (request: { url: string; options: any; requestId: string }) =>
    invoke('lx_music_http_request', { request }),
  lxMusicHttpCancel: (requestId: string) =>
    invoke('lx_music_http_cancel', { requestId }),

  // Local Music & Metadata
  scanLocalMusic: (folderPath: string) =>
    invoke('scan_local_music', { folderPath }),
  scanLocalMusicWithStats: (folderPath: string) =>
    invoke('scan_local_music_with_stats', { folderPath }),
  parseLocalMusicMetadata: (filePaths: string[]) =>
    invoke('parse_local_music_metadata', { filePaths }),
  fetchOnlineMetadata: (query: { title: string; artist?: string; album?: string }) =>
    invoke('fetch_online_metadata', { query }),
  fetchMultiSourceLyrics: (query: {
    title: string;
    artist?: string;
    album?: string;
    durationSec?: number;
  }) => invoke('fetch_multi_source_lyrics', { query }),
  updateLocalMusicTagsAndFile: (payload: any) =>
    invoke('update_local_music_tags_and_file', { payload }),
  saveSyncedLyrics: (params: { filePath: string; lyrics: string; saveSidecar?: boolean }) =>
    invoke('save_synced_lyrics', { params }),
  selectCoverFile: () =>
    open({
      multiple: false,
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }]
    }),
  exportM3u8: (params: {
    tracks: Array<{ filePath: string; title?: string; artist?: string; duration?: number }>;
    defaultName?: string;
  }) => invoke('export_m3u8', { params }),
  importM3u8: () => invoke('import_m3u8'),
  exportBackupJson: (params: { payload: Record<string, any>; defaultName?: string }) =>
    invoke('export_backup_json', { params }),
  importBackupJson: () => invoke('import_backup_json'),

  // Download Manager
  downloadAdd: (task: any) => invoke('download_add', { task }),
  downloadAddBatch: (tasks: any) => invoke('download_add_batch', { tasks }),
  downloadPause: (taskId: string) => invoke('download_pause', { taskId }),
  downloadResume: (taskId: string) => invoke('download_resume', { taskId }),
  downloadCancel: (taskId: string) => invoke('download_cancel', { taskId }),
  downloadCancelAll: () => invoke('download_cancel_all'),
  downloadGetQueue: () => invoke('download_get_queue'),
  downloadSetConcurrency: (n: number) => void invoke('download_set_concurrency', { n }),
  downloadGetCompleted: () => invoke('download_get_completed'),
  downloadDeleteCompleted: (filePath: string) =>
    invoke('download_delete_completed', { filePath }),
  downloadClearCompleted: () => invoke('download_clear_completed'),
  getEmbeddedLyrics: (filePath: string) =>
    invoke('get_embedded_lyrics', { filePath }),
  downloadProvideUrl: (taskId: string, url: string) =>
    invoke('download_provide_url', { taskId, url }),
  onDownloadProgress: (cb: (data: any) => void) =>
    registerListener('download:progress', cb),
  onDownloadStateChange: (cb: (data: any) => void) =>
    registerListener('download:state-change', cb),
  onDownloadBatchComplete: (cb: (data: any) => void) =>
    registerListener('download:batch-complete', cb),
  onDownloadRequestUrl: (cb: (data: any) => void) =>
    registerListener('download:request-url', cb),
  removeDownloadListeners: () => {
    clearChannelListeners('download:progress');
    clearChannelListeners('download:state-change');
    clearChannelListeners('download:batch-complete');
    clearChannelListeners('download:request-url');
  },

  // Media Coordinator
  sendMediaPlay: (data: any) => void emit('media-play', data),
  onMediaPauseAll: (callback: (data: any) => void) =>
    registerListener('media-pause-all', callback),
  selectDirectory: () => open({ directory: true, multiple: false }),
  saveLyricFile: (params: { filename: string; lrcContent: string; targetDir?: string }) =>
    invoke('save_lyric_file', { params })
};

export const ipcRenderer = {
  send: (channel: string, ...args: any[]) => void emit(channel, args),
  invoke: (channel: string, ...args: any[]) => api.invoke(channel, ...args),
  on: (channel: string, listener: (...args: any[]) => void) =>
    registerListener(channel, (payload) =>
      Array.isArray(payload) ? listener(...payload) : listener(payload)
    ),
  removeAllListeners: (channel: string) => clearChannelListeners(channel)
};

// Mount onto global window object for 100% backward compatibility
if (typeof window !== 'undefined') {
  (window as any).api = api;
  (window as any).youtube = youtube;
  (window as any).ipcRenderer = ipcRenderer;
  (window as any).electron = { ipcRenderer };
}
