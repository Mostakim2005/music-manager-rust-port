pub mod commands;
pub mod protocol;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol("stream", protocol::handle_stream_protocol)
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running Music Manager Tauri application");
}
