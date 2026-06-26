use serde::Serialize;

/// Plugin-level error type. Serialized to the frontend as `{ code, message }`.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("download failed: {0}")]
    Download(String),

    #[error("model not installed — call ensure_model first")]
    NotInstalled,

    #[error("inference error: {0}")]
    Inference(String),

    #[error("llama.cpp error: {0}")]
    LlamaCpp(#[from] llama_cpp_2::LlamaCppError),
}

// The `?` operator only does a single `From` step. The llama-cpp-2 crate's
// sub-errors that DO convert to `LlamaCppError` (BatchAddError, DecodeError,
// LlamaContextLoadError) are funnelled through it here so `?` works at call
// sites. A few model errors (LlamaModelLoadError, StringToTokenError,
// TokenToStringError) don't convert to LlamaCppError — those are mapped
// manually at the call site via map_err.
impl From<llama_cpp_2::llama_batch::BatchAddError> for Error {
    fn from(e: llama_cpp_2::llama_batch::BatchAddError) -> Self {
        Error::LlamaCpp(e.into())
    }
}
impl From<llama_cpp_2::DecodeError> for Error {
    fn from(e: llama_cpp_2::DecodeError) -> Self {
        Error::LlamaCpp(e.into())
    }
}
impl From<llama_cpp_2::LlamaContextLoadError> for Error {
    fn from(e: llama_cpp_2::LlamaContextLoadError) -> Self {
        Error::LlamaCpp(e.into())
    }
}

pub type Result<T> = std::result::Result<T, Error>;

/// Frontend-facing error payload. We map the internal enum to a stable
/// `{ code, message }` shape (the internal enum isn't `Serialize` directly
/// because of the `#[from]` io::Error).
#[derive(Clone, Serialize)]
pub struct ErrorPayload {
    pub code: &'static str,
    pub message: String,
}

impl Error {
    pub fn to_payload(&self) -> ErrorPayload {
        let code = match self {
            Error::Io(_) => "Io",
            Error::Download(_) => "Download",
            Error::NotInstalled => "NotInstalled",
            Error::Inference(_) => "Inference",
            Error::LlamaCpp(_) => "LlamaCpp",
        };
        ErrorPayload {
            code,
            message: self.to_string(),
        }
    }
}

impl Serialize for Error {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        self.to_payload().serialize(serializer)
    }
}
