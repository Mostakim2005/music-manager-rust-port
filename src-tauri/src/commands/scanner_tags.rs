use color_thief::{get_palette, ColorFormat};
use image::GenericImageView;
use lofty::config::WriteOptions;
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::prelude::*;
use lofty::probe::Probe;
use lofty::tag::{ItemKey, ItemValue, Tag, TagItem};
use rayon::prelude::*;
use rusty_chromaprint::{Configuration, Fingerprinter};
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::fs::{self, File};
use std::hash::{Hash, Hasher};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::Instant;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_dialog::DialogExt;
use walkdir::WalkDir;

const AUDIO_EXTENSIONS: &[&str] = &["mp3", "flac", "m4a", "mp4", "ogg", "opus", "wav", "aac", "wv"];

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScannedTrackMetadata {
    pub file_path: String,
    pub stored_url: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration_sec: f64,
    pub bitrate_kbps: Option<u32>,
    pub sample_rate: Option<u32>,
    pub container: String,
    pub codec: String,
    pub size_bytes: u64,
    pub cover_path: Option<String>,
    pub primary_color: Option<String>,
    pub background_color: Option<String>,
    pub palette_hex: Vec<String>,
    pub embedded_lyrics: Option<String>,
    pub youtube_link: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScanWithStatsResult {
    pub tracks: Vec<ScannedTrackMetadata>,
    pub total_files_found: usize,
    pub total_parsed: usize,
    pub failed_count: usize,
    pub elapsed_ms: u128,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FingerprintResult {
    pub fingerprint: String,
    pub duration_sec: f64,
    pub windows: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTagsPayload {
    pub file_path: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub cover_file_path: Option<String>,
    pub lyrics: Option<String>,
    pub youtube_url: Option<String>,
    pub rename_file_to: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SaveSyncedLyricsParams {
    pub file_path: String,
    pub lyrics: String,
    pub save_sidecar: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SaveLyricFileParams {
    pub filename: String,
    pub lrc_content: String,
    pub target_dir: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct M3u8TrackItem {
    pub file_path: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub duration: Option<f64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExportM3u8Params {
    pub tracks: Vec<M3u8TrackItem>,
    pub default_name: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExportBackupJsonParams {
    pub payload: serde_json::Value,
    pub default_name: Option<String>,
}

/// Normalizes a `local:///...` or raw disk path into a clean OS PathBuf
pub fn clean_disk_path(input: &str) -> PathBuf {
    let stripped = input
        .strip_prefix("local:///")
        .or_else(|| input.strip_prefix("local://"))
        .or_else(|| input.strip_prefix("file:///"))
        .unwrap_or(input);
    PathBuf::from(stripped)
}

/// Converts an OS path into the canonical `local:///...` format stored in Dexie / SQLite
pub fn to_stored_local_url(path: &Path) -> String {
    let normalized = path.to_string_lossy().replace('\\', "/");
    if normalized.starts_with('/') {
        format!("local://{normalized}")
    } else {
        format!("local:///{normalized}")
    }
}

/// Extracts dominant and ambient colors from raw image bytes using `color-thief`
pub fn extract_namida_palette(image_bytes: &[u8]) -> Option<(String, String, Vec<String>)> {
    let img = image::load_from_memory(image_bytes).ok()?;
    let rgb_img = img.thumbnail(96, 96).to_rgb8();
    let raw_pixels = rgb_img.as_raw();

    let colors = get_palette(raw_pixels, ColorFormat::Rgb, 5, 5).ok()?;
    if colors.is_empty() {
        return None;
    }

    let hex_list: Vec<String> = colors
        .iter()
        .map(|c| format!("#{:02x}{:02x}{:02x}", c.r, c.g, c.b))
        .collect();

    let primary = hex_list[0].clone();
    let bg_source = colors.get(1).unwrap_or(&colors[0]);
    let bg_hex = format!(
        "#{:02x}{:02x}{:02x}",
        (bg_source.r as u16 * 35 / 100) as u8,
        (bg_source.g as u16 * 35 / 100) as u8,
        (bg_source.b as u16 * 35 / 100) as u8
    );

    Some((primary, bg_hex, hex_list))
}

/// Reads metadata, cover art, palette, and embedded lyrics for a single audio file
fn parse_single_track(path: &Path, cover_cache_dir: &Path) -> anyhow::Result<ScannedTrackMetadata> {
    let file_meta = fs::metadata(path)?;
    let size_bytes = file_meta.len();
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let tagged_file = Probe::open(path)?.read()?;
    let properties = tagged_file.properties();
    let duration_sec = properties.duration().as_secs_f64();
    let bitrate_kbps = properties.audio_bitrate();
    let sample_rate = properties.sample_rate();

    let file_stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Unknown Title")
        .to_string();

    let mut title = file_stem;
    let mut artist = String::from("Unknown Artist");
    let mut album = String::from("Unknown Album");
    let mut embedded_lyrics: Option<String> = None;
    let mut youtube_link: Option<String> = None;
    let mut cover_path: Option<String> = None;
    let mut primary_color: Option<String> = None;
    let mut background_color: Option<String> = None;
    let mut palette_hex: Vec<String> = Vec::new();

    if let Some(tag) = tagged_file.primary_tag().or_else(|| tagged_file.first_tag()) {
        if let Some(t) = tag.title() {
            if !t.trim().is_empty() {
                title = t.into_owned();
            }
        }
        if let Some(a) = tag.artist() {
            if !a.trim().is_empty() {
                artist = a.into_owned();
            }
        }
        if let Some(al) = tag.album() {
            if !al.trim().is_empty() {
                album = al.into_owned();
            }
        }

        // Check for embedded lyrics
        if let Some(lyr) = tag.get_string(&ItemKey::Lyrics) {
            embedded_lyrics = Some(lyr.to_string());
        }

        // Check for custom YouTube URL link tag
        for item in tag.items() {
            if let ItemKey::Unknown(k) = item.key() {
                if k.eq_ignore_ascii_case("YOUTUBE_URL") || k.eq_ignore_ascii_case("WWWAUDIOSOURCE") {
                    if let ItemValue::Text(url) = item.value() {
                        youtube_link = Some(url.clone());
                    }
                }
            }
        }

        // Extract embedded cover art to disk cache & compute Namida palette
        if let Some(pic) = tag.pictures().first() {
            let pic_bytes = pic.data();
            if !pic_bytes.is_empty() {
                let mut hasher = DefaultHasher::new();
                pic_bytes.hash(&mut hasher);
                let hash_hex = format!("{:016x}", hasher.finish());

                let img_ext = match pic.mime_type() {
                    Some(MimeType::Png) => "png",
                    Some(MimeType::Unknown(ref s)) if s.to_lowercase().contains("webp") => "webp",
                    _ => "jpg",
                };

                let target_cover = cover_cache_dir.join(format!("{hash_hex}.{img_ext}"));
                if !target_cover.exists() {
                    let _ = fs::write(&target_cover, pic_bytes);
                }
                cover_path = Some(to_stored_local_url(&target_cover));

                if let Some((pri, bg, pal)) = extract_namida_palette(pic_bytes) {
                    primary_color = Some(pri);
                    background_color = Some(bg);
                    palette_hex = pal;
                }
            }
        }
    }

    // Check for sidecar .lrc file if no embedded lyrics exist
    if embedded_lyrics.is_none() {
        let sidecar_lrc = path.with_extension("lrc");
        if sidecar_lrc.exists() {
            if let Ok(lrc_text) = fs::read_to_string(&sidecar_lrc) {
                embedded_lyrics = Some(lrc_text);
            }
        }
    }

    Ok(ScannedTrackMetadata {
        file_path: path.to_string_lossy().into_owned(),
        stored_url: to_stored_local_url(path),
        title,
        artist,
        album,
        duration_sec,
        bitrate_kbps,
        sample_rate,
        container: ext.clone(),
        codec: ext,
        size_bytes,
        cover_path,
        primary_color,
        background_color,
        palette_hex,
        embedded_lyrics,
        youtube_link,
    })
}

fn ensure_cover_cache_dir<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    let base = app
        .path()
        .app_cache_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("covers");
    let _ = fs::create_dir_all(&base);
    base
}

// ============================================================================
// 1. PARALLEL DIRECTORY SCANNER COMMANDS
// ============================================================================

#[tauri::command]
pub async fn scan_local_music_with_stats<R: Runtime>(
    app: AppHandle<R>,
    folder_path: String,
) -> Result<ScanWithStatsResult, String> {
    let cover_dir = ensure_cover_cache_dir(&app);

    tokio::task::spawn_blocking(move || {
        let start = Instant::now();
        let root = clean_disk_path(&folder_path);

        let audio_files: Vec<PathBuf> = WalkDir::new(&root)
            .follow_links(true)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
            .filter(|e| {
                e.path()
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .map(|ext| AUDIO_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
                    .unwrap_or(false)
            })
            .map(|e| e.into_path())
            .collect();

        let total_files_found = audio_files.len();

        let tracks: Vec<ScannedTrackMetadata> = audio_files
            .par_iter()
            .filter_map(|path| parse_single_track(path, &cover_dir).ok())
            .collect();

        let total_parsed = tracks.len();
        let failed_count = total_files_found.saturating_sub(total_parsed);

        Ok(ScanWithStatsResult {
            tracks,
            total_files_found,
            total_parsed,
            failed_count,
            elapsed_ms: start.elapsed().as_millis(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn scan_local_music<R: Runtime>(
    app: AppHandle<R>,
    folder_path: String,
) -> Result<Vec<ScannedTrackMetadata>, String> {
    let stats = scan_local_music_with_stats(app, folder_path).await?;
    Ok(stats.tracks)
}

#[tauri::command]
pub async fn parse_local_music_metadata<R: Runtime>(
    app: AppHandle<R>,
    file_paths: Vec<String>,
) -> Result<Vec<ScannedTrackMetadata>, String> {
    let cover_dir = ensure_cover_cache_dir(&app);

    tokio::task::spawn_blocking(move || {
        let results: Vec<ScannedTrackMetadata> = file_paths
            .par_iter()
            .map(|raw| clean_disk_path(raw))
            .filter_map(|path| parse_single_track(&path, &cover_dir).ok())
            .collect();
        Ok(results)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ============================================================================
// 2. UNIFIED TAG & LYRIC WRITER COMMANDS (LOFTY)
// ============================================================================

#[tauri::command]
pub async fn update_local_music_tags_and_file<R: Runtime>(
    app: AppHandle<R>,
    payload: UpdateTagsPayload,
) -> Result<ScannedTrackMetadata, String> {
    let cover_dir = ensure_cover_cache_dir(&app);

    tokio::task::spawn_blocking(move || {
        let mut path = clean_disk_path(&payload.file_path);
        if !path.exists() {
            return Err(format!("Track file does not exist: {}", path.display()));
        }

        let mut tagged_file = Probe::open(&path)
            .map_err(|e| e.to_string())?
            .read()
            .map_err(|e| e.to_string())?;

        let tag_type = tagged_file.primary_tag_type();
        if tagged_file.primary_tag().is_none() {
            tagged_file.insert_tag(Tag::new(tag_type));
        }
        let tag = tagged_file.primary_tag_mut().unwrap();

        if let Some(title) = payload.title {
            tag.set_title(title);
        }
        if let Some(artist) = payload.artist {
            tag.set_artist(artist);
        }
        if let Some(album) = payload.album {
            tag.set_album(album);
        }
        if let Some(lyrics) = payload.lyrics {
            tag.insert_text(ItemKey::Lyrics, lyrics);
        }
        if let Some(yt_url) = payload.youtube_url {
            tag.insert(TagItem::new(
                ItemKey::Unknown("YOUTUBE_URL".to_string()),
                ItemValue::Text(yt_url),
            ));
        }

        if let Some(cover_src) = payload.cover_file_path {
            let clean_cover = clean_disk_path(&cover_src);
            if clean_cover.exists() {
                let bytes = fs::read(&clean_cover).map_err(|e| e.to_string())?;
                let mime = match clean_cover
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("jpg")
                    .to_lowercase()
                    .as_str()
                {
                    "png" => MimeType::Png,
                    "webp" => MimeType::Unknown("image/webp".to_string()),
                    _ => MimeType::Jpeg,
                };
                tag.remove_picture_type(PictureType::CoverFront);
                tag.push_picture(Picture::new_unchecked(
                    PictureType::CoverFront,
                    Some(mime),
                    None,
                    bytes,
                ));
            }
        }

        tag.save_to_path(&path, WriteOptions::default())
            .map_err(|e| format!("Failed saving tags: {e}"))?;

        if let Some(new_name) = payload.rename_file_to {
            let sanitized: String = new_name
                .chars()
                .filter(|c| !['<', '>', ':', '"', '/', '\\', '|', '?', '*'].contains(c))
                .collect();
            if !sanitized.trim().is_empty() {
                let ext = path
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("mp3");
                let target_path = path.with_file_name(format!("{sanitized}.{ext}"));
                if target_path != path {
                    fs::rename(&path, &target_path).map_err(|e| e.to_string())?;
                    path = target_path;
                }
            }
        }

        parse_single_track(&path, &cover_dir).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn save_synced_lyrics(params: SaveSyncedLyricsParams) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || {
        let path = clean_disk_path(&params.file_path);
        if !path.exists() {
            return Err("Audio file not found".into());
        }

        if let Ok(mut tagged) = Probe::open(&path).and_then(|p| p.read()) {
            let tag_type = tagged.primary_tag_type();
            if tagged.primary_tag().is_none() {
                tagged.insert_tag(Tag::new(tag_type));
            }
            if let Some(tag) = tagged.primary_tag_mut() {
                tag.insert_text(ItemKey::Lyrics, params.lyrics.clone());
                let _ = tag.save_to_path(&path, WriteOptions::default());
            }
        }

        if params.save_sidecar.unwrap_or(true) {
            let lrc_path = path.with_extension("lrc");
            fs::write(&lrc_path, params.lyrics.as_bytes()).map_err(|e| e.to_string())?;
        }

        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_embedded_lyrics(file_path: String) -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(move || {
        let path = clean_disk_path(&file_path);
        if let Ok(tagged) = Probe::open(&path).and_then(|p| p.read()) {
            if let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) {
                if let Some(lyr) = tag.get_string(&ItemKey::Lyrics) {
                    return Ok(Some(lyr.to_string()));
                }
            }
        }
        let sidecar = path.with_extension("lrc");
        if sidecar.exists() {
            if let Ok(text) = fs::read_to_string(sidecar) {
                return Ok(Some(text));
            }
        }
        Ok(None)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn save_lyric_file(params: SaveLyricFileParams) -> Result<String, String> {
    let dir = match params.target_dir {
        Some(d) => clean_disk_path(&d),
        None => std::env::temp_dir(),
    };
    let _ = fs::create_dir_all(&dir);
    let file_name = if params.filename.ends_with(".lrc") {
        params.filename
    } else {
        format!("{}.lrc", params.filename)
    };
    let full_path = dir.join(file_name);
    fs::write(&full_path, params.lrc_content.as_bytes()).map_err(|e| e.to_string())?;
    Ok(full_path.to_string_lossy().into_owned())
}

// ============================================================================
// 3. PURE-RUST ACOUSTIC FINGERPRINTING (SYMPHONIA + RUSTY-CHROMAPRINT)
// ============================================================================

#[tauri::command]
pub async fn get_audio_fingerprint(file_path: String) -> Result<Option<FingerprintResult>, String> {
    tokio::task::spawn_blocking(move || {
        let path = clean_disk_path(&file_path);
        if !path.exists() {
            return Ok(None);
        }

        let file = File::open(&path).map_err(|e| e.to_string())?;
        let mss = MediaSourceStream::new(Box::new(file), Default::default());

        let mut hint = Hint::new();
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            hint.with_extension(ext);
        }

        let probed = symphonia::default::get_probe()
            .format(
                &hint,
                mss,
                &FormatOptions::default(),
                &MetadataOptions::default(),
            )
            .map_err(|e| e.to_string())?;

        let mut format = probed.format;
        let track = match format.default_track() {
            Some(t) => t,
            None => return Ok(None),
        };

        let track_id = track.id;
        let sample_rate = track.codec_params.sample_rate.unwrap_or(44100);
        let channels = track
            .codec_params
            .channels
            .map(|c| c.count())
            .unwrap_or(2) as u32;

        let mut decoder = symphonia::default::get_codecs()
            .make(&track.codec_params, &DecoderOptions::default())
            .map_err(|e| e.to_string())?;

        let config = Configuration::preset_test2();
        let mut printer = Fingerprinter::new(&config);
        printer
            .start(sample_rate, channels)
            .map_err(|e| format!("Chromaprint init error: {e:?}"))?;

        let max_samples = (sample_rate as usize) * (channels as usize) * 120;
        let mut processed_samples = 0usize;
        let mut windows = 0usize;

        while let Ok(packet) = format.next_packet() {
            if packet.track_id() != track_id {
                continue;
            }
            if let Ok(decoded) = decoder.decode(&packet) {
                let spec = *decoded.spec();
                let mut sample_buf = SampleBuffer::<i16>::new(decoded.capacity() as u64, spec);
                sample_buf.copy_interleaved_ref(decoded);
                let samples = sample_buf.samples();
                printer.consume(samples);
                processed_samples += samples.len();
                windows += 1;

                if processed_samples >= max_samples {
                    break;
                }
            }
        }

        printer.finish();
        let raw_fp = printer.fingerprint();
        let fp_hex: String = raw_fp.iter().map(|v| format!("{v:08x}")).collect();
        let duration_sec =
            (processed_samples as f64) / ((sample_rate as f64) * (channels as f64));

        Ok(Some(FingerprintResult {
            fingerprint: fp_hex,
            duration_sec,
            windows,
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}

// ============================================================================
// 4. NAMIDA WAVEFORM SEEKBAR PEAK GENERATOR & PALETTE COMMANDS
// ============================================================================

#[tauri::command]
pub async fn generate_waveform_peaks(
    file_path: String,
    buckets: Option<usize>,
) -> Result<Vec<f32>, String> {
    let target_buckets = buckets.unwrap_or(180).clamp(32, 512);

    tokio::task::spawn_blocking(move || {
        let path = clean_disk_path(&file_path);
        let file = File::open(&path).map_err(|e| e.to_string())?;
        let mss = MediaSourceStream::new(Box::new(file), Default::default());

        let mut hint = Hint::new();
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            hint.with_extension(ext);
        }

        let probed = symphonia::default::get_probe()
            .format(
                &hint,
                mss,
                &FormatOptions::default(),
                &MetadataOptions::default(),
            )
            .map_err(|e| e.to_string())?;

        let mut format = probed.format;
        let track = format
            .default_track()
            .ok_or_else(|| "No audio track found".to_string())?;
        let track_id = track.id;

        let mut decoder = symphonia::default::get_codecs()
            .make(&track.codec_params, &DecoderOptions::default())
            .map_err(|e| e.to_string())?;

        let mut packet_peaks: Vec<f32> = Vec::with_capacity(4096);

        while let Ok(packet) = format.next_packet() {
            if packet.track_id() != track_id {
                continue;
            }
            if let Ok(decoded) = decoder.decode(&packet) {
                let spec = *decoded.spec();
                let mut sample_buf = SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
                sample_buf.copy_interleaved_ref(decoded);

                let peak = sample_buf
                    .samples()
                    .iter()
                    .step_by(32)
                    .fold(0.0f32, |max, &s| max.max(s.abs()));
                packet_peaks.push(peak);
            }
        }

        if packet_peaks.is_empty() {
            return Ok(vec![0.15; target_buckets]);
        }

        let chunk_size = (packet_peaks.len() / target_buckets).max(1);
        let mut bars: Vec<f32> = packet_peaks
            .chunks(chunk_size)
            .take(target_buckets)
            .map(|c| c.iter().copied().fold(0.0f32, f32::max))
            .collect();

        let global_max = bars.iter().copied().fold(0.001f32, f32::max);
        for b in &mut bars {
            *b = (*b / global_max).clamp(0.08, 1.0);
        }
        while bars.len() < target_buckets {
            bars.push(0.08);
        }

        Ok(bars)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn extract_image_palette(
    image_path: String,
) -> Result<Option<(String, String, Vec<String>)>, String> {
    tokio::task::spawn_blocking(move || {
        let path = clean_disk_path(&image_path);
        let bytes = fs::read(&path).map_err(|e| e.to_string())?;
        Ok(extract_namida_palette(&bytes))
    })
    .await
    .map_err(|e| e.to_string())?
}

// ============================================================================
// 5. M3U8 PLAYLIST & JSON BACKUP IMPORT / EXPORT
// ============================================================================

#[tauri::command]
pub async fn export_m3u8<R: Runtime>(
    app: AppHandle<R>,
    params: ExportM3u8Params,
) -> Result<Option<String>, String> {
    let default_name = params
        .default_name
        .unwrap_or_else(|| "playlist.m3u8".to_string());

    let save_path = app
        .dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter("M3U8 Playlist", &["m3u8", "m3u"])
        .blocking_save_file();

    let Some(file_path) = save_path else {
        return Ok(None);
    };
    let target = file_path.into_path().map_err(|e| e.to_string())?;

    let mut out = String::from("#EXTM3U\n");
    for item in params.tracks {
        let dur = item.duration.unwrap_or(-1.0).round() as i64;
        let artist = item.artist.unwrap_or_else(|| "Unknown Artist".into());
        let title = item.title.unwrap_or_else(|| "Unknown Title".into());
        let disk_path = clean_disk_path(&item.file_path);
        out.push_str(&format!("#EXTINF:{dur},{artist} - {title}\n"));
        out.push_str(&format!("{}\n", disk_path.display()));
    }

    fs::write(&target, out.as_bytes()).map_err(|e| e.to_string())?;
    Ok(Some(target.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn import_m3u8<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<ScannedTrackMetadata>, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("M3U8 Playlist", &["m3u8", "m3u"])
        .blocking_pick_file();

    let Some(file_path) = picked else {
        return Ok(Vec::new());
    };
    let m3u_path = file_path.into_path().map_err(|e| e.to_string())?;
    let parent_dir = m3u_path.parent().unwrap_or_else(|| Path::new(".")).to_path_buf();

    let file = File::open(&m3u_path).map_err(|e| e.to_string())?;
    let reader = BufReader::new(file);

    let mut track_paths: Vec<String> = Vec::new();
    for line in reader.lines().map_while(Result::ok) {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let candidate = PathBuf::from(trimmed);
        let resolved = if candidate.is_absolute() {
            candidate
        } else {
            parent_dir.join(candidate)
        };
        if resolved.exists() {
            track_paths.push(resolved.to_string_lossy().into_owned());
        }
    }

    parse_local_music_metadata(app, track_paths).await
}

#[tauri::command]
pub async fn export_backup_json<R: Runtime>(
    app: AppHandle<R>,
    params: ExportBackupJsonParams,
) -> Result<Option<String>, String> {
    let default_name = params
        .default_name
        .unwrap_or_else(|| "music-manager-backup.json".to_string());

    let save_path = app
        .dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter("JSON Backup", &["json"])
        .blocking_save_file();

    let Some(file_path) = save_path else {
        return Ok(None);
    };
    let target = file_path.into_path().map_err(|e| e.to_string())?;
    let pretty = serde_json::to_string_pretty(&params.payload).map_err(|e| e.to_string())?;
    fs::write(&target, pretty.as_bytes()).map_err(|e| e.to_string())?;
    Ok(Some(target.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn import_backup_json<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Option<serde_json::Value>, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("JSON Backup", &["json"])
        .blocking_pick_file();

    let Some(file_path) = picked else {
        return Ok(None);
    };
    let target = file_path.into_path().map_err(|e| e.to_string())?;
    let content = fs::read_to_string(&target).map_err(|e| e.to_string())?;
    let parsed: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(Some(parsed))
}
