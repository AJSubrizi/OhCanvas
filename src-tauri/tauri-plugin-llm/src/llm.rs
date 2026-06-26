//! Tauri command wrappers around the model + inference modules.

use crate::error::Result;
use crate::inference::complete_once;
use crate::model::{ensure_model as model_ensure, model_is_ready};
use tauri::{command, AppHandle, Runtime};

#[command]
pub async fn ensure_model<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    // Download is blocking (HTTP) — run it off the IPC thread.
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || model_ensure(&app2))
        .await
        .map_err(|e| crate::Error::Inference(format!("join: {e}")))?
}

#[command]
pub async fn is_ready<R: Runtime>(app: AppHandle<R>) -> Result<bool> {
    Ok(model_is_ready(&app))
}

/// Run a single completion against SmolLM2 and return the generated text.
/// The loaded model + backend are cached in a global (inside the inference
/// module) so the first call pays the load cost and later calls reuse it.
#[command]
pub async fn complete<R: Runtime>(app: AppHandle<R>, prompt: String) -> Result<String> {
    // Make sure the model file exists, then run inference off the IPC thread.
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        model_ensure(&app2)?;
        let path = crate::model::model_path(&app2);
        complete_once(&path, &prompt)
    })
    .await
    .map_err(|e| crate::Error::Inference(format!("join: {e}")))?
}
