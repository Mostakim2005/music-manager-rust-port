use crate::commands::scanner_tags::{clean_disk_path, update_local_music_tags_and_file, UpdateTagsPayload};
use crate::state::AppState;
#[allow(unused_imports)]
use futures::StreamExt;
use lofty::prelude::*;
use lofty::probe::Probe;
use lofty::tag::{ItemKey, ItemValue};
use serde::{Deserialize, Serialize};
use std::fs::File;
#[allow(unused_imports)]
use std::io::Write;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct YtFormatOption {
    pub format_id: String,
    pub container: String,
    pub codec: String,
    pub height: Option<u32>,
    pub fps: Option<u32>,
    pub bitrate_kbps: Option<u32>,
    pub size_bytes: Option<u64>,
    pub is_video_only: bool,
    pub is_audio_only: bool,
    pub url: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct YtFormatsResponse {
    pub id: String,
    pub title: String,
    pub uploader: Option<String>,
    pub duration_sec: f64,
    pub thumbnail: Option<String>,
    pub video_formats: Vec<YtFormatOption>,
    pub audio_formats: Vec<YtFormatOption>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct YtStreamOptions {
    pub kind: Option<String>, // "audio" | "video"
    pub height: Option<u32>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct YtDownloadOptions {
    pub job_id: Option<String>,
    pub format_id: Option<String>,
    pub kind: Option<String>, // "video" | "audio"
    pub height: Option<u32>,
    pub output_dir: Option<String>,
    pub filename: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct YtDownloadProgressEvent {
    pub job_id: String,
    pub percent: f64,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub speed_bps: Option<f64>,
    pub status: String,
    pub file_path: Option<String>,
}

fn normalize_yt_url(id_or_url: &str) -> String {
    if id_or_url.starts_with("http://") || id_or_url.starts_with("https://") {
        id_or_url.to_string()
    } else {
        format!("https://www.youtube.com/watch?v={id_or_url}")
    }
}

/// Simplifies codec strings ("av01.0.05M.08" -> "av01", "vp9" -> "vp9", "avc1.640028" -> "h264")
fn normalize_codec_name(raw: &str) -> String {
    let lower = raw.to_lowercase();
    if lower.starts_with("av01") {
        "av01".into()
    } else if lower.starts_with("vp9") || lower.starts_with("vp09") {
        "vp9".into()
    } else if lower.starts_with("avc1") || lower.starts_with("h264") {
        "h264".into()
    } else if lower.starts_with("mp4a") || lower.starts_with("aac") {
        "aac".into()
    } else if lower.starts_with("opus") {
        "opus".into()
    } else {
        raw.split('.').next().unwrap_or(raw).to_string()
    }
}

// ============================================================================
// 1. FORMAT LADDER EXTRACTION (WINDOWS SIDECAR + ANDROID PURE-RUST)
// ============================================================================

#[tauri::command]
pub async fn yt_formats<R: Runtime>(
    app: AppHandle<R>,
    id_or_url: String,
) -> Result<YtFormatsResponse, String> {
    let url = normalize_yt_url(&id_or_url);

    #[cfg(not(target_os = "android"))]
    {
        use tauri_plugin_shell::ShellExt;
        let output = app
            .shell()
            .sidecar("yt-dlp")
            .map_err(|e| e.to_string())?
            .args(["-J", "--no-playlist", "--no-warnings", &url])
            .output()
            .await
            .map_err(|e| format!("yt-dlp execution failed: {e}"))?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).into_owned());
        }

        let json: serde_json::Value =
            serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())?;
        return parse_ytdlp_json(&json);
    }

    #[cfg(target_os = "android")]
    {
        let _ = app;
        use rusty_ytdl::{Video, VideoOptions};
        let video = Video::new_with_options(&url, VideoOptions::default())
            .map_err(|e| e.to_string())?;
        let info = video.get_Info().await.map_err(|e| e.to_string())?;

        let mut video_formats = Vec::new();
        let mut audio_formats = Vec::new();

        for fmt in &info.formats {
            let has_video = fmt.has_video;
            let has_audio = fmt.has_audio;
            let container = fmt
                .container
                .clone()
                .unwrap_or_else(|| "mp4".to_string());
            let raw_codec = fmt
                .codecs
                .clone()
                .unwrap_or_else(|| "h264".to_string());
            let codec = normalize_codec_name(&raw_codec);
            let bitrate_kbps = fmt.bitrate.map(|b| (b / 1000) as u32);
            let size_bytes = fmt
                .content_length
                .as_ref()
                .and_then(|s| s.parse::<u64>().ok());

            let item = YtFormatOption {
                format_id: fmt.itag.to_string(),
                container,
                codec,
                height: fmt.height.map(|h| h as u32),
                fps: fmt.fps.map(|f| f as u32),
                bitrate_kbps,
                size_bytes,
                is_video_only: has_video && !has_audio,
                is_audio_only: has_audio && !has_video,
                url: Some(fmt.url.clone()),
            };

            if has_video {
                video_formats.push(item);
            } else if has_audio {
                audio_formats.push(item);
            }
        }

        video_formats.sort_by(|a, b| b.height.unwrap_or(0).cmp(&a.height.unwrap_or(0)));
        audio_formats.sort_by(|a, b| {
            b.bitrate_kbps
                .unwrap_or(0)
                .cmp(&a.bitrate_kbps.unwrap_or(0))
        });

        let details = &info.video_details;
        let duration_sec = details.length_seconds.parse::<f64>().unwrap_or(0.0);
        let thumbnail = details.thumbnails.last().map(|t| t.url.clone());

        return Ok(YtFormatsResponse {
            id: details.video_id.clone(),
            title: details.title.clone(),
            uploader: Some(details.author.name.clone()),
            duration_sec,
            thumbnail,
            video_formats,
            audio_formats,
        });
    }
}

#[cfg(not(target_os = "android"))]
fn parse_ytdlp_json(json: &serde_json::Value) -> Result<YtFormatsResponse, String> {
    let id = json["id"].as_str().unwrap_or_default().to_string();
    let title = json["title"].as_str().unwrap_or("Unknown").to_string();
    let uploader = json["uploader"].as_str().map(|s| s.to_string());
    let duration_sec = json["duration"].as_f64().unwrap_or(0.0);
    let thumbnail = json["thumbnail"].as_str().map(|s| s.to_string());

    let mut video_formats = Vec::new();
    let mut audio_formats = Vec::new();

    if let Some(arr) = json["formats"].as_array() {
        for f in arr {
            let format_id = f["format_id"].as_str().unwrap_or_default().to_string();
            let ext = f["ext"].as_str().unwrap_or("mp4").to_string();
            let vcodec = f["vcodec"].as_str().unwrap_or("none");
            let acodec = f["acodec"].as_str().unwrap_or("none");
            let url = f["url"].as_str().map(|s| s.to_string());

            let has_video = vcodec != "none";
            let has_audio = acodec != "none";
            if !has_video && !has_audio {
                continue;
            }

            let height = f["height"].as_u64().map(|h| h as u32);
            let fps = f["fps"].as_f64().map(|fps| fps.round() as u32);
            let tbr = f["tbr"]
                .as_f64()
                .or_else(|| f["vbr"].as_f64())
                .or_else(|| f["abr"].as_f64())
                .map(|b| b.round() as u32);
            let size_bytes = f["filesize"]
                .as_u64()
                .or_else(|| f["filesize_approx"].as_u64());

            if has_video {
                video_formats.push(YtFormatOption {
                    format_id,
                    container: ext,
                    codec: normalize_codec_name(vcodec),
                    height,
                    fps,
                    bitrate_kbps: tbr,
                    size_bytes,
                    is_video_only: !has_audio,
                    is_audio_only: false,
                    url,
                });
            } else if has_audio {
                audio_formats.push(YtFormatOption {
                    format_id,
                    container: ext,
                    codec: normalize_codec_name(acodec),
                    height: None,
                    fps: None,
                    bitrate_kbps: tbr,
                    size_bytes,
                    is_video_only: false,
                    is_audio_only: true,
                    url,
                });
            }
        }
    }

    // Sort highest resolution & bitrate first
    video_formats.sort_by(|a, b| {
        b.height
            .unwrap_or(0)
            .cmp(&a.height.unwrap_or(0))
            .then_with(|| b.bitrate_kbps.unwrap_or(0).cmp(&a.bitrate_kbps.unwrap_or(0)))
    });
    audio_formats.sort_by(|a, b| {
        b.bitrate_kbps
            .unwrap_or(0)
            .cmp(&a.bitrate_kbps.unwrap_or(0))
    });

    Ok(YtFormatsResponse {
        id,
        title,
        uploader,
        duration_sec,
        thumbnail,
        video_formats,
        audio_formats,
    })
}

// ============================================================================
// 2. STREAM URL RESOLUTION WITH 4-HOUR CACHE
// ============================================================================

#[tauri::command]
pub async fn yt_stream_url<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    id_or_url: String,
    options: Option<YtStreamOptions>,
) -> Result<String, String> {
    let kind = options
        .as_ref()
        .and_then(|o| o.kind.clone())
        .unwrap_or_else(|| "video".to_string());
    let target_height = options.as_ref().and_then(|o| o.height).unwrap_or(1080);

    let cache_key = format!("{id_or_url}:{kind}:{target_height}");
    if let Some(cached) = state.get_cached_stream(&cache_key) {
        return Ok(cached);
    }

    let ladder = yt_formats(app, id_or_url).await?;
    let chosen_url = if kind == "audio" {
        ladder
            .audio_formats
            .into_iter()
            .find_map(|f| f.url)
            .ok_or_else(|| "No playable audio stream URL found".to_string())?
    } else {
        // Prefer H.264/MP4 on WebView2 for universal hardware decode, matching target_height
        let mut candidates: Vec<_> = ladder
            .video_formats
            .into_iter()
            .filter(|f| f.url.is_some())
            .collect();

        candidates.sort_by_key(|f| {
            let h_diff = (f.height.unwrap_or(720) as i32 - target_height as i32).abs();
            let codec_score = if f.codec == "h264" { 0 } else { 1 };
            (h_diff, codec_score)
        });

        candidates
            .into_iter()
            .next()
            .and_then(|f| f.url)
            .ok_or_else(|| "No playable video stream URL found".to_string())?
    };

    state.set_cached_stream(cache_key, chosen_url.clone());
    Ok(chosen_url)
}

// ============================================================================
// 3. YOUTUBE SEARCH & VIDEO-ONLY / AUDIO-ONLY DOWNLOADER
// ============================================================================

#[tauri::command]
pub async fn yt_search<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    query: String,
    options: Option<serde_json::Value>,
) -> Result<Vec<serde_json::Value>, String> {
    let limit = options
        .as_ref()
        .and_then(|o| o["limit"].as_u64())
        .unwrap_or(10) as usize;

    #[cfg(not(target_os = "android"))]
    {
        let _ = state;
        use tauri_plugin_shell::ShellExt;
        let search_arg = format!("ytsearch{limit}:{query}");
        let output = app
            .shell()
            .sidecar("yt-dlp")
            .map_err(|e| e.to_string())?
            .args(["-J", "--flat-playlist", "--no-warnings", &search_arg])
            .output()
            .await
            .map_err(|e| e.to_string())?;

        let parsed: serde_json::Value =
            serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())?;
        Ok(parsed["entries"].as_array().cloned().unwrap_or_default())
    }

    #[cfg(target_os = "android")]
    {
        let _ = app;
        // Query Piped/Invidious JSON search endpoint via reqwest for fast mobile search
        let encoded = percent_encoding::utf8_percent_encode(&query, percent_encoding::NON_ALPHANUMERIC);
        let url = format!("https://pipedapi.kavin.rocks/search?q={encoded}&filter=videos");
        let resp: serde_json::Value = state
            .http
            .get(&url)
            .send()
            .await
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;

        let items = resp["items"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .take(limit)
            .collect();
        Ok(items)
    }
}

#[tauri::command]
pub async fn yt_download<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    id_or_url: String,
    options: YtDownloadOptions,
) -> Result<String, String> {
    let job_id = options
        .job_id
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let format_id = options.format_id.unwrap_or_else(|| "bestvideo".to_string());

    let out_dir = match options.output_dir {
        Some(d) => clean_disk_path(&d),
        None => app
            .path()
            .download_dir()
            .unwrap_or_else(|_| std::env::temp_dir()),
    };
    let _ = std::fs::create_dir_all(&out_dir);

    let file_name = options
        .filename
        .unwrap_or_else(|| format!("yt_{id_or_url}_{format_id}.mp4"));
    let target_path = out_dir.join(&file_name);
    let target_str = target_path.to_string_lossy().into_owned();

    let mut cancel_rx = state.register_job(&job_id);
    let url = normalize_yt_url(&id_or_url);

    #[cfg(not(target_os = "android"))]
    {
        use tauri_plugin_shell::process::CommandEvent;
        use tauri_plugin_shell::ShellExt;

        let sidecar = app
            .shell()
            .sidecar("yt-dlp")
            .map_err(|e| e.to_string())?
            .args([
                "-f",
                &format_id,
                "--no-playlist",
                "--newline",
                "-o",
                &target_str,
                &url,
            ]);

        let (mut rx, child) = sidecar.spawn().map_err(|e| e.to_string())?;
        let app_clone = app.clone();
        let job_id_clone = job_id.clone();
        let out_clone = target_str.clone();

        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = cancel_rx.changed() => {
                        let _ = child.kill();
                        let _ = app_clone.emit("yt:download-progress", YtDownloadProgressEvent {
                            job_id: job_id_clone,
                            percent: 0.0,
                            downloaded_bytes: 0,
                            total_bytes: None,
                            speed_bps: None,
                            status: "cancelled".into(),
                            file_path: None,
                        });
                        break;
                    }
                    maybe_event = rx.recv() => {
                        let Some(event) = maybe_event else { break; };
                        match event {
                            CommandEvent::Stdout(bytes) => {
                                let line = String::from_utf8_lossy(&bytes);
                                // Parse percentage from `[download]  45.2% of ...`
                                if let Some(pct) = parse_ytdlp_percent(&line) {
                                    let _ = app_clone.emit("yt:download-progress", YtDownloadProgressEvent {
                                        job_id: job_id_clone.clone(),
                                        percent: pct,
                                        downloaded_bytes: 0,
                                        total_bytes: None,
                                        speed_bps: None,
                                        status: "downloading".into(),
                                        file_path: Some(out_clone.clone()),
                                    });
                                }
                            }
                            CommandEvent::Terminated(payload) => {
                                let status = if payload.code == Some(0) { "completed" } else { "failed" };
                                let _ = app_clone.emit("yt:download-progress", YtDownloadProgressEvent {
                                    job_id: job_id_clone.clone(),
                                    percent: if status == "completed" { 100.0 } else { 0.0 },
                                    downloaded_bytes: 0,
                                    total_bytes: None,
                                    speed_bps: None,
                                    status: status.into(),
                                    file_path: Some(out_clone.clone()),
                                });
                                break;
                            }
                            _ => {}
                        }
                    }
                }
            }
        });

        return Ok(job_id);
    }

    #[cfg(target_os = "android")]
    {
        // Pure-Rust direct HTTP stream download (No FFmpeg needed for video-only variants!)
        let ladder = yt_formats(app.clone(), id_or_url).await?;
        let direct_url = ladder
            .video_formats
            .iter()
            .chain(ladder.audio_formats.iter())
            .find(|f| f.format_id == format_id)
            .and_then(|f| f.url.clone())
            .ok_or_else(|| "Format stream URL unavailable on Android".to_string())?;

        let client = state.http.clone();
        let app_clone = app.clone();
        let job_id_clone = job_id.clone();
        let out_clone = target_str.clone();

        tokio::spawn(async move {
            let Ok(resp) = client.get(&direct_url).send().await else { return; };
            let total_bytes = resp.content_length();
            let Ok(mut file) = File::create(&out_clone) else { return; };
            let mut stream = resp.bytes_stream();
            let mut downloaded: u64 = 0;

            loop {
                tokio::select! {
                    _ = cancel_rx.changed() => {
                        let _ = std::fs::remove_file(&out_clone);
                        break;
                    }
                    chunk = stream.next() => {
                        match chunk {
                            Some(Ok(bytes)) => {
                                let _ = file.write_all(&bytes);
                                downloaded += bytes.len() as u64;
                                let percent = total_bytes
                                    .map(|t| (downloaded as f64 / t as f64) * 100.0)
                                    .unwrap_or(0.0);
                                let _ = app_clone.emit("yt:download-progress", YtDownloadProgressEvent {
                                    job_id: job_id_clone.clone(),
                                    percent,
                                    downloaded_bytes: downloaded,
                                    total_bytes,
                                    speed_bps: None,
                                    status: "downloading".into(),
                                    file_path: Some(out_clone.clone()),
                                });
                            }
                            Some(Err(_)) => break,
                            None => {
                                let _ = app_clone.emit("yt:download-progress", YtDownloadProgressEvent {
                                    job_id: job_id_clone.clone(),
                                    percent: 100.0,
                                    downloaded_bytes: downloaded,
                                    total_bytes,
                                    speed_bps: None,
                                    status: "completed".into(),
                                    file_path: Some(out_clone.clone()),
                                });
                                break;
                            }
                        }
                    }
                }
            }
        });

        return Ok(job_id);
    }
}

#[cfg(not(target_os = "android"))]
fn parse_ytdlp_percent(line: &str) -> Option<f64> {
    if !line.contains("[download]") || !line.contains('%') {
        return None;
    }
    let before_pct = line.split('%').next()?;
    let token = before_pct.split_whitespace().last()?;
    token.parse::<f64>().ok()
}

#[tauri::command]
pub async fn yt_cancel_download(
    state: State<'_, AppState>,
    job_id: String,
) -> Result<bool, String> {
    Ok(state.cancel_job(&job_id))
}

#[tauri::command]
pub async fn yt_read_link(file_path: String) -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(move || {
        let path = clean_disk_path(&file_path);
        if let Ok(tagged) = Probe::open(&path).and_then(|p| p.read()) {
            if let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) {
                for item in tag.items() {
                    if let ItemKey::Unknown(k) = item.key() {
                        if k.eq_ignore_ascii_case("YOUTUBE_URL") {
                            if let ItemValue::Text(v) = item.value() {
                                return Ok(Some(v.clone()));
                            }
                        }
                    }
                }
            }
        }
        Ok(None)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn yt_write_link<R: Runtime>(
    app: AppHandle<R>,
    file_path: String,
    youtube_url: String,
) -> Result<bool, String> {
    update_local_music_tags_and_file(
        app,
        UpdateTagsPayload {
            file_path,
            title: None,
            artist: None,
            album: None,
            cover_file_path: None,
            lyrics: None,
            youtube_url: Some(youtube_url),
            rename_file_to: None,
        },
    )
    .await?;
    Ok(true)
}

#[tauri::command]
pub async fn yt_resolve_download_dir<R: Runtime>(
    app: AppHandle<R>,
    context_file_path: Option<String>,
) -> Result<String, String> {
    if let Some(ctx) = context_file_path {
        let p = clean_disk_path(&ctx);
        if let Some(parent) = p.parent() {
            if parent.exists() {
                return Ok(parent.to_string_lossy().into_owned());
            }
        }
    }
    let dir = app
        .path()
        .download_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn yt_binary_status() -> Result<serde_json::Value, String> {
    #[cfg(not(target_os = "android"))]
    return Ok(serde_json::json!({ "available": true, "engine": "yt-dlp-sidecar" }));

    #[cfg(target_os = "android")]
    return Ok(serde_json::json!({ "available": true, "engine": "rusty_ytdl-native" }));
}

#[tauri::command]
pub async fn yt_update_binary<R: Runtime>(app: AppHandle<R>) -> Result<serde_json::Value, String> {
    #[cfg(not(target_os = "android"))]
    {
        use tauri_plugin_shell::ShellExt;
        let out = app
            .shell()
            .sidecar("yt-dlp")
            .map_err(|e| e.to_string())?
            .args(["-U"])
            .output()
            .await
            .map_err(|e| e.to_string())?;
        return Ok(serde_json::json!({
            "updated": out.status.success(),
            "output": String::from_utf8_lossy(&out.stdout)
        }));
    }
    #[cfg(target_os = "android")]
    {
        let _ = app;
        Ok(serde_json::json!({ "updated": true, "output": "Pure-Rust engine requires no binary update." }))
    }
}
