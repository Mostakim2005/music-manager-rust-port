# Project Operating Instructions (`AGENTS.md`)
> **Notice:** This project inherits user persona, confirmation gates, and documentation blueprints from the global master `AGENTS.md`. Do not duplicate those rules here.

## 1. Project Tech Stack & Environment
* **Runtime / Language:** Node.js v20+, TypeScript 5+, Rust 1.78+, Tauri v2 (with legacy Electron 30+ baseline)
* **Framework / Host:** Vue 3 + Vite + Tailwind CSS + Naive UI + Pinia
* **Target OS / Build Output:** Windows 10/11 x64 portable `.exe` and NSIS installer
* **Local Media Tools:** Bundled `yt-dlp` and `ffmpeg` in `resources/bin/` (orchestrated asynchronously via Tokio in Rust)

## 2. Mandatory Verification & Build Commands
* **Type Check:** `npm run typecheck` (`npm run typecheck:node && npm run typecheck:web`)
* **Test Suite:** `npm test` (`vitest run`, 18 test files, 170 tests)
* **English Sweep Gate:** `node .sweep-gate.mjs` (must exit 0 with 0 non-exempt CJK lines)
* **Bundle Build:** `npm run build` (generates bundle and auto-import component stubs)
* **Portable Exe Build:** `npm run build:portable`
* **NSIS Installer Build:** `npm run build:installer`

## 3. Repository Directory Structure & Conventions
* `RUST_PORT_ANALYSIS.md` — Comprehensive architectural blueprint and migration roadmap for the Rust (Tauri v2) port.
* `src/main/` — Electron main process (baseline to be ported to `src-tauri`): YouTube engine, file manager, tag manager.
* `src/preload/` — Context bridge exposing `window.api` and `window.electron` to the renderer.
* `src/renderer/` — Vue 3 user interface: fullscreen player, playbar, track editor, video source popover, Dexie IndexedDB.
* `src/shared/` — Cross-process types, app update constants, and transliteration helpers.
* `resources/` — Application icons, manifest, and `bin/` directory for external executables.
* `docs/` — Core Search-First documentation suite:
  * `PRODUCT.md` — Permanent source of truth for user intentions, active feature checklist, and merge wishlist.
  * `ARCHITECTURE.md` — Visual Mermaid diagrams, tech stack rationale, subsystem mechanics, and extension recipes.
  * `DECISIONS_AND_TRAPS.md` — Architectural pivots and engineering landmines.

## 4. Repository-Specific Engineering Traps
* **TRAP 1: Single FFmpeg Binary** — Never reintroduce `ffmpeg-static`. Always resolve via `getFfmpegPath()`.
* **TRAP 2: Linked Video Muted Playback** — The linked video element must never claim playback exclusivity or unmute; the audio element is the sole sound source and master clock.
* **TRAP 3: Cancel Fade Timers on Resume** — Always call `cancelFadeTimer()` when playing/resuming to avoid ghost pauses.
* **TRAP 4: Type Stub Generation** — On fresh clones, run `npm run build` once before `npm run typecheck` to generate `auto-imports.d.ts` and `components.d.ts`.
* **TRAP 5: Tag-Triggered Releases** — Never push a `v*` tag until `main` has all rebranding, URLs, and attribution commits clean and verified.
* **TRAP 6: WebView2 Background Throttling** — Always preserve background timer flags in WebView2 or keep audio playback on a dedicated audio pipeline.
