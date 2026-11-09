use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use http::{header, Request, Response, StatusCode};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use tauri::{Runtime, UriSchemeContext, UriSchemeResponder};

/// Maximum chunk size returned on an open-ended Range request (2 MB)
const MAX_CHUNK_SIZE: u64 = 2 * 1024 * 1024;

pub fn handle_stream_protocol<R: Runtime>(
    _ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    tokio::task::spawn_blocking(move || {
        let response = serve_range_request(&request).unwrap_or_else(|err| {
            Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .body(format!("Stream protocol error: {err}").into_bytes())
                .unwrap()
        });
        responder.respond(response);
    });
}

fn serve_range_request(request: &Request<Vec<u8>>) -> anyhow::Result<Response<Vec<u8>>> {
    let uri = request.uri();
    let query = uri.query().unwrap_or("");

    // Extract `?p=<base64url_encoded_path>`
    let encoded_path = query
        .split('&')
        .find_map(|pair| pair.strip_prefix("p="))
        .ok_or_else(|| anyhow::anyhow!("Missing 'p' query parameter"))?;

    let decoded_bytes = URL_SAFE_NO_PAD.decode(encoded_path)?;
    let raw_path = String::from_utf8(decoded_bytes)?;
    let clean_path = raw_path
        .strip_prefix("local:///")
        .or_else(|| raw_path.strip_prefix("local://"))
        .or_else(|| raw_path.strip_prefix("file:///"))
        .unwrap_or(&raw_path);

    let path = PathBuf::from(clean_path);
    if !path.exists() {
        return Ok(Response::builder()
            .status(StatusCode::NOT_FOUND)
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .body(b"File not found".to_vec())?);
    }

    let mut file = File::open(&path)?;
    let total_size = file.metadata()?.len();
    let mime_type = mime_guess::from_path(&path)
        .first_or_octet_stream()
        .to_string();

    // Check for HTTP Range header (required for <audio> and <video> seeking)
    if let Some(range_header) = request.headers().get(header::RANGE) {
        let range_str = range_header.to_str().unwrap_or("");
        if let Some(byte_range) = range_str.strip_prefix("bytes=") {
            let mut parts = byte_range.split('-');
            let start: u64 = parts
                .next()
                .and_then(|s| s.parse().ok())
                .unwrap_or(0);

            let requested_end: Option<u64> = parts.next().and_then(|s| s.parse().ok());
            let end = match requested_end {
                Some(e) => e.min(total_size.saturating_sub(1)),
                None => (start + MAX_CHUNK_SIZE - 1).min(total_size.saturating_sub(1)),
            };

            if start >= total_size {
                return Ok(Response::builder()
                    .status(StatusCode::RANGE_NOT_SATISFIABLE)
                    .header(header::CONTENT_RANGE, format!("bytes */{total_size}"))
                    .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                    .body(Vec::new())?);
            }

            let length = (end - start) + 1;
            file.seek(SeekFrom::Start(start))?;
            let mut buffer = vec![0u8; length as usize];
            file.read_exact(&mut buffer)?;

            return Ok(Response::builder()
                .status(StatusCode::PARTIAL_CONTENT)
                .header(header::CONTENT_TYPE, mime_type)
                .header(header::ACCEPT_RANGES, "bytes")
                .header(header::CONTENT_LENGTH, length.to_string())
                .header(
                    header::CONTENT_RANGE,
                    format!("bytes {start}-{end}/{total_size}"),
                )
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .body(buffer)?);
        }
    }

    // Fallback when no Range header is sent (e.g., cover art images)
    let mut buffer = Vec::with_capacity(total_size as usize);
    file.read_to_end(&mut buffer)?;

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime_type)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, total_size.to_string())
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(buffer)?)
}
