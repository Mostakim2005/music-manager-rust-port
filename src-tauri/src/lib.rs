pub mod commands;
pub mod protocol;
pub mod state;

use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "create_music_manager_tables",
        sql: r#"
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;

            CREATE TABLE IF NOT EXISTS songs (
                id TEXT PRIMARY KEY NOT NULL,
                title TEXT NOT NULL,
                artist TEXT NOT NULL,
                album TEXT,
                durationSec REAL NOT NULL,
                normKey TEXT NOT NULL,
                youtubeId TEXT,
                coverPath TEXT,
                primaryColor TEXT,
                backgroundColor TEXT,
                fingerprint TEXT,
                fingerprintDurationSec REAL,
                lastPositionSec REAL,
                lastPlayedAt INTEGER,
                createdAt INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_songs_normKey ON songs(normKey);
            CREATE INDEX IF NOT EXISTS idx_songs_youtubeId ON songs(youtubeId);
            CREATE INDEX IF NOT EXISTS idx_songs_fingerprint ON songs(fingerprint);

            CREATE TABLE IF NOT EXISTS variants (
                id TEXT PRIMARY KEY NOT NULL,
                songId TEXT NOT NULL,
                kind TEXT NOT NULL,
                source TEXT NOT NULL,
                path TEXT,
                url TEXT,
                container TEXT,
                bitrateKbps INTEGER,
                height INTEGER,
                codec TEXT,
                formatId TEXT,
                sizeBytes INTEGER,
                addedAt INTEGER NOT NULL,
                FOREIGN KEY(songId) REFERENCES songs(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_variants_songId ON variants(songId);
            CREATE INDEX IF NOT EXISTS idx_variants_path ON variants(path);

            CREATE TABLE IF NOT EXISTS playback_positions (
                key TEXT PRIMARY KEY NOT NULL,
                positionSec REAL NOT NULL,
                updatedAt INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS waveforms (
                filePath TEXT PRIMARY KEY NOT NULL,
                peaksJson TEXT NOT NULL,
                updatedAt INTEGER NOT NULL
            );
        "#,
        kind: MigrationKind::Up,
    }];

    let builder = tauri::Builder::default()
        .manage(state::AppState::new())
        .register_asynchronous_uri_scheme_protocol("stream", protocol::handle_stream_protocol)
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:music_manager.db", migrations)
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_os::init());

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build());

    builder
        .setup(|app| {
            // Apply subtle native Mica/Acrylic backdrop on Windows 11
            #[cfg(target_os = "windows")]
            if let Some(win) = app.get_webview_window("main") {
                let _ = window_vibrancy::apply_mica(&win, Some(true));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Window controls & shell
            commands::window_shell::window_minimize,
            commands::window_shell::window_maximize,
            commands::window_shell::is_window_maximized,
            commands::window_shell::toggle_fullscreen,
            commands::window_shell::is_fullscreen,
            commands::window_shell::close_window,
            commands::window_shell::quit_app,
            commands::window_shell::resize_window,
            commands::window_shell::mini_window,
            commands::window_shell::restore_window,
            commands::window_shell::delete_variant_file,
            commands::window_shell::get_system_fonts,
            commands::discord_rpc::update_discord_presence,

            // Local media scanner, tag editor, fingerprinting & waveform
            commands::scanner_tags::scan_local_music_with_stats,
            commands::scanner_tags::scan_local_music,
            commands::scanner_tags::parse_local_music_metadata,
            commands::scanner_tags::update_local_music_tags_and_file,
            commands::scanner_tags::save_synced_lyrics,
            commands::scanner_tags::get_embedded_lyrics,
            commands::scanner_tags::save_lyric_file,
            commands::scanner_tags::get_audio_fingerprint,
            commands::scanner_tags::generate_waveform_peaks,
            commands::scanner_tags::extract_image_palette,
            commands::scanner_tags::export_m3u8,
            commands::scanner_tags::import_m3u8,
            commands::scanner_tags::export_backup_json,
            commands::scanner_tags::import_backup_json,

            // Dual-platform YouTube engine
            commands::youtube_dl::yt_search,
            commands::youtube_dl::yt_formats,
            commands::youtube_dl::yt_stream_url,
            commands::youtube_dl::yt_download,
            commands::youtube_dl::yt_cancel_download,
            commands::youtube_dl::yt_read_link,
            commands::youtube_dl::yt_write_link,
            commands::youtube_dl::yt_resolve_download_dir,
            commands::youtube_dl::yt_binary_status,
            commands::youtube_dl::yt_update_binary,

            // Online metadata, LRCLIB lyrics & LX-Music proxy
            commands::network_proxy::fetch_multi_source_lyrics,
            commands::network_proxy::fetch_online_metadata,
            commands::network_proxy::lx_music_http_request,
            commands::network_proxy::lx_music_http_cancel,

            // Download manager queue
            commands::network_proxy::download_add,
            commands::network_proxy::download_add_batch,
            commands::network_proxy::download_pause,
            commands::network_proxy::download_resume,
            commands::network_proxy::download_cancel,
            commands::network_proxy::download_cancel_all,
            commands::network_proxy::download_get_queue,
            commands::network_proxy::download_set_concurrency,
            commands::network_proxy::download_get_completed,
            commands::network_proxy::download_clear_completed,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Music Manager Tauri application");
}
