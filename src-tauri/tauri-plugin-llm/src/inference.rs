//! SmolLM2 inference: load the model once, complete prompts with a simple
//! token-by-token loop using the llama-cpp-2 high-level sampler API.
//!
//! The loaded model is cached in a global (behind a mutex) keyed by its path,
//! so the first `complete_once` pays the load cost and every subsequent call
//! reuses it. A fresh `LlamaContext` is created per completion — SmolLM2-135M
//! is tiny, so context creation is cheap and we avoid carrying KV-cache
//! between calls.

use crate::{Error, Result};
use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaModel};
use llama_cpp_2::sampling::LlamaSampler;
use std::num::NonZeroU32;
use std::path::Path;
use std::sync::{Mutex, OnceLock};

/// Max tokens the conductor may emit. OHCANVAS actions are short (one line of
/// JSON per action), so 256 is plenty and keeps latency low.
const MAX_TOKENS: i32 = 256;
/// Context window. Generous relative to the prompt (the canvas context + the
/// user request) so we never truncate the system prompt.
const CTX_SIZE: u32 = 2048;

/// Cached engine: the loaded model + the path it came from. The llama.cpp
/// backend (process-global, init once) is held in a separate static.
struct Engine {
    model_path: String,
    model: LlamaModel,
}

static ENGINE: OnceLock<Mutex<Option<Engine>>> = OnceLock::new();

fn engine_slot() -> &'static Mutex<Option<Engine>> {
    ENGINE.get_or_init(|| Mutex::new(None))
}

/// Process-global llama.cpp backend. `LlamaBackend::init()` may only succeed
/// once per process; we run it through a OnceLock so retries are safe.
static BACKEND: OnceLock<Result<LlamaBackend>> = OnceLock::new();

fn backend() -> Result<&'static LlamaBackend> {
    let res = BACKEND.get_or_init(|| LlamaBackend::init().map_err(|e| Error::LlamaCpp(e)));
    res.as_ref().map_err(|e| Error::Inference(e.to_string()))
}

/// Run one completion and return the generated text (no streaming — the
/// conductor emits short, structured OHCANVAS lines).
pub fn complete_once(model_path: &Path, prompt: &str) -> Result<String> {
    let mut guard = engine_slot()
        .lock()
        .map_err(|e| Error::Inference(format!("engine lock poisoned: {e}")))?;

    let path_str = model_path
        .to_str()
        .ok_or_else(|| Error::Inference("model path is not valid utf-8".into()))?
        .to_string();

    // Load the model if missing or if the path changed.
    let needs_load = guard
        .as_ref()
        .map(|e| e.model_path != path_str)
        .unwrap_or(true);
    if needs_load {
        let backend = backend()?;
        let params = LlamaModelParams::default().with_n_gpu_layers(99);
        let model = LlamaModel::load_from_file(backend, model_path, &params)
            .map_err(|e| Error::Inference(format!("load model: {e}")))?;
        *guard = Some(Engine {
            model_path: path_str,
            model,
        });
    }
    let engine = guard.as_ref().expect("engine just loaded");
    let backend = backend()?;

    // Tokenise the (already chat-templated) prompt.
    let prompt_tokens = engine
        .model
        .str_to_token(prompt, AddBos::Always)
        .map_err(|e| Error::Inference(format!("tokenize prompt: {e}")))?;

    // Fresh context per completion (cheap for 135M; avoids cross-call KV-cache).
    let ctx_params = LlamaContextParams::default()
        .with_n_ctx(NonZeroU32::new(CTX_SIZE))
        .with_n_batch(CTX_SIZE)
        .with_n_threads(num_cpus_capped(4) as i32);
    let mut ctx = engine.model.new_context(backend, ctx_params)?;

    let mut batch = LlamaBatch::new(prompt_tokens.len() + 1, 1);
    let last_idx = (prompt_tokens.len() - 1) as i32;
    for (i, tok) in prompt_tokens.iter().enumerate() {
        batch.add(*tok, i as i32, &[0], i as i32 == last_idx)?;
    }
    ctx.decode(&mut batch)?;

    // Pure greedy (temp = 0) for maximum determinism on tiny model.
    // SmolLM2-135M needs very constrained sampling to stay on the rigid
    // OHCANVAS JSON format instead of drifting into prose or repetition.
    let mut sampler = LlamaSampler::greedy();
    let eos = engine.model.token_eos();

    let mut n_decoded = 0;
    let mut out = String::new();
    // `pos` is the absolute position of the next token in the KV cache.
    let mut pos = batch.n_tokens() as i32;

    loop {
        // Sample from the logits of the last token in the most recent batch.
        // `sample` takes an index into the last-decoded batch, so it's always
        // the final token there (the only one we set logits=true on).
        let token = sampler.sample(&ctx, last_logits_index(&batch));
        if token == eos || engine.model.is_eog_token(token) || n_decoded >= MAX_TOKENS {
            break;
        }

        // Decode the token to text via the non-deprecated bytes API. SmolLM2
        // uses a UTF-8 vocabulary, so a lossy decode is correct here.
        let piece = engine
            .model
            .token_to_piece_bytes(token, 32, false, None)
            .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
            .unwrap_or_default();
        out.push_str(&piece);

        // Feed the sampled token back as a single-token batch at the next
        // absolute position, requesting logits for it so the next loop
        // iteration can sample.
        batch = LlamaBatch::new(1, 1);
        batch.add(token, pos, &[0], true)?;
        ctx.decode(&mut batch)?;

        sampler.accept(token);
        n_decoded += 1;
        pos += 1;
    }

    Ok(out)
}

/// Index of the last token in a batch — the position `sample` expects (an index
/// into the most recent decode, not an absolute KV-cache position).
fn last_logits_index(batch: &LlamaBatch) -> i32 {
    batch.n_tokens() - 1
}

fn num_cpus_capped(cap: usize) -> u32 {
    let avail = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1);
    (avail.min(cap).max(1)) as u32
}
