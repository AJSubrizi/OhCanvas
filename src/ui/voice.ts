import { useCanvasStore } from "../state/store";
import type { RecognitionResult, SttError, StateChangeEvent } from "tauri-plugin-stt-api";
import type { UnlistenFn } from "@tauri-apps/api/event";

/**
 * Cross-platform speech-to-text via the `tauri-plugin-stt` plugin (whisper.cpp
 * through whisper-rs, Metal on macOS / CPU elsewhere). Whisper is NOT streaming:
 * audio is buffered while listening and transcribed on stop ("push-to-talk").
 *
 * Only works inside the Tauri desktop app — in the plain web preview the mic is
 * unavailable and we degrade gracefully.
 */

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function voiceSupported(): boolean {
  return isTauri();
}

type SttApi = typeof import("tauri-plugin-stt-api");

let api: SttApi | null = null;
let wired = false;
let warmingUp = false;
let rawErrorUnlisten: UnlistenFn | null = null;
const finalListeners = new Set<(text: string) => void>();

const setStatus = (state: string, message?: string) =>
  useCanvasStore.getState().setVoiceStatus(state, message);
const setListening = (v: boolean) => useCanvasStore.getState().setVoiceListening(v);
const setPartial = (t: string) => useCanvasStore.getState().setVoicePartial(t);

async function ensureApi(): Promise<SttApi | null> {
  if (!isTauri()) return null;
  if (!api) api = await import("tauri-plugin-stt-api");
  if (!wired) {
    wired = true;
    await api.onResult((r: RecognitionResult) => {
      console.debug("[voice] onResult", { isFinal: r.isFinal, len: (r.transcript || "").length });
      if (!r.isFinal) {
        setPartial(r.transcript);
        return;
      }
      const text = (r.transcript || "").trim();
      const audio = analyzeWavBase64(r.audioData);
      setPartial("");
      setListening(false);
      if (warmingUp) {
        setStatus("ready");
        return;
      }
      if (text) {
        console.debug("[voice] final transcript →", text);
        setStatus("done");
        finalListeners.forEach((l) => l(text));
      } else {
        setStatus("empty", emptySpeechMessage(audio));
      }
    });
    await api.onStateChange((s: StateChangeEvent) => {
      if (s.state === "listening") {
        setListening(true);
        setStatus("listening-whisper");
      } else if (s.state === "processing") {
        setStatus("transcribing");
      } else {
        setListening(false);
      }
    });
    await api.onError((e: SttError) => {
      if (warmingUp) {
        setListening(false);
        setStatus("ready");
        return;
      }
      setListening(false);
      setStatus("error", e.message);
    });
    if (!rawErrorUnlisten) {
      const { listen } = await import("@tauri-apps/api/event");
      rawErrorUnlisten = await listen<SttError>("stt://error", (event) => {
        if (warmingUp) {
          setListening(false);
          setStatus("ready");
          return;
        }
        setListening(false);
        setStatus("error", event.payload.message);
      });
    }
  }
  return api;
}

export function onVoiceFinal(cb: (text: string) => void): () => void {
  finalListeners.add(cb);
  return () => finalListeners.delete(cb);
}

/** Ensure a Whisper model is installed; auto-downloads the recommended one. */
async function ensureModel(stt: SttApi): Promise<boolean> {
  const avail = await stt.isAvailable();
  if (avail.available) return true;

  const { models } = await stt.listModels(true);
  const rec =
    models.find((m) => m.id === "large-v3-turbo" && m.fitsInMemory) ??
    models.find((m) => m.id === "large-v3" && m.fitsInMemory) ??
    models.find((m) => m.recommended) ??
    models.find((m) => m.id === "base") ??
    models[0];
  if (!rec) {
    setStatus("error", "no speech model available");
    return false;
  }
  setStatus("downloading", `Downloading ${rec.displayName} speech model…`);
  const un = await stt.onDownloadProgress((e) => {
    if (e.status === "downloading" && e.progress != null) {
      setStatus("downloading", `Downloading speech model… ${Math.round(e.progress)}%`);
    }
  });
  try {
    await stt.installModel(rec.id);
    await stt.setActiveModel(rec.id);
  } catch (err) {
    setStatus("error", `model download failed: ${(err as Error).message}`);
    return false;
  } finally {
    (un as () => void)?.();
  }
  return true;
}

export async function startVoice(): Promise<void> {
  const stt = await ensureApi();
  if (!stt) {
    setStatus("error", "Voice needs the desktop app.");
    return;
  }
  setStatus("preparing");
  if (!(await ensureModel(stt))) return;

  // Only treat an *explicit* denial as blocking. The Whisper plugin frequently
  // reports "unknown" (it can't always introspect TCC state) even when the mic
  // works fine — bailing on anything but "granted" meant listening never
  // started. If it's truly denied, startListening below will surface the error.
  try {
    const perm = await stt.requestPermission();
    if (perm.microphone === "denied") {
      setStatus("denied", "microphone not granted");
      return;
    }
  } catch (err) {
    // Permission probe failed — proceed anyway; capture will error if blocked.
    console.warn("[voice] requestPermission failed, continuing:", err);
  }

  setListening(true);
  setStatus("listening-whisper");
  try {
    await stt.startListening({
      language: "auto",
      onDevice: true,
      interimResults: false,
      continuous: false,
      maxDuration: 60_000,
    });
    console.debug("[voice] listening started (whisper, lang=auto)");
    // No VAD / auto-stop. User must press the mic again to stop talking.
  } catch (err) {
    setListening(false);
    setStatus("error", (err as Error).message);
  }
}

export async function stopVoice(): Promise<void> {
  const stt = await ensureApi();
  if (!stt) return;
  setStatus("transcribing");
  try {
    await stt.stopListening();
  } catch {
    setListening(false);
  }
}

export async function prepareVoice(): Promise<void> {
  const stt = await ensureApi();
  if (!stt) return;

  setStatus("preparing");
  if (!(await ensureModel(stt))) return;

  // Only ensure the model is ready. No automatic listening or recording at launch.
  // User must explicitly press the mic button to start talking (pure press-to-talk).
  setStatus("ready");
}

// ── Model management (for a Settings picker) ────────────────────────────────
export async function listVoiceModels() {
  const stt = await ensureApi();
  return stt ? stt.listModels(true) : null;
}

export async function downloadVoiceModel(id: string): Promise<void> {
  const stt = await ensureApi();
  if (!stt) return;
  const un = await stt.onDownloadProgress((e) => {
    if (e.progress != null) setStatus("downloading", `Downloading model… ${Math.round(e.progress)}%`);
  });
  try {
    await stt.installModel(id);
    await stt.setActiveModel(id);
    setStatus("idle");
  } finally {
    (un as () => void)?.();
  }
}

interface AudioStats {
  durationSec: number;
  peak: number;
  rms: number;
}

function analyzeWavBase64(audioData?: string): AudioStats | null {
  if (!audioData) return null;
  try {
    const binary = atob(audioData);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    if (bytes.length < 44) return null;
    const view = new DataView(bytes.buffer);
    const channels = Math.max(1, view.getUint16(22, true));
    const sampleRate = Math.max(1, view.getUint32(24, true));
    const bits = view.getUint16(34, true);
    if (bits !== 16) return null;

    let offset = 12;
    let dataOffset = 44;
    let dataSize = bytes.length - 44;
    while (offset + 8 <= bytes.length) {
      const id =
        String.fromCharCode(bytes[offset]) +
        String.fromCharCode(bytes[offset + 1]) +
        String.fromCharCode(bytes[offset + 2]) +
        String.fromCharCode(bytes[offset + 3]);
      const size = view.getUint32(offset + 4, true);
      if (id === "data") {
        dataOffset = offset + 8;
        dataSize = Math.min(size, bytes.length - dataOffset);
        break;
      }
      offset += 8 + size + (size % 2);
    }

    const sampleCount = Math.floor(dataSize / 2);
    if (sampleCount <= 0) return null;
    let peak = 0;
    let sumSquares = 0;
    for (let i = 0; i < sampleCount; i += 1) {
      const sample = view.getInt16(dataOffset + i * 2, true) / 32768;
      const abs = Math.abs(sample);
      if (abs > peak) peak = abs;
      sumSquares += sample * sample;
    }
    return {
      durationSec: sampleCount / channels / sampleRate,
      peak,
      rms: Math.sqrt(sumSquares / sampleCount),
    };
  } catch {
    return null;
  }
}

function emptySpeechMessage(audio: AudioStats | null): string {
  if (!audio) return "No speech detected. No audio buffer was returned.";
  const duration = `${audio.durationSec.toFixed(1)}s`;
  const peakPct = Math.round(audio.peak * 100);
  if (audio.durationSec < 0.7) return `Clip too short (${duration}). Hold the mic while speaking.`;
  if (audio.peak < 0.015 || audio.rms < 0.002) {
    return `Mic audio is too low (${duration}, peak ${peakPct}%). Check macOS input device/level.`;
  }
  return `Audio captured (${duration}, peak ${peakPct}%) but Whisper returned no text. Try again closer to the mic.`;
}
