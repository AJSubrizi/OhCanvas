//! Local LLM inference plugin for OhCanvas.
//!
//! Backs the "conductor" (the app's internal router) with a small local model
//! (SmolLM2-135M-Instruct) running through llama.cpp via the `llama-cpp-2`
//! bindings — same offline/embedded philosophy as `tauri-plugin-stt` (Whisper).
//!
//! The model file is downloaded on first use into the app data directory.

pub mod error;
pub mod inference;
mod llm;
pub mod model;

use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

pub use error::{Error, Result};
pub use model::{ensure_model, model_path};

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("llm")
        .invoke_handler(tauri::generate_handler![
            llm::ensure_model,
            llm::complete,
            llm::is_ready,
        ])
        .build()
}
