import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/**
 * Local LLM conductor (SmolLM2-135M-Instruct) via the `tauri-plugin-llm` plugin
 * (llama.cpp through llama-cpp-2, Metal on macOS). This is the app's internal
 * "router brain" — it turns natural-language commands into OHCANVAS canvas
 * actions, fully offline.
 *
 * Only works inside the Tauri desktop app.
 */

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function llmSupported(): boolean {
  return isTauri();
}

/** Response shape of the plugin's `complete` command. */
interface CompleteResult {
  text?: string;
}

/** Ensure the SmolLM2 model file is downloaded. No-op if already present. */
export async function ensureLlmModel(): Promise<void> {
  if (!isTauri()) return;
  await invoke("plugin:llm|ensure_model");
}

/** Is the model downloaded and ready? */
export async function llmReady(): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("plugin:llm|is_ready");
}

/**
 * Run one completion against SmolLM2 and return the generated text. The caller
 * is responsible for parsing OHCANVAS action lines (the sidecar does this).
 */
export async function llmComplete(prompt: string): Promise<string> {
  if (!isTauri()) {
    throw new Error("Local LLM needs the Tauri desktop app.");
  }
  const result = await invoke<CompleteResult | string>("plugin:llm|complete", { prompt });
  // The command returns the generated text directly (String) or an error via
  // the serialized Error type, which Tauri surfaces as a thrown rejection.
  return typeof result === "string" ? result : result.text ?? "";
}

/** Subscribe to model download progress. Returns an unsubscribe function. */
export function onLlmDownloadProgress(cb: (progress: number) => void): () => void {
  if (!isTauri()) return () => {};
  let unlisten: (() => void) | null = null;
  listen<{ status: string; progress?: number }>("llm://download-progress", (event: { payload: { status: string; progress?: number } }) => {
    if (typeof event.payload.progress === "number") cb(event.payload.progress);
  }).then((un: () => void) => {
    unlisten = un;
  });
  return () => {
    unlisten?.();
  };
}
