# Product Intent & Feature Map (`PRODUCT.md`)
> **1-Line Summary:** The permanent source of truth for what the user wants the app to do and feel like, independent of how the code is currently implemented.

## 1. Core Vision & User Experience Intent
* **What This App Does (Plain English):** Music Manager is a local-first Windows desktop music player. It plays your own audio files and their linked music videos as one song, with synced lyrics, one queue, and no account or cloud library. Bundled `yt-dlp` + `ffmpeg` find and store video/audio; everything matches to a single song identity built from artist and title.
* **How It Must Feel to Use:** Instant local playback; audio, video, lyrics and the progress bar always share one clock and never disagree; no double audio ever; clean light and dark themes with strong contrast; fully usable offline for local files.
* **Rust & Namida Evolution:** Transitioning from Electron to a high-performance Tauri v2 + Rust foundation while deepening Namida-inspired fluid visuals (frosted glassmorphism, dynamic ambient mesh gradients, interactive waveform seekbar, and stacked layout).

## 2. Active Features (Do Not Break)

### [FEATURE: Linked-AV-Playback] | Aliases: video mode, audio video toggle, linked video, video pill, muted video
> **1-Line Summary:** The song's audio always plays the sound while the video shows the picture muted beside it, so switching audio⇄video never interrupts anything.
* **User Intention (Non-Negotiable):** Audio and video must be linked, not competing. The video file should carry no audio at all; the audio file is the only sound source and the master clock.
* **Visual / UI Behavior:** Bottom-left pill in the fullscreen player shows `Video • 360p` or `Audio • 128 kb/s` and toggles mode instantly with no gap.
* **Code Anchors (Grep Targets):**
  * `src/renderer/components/lyric/MusicFull.vue` -> `enterVideoMode`, `syncVideoSlaveState`, `videoPillBadge`
  * `src/renderer/store/modules/playerCore.ts` -> `setPlaybackMode`

### [FEATURE: One-Play-State-For-Every-Button] | Aliases: play button, pause desync, play/pause sync, big button
> **1-Line Summary:** Every play/pause button reflects the real audible state and controls whichever surface is actually playing.
* **User Intention (Non-Negotiable):** The button must never show "paused" while sound plays, and one click must stop everything (audio, video, MV drawer).
* **Visual / UI Behavior:** Identical play/pause icons on the PlayBar, fullscreen player, mini bars and stacked layout.
* **Code Anchors (Grep Targets):**
  * `src/renderer/hooks/usePlaybackControl.ts` -> `playMusicEvent`
  * `src/renderer/store/modules/playerCore.ts` -> `setIsPlay`, `handlePause`
  * `src/renderer/services/mediaCoordinator.ts` -> `toggleActiveNonAudioPlayback`

### [FEATURE: Per-Song-Media-Reset] | Aliases: next song bug, old artwork stays, stale video, track change reset
> **1-Line Summary:** Pressing next/previous fully drops the old song's video, artwork and mode, so nothing carries over to the new song.
* **User Intention (Non-Negotiable):** Media is matched by song ID; a song without a video must never show the previous song's video or picture.
* **Visual / UI Behavior:** The video frame, quality selection and mode pill reset the instant the track changes.
* **Code Anchors (Grep Targets):**
  * `src/renderer/services/playbackController.ts` -> `playTrack`
  * `src/renderer/store/modules/playerCore.ts` -> `resetMediaStateForNewSong`
  * `src/renderer/components/lyric/MusicFull.vue` -> `resetVideoStateForNewSong`

### [FEATURE: Per-Codec-Video-Qualities] | Aliases: qualities tab, quality list, video source, codec rows, download video
> **1-Line Summary:** The video source menu lists one row per height AND codec with real bitrate and a single size badge, downloads video-only files, and shows tick/delete/speed states.
* **User Intention (Non-Negotiable):** Size must appear once per row; codec must be visible so different variants can be chosen; finished downloads get a green tick and a delete button; the audio row shows its real bitrate.
* **Visual / UI Behavior:** "Video Source & Media" dialog → Qualities tab: rows like `1080p | mp4 • av01 • 2500 kb/s | 45.2 MB`.
* **Code Anchors (Grep Targets):**
  * `src/main/modules/youtubeFormats.ts` -> `mapAndGroupFormats`, `normalizeCodec`
  * `src/renderer/utils/videoQualityHelpers.ts` -> `formatQualityRow`, `getUniqueVideoHeights`
  * `src/renderer/components/player/VideoSourcePopover.vue` -> `downloadVideoQuality`, `downloadedVariantFor`

### [FEATURE: Synced-Lyrics-With-Responsive-Layout] | Aliases: lyrics panel, lyric column, mini lyrics, line times, under artwork
> **1-Line Summary:** Lyrics show in a side column when the window is wide, or as a scrollable click-to-seek strip under the artwork when it is narrow, with each line's start time visible.
* **User Intention (Non-Negotiable):** The lyric column must never drop broken below the player; the current line must appear exactly once; clicking a line seeks; `mm:ss,ms` start times stay visible.
* **Visual / UI Behavior:** Right column ≥1024px; below that a 3-line strip under the artwork/video; toggleable per-line timestamps in the lyric settings.
* **Code Anchors (Grep Targets):**
  * `src/renderer/components/lyric/MusicFull.vue` -> `underArtworkLyricLines`, `lineTimeLabel`, `showUnderArtworkLyrics`
  * `src/renderer/types/lyric.ts` -> `LyricConfig`

### [FEATURE: Edit-LRC-Editor] | Aliases: edit lrc, lyric editor, timestamps, lrc sync, tap timestamp
> **1-Line Summary:** "Edit LRC" opens the raw LRC with millisecond timestamps, per-line ±0.1s nudges and live playback following, and applies edits to the player instantly.
* **User Intention (Non-Negotiable):** The user must be able to fix mismatched auto-found lyrics while watching the times change live, and see the first lyric's start time next to the seek bar.
* **Visual / UI Behavior:** Button at the bottom of the lyric section; editor rows show `[mm:ss.xxx]` timestamps with nudge buttons and preview-seek.
* **Code Anchors (Grep Targets):**
  * `src/renderer/components/lyric/MusicFull.vue` -> `handleApplyEditedLrc`, `rawLrcString`
  * `src/renderer/components/common/LrcSynchronizerModal.vue` -> `nudgeLine`, `commitTimestampEdit`
  * `src/renderer/utils/lyrics.ts` -> `formatLrcTimestamp`, `formatLrcTimestampMs`, `parseLrcTimestamp`

### [FEATURE: Lyric-Timing-Offset-Control] | Aliases: offset, minus plus, lyric shift, correction, reset icon
> **1-Line Summary:** A uniform-sized − / reset / + control with Remove/Add labels and a manual ±seconds input shifts lyrics live per song.
* **User Intention (Non-Negotiable):** All controls one size, a proper reset icon (not a clickable label), and a manual input where 0.1 means 0.1 s and 1 means 1 s, positive or negative.
* **Visual / UI Behavior:** Bottom-right of the lyric area; remembered per song.
* **Code Anchors (Grep Targets):**
  * `src/renderer/components/lyric/LyricCorrectionControl.vue` -> `nudge`, `reset`, `applyDraft`
  * `src/renderer/hooks/MusicHook.ts` -> `setCorrectionTime`, `correctionTimeMap`

### [FEATURE: Lyric-Search-Match-Badges] | Aliases: lyric search, lrc search, match picker, length match, offset badge
> **1-Line Summary:** Online lyric search shows every candidate with length-match and start-offset badges so the user can pick the version closest to their file.
* **User Intention (Non-Negotiable):** Never silently trust one match; show `length ✓` or `Δ ±Xs` versus the file, plus where the lyrics start.
* **Visual / UI Behavior:** "Lyric Matches" picker in the track editor after an LRCLIB fetch.
* **Code Anchors (Grep Targets):**
  * `src/main/modules/tagAndMetadataManager.ts` -> `lrcTimeBounds`
  * `src/renderer/components/common/LocalTrackEditorModal.vue` -> `applyLyricCandidate`, `formatCandidateOffset`

### [FEATURE: Audio-Video-Length-Mismatch-Warning] | Aliases: length warning, different version, glass warning
> **1-Line Summary:** A glass banner warns when the linked video and the audio file have different lengths, which means different versions.
* **User Intention (Non-Negotiable):** Quality may differ but length must roughly match; a mismatch means lyric sync will suffer, so say so.
* **Visual / UI Behavior:** Top-center glassmorphism banner in the fullscreen player; auto-hides after a few seconds.
* **Code Anchors (Grep Targets):**
  * `src/renderer/components/lyric/MusicFull.vue` -> `checkMediaLengthMismatch`, `lengthMismatchWarning`

### [FEATURE: Save-To-Disk-Batches] | Aliases: save to disk, save audio, save video, save lrc, saved tick
> **1-Line Summary:** Save Audio / Save Video / Save Lyrics have checkboxes for one-shot batch saving, persistent green "Saved" ticks, and duplicate prevention.
* **User Intention (Non-Negotiable):** The user must see what was saved and at which quality, never accidentally save the same item twice, and never wonder if a save was cancelled.
* **Visual / UI Behavior:** "Save to Disk" dialog: per-row checkboxes, `Saved • 480p` ticks, a "Save Selected" button, and a "n saved" summary chip.
* **Code Anchors (Grep Targets):**
  * `src/renderer/components/player/SaveToDiskModal.vue` -> `saveSelected`, `markSaved`, `pendingSelectedCount`

### [FEATURE: In-Player-Metadata-Editor] | Aliases: edit metadata, edit artwork, rename file, tag editor button
> **1-Line Summary:** The "Edit Metadata, Artwork & Filename" editor is reachable from inside the player, not only from the local music list.
* **User Intention (Non-Negotiable):** Editing tags, artwork, filename and lyrics must not require going back to the library view; for songs without lyrics the editor can add or search them.
* **Visual / UI Behavior:** Edit button on the PlayBar and in the fullscreen control strip; opens the same editor as the list's edit button.
* **Code Anchors (Grep Targets):**
  * `src/renderer/hooks/useLocalTrackEditor.ts` -> `useLocalTrackEditor`
  * `src/renderer/components/common/LocalTrackEditorModal.vue` -> `handleSave`, `handleAutoFetchLyrics`

### [FEATURE: Unified-Song-Library] | Aliases: variants, song identity, duplicates, fingerprint, one song
> **1-Line Summary:** Audio copies and videos of the same recording live as one song record with a stable identity, with fingerprinting to merge duplicates.
* **User Intention (Non-Negotiable):** Each song has one unique ID built from artist and title; audio and video files are matched to that ID; duplicates merge without losing variants.
* **Visual / UI Behavior:** Files tab of the video source dialog lists every linked file with play/reveal/unlink/delete actions.
* **Code Anchors (Grep Targets):**
  * `src/renderer/services/songLibrary.ts` -> `computeNormKey`, `ingestLocalTrack`, `linkVariant`, `getVariants`, `getSongKey`

### [FEATURE: Player-Look-And-Feel] | Aliases: stacked player, themes, palette, waveform, fullscreen
> **1-Line Summary:** A polished player: Namida stacked layout, dynamic album-art palette, waveform seekbar, light/dark themes.
* **User Intention (Non-Negotiable):** Clean visual hierarchy, proportional spacing, strong contrast in both themes, no broken layouts at any window size.
* **Visual / UI Behavior:** Side-by-side or stacked fullscreen layouts; gradient background from album art.
* **Code Anchors (Grep Targets):**
  * `src/renderer/components/player/NamidaStackedPlayer.vue` -> `currentLyricSub`
  * `src/renderer/utils/linearColor.ts` -> `extractVibrantPalette`, `applyDynamicPaletteToRoot`

### [FEATURE: Audio-Enhancements] | Aliases: crossfade, equalizer, skip silence, A-B loop, bookmarks
> **1-Line Summary:** Equal-power crossfade, EQ, skip-silence, A-B loop repeat and per-track bookmarks round out playback.
* **User Intention (Non-Negotiable):** Smart transitions stay; heavy DSP extras stay out unless requested.
* **Visual / UI Behavior:** Advanced controls popover and A-B pill on the PlayBar.
* **Code Anchors (Grep Targets):**
  * `src/renderer/services/audioService.ts` -> `fadeInVolume`, `setAbLoopPointA`, `setAbLoopPointB`
  * `src/renderer/services/eqService.ts` -> `eqService`

### [FEATURE: Library-Backup-And-Stats] | Aliases: m3u8 backup, json backup, listening stats, history
> **1-Line Summary:** Export/restore M3U8 playlists and JSON library snapshots, plus personal listening statistics.
* **User Intention (Non-Negotiable):** The library must survive reinstalls; stats stay local with no telemetry.
* **Visual / UI Behavior:** "M3U8 / Backup" toolbar menu in Local Music; stats modal from the PlayBar.
* **Code Anchors (Grep Targets):**
  * `src/main/modules/tagAndMetadataManager.ts` -> `library:export-m3u8`, `library:import-backup-json`
  * `src/renderer/services/listeningStatsService.ts` -> `addListeningSeconds`, `recordTrackPlay`

### [FEATURE: Rust-Tauri-V2-Engine-And-Namida-Visuals] | Aliases: rust port, tauri v2, namida visuals, ambient canvas, waveform seekbar, karaoke glow
> **1-Line Summary:** Native Tauri v2 + compiled Rust media engine delivering 60fps WebGL2 ambient gradients, SQLite persistence, and Symphonia acoustic waveform seekbars.
* **User Intention (Non-Negotiable):** 100% feature and visual parity with the Vue 3 frontend, cutting idle memory down to ~45MB with instant HTTP 206 range seeking, parallel directory scanning, pure-Rust tagging/fingerprinting, dual-platform YouTube streaming, and proportional audio/video sync locking.
* **Visual / UI Behavior:** Real-time WebGL2 ambient mesh shader pulsing with bass energy; interactive Namida waveform seekbar with amplitude peaks and hover preview; word-by-word karaoke glow; Windows SMTC and Android MediaSession integration.
* **Code Anchors (Grep Targets):**
  * `src-tauri/src/commands/scanner_tags.rs` -> `scan_local_music_with_stats`, `generate_waveform_peaks`, `get_audio_fingerprint`
  * `src-tauri/src/commands/youtube_dl.rs` -> `yt_formats`, `yt_stream_url`, `yt_download`
  * `src-tauri/src/commands/network_proxy.rs` -> `fetch_multi_source_lyrics`, `fetch_online_metadata`
  * `src/renderer/components/namida/NamidaAmbientCanvas.vue` -> `renderLoop`, `compileShader`
  * `src/renderer/components/namida/NamidaWaveformSeekbar.vue` -> `onPointerDown`, `normalizedPeaks`
  * `src/renderer/composables/useLinkedMediaSync.ts` -> `enforceSyncTick`
  * `src/renderer/services/songLibrary.ts` -> `getLibraryDb`, `getOrComputeWaveformPeaks`

## 3. Planned Features & App-Merge Wishlist

### [WISHLIST: Cloud-Built-Releases] | Aliases: github actions, cloud build, releases, tag build, portable and installer
> **1-Line Summary:** Version tags trigger a GitHub Actions build that attaches both the portable `.exe` and the NSIS installer to the release, instead of storing builds locally.
* **User Intention:** Keep GitHub as the single source of truth; no heavy binaries in git history; every release offers both formats.
* **Target Integration Point:** `.github/workflows/build.yml` → `build:portable` + `build:installer`.

### [WISHLIST: Desktop-GUI-Verification] | Aliases: manual checklist, real desktop test, gui check
> **1-Line Summary:** Run the manual desktop verification checklist against a fresh portable build, since the agent sandbox cannot launch the GUI.
* **User Intention:** Prove playback, linked video, lyric editing and save flows visually before wider use.
* **Target Integration Point:** The manual checklist in `docs/legacy/HANDOFF.md` §3.3; `npm run build:portable` artifact.

### [WISHLIST: Smaller-Portable-Through-Pruning] | Aliases: size reduction, dependency pruning, smaller exe
> **1-Line Summary:** Reduce `app.asar` weight by proving duplicate or unused dependencies unreferenced before removing them.
* **User Intention:** A leaner download without losing functionality.
* **Target Integration Point:** `package.json` production dependency tree.

### [WISHLIST: Installer-Verification-On-Real-Machine] | Aliases: nsis installer, setup exe, install test
> **1-Line Summary:** Install and uninstall the NSIS setup once on a real machine to confirm shortcuts and clean removal.
* **User Intention:** Portable stays the default; the installer is optional convenience and must cleanly uninstall.
* **Target Integration Point:** `MusicManager-v<version>-Setup.exe` from the cloud release.
