// Prevents an extra console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use serde::Serialize;
use tauri::{AppHandle, Manager};

/// Errors surfaced from the persistence commands. Serialized to JS so the
/// adapter can log + fall back to localStorage on failure.
#[derive(Debug, Serialize)]
struct PersistenceError {
    message: String,
}

impl<E: std::fmt::Display> From<E> for PersistenceError {
    fn from(e: E) -> Self {
        Self { message: e.to_string() }
    }
}

type CmdResult<T> = Result<T, PersistenceError>;

/// Resolve `<app_data_dir>/state/<safe_name>.json`. Scoped under a `state/`
/// subfolder so the app data dir stays tidy and we can blow away just our
/// persistence files without touching anything else Tauri/other plugins drop
/// in there.
fn state_path(app: &AppHandle, name: &str) -> CmdResult<PathBuf> {
    let safe = sanitize_name(name)?;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| PersistenceError { message: format!("resolve app_data_dir: {e}") })?
        .join("state");
    Ok(dir.join(format!("{safe}.json")))
}

/// Filesystem-safe key: keep [A-Za-z0-9._-], reject everything else so a
/// caller can't escape the state directory with `..` or path separators.
fn sanitize_name(name: &str) -> CmdResult<&str> {
    if name.is_empty() {
        return Err(PersistenceError { message: "empty state name".into() });
    }
    if name.len() > 128 {
        return Err(PersistenceError { message: "state name too long".into() });
    }
    if !name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-')) {
        return Err(PersistenceError { message: "state name contains invalid characters".into() });
    }
    // Reject traversal-ish names even though the charset filter blocks "/":
    // ".", "..", names starting with "." would be confusing on disk.
    if name == "." || name == ".." || name.starts_with('.') {
        return Err(PersistenceError { message: "state name not allowed".into() });
    }
    Ok(name)
}

#[tauri::command]
fn read_state(app: AppHandle, name: String) -> CmdResult<Option<String>> {
    let path = state_path(&app, &name)?;
    match fs::read(&path) {
        Ok(bytes) => {
            // UTF-8 decode: persistence payloads are JSON, we own the writer.
            match String::from_utf8(bytes) {
                Ok(s) => Ok(Some(s)),
                Err(e) => Err(PersistenceError { message: format!("non-utf8 state file {path:?}: {e}") }),
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(PersistenceError { message: format!("read {path:?}: {e}") }),
    }
}

#[tauri::command]
fn write_state(app: AppHandle, name: String, content: String) -> CmdResult<()> {
    let path = state_path(&app, &name)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    // Atomic write: write to a sibling temp file, fsync, then rename over the
    // target. Rename is atomic on POSIX and the Windows fallback below
    // gives us the same effect. This way a crash mid-write never corrupts
    // an existing snapshot — the previous one stays intact.
    //
    // Append ".tmp" manually instead of with_extension("json.tmp") — the
    // latter would strip the real ".json" extension, which happens to be
    // safe today only because every key ends in ".json".
    let mut tmp = path.clone().into_os_string();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(content.as_bytes())?;
        f.sync_all()?;
    }
    // On Windows, std::fs::rename does NOT use MOVEFILE_REPLACE_EXISTING —
    // it errors out if the target already exists. The fallback below
    // (delete + rename) is the standard Rust workaround but exposes a
    // small "file missing" window to concurrent readers. For a single-
    // writer desktop app this is acceptable; if we ever add multi-writer
    // concurrency, switch to `MoveFileExW` with MOVEFILE_REPLACE_EXISTING
    // via the windows-sys crate.
    #[cfg(windows)]
    fs::rename(&tmp, &path).or_else(|_| {
        let _ = fs::remove_file(&path);
        fs::rename(&tmp, &path)
    })?;
    #[cfg(not(windows))]
    fs::rename(&tmp, &path)?;

    // POSIX durability: after rename, flush the parent directory entry so
    // the rename itself survives a crash. Without this, sudden power loss
    // can roll back the rename and resurrect the previous snapshot —
    // defeating the whole atomic-write scheme. No-op on Windows (the
    // directory entry is committed with the file write there).
    #[cfg(not(windows))]
    if let Some(parent) = path.parent() {
        if let Ok(dir) = fs::File::open(parent) {
            let _ = dir.sync_all();
        }
    }
    Ok(())
}

#[tauri::command]
fn remove_state(app: AppHandle, name: String) -> CmdResult<()> {
    let path = state_path(&app, &name)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(PersistenceError { message: format!("remove {path:?}: {e}") }),
    }
}

/// Spawn the sidecar Node.js process so the React app can connect to
/// ws://127.0.0.1:8787 without an out-of-band launcher.
///
/// In release builds the binary is bundled by Tauri at
/// `<resource_dir>/ohcanvas-sidecar[.exe]` and we spawn it directly.
/// In dev (`cargo tauri dev`) the bundled resource doesn't exist, so we
/// fall back to `pnpm --filter sidecar start` which the React WebSocket
/// client will reach once it boots.
///
/// Fire-and-forget: we don't block the Tauri setup on the child, and we
/// don't capture stdout/stderr to avoid backpressure deadlocks if the
/// sidecar ever hangs. On Tauri exit the child inherits SIGTERM via the
/// process group; a forced kill (SIGKILL) on Tauri may orphan it — that's
/// the same behavior as `pnpm dev` today, where Ctrl-C kills both.
fn spawn_sidecar(app: &AppHandle) -> CmdResult<()> {
    let bin_name = if cfg!(windows) { "ohcanvas-sidecar.exe" } else { "ohcanvas-sidecar" };

    // Production path: look for the bundled binary alongside the app.
    if let Ok(bundled) = app.path().resolve(bin_name, tauri::path::BaseDirectory::Resource) {
        if bundled.exists() {
            Command::new(&bundled)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|e| PersistenceError {
                    message: format!("spawn bundled sidecar {bundled:?}: {e}"),
                })?;
            return Ok(());
        }
    }

    // Dev path: no bundled binary, assume `pnpm dev` style workflow.
    // Walk up from CARGO_MANIFEST_DIR (src-tauri/) to find the workspace
    // root containing pnpm-workspace.yaml.
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR")
        .map_err(|e| PersistenceError { message: format!("CARGO_MANIFEST_DIR: {e}") })?;
    let workspace_root = PathBuf::from(&manifest_dir)
        .parent()
        .ok_or_else(|| PersistenceError { message: "no workspace root".into() })?
        .to_path_buf();
    Command::new("pnpm")
        .args(["--filter", "sidecar", "start"])
        .current_dir(&workspace_root)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| PersistenceError {
            message: format!("spawn dev sidecar (pnpm --filter sidecar start): {e}"),
        })?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_stt::init())
        .plugin(tauri_plugin_llm::init())
        .invoke_handler(tauri::generate_handler![read_state, write_state, remove_state])
        .setup(|app| {
            // Fire-and-forget: spawn the sidecar asynchronously so we
            // don't block app setup. Failures are logged to stderr; the
            // React app will surface "sidecar disconnected" in the UI.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = spawn_sidecar(&handle) {
                    eprintln!("[ohcanvas] failed to spawn sidecar: {}", e.message);
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Canvas");
}