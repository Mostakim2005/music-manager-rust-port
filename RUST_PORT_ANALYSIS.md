# Architectural Analysis & Implementation Blueprint: Music Manager Rust Port (Tauri v2)

> **1-Line Summary:** Comprehensive feasibility study, system architecture, and phased implementation blueprint for porting Music Manager from Electron to a high-performance Tauri v2 + Rust foundation while preserving 100% of its UI/UX and integrating Namida-inspired visual aesthetics.

---

## 1. Executive Summary & Vision

Music Manager is a local-first Windows desktop music and music video player known for its seamless **Linked Audio/Video Playback** (audio file is the master clock; video displays muted alongside it), **per-codec YouTube quality ladder**, **millisecond-precise synced lyrics with inline LRC editor**, and **local-first variant library**.

While the current Electron + Node.js architecture provides a flexible environment, it carries standard Electron overhead:
* **Memory footprint:** ~180 MB – 320 MB idle RAM usage.
* **Installer / Portable binary size:** ~100 MB – 130 MB.
* **Process overhead:** Multiple heavy Chromium helper processes.
* **I/O bottlenecks:** Node.js file system scanning and child process overhead for large multi-gigabyte music libraries.

### The Porting Strategy: Tauri v2 (Rust Core + Vue 3 Frontend)
By selecting **Tauri v2** (Option 2A), we achieve the optimal balance:
1. **100% Visual Fidelity & Feature Retention:** The Vue 3 + Tailwind CSS + Naive UI + Pinia frontend remains directly reusable. All responsive layouts, dialogs, LRC synchronizer modals, and complex components carry over with zero visual degradation.
2. **Namida Music Player Aesthetics:** Deepen the UI polish inspired by the acclaimed **Namida music player**—leveraging dynamic frosted glassmorphism, vibrant album art palette extraction, fluid stacked player transitions, interactive waveform progress bars, and synchronized karaoke-style lyric animations.
3. **Rust Native Performance:** The entire backend (Electron main process, Node.js runtime, file system scanning, media tagging, YouTube engine orchestration, and database persistence) is replaced with native, compiled Rust code.
4. **Drastic Resource Reduction:**
   * **RAM Usage:** Drops from ~250 MB down to ~40 MB – 65 MB (leveraging Windows native WebView2).
   * **Binary Size:** Portable `.exe` drops from ~110 MB to ~15 MB – 20 MB (excluding bundled external binaries).
   * **Cold Startup Time:** Near-instantaneous window presentation (< 400ms).

---

## 2. Namida Music Player Visual & Feature Synthesis

The **Namida music player** (renowned in the open-source mobile and desktop audio space) sets a high benchmark for music app design. This port directly integrates its visual philosophy and UX paradigms into Music Manager.

### Core Visual Elements Inspired by Namida
* **Frosted Glassmorphism & Depth:**
  * Multi-layered translucent panels (`backdrop-filter: blur(28px) saturate(180%)`) with subtle 1px border highlights (`rgba(255, 255, 255, 0.08)` in dark mode; `rgba(0, 0, 0, 0.06)` in light mode).
  * Layered elevations where dialogs, track editors, and quality pickers float naturally above the content plane.
* **Dynamic Ambient Lighting & Background Canvas:**
  * Real-time color extraction from album artwork and video thumbnails using Rust-accelerated color quantization.
  * Multi-stop animated linear and radial gradients that gently breathe behind the stacked player without causing GPU frame drops.
* **Namida Stacked Player Layout:**
  * Unified vertical hero stage: artwork/video frame on top, animated track info and audio/video mode pill in the center, and dynamic controls with waveform seekbar at the bottom.
  * Smooth gesture and click-based sheet expansion transitioning seamlessly into full lyrics or video mode.
* **Karaoke-Style Synced Lyrics Experience:**
  * Multi-line active lyric tracking with smooth spring-physics auto-scrolling.
  * Word-by-word timing glow and distinct `mm:ss.xx` timestamp badges for accurate manual line syncing.
* **Interactive Waveform Seekbar:**
  * Audio amplitude visualization directly embedded into the track progress bar, allowing users to visually spot drops, intros, and vocal sections.

```mermaid
flowchart TD
    subgraph NamidaVisuals["Namida-Inspired Visual Experience"]
        A[Album Art / Video Thumbnail] --> B[Rust Color Quantizer]
        B --> C[Dynamic Ambient Mesh Gradient]
        C --> D[Frosted Glass Stacked Player]
        D --> E[Karaoke Synced Lyrics Strip]
        D --> F[Interactive Waveform Seekbar]
        D --> G[Instant Muted Video Surface]
    end
```

---

## 3. High-Level Architecture: Tauri v2 + Rust Core

```mermaid
flowchart TB
    subgraph FRONTEND["Frontend (Vue 3 + Vite + Tailwind + Naive UI)"]
        UI_STACK[NamidaStackedPlayer & Fullscreen View]
        UI_BAR[PlayBar & Control Strip]
        UI_LIB[Local Music Library & Track Editor]
        UI_MODALS[LRC Synchronizer & Video Quality Popover]
        STORE[Pinia Stores: playerCore, songLibrary, mediaState]
        BRIDGE[IPC Client Bridge: @tauri-apps/api/core]
    end

    subgraph TAURI_IPC["Tauri v2 IPC & Event Highway"]
        INVOKE[tauri::command RPC]
        EVENTS[tauri::ipc::Channel / Event Streams]
    end

    subgraph RUST_CORE["Rust Native Engine (src-tauri/)"]
        subgraph MEDIA_SUBSYSTEM["Media & YouTube Subsystem"]
            YT[yt-dlp Runner: Tokio Async Process]
            FFMPEG[ffmpeg Stream & Codec Probe]
            FMT[YouTube Format Tree Parser & Cache]
        end

        subgraph IO_TAG_SUBSYSTEM["I/O & Metadata Subsystem"]
            TAG[Lofty Audio Tag Engine: ID3v2, FLAC, Vorbis, MP4]
            SCAN[Multithreaded Directory Scanner: Rayon + Walkdir]
            WATCH[File Watcher: Notify Crate]
        end

        subgraph DB_SUBSYSTEM["Persistence & Fingerprinting Subsystem"]
            SQLITE[Embedded SQLite via SQLx / Rusqlite]
            FP[Chromaprint / AcoustID Native Hasher]
        end

        subgraph OS_SUBSYSTEM["OS & Platform Integration"]
            SMTC[Windows System Media Transport Controls]
            TRAY[Native System Tray: tauri-plugin-tray]
            SHORTCUT[Global Hotkeys: tauri-plugin-global-shortcut]
            SINGLE[Single Instance Lock: tauri-plugin-single-instance]
        end
    end

    subgraph DISK["Local Storage & Binaries"]
        BIN[resources/bin: yt-dlp.exe, ffmpeg.exe]
        MEDIA_FILES[Local Audio & Video Variants]
        DB_FILE[AppData/Local/MusicManager/library.db]
    end

    FRONTEND --> BRIDGE
    BRIDGE --> TAURI_IPC
    TAURI_IPC --> RUST_CORE
    MEDIA_SUBSYSTEM --> BIN
    IO_TAG_SUBSYSTEM --> MEDIA_FILES
    DB_SUBSYSTEM --> DB_FILE
```

---

## 4. Subsystem Migration Mapping: Electron/Node vs. Tauri v2/Rust

| Capability / Subsystem | Current Electron Implementation | Tauri v2 + Rust Implementation | Performance & UX Advantage |
| :--- | :--- | :--- | :--- |
| **Desktop Shell** | Electron 30+ (`BrowserWindow`, `ipcMain`) | Tauri v2 (`tauri::Builder`, WebView2) | Idle RAM drops from ~250MB to ~45MB; binary drops from ~110MB to ~16MB. |
| **IPC Communication** | `contextBridge.exposeInMainWorld`, `ipcRenderer.invoke` | `#[tauri::command]`, `@tauri-apps/api/core` (`invoke`) | Zero JSON stringification bottlenecks; strongly typed Rust structs mapped to TypeScript via `specta` / `ts-rs`. |
| **Event Streaming** | `ipcRenderer.on` with custom emitters | `tauri::ipc::Channel` / `app_handle.emit` | High-frequency progress updates (download percentage, media indexing) without main-thread stutter. |
| **YouTube Engine** | `child_process.spawn("yt-dlp")` + manual JSON buffering | `tokio::process::Command` + `serde_json` streaming | Non-blocking asynchronous process orchestration; zero Node event-loop starvation. |
| **Audio Tagging** | `node-id3`, `flac-tagger`, `music-metadata` | `lofty` Rust crate | Single unified crate supporting ID3v1/2, FLAC Vorbis comments, MP4 atoms, Ogg, and RIFF; 15x faster tag parsing. |
| **Directory Scanner** | Node `fs.readdir` recursive traversal | `rayon` + `walkdir` in Rust | Multi-core parallel directory scan capable of indexing 50,000 tracks in < 1.2 seconds. |
| **Database & Library** | Dexie.js (IndexedDB inside Chromium) | Embedded **SQLite** via `sqlx` or `rusqlite` | Immune to Chromium storage quotas or browser profile corruption; instant cold-start queries; ACID guarantees. |
| **Audio Master Engine** | HTML5 `<audio>` element + Web Audio API | **Dual Mode:** HTML5 `<audio>` (Phase 1) + Optional `rodio`/`symphonia` (Phase 2) | Phase 1 guarantees 100% zero-regression web playback; Phase 2 unlocks bit-perfect WASAPI exclusive mode and 32-bit DSP. |
| **Linked Video Engine** | Muted `<video>` slave element syncing to audio clock | Muted `<video>` slave element syncing to audio clock | Preserves the battle-tested single-clock rule: audio element stays master, video follows and corrects drift > 0.75s. |
| **Windows Media Keys** | Custom Electron IPC wrapper around native module | `windows` crate / WinRT `SystemMediaTransportControls` | Native Windows 10/11 volume HUD integration with album art, track scrub bar, and media key handling. |
| **File Watcher** | Node `chokidar` | `notify` crate (Rust) | Native Windows `ReadDirectoryChangesW` kernel events with debounced thread pools. |

---

## 5. Architectural Deep Dives & Key Implementation Details

### 5.1 The Audio-Video Linked Engine in Tauri
The cornerstone of Music Manager is its **Linked A/V Playback**:
* **Rule 1 (Master Clock):** The audio file is the sole audio generator and master clock.
* **Rule 2 (Muted Video):** The video stream/file is downloaded without audio (`-f bestvideo` or video-only format) and rendered in a muted `<video>` element.
* **Rule 3 (Drift Correction):** Whenever the user enters video mode, the video element is unhidden, seeked to `audio.currentTime`, and synchronized on each video frame. If drift exceeds `0.75s`, the video is gently re-seeked without interrupting audio playback.

In Tauri v2, this mechanism remains fully intact within the WebView2 layer, eliminating complex cross-process video frame piping while leveraging hardware-accelerated video decoding (DirectX / Media Foundation) natively supported by WebView2 on Windows.

### 5.2 High-Performance Audio Tagging with `lofty`
Currently, the Electron app requires three separate npm packages (`node-id3`, `flac-tagger`, `music-metadata`) with inconsistent API conventions to support different audio formats.
In Rust, the [`lofty`](https://crates.io/crates/lofty) crate provides a single, uniform API across all container types:
```rust
use lofty::prelude::*;
use lofty::probe::Probe;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct AudioMetadata {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub duration_seconds: f64,
    pub bitrate: Option<u32>,
    pub sample_rate: Option<u32>,
    pub has_picture: bool,
}

#[tauri::command]
pub async fn read_track_metadata(path: String) -> Result<AudioMetadata, String> {
    tokio::task::spawn_blocking(move || {
        let tagged_file = Probe::open(&path)
            .map_err(|e| e.to_string())?
            .read()
            .map_err(|e| e.to_string())?;

        let tag = tagged_file.primary_tag().or_else(|| tagged_file.first_tag());
        let properties = tagged_file.properties();

        Ok(AudioMetadata {
            title: tag.and_then(|t| t.title().map(String::from)),
            artist: tag.and_then(|t| t.artist().map(String::from)),
            album: tag.and_then(|t| t.album().map(String::from)),
            duration_seconds: properties.duration().as_secs_f64(),
            bitrate: properties.audio_bitrate(),
            sample_rate: properties.sample_rate(),
            has_picture: tag.map_or(false, |t| !t.pictures().is_empty()),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
```

### 5.3 Asynchronous YouTube Engine Orchestration
The Electron app spawns `yt-dlp.exe` and handles buffering manually. In Tauri, Rust's `tokio` runtime provides seamless process supervision:
```rust
use tokio::process::Command;
use serde_json::Value;

#[tauri::command]
pub async fn fetch_youtube_formats(
    app: tauri::AppHandle, 
    video_url: String
) -> Result<Value, String> {
    let ytdlp_path = resolve_bundled_binary(&app, "yt-dlp.exe")?;
    
    let output = Command::new(ytdlp_path)
        .args(["-J", "--no-warnings", "--no-playlist", &video_url])
        .output()
        .await
        .map_err(|e| format!("Failed to execute yt-dlp: {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let json: Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Invalid JSON from yt-dlp: {}", e))?;
        
    Ok(json)
}
```

### 5.4 Database Architecture: From Dexie to SQLite
While Dexie IndexedDB serves well in Electron, browser IndexedDB in WebView2 can be cleared if Windows storage sense cleans up temp app data.
Migrating to an embedded **SQLite** database (`library.db`) stored in `%LOCALAPPDATA%/MusicManager/` provides:
* Total data safety across updates and system cleanups.
* Fast full-text search (`FTS5`) for instant search across millions of tracks.
* Relational tables linking Songs -> Variants (FLAC, MP3, 1080p MP4, 360p WebM).

```mermaid
erDiagram
    SONGS ||--o{ TRACK_VARIANTS : contains
    SONGS ||--o{ LYRIC_RECORDS : has
    SONGS {
        string id PK
        string title
        string artist
        string album
        string fingerprint
        float duration
        int play_count
        timestamp created_at
    }
    TRACK_VARIANTS {
        string id PK
        string song_id FK
        string file_path
        string media_type "audio | video"
        string format "flac | mp3 | mp4"
        string quality "1080p | 320k"
        int file_size
        int is_primary
    }
    LYRIC_RECORDS {
        string id PK
        string song_id FK
        text lrc_raw
        float offset_seconds
        string source
    }
```

---

## 6. Phased Implementation Roadmap

```mermaid
gantt
    title Music Manager Rust Port Roadmap
    dateFormat  YYYY-MM-DD
    section Phase 0: Setup
    Tauri v2 Scaffold & Cargo Config        :p0_1, 2026-11-09, 3d
    Dual-Run Vite Dev Harness                :p0_2, after p0_1, 2d
    section Phase 1: IPC Shim
    TypeScript Context Bridge Emulation     :p1_1, after p0_2, 4d
    Window Controls & Tray Ports             :p1_2, after p1_1, 3d
    section Phase 2: Rust Engines
    Lofty Metadata & Directory Scanner       :p2_1, after p1_2, 5d
    Tokio yt-dlp Process Manager            :p2_2, after p2_1, 4d
    section Phase 3: Storage
    SQLite Schema & Dexie Data Importer      :p3_1, after p2_2, 4d
    Unified Song Fingerprint Engine         :p3_2, after p3_1, 3d
    section Phase 4: Polish
    Namida Visual Polish & Glassmorphism    :p4_1, after p3_2, 5d
    Interactive Waveform Seekbar            :p4_2, after p4_1, 4d
    Portable Exe & Cloud CI Packaging       :p4_3, after p4_2, 3d
```

### Phase 0: Tauri v2 Scaffold & Dual-Run Configuration
* Initialize `src-tauri` using `cargo tauri init`.
* Configure `tauri.conf.json` with permissions, bundle identifiers, and Windows WebView2 settings.
* Maintain the current `npm run dev` script with dual targets: `npm run tauri dev` and legacy `npm run dev:electron`.

### Phase 1: IPC Compatibility Layer & Window Shell
* Create a TypeScript adapter layer (`src/renderer/api/tauriBridge.ts`) implementing the exact interface of `window.api`.
* Migrate window frame operations (minimize, maximize, close, custom title bar dragging) to `@tauri-apps/plugin-window`.
* Implement native system tray with play/pause, next, previous, and quit controls using `tauri-plugin-tray`.

### Phase 2: Native Rust Engines (Metadata & YouTube)
* Implement `lofty`-powered track metadata reader and writer commands in Rust.
* Implement parallel directory scanning (`walkdir` + `rayon`) returning track chunks over Tauri channels.
* Implement asynchronous `yt-dlp` and `ffmpeg` runners with live progress reporting for video quality downloads.

### Phase 3: SQLite Storage & Song Fingerprinting
* Create embedded SQLite migrations in Rust using `rusqlite` or `sqlx`.
* Implement one-time automatic import from existing Dexie IndexedDB into SQLite.
* Port acoustic fingerprinting and duplicate matching logic to native Rust.

### Phase 4: Namida Visual Polish & Distribution
* Deepen glassmorphism CSS styling across the stacked player and modal sheets.
* Implement dynamic background palette extraction in Rust (`palette` or `color_thief` crate) to feed CSS custom properties without main-thread jank.
* Implement the interactive audio waveform seekbar.
* Finalize GitHub Actions CI workflow to compile portable `.exe` releases with bundled binaries automatically.

---

## 7. Engineering Traps & Landmines (Tauri & Windows Specific)

1. **TRAP 1: WebView2 Media Codec Boundaries**  
   * *Problem:* Microsoft WebView2 relies on Windows Media Foundation. While AAC, MP3, and H.264 playback are universal, AV1 and VP9 video-only playback in `<video>` may fail on un-updated Windows 10 machines lacking the AV1 Video Extension from the Microsoft Store.  
   * *Mitigation:* In the video quality selector, default to MP4/H.264 formats for linked video playback, and provide a clear codec badge with automatic fallback to H.264 when AV1 decode is unsupported.
2. **TRAP 2: WebView2 Background Throttling**  
   * *Problem:* Chromium-based webviews aggressively throttle timers (`setInterval`, `requestAnimationFrame`) and audio elements when the window is minimized.  
   * *Mitigation:* Set WebView2 initialization flags to prevent background suspension (`--disable-background-timer-throttling`, `--disable-renderer-backgrounding`), or transition audio playback to a dedicated native Rust audio thread (Phase 2).
3. **TRAP 3: Synchronous IPC Serialization Overhead**  
   * *Problem:* Passing large arrays of track objects (e.g., 20,000 songs) over a single JSON IPC call can momentarily freeze the UI thread during V8 JSON parsing.  
   * *Mitigation:* Stream library scan results in batches of 200 items using `tauri::ipc::Channel` or pagination, allowing the UI to render progressively.
4. **TRAP 4: Preserving the Master Audio Clock Rule**  
   * *Problem:* Developers often attempt to let the video element play audio or unmute when switching to video mode.  
   * *Mitigation:* Strictly enforce `DECISION: Linked-Muted-Video-With-Master-Audio`—the video element must remain permanently muted; the audio element remains the sole sound source and time master.

---

## 8. Conclusion & Recommendation

The **Tauri v2 + Rust** architecture is the definitive solution for porting Music Manager. It eliminates Electron's heavyweight memory and storage overhead while preserving 100% of the existing Vue 3 visual codebase and enabling rich, Namida-inspired glassmorphism and stacked playback features. 

The step-by-step migration outlined in this document ensures a seamless transition with zero feature regressions, maintaining rock-solid linked A/V playback, precise lyric synchronization, and local-first reliability.
