use crate::state::{AppState, DownloadTaskItem};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime, State};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MetadataQuery {
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub duration_sec: Option<f64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LxHttpRequestPayload {
    pub url: String,
    pub options: Option<serde_json::Value>,
    pub request_id: String,
}

#[tauri::command]
pub async fn fetch_multi_source_lyrics(
    state: State<'_, AppState>,
    query: MetadataQuery,
) -> Result<serde_json::Value, String> {
    let artist = query.artist.unwrap_or_default();
    let album = query.album.unwrap_or_default();

    // 1. Primary: LRCLIB exact / search endpoint for millisecond-synced lyrics
    let mut url = reqwest::Url::parse("https://lrclib.net/api/search").map_err(|e| e.to_string())?;
    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("track_name", &query.title);
        if !artist.is_empty() {
            pairs.append_pair("artist_name", &artist);
        }
        if !album.is_empty() {
            pairs.append_pair("album_name", &album);
        }
    }

    let results: Vec<serde_json::Value> = state
        .http
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .unwrap_or_default();

    // Pick closest duration match that contains syncedLyrics
    let best = results
        .iter()
        .find(|item| item["syncedLyrics"].is_string())
        .or_else(|| results.first())
        .cloned()
        .unwrap_or(serde_json::Value::Null);

    Ok(serde_json::json!({
        "source": "lrclib",
        "syncedLyrics": best["syncedLyrics"],
        "plainLyrics": best["plainLyrics"],
        "candidates": results
    }))
}

#[tauri::command]
pub async fn fetch_online_metadata(
    state: State<'_, AppState>,
    query: MetadataQuery,
) -> Result<Vec<serde_json::Value>, String> {
    let term = match &query.artist {
        Some(a) if !a.is_empty() => format!("{} {}", a, query.title),
        _ => query.title.clone(),
    };

    let mut url = reqwest::Url::parse("https://itunes.apple.com/search").map_err(|e| e.to_string())?;
    url.query_pairs_mut()
        .append_pair("term", &term)
        .append_pair("entity", "song")
        .append_pair("limit", "10");

    let resp: serde_json::Value = state
        .http
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    let items: Vec<serde_json::Value> = resp["results"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|r| {
            // Upgrade iTunes cover art URL from 100x100 to 1000x1000 HD
            let cover_hd = r["artworkUrl100"]
                .as_str()
                .map(|u| u.replace("100x100bb", "1000x1000bb"));
            serde_json::json!({
                "title": r["trackName"],
                "artist": r["artistName"],
                "album": r["collectionName"],
                "durationSec": r["trackTimeMillis"].as_f64().map(|ms| ms / 1000.0),
                "coverUrl": cover_hd,
                "releaseDate": r["releaseDate"],
                "genre": r["primaryGenreName"]
            })
        })
        .collect();

    Ok(items)
}

#[tauri::command]
pub async fn lx_music_http_request(
    state: State<'_, AppState>,
    request: LxHttpRequestPayload,
) -> Result<serde_json::Value, String> {
    let mut cancel_rx = state.register_job(&request.request_id);
    let method = request
        .options
        .as_ref()
        .and_then(|o| o["method"].as_str())
        .unwrap_or("GET")
        .to_uppercase();

    let mut req_builder = match method.as_str() {
        "POST" => state.http.post(&request.url),
        _ => state.http.get(&request.url),
    };

    if let Some(headers) = request
        .options
        .as_ref()
        .and_then(|o| o["headers"].as_object())
    {
        for (k, v) in headers {
            if let Some(val_str) = v.as_str() {
                req_builder = req_builder.header(k, val_str);
            }
        }
    }

    let result = tokio::select! {
        _ = cancel_rx.changed() => Err("Request cancelled".to_string()),
        res = req_builder.send() => {
            let resp = res.map_err(|e| e.to_string())?;
            let status = resp.status().as_u16();
            let body_text = resp.text().await.map_err(|e| e.to_string())?;
            let body_json: serde_json::Value = serde_json::from_str(&body_text)
                .unwrap_or(serde_json::Value::String(body_text.clone()));
            Ok(serde_json::json!({
                "statusCode": status,
                "body": body_json,
                "raw": body_text
            }))
        }
    };

    state.finish_job(&request.request_id);
    result
}

#[tauri::command]
pub async fn lx_music_http_cancel(
    state: State<'_, AppState>,
    request_id: String,
) -> Result<bool, String> {
    Ok(state.cancel_job(&request_id))
}

// ============================================================================
// DOWNLOAD QUEUE MANAGER COMMANDS
// ============================================================================

#[tauri::command]
pub async fn download_add<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    task: DownloadTaskItem,
) -> Result<DownloadTaskItem, String> {
    state.download_queue.write().push(task.clone());
    let _ = app.emit("download:state-change", &task);
    Ok(task)
}

#[tauri::command]
pub async fn download_add_batch<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    tasks: Vec<DownloadTaskItem>,
) -> Result<usize, String> {
    let count = tasks.len();
    state.download_queue.write().extend(tasks);
    let _ = app.emit("download:state-change", serde_json::json!({ "batchAdded": count }));
    Ok(count)
}

#[tauri::command]
pub async fn download_pause(state: State<'_, AppState>, task_id: String) -> Result<bool, String> {
    state.cancel_job(&task_id);
    if let Some(t) = state.download_queue.write().iter_mut().find(|t| t.id == task_id) {
        t.status = "paused".into();
    }
    Ok(true)
}

#[tauri::command]
pub async fn download_resume(state: State<'_, AppState>, task_id: String) -> Result<bool, String> {
    if let Some(t) = state.download_queue.write().iter_mut().find(|t| t.id == task_id) {
        t.status = "queued".into();
    }
    Ok(true)
}

#[tauri::command]
pub async fn download_cancel(state: State<'_, AppState>, task_id: String) -> Result<bool, String> {
    state.cancel_job(&task_id);
    state.download_queue.write().retain(|t| t.id != task_id);
    Ok(true)
}

#[tauri::command]
pub async fn download_cancel_all(state: State<'_, AppState>) -> Result<bool, String> {
    let ids: Vec<String> = state.download_queue.read().iter().map(|t| t.id.clone()).collect();
    for id in ids {
        state.cancel_job(&id);
    }
    state.download_queue.write().clear();
    Ok(true)
}

#[tauri::command]
pub async fn download_get_queue(state: State<'_, AppState>) -> Result<Vec<DownloadTaskItem>, String> {
    Ok(state.download_queue.read().clone())
}

#[tauri::command]
pub async fn download_set_concurrency(state: State<'_, AppState>, n: usize) -> Result<(), String> {
    state.set_concurrency(n);
    Ok(())
}

#[tauri::command]
pub async fn download_get_completed(state: State<'_, AppState>) -> Result<Vec<DownloadTaskItem>, String> {
    Ok(state.completed_downloads.read().clone())
}

#[tauri::command]
pub async fn download_clear_completed(state: State<'_, AppState>) -> Result<bool, String> {
    state.completed_downloads.write().clear();
    Ok(true)
}
