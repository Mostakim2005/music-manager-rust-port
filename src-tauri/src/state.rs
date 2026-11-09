use parking_lot::RwLock;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::watch;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadTaskItem {
    pub id: String,
    pub url: String,
    pub title: String,
    pub artist: Option<String>,
    pub target_path: String,
    pub format_id: Option<String>,
    pub status: String, // "queued" | "downloading" | "paused" | "completed" | "failed" | "cancelled"
    pub progress: f64,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub error: Option<String>,
}

pub struct CachedStreamUrl {
    pub url: String,
    pub expires_at: Instant,
}

pub struct AppState {
    pub http: Client,
    pub active_jobs: Arc<RwLock<HashMap<String, watch::Sender<bool>>>>,
    pub download_queue: Arc<RwLock<Vec<DownloadTaskItem>>>,
    pub completed_downloads: Arc<RwLock<Vec<DownloadTaskItem>>>,
    pub stream_cache: Arc<RwLock<HashMap<String, CachedStreamUrl>>>,
    pub max_concurrency: AtomicUsize,
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

impl AppState {
    pub fn new() -> Self {
        let http = Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
            .timeout(Duration::from_secs(30))
            .build()
            .expect("Failed to initialize reqwest HTTP client");

        Self {
            http,
            active_jobs: Arc::new(RwLock::new(HashMap::new())),
            download_queue: Arc::new(RwLock::new(Vec::new())),
            completed_downloads: Arc::new(RwLock::new(Vec::new())),
            stream_cache: Arc::new(RwLock::new(HashMap::new())),
            max_concurrency: AtomicUsize::new(3),
        }
    }

    pub fn register_job(&self, job_id: &str) -> watch::Receiver<bool> {
        let (tx, rx) = watch::channel(false);
        self.active_jobs.write().insert(job_id.to_string(), tx);
        rx
    }

    pub fn cancel_job(&self, job_id: &str) -> bool {
        if let Some(tx) = self.active_jobs.write().remove(job_id) {
            let _ = tx.send(true);
            return true;
        }
        false
    }

    pub fn finish_job(&self, job_id: &str) {
        self.active_jobs.write().remove(job_id);
    }

    pub fn get_cached_stream(&self, key: &str) -> Option<String> {
        let cache = self.stream_cache.read();
        if let Some(entry) = cache.get(key) {
            if Instant::now() < entry.expires_at {
                return Some(entry.url.clone());
            }
        }
        None
    }

    pub fn set_cached_stream(&self, key: String, url: String) {
        // 4-hour cache TTL matching the Electron implementation
        let expires_at = Instant::now() + Duration::from_secs(4 * 3600);
        self.stream_cache
            .write()
            .insert(key, CachedStreamUrl { url, expires_at });
    }

    pub fn set_concurrency(&self, n: usize) {
        self.max_concurrency.store(n.clamp(1, 8), Ordering::SeqCst);
    }
}
