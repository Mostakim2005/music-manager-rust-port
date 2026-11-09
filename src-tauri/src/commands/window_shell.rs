use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime};

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateState {
    pub status: String,
    pub version: Option<String>,
    pub progress: Option<f64>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn window_minimize<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let _ = &app;
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    if let Some(win) = app.get_webview_window("main") {
        win.minimize().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn window_maximize<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let _ = &app;
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    if let Some(win) = app.get_webview_window("main") {
        let is_max = win.is_maximized().unwrap_or(false);
        if is_max {
            win.unmaximize().map_err(|e| e.to_string())?;
        } else {
            win.maximize().map_err(|e| e.to_string())?;
        }
        let _ = app.emit("window-maximized-state", !is_max);
    }
    Ok(())
}

#[tauri::command]
pub async fn is_window_maximized<R: Runtime>(app: AppHandle<R>) -> Result<bool, String> {
    let _ = &app;
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    if let Some(win) = app.get_webview_window("main") {
        return win.is_maximized().map_err(|e| e.to_string());
    }
    Ok(false)
}

#[tauri::command]
pub async fn toggle_fullscreen<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let _ = &app;
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    if let Some(win) = app.get_webview_window("main") {
        let is_full = win.is_fullscreen().unwrap_or(false);
        win.set_fullscreen(!is_full).map_err(|e| e.to_string())?;
        let _ = app.emit("window-fullscreen-state", !is_full);
    }
    Ok(())
}

#[tauri::command]
pub async fn is_fullscreen<R: Runtime>(app: AppHandle<R>) -> Result<bool, String> {
    let _ = &app;
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    if let Some(win) = app.get_webview_window("main") {
        return win.is_fullscreen().map_err(|e| e.to_string());
    }
    Ok(false)
}

#[tauri::command]
pub async fn close_window<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let _ = &app;
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    if let Some(win) = app.get_webview_window("main") {
        win.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn quit_app<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    app.exit(0);
    Ok(())
}

#[tauri::command]
pub async fn resize_window<R: Runtime>(
    app: AppHandle<R>,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let _ = (&app, width, height);
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    if let Some(win) = app.get_webview_window("main") {
        use tauri::LogicalSize;
        win.set_size(LogicalSize::new(width, height))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn mini_window<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let _ = &app;
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    if let Some(win) = app.get_webview_window("main") {
        use tauri::LogicalSize;
        win.set_size(LogicalSize::new(360.0, 120.0))
            .map_err(|e| e.to_string())?;
        win.set_always_on_top(true).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn restore_window<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let _ = &app;
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    if let Some(win) = app.get_webview_window("main") {
        use tauri::LogicalSize;
        win.set_always_on_top(false).map_err(|e| e.to_string())?;
        win.set_size(LogicalSize::new(1280.0, 820.0))
            .map_err(|e| e.to_string())?;
        win.show().map_err(|e| e.to_string())?;
        win.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_variant_file(file_path: String) -> Result<serde_json::Value, String> {
    let clean = file_path
        .strip_prefix("local:///")
        .or_else(|| file_path.strip_prefix("local://"))
        .unwrap_or(&file_path);

    match std::fs::remove_file(clean) {
        Ok(_) => Ok(serde_json::json!({ "ok": true, "deleted": true })),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            Ok(serde_json::json!({ "ok": true, "deleted": false }))
        }
        Err(e) => Ok(serde_json::json!({ "ok": false, "error": e.to_string() })),
    }
}

#[tauri::command]
pub async fn get_system_fonts() -> Result<Vec<String>, String> {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let source = font_kit::source::SystemSource::new();
        let mut fonts = source.all_families().unwrap_or_default();
        fonts.sort();
        fonts.dedup();
        return Ok(fonts);
    }
    #[cfg(target_os = "android")]
    Ok(vec![
        "sans-serif".into(),
        "serif".into(),
        "monospace".into(),
    ])
}
