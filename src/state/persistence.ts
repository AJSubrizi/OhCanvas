// Persistence adapter for canvas state.
//
// In Tauri runtime: store snapshots in <app_data_dir>/state/<key>.json via
// the read_state / write_state / remove_state commands exposed by
// src-tauri/src/main.rs. Atomic writes (temp file + rename) and per-key
// scoping — survives browser cache clears, syncs across windows of the same
// app, and lifts the 5 MB localStorage cap.
//
// In non-Tauri runtime (pnpm dev:web, browsers): transparently fall back to
// localStorage so the same code path works in dev and tests.
//
// Migration: on the first read for a key, if the file is missing but a
// localStorage copy exists, we return the localStorage value AND copy it to
// the file in the background so subsequent loads go straight to disk. Old
// localStorage entries are deleted once the file write succeeds.

import { invoke } from "@tauri-apps/api/core";

const STATE_PREFIX = "ohcanvas:";

export interface PersistenceAdapter {
  /** Best-effort read. Returns null when the key is absent or unreadable. */
  read(key: string): Promise<string | null>;
  /** Best-effort write. Never throws — logs and falls back internally. */
  write(key: string, value: string): void;
  /** Best-effort remove. Never throws. */
  remove(key: string): void;
  /** True if this adapter writes to disk (vs localStorage). */
  readonly backend: "file" | "localStorage";
}

function lsKey(key: string): string {
  // Keep the existing on-disk shape so an upgrade doesn't lose data.
  return `${STATE_PREFIX}${key}`;
}

function detectTauri(): boolean {
  // Tauri 2 sets this internal before the page script runs; it's the most
  // reliable check that survives bundler quirks.
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

interface InFlightWrite {
  promise: Promise<void>;
  /** Latest value queued while the in-flight write was running. */
  pending: string | null;
}

class FileAdapter implements PersistenceAdapter {
  readonly backend = "file" as const;
  // One in-flight promise per key, plus the latest value to flush when it
  // resolves. Coalesces bursts of saves (a drag emits dozens per second) into
  // at most one extra write per key.
  private writes = new Map<string, InFlightWrite>();

  async read(key: string): Promise<string | null> {
    try {
      const fromDisk = await invoke<string | null>("read_state", { name: lsKey(key) });
      if (fromDisk != null) return fromDisk;
      // First-time migration: try localStorage once, then mirror to disk.
      const fromLs = readLocalStorage(key);
      if (fromLs != null) {
        // Fire-and-forget; never block the caller on the copy.
        this.write(key, fromLs);
        try { removeLocalStorage(key); } catch { /* ignore */ }
        return fromLs;
      }
      return null;
    } catch (e) {
      console.warn(`[persistence] file read failed for ${key}, falling back to localStorage`, e);
      return readLocalStorage(key);
    }
  }

  write(key: string, value: string): void {
    const existing = this.writes.get(key);
    if (existing) {
      // Latest snapshot wins — drop any intermediate value queued by a
      // previous save call.
      existing.pending = value;
      return;
    }
    const slot: InFlightWrite = { promise: Promise.resolve(), pending: null };
    this.writes.set(key, slot);
    slot.promise = this.flush(key, value, slot).finally(() => {
      // Only clear the slot if no newer write superseded us.
      const current = this.writes.get(key);
      if (current === slot) this.writes.delete(key);
    });
  }

  private async flush(key: string, value: string, slot: InFlightWrite): Promise<void> {
    // Loop until no newer snapshot landed while we were writing.
    // `slot.pending` is overwritten by concurrent write() calls; we drain it
    // here so each invocation flushes the latest known value, not a stale one.
    for (;;) {
      slot.pending = null;
      try {
        await invoke<void>("write_state", { name: lsKey(key), content: value });
      } catch (e) {
        console.warn(`[persistence] file write failed for ${key}, mirroring to localStorage`, e);
        try { writeLocalStorage(key, value); } catch { /* ignore */ }
        // On error stop the coalesce loop — caller already fell back.
        return;
      }
      if (slot.pending == null) return;
      value = slot.pending;
    }
  }

  remove(key: string): void {
    void invoke<void>("remove_state", { name: lsKey(key) })
      .then(() => { try { removeLocalStorage(key); } catch { /* ignore */ } })
      .catch((e) => console.warn(`[persistence] file remove failed for ${key}`, e));
  }
}

class LocalStorageAdapter implements PersistenceAdapter {
  readonly backend = "localStorage" as const;
  async read(key: string): Promise<string | null> { return readLocalStorage(key); }
  write(key: string, value: string): void { writeLocalStorage(key, value); }
  remove(key: string): void { removeLocalStorage(key); }
}

function readLocalStorage(key: string): string | null {
  try { return localStorage.getItem(lsKey(key)); } catch { return null; }
}

function writeLocalStorage(key: string, value: string): void {
  try { localStorage.setItem(lsKey(key), value); } catch { /* quota or disabled */ }
}

function removeLocalStorage(key: string): void {
  try { localStorage.removeItem(lsKey(key)); } catch { /* ignore */ }
}

let singleton: PersistenceAdapter | null = null;

export function persistence(): PersistenceAdapter {
  if (singleton) return singleton;
  singleton = detectTauri() ? new FileAdapter() : new LocalStorageAdapter();
  return singleton;
}

/** Test helper: reset the singleton (used by unit tests, if any). */
export function __resetPersistenceForTests(): void {
  singleton = null;
}