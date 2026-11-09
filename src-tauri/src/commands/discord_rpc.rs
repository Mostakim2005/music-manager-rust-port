use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscordPresencePayload {
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub is_playing: bool,
}

#[tauri::command]
pub async fn update_discord_presence(payload: DiscordPresencePayload) -> Result<bool, String> {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        // Non-blocking best-effort Discord IPC update
        tokio::task::spawn_blocking(move || {
            use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
            if let Ok(mut client) = DiscordIpcClient::new("1190000000000000000") {
                if client.connect().is_ok() {
                    let state_str = format!("by {}", payload.artist);
                    let act = activity::Activity::new()
                        .details(&payload.title)
                        .state(&state_str);
                    let _ = client.set_activity(act);
                }
            }
        });
    }
    #[cfg(target_os = "android")]
    let _ = payload;

    Ok(true)
}
