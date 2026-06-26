//! Model file management: download the SmolLM2 GGUF on first use.
//!
//! Mirrors the `ensureModel` flow used by `tauri-plugin-stt` for Whisper: the
//! model is not bundled (keeps the repo/app light) but fetched into the app
//! data directory the first time it's needed, with throttled progress events.

use crate::{Error, Result};
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// The single model we ship: SmolLM2-135M-Instruct, 4-bit K-quant medium.
/// ~105 MB. Fits comfortably in RAM and gives the conductor a fast local brain.
const FILE_NAME: &str = "SmolLM2-135M-Instruct-Q4_K_M.gguf";
const DOWNLOAD_URL: &str =
    "https://huggingface.co/bartowski/SmolLM2-135M-Instruct-GGUF/resolve/main/SmolLM2-135M-Instruct-Q4_K_M.gguf";

pub fn models_dir<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("llm-models")
}

pub fn model_path<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    models_dir(app).join(FILE_NAME)
}

/// Is the model file present on disk?
pub fn model_is_ready<R: Runtime>(app: &AppHandle<R>) -> bool {
    model_path(app).exists()
}

/// Download the model if it is not already present. Emits `llm://download-progress`
/// events so the UI can render a progress bar. No-op (fast path) once installed.
pub fn ensure_model<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    let dest = model_path(app);
    if dest.exists() {
        return Ok(());
    }
    std::fs::create_dir_all(models_dir(app))
        .map_err(|e| Error::Io(e))?;

    let _ = app.emit(
        "llm://download-progress",
        serde_json::json!({ "status": "downloading", "progress": 0 }),
    );

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(60 * 60))
        .build()
        .map_err(|e| Error::Download(format!("http client: {e}")))?;
    let mut response = client
        .get(DOWNLOAD_URL)
        .send()
        .map_err(|e| Error::Download(format!("get: {e}")))?
        .error_for_status()
        .map_err(|e| Error::Download(format!("http status: {e}")))?;

    let total = response.content_length();
    let tmp = dest.with_extension("part");
    let mut file =
        std::fs::File::create(&tmp).map_err(|e| Error::Io(e))?;
    let mut downloaded: u64 = 0;
    let mut last_emit = Instant::now();
    let mut chunk = [0u8; 64 * 1024];
    use std::io::{Read, Write};
    loop {
        let n = response
            .read(&mut chunk)
            .map_err(|e| Error::Download(format!("read chunk: {e}")))?;
        if n == 0 {
            break;
        }
        file.write_all(&chunk[..n])
            .map_err(|e| Error::Io(e))?;
        downloaded += n as u64;
        if last_emit.elapsed() >= Duration::from_millis(250) {
            last_emit = Instant::now();
            let progress = match total {
                Some(t) if t > 0 => ((downloaded as f64 / t as f64) * 100.0) as u8,
                _ => 0,
            };
            let _ = app.emit(
                "llm://download-progress",
                serde_json::json!({
                    "status": "downloading",
                    "progress": progress,
                    "downloaded": downloaded,
                    "total": total,
                }),
            );
        }
    }
    drop(file);
    std::fs::rename(&tmp, &dest)
        .map_err(|e| Error::Io(e))?;

    let _ = app.emit(
        "llm://download-progress",
        serde_json::json!({ "status": "complete", "progress": 100 }),
    );
    Ok(())
}
