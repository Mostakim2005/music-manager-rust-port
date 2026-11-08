<h2 align="center">🎵 Music Manager (Rust Port Initiative)</h2>

<p align="center">
  A local-first desktop music player for Windows.<br>
  Built on Vue 3, TypeScript and transitioning to a high-performance <strong>Tauri v2 + Rust</strong> core.<br>
  <em>Licensed under PolyForm Noncommercial 1.0.0 — see LICENSE.</em>
</p>

---

## 🚀 The Rust Port Initiative

This repository (`music-manager-rust-port`) hosts the architectural blueprint and ongoing port of Music Manager from Electron to **Tauri v2 + Rust**, incorporating visual and feature inspirations from the **[Namida music player](https://github.com/namidaco/Namida)**:

* **100% Visual Fidelity:** Retains the complete Vue 3 + Tailwind CSS + Naive UI frontend with zero UI regressions.
* **Namida-Inspired Aesthetics:** Frosted glassmorphism (`backdrop-filter`), dynamic ambient mesh gradients from cover art, interactive waveform seekbar, and fluid stacked player layouts.
* **Rust Native Power:** Replaces the Electron main process, Node runtime, child process wrappers, and tagging engines with native compiled Rust (`lofty`, `tokio`, `rusqlite`).
* **Resource Optimization:** Idle RAM reduced from ~250MB to ~45MB; portable `.exe` reduced from ~110MB to ~16MB.

👉 **Read the full migration blueprint:** [`RUST_PORT_ANALYSIS.md`](RUST_PORT_ANALYSIS.md)

---

## What it is

Music Manager plays your own files and their linked music videos, with synced
lyrics, in one library and one queue. There is no account requirement, no cloud
library, and no telemetry beyond a local error log.

It is built on the MIT-licensed [AlgerMusicPlayer](https://github.com/algerkong/AlgerMusicPlayer)
engine, with the Netease cloud layer, the non-English locales and the
promotional modules removed. All upstream open-source credits are listed in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

## Features

### Linked audio + video
- **Linked A/V playback** — the song's audio is the only sound source and the
  master clock; the video shows the picture muted beside it. No double audio,
  no gap when switching modes, one shared duration and playback time.
- **Instant audio ⇄ video switching** mid-track, with the pill showing
  `Video • 360p` or `Audio • 128 kb/s`.
- **Per-codec quality ladder** (1080p–144p) via bundled `yt-dlp`, with
  video-only downloads, completion ticks and per-file deletion.

### Library and playback
- **Local file playback** for `.mp3`, `.flac`, `.opus`, `.m4a`, `.mp4`, `.webm`
  and more, with HTTP Range seeking.
- **Unified song library** — audio files, higher-bitrate copies and music videos
  are linked as *variants of one song* in a single database.
- **Acoustic fingerprint index** — detects duplicate recordings by fingerprint
  and duration, then merges them while preserving every variant.
- **Automatic metadata repair** — fills in missing titles, artists and cover art
  from iTunes Search, MusicBrainz and the Cover Art Archive, and writes the tags
  back to the file (`ID3v2`, Vorbis comments, MP4 atoms).
- **Playlist and library backup** — export and restore `.m3u8` playlists and full
  `.json` library snapshots.

### Lyrics
- **Synced lyrics** from LRCLIB, with word-by-word (karaoke) highlighting,
  per-line `mm:ss,ms` start times, and a scrollable click-to-seek strip under
  the artwork in narrow windows.
- **Edit LRC** — raw timestamps with per-line ±0.1s nudges that follow playback
  live and apply to the player instantly.
- **Timing offset control** (uniform − / reset / + with a manual ±seconds input),
  remembered per song and applied to every surface.
- **Lyric search with match badges** — candidates show `length ✓` or `Δ ±Xs`
  versus your file, plus where the lyrics start, so the closest version wins.
- **Multi-language romanization** — Hepburn Romaji for Japanese kana and phonetic
  Bangla, generated from the shared transliteration tables.

### Player and interface
- Dynamic palette extracted from the album art, with light and dark themes.
- Namida-style stacked fullscreen player with a waveform seekbar.
- Equal-power crossfade, gapless playback, skip-silence and an equalizer.
- A-B loop, per-track bookmarks, sleep timer and listening statistics.
- "Edit Metadata, Artwork & Filename" available both in the library list and
  inside the player.
- Save to Disk with batch checkboxes, persistent "Saved" ticks and no duplicate
  saves.
- Discord Rich Presence, global media keys and system tray controls.
- **English-only interface and source.** No other locale ships.

## Documentation

| Document | What it holds |
| --- | --- |
| [`RUST_PORT_ANALYSIS.md`](RUST_PORT_ANALYSIS.md) | Comprehensive feasibility study, system architecture, and migration blueprint for Tauri v2 + Rust |
| [`docs/PRODUCT.md`](docs/PRODUCT.md) | User intentions, active feature map, and the merge wishlist |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Visual system map, tech stack rationale, subsystems, recipes |
| [`docs/DECISIONS_AND_TRAPS.md`](docs/DECISIONS_AND_TRAPS.md) | Why we chose each approach, what failed, and the do-not-touch landmines |

## License

This project is licensed under the **PolyForm Noncommercial License 1.0.0** —
see [`LICENSE`](LICENSE). Noncommercial use, personal study and noncommercial
organizations are permitted; commercial use is not.

Third-party components retain their own licenses (MIT, ISC, Apache-2.0,
Unlicense, GPL) — see [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

## Built on

Music Manager is an **independent derivative of
[AlgerMusicPlayer](https://github.com/algerkong/AlgerMusicPlayer)**, forked from
commit `f57204d` in October 2026. The majority of the source tree originates
there under the MIT License; the local-first library, the linked audio/video
playback, the English-only sweep and the rebrand are additions made in this
repository. This project does not track upstream.

| Source | What came from it | License |
| --- | --- | --- |
| [AlgerMusicPlayer](https://github.com/algerkong/AlgerMusicPlayer) by Alger | Shell, player core, renderer components, download and update pipeline — most of the tree | MIT |
| [YesPlayMusic](https://github.com/qier222/YesPlayMusic) by qier222 | Lyric parser and aligner, database schema, play/pause volume fade | MIT |
| [Namida](https://github.com/namidaco/Namida) | Stacked fullscreen player, frosted glassmorphism, dynamic palette, video pill — design inspiration only | — |

Every dependency and bundled tool is listed with its license in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md), which also reproduces the MIT
notice text for the two projects above. Fork point, commit split and a
file-level map of what originates where are recorded in
[`UPSTREAM.md`](UPSTREAM.md).

## Acknowledgements

Thanks to Alger, qier222 and the other YesPlayMusic and AlgerMusicPlayer
contributors, whose MIT-licensed work this project is built on.
