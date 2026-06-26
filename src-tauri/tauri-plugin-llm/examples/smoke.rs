//! Standalone smoke test for the SmolLM2 conductor inference.
//!
//! Run with:
//!   cargo run --example smoke -- <path-to-gguf>
//!
//! Uses a very directive few-shot prompt + force-prefix "OHCANVAS {" at the
//! end of the assistant turn. The 135M model only has to complete the JSON.
//! Prints the full prompt and the raw unfiltered generation for quality eval.

use std::path::PathBuf;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let model_path = match args.get(1) {
        Some(p) => PathBuf::from(p),
        None => {
            // Default: the Tauri app data dir on macOS.
            let home = std::env::var("HOME").expect("HOME");
            PathBuf::from(home)
                .join("Library/Application Support/dev.canvas.app/llm-models")
                .join("SmolLM2-135M-Instruct-Q4_K_M.gguf")
        }
    };

    if !model_path.exists() {
        eprintln!("model not found at {}", model_path.display());
        std::process::exit(1);
    }

    // Strong directive + few-shot for SmolLM2-135M (tiny model).
    // Use proper ChatML turns so previous assistants show full valid lines.
    // End the final assistant turn with the prefix so it only completes the JSON.
    // This is the pattern that works for force-starting structured output on 135M.
    let prompt = [
        "<|im_start|>system",
        "You are the OhCanvas conductor. Translate the user request into EXACTLY ONE line that starts with OHCANVAS followed by a single-line JSON object.",
        "Output NOTHING else: no prose, no markdown, no Python, no explanations. Stop after the closing }.",
        "Use only these actions: open_browser, run_shell, add_note, send_terminal, spawn_agent, kill_terminal.",
        "<|im_end|>",
        "<|im_start|>user",
        "open a browser at localhost:3000",
        "<|im_end|>",
        "<|im_start|>assistant",
        "OHCANVAS {\"action\":\"open_browser\",\"url\":\"http://localhost:3000\"}",
        "<|im_end|>",
        "<|im_start|>user",
        "run pnpm dev in the project",
        "<|im_end|>",
        "<|im_start|>assistant",
        "OHCANVAS {\"action\":\"run_shell\",\"command\":\"pnpm dev\"}",
        "<|im_end|>",
        "<|im_start|>user",
        "run pnpm dev",
        "<|im_end|>",
        "<|im_start|>assistant",
        "OHCANVAS {",
    ]
    .join("\n");

    eprintln!("loading model from {} …", model_path.display());
    eprintln!("=== PROMPT (full, sent to model) ===");
    eprintln!("{prompt}");
    eprintln!("=== END PROMPT ===");
    match tauri_plugin_llm::inference::complete_once(&model_path, &prompt) {
        Ok(text) => {
            println!("=== SmolLM2 RAW UNFILTERED GENERATION ===");
            println!("{text}");
            println!("=== done ===");
        }
        Err(e) => {
            eprintln!("inference failed: {e:?}");
            std::process::exit(2);
        }
    }
}
