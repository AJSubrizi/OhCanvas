import { open } from "@tauri-apps/plugin-dialog";

export interface PickedWorkspace {
  name: string;
  path: string | null;
}

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function basename(p: string): string {
  return p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;
}

/** User-facing alias — each terminal picks a folder, not a global workspace. */
export type PickedFolder = PickedWorkspace;

const RECENT_FOLDERS_KEY = "ohcanvas:recent-folders";
const RECENT_FOLDERS_MAX = 3;

export function rememberFolder(folder: PickedWorkspace) {
  if (!folder.path) return;
  try {
    const raw = localStorage.getItem(RECENT_FOLDERS_KEY);
    const prev = raw ? (JSON.parse(raw) as PickedWorkspace[]) : [];
    const next = [folder, ...prev.filter((f) => f.path !== folder.path)].slice(0, RECENT_FOLDERS_MAX);
    localStorage.setItem(RECENT_FOLDERS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export function getRecentFolders(): PickedWorkspace[] {
  try {
    const raw = localStorage.getItem(RECENT_FOLDERS_KEY);
    return raw ? (JSON.parse(raw) as PickedWorkspace[]) : [];
  } catch {
    return [];
  }
}

/**
 * Opens a folder picker and returns the chosen folder. In the Tauri app this
 * uses the native dialog (real absolute path). In a plain browser it falls back
 * to the `<input webkitdirectory>` picker, which only yields the folder name.
 * Resolves null when the user cancels.
 */
export async function pickFolder(title = "Choose a folder"): Promise<PickedWorkspace | null> {
  if (isTauri()) {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title,
      });
      if (typeof selected !== "string") return null; // cancelled
      const folder: PickedWorkspace = { name: basename(selected), path: selected };
      rememberFolder(folder);
      return folder;
    } catch {
      // fall through to the web picker
    }
  }
  return pickWorkspaceDirectory();
}

export function pickWorkspaceDirectory(): Promise<PickedWorkspace | null> {
  return new Promise<PickedWorkspace | null>((resolve) => {
    const input = document.createElement("input") as HTMLInputElement & {
      directory?: boolean;
      webkitdirectory?: boolean;
    };
    input.type = "file";
    input.multiple = true;
    input.directory = true;
    input.webkitdirectory = true;

    let settled = false;
    const finish = (workspace: PickedWorkspace | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(workspace);
    };

    const cleanup = () => {
      input.onchange = null;
      input.removeEventListener("cancel", onCancel);
      window.setTimeout(() => input.remove(), 0);
    };

    const onCancel = () => finish(null);

    input.onchange = (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) {
        finish(null);
        return;
      }
      finish(workspaceFromFile(file));
    };
    input.addEventListener("cancel", onCancel);

    input.style.display = "none";
    document.body.appendChild(input);
    input.click();
  }).then((folder) => {
    if (folder?.path) rememberFolder(folder);
    return folder;
  });
}

export function workspaceFromFile(file: File): PickedWorkspace {
  const relative = file.webkitRelativePath;
  const name = relative ? relative.split("/")[0] : file.name;
  const nativePath = (file as File & { path?: string }).path;
  let path: string | null = null;

  if (nativePath) {
    const normalized = nativePath.replace(/\\/g, "/");
    const marker = relative ? `/${relative.split("/")[0]}/` : "/";
    const index = normalized.lastIndexOf(marker);
    path = index >= 0 && relative ? normalized.slice(0, index + marker.length - 1) : normalized.replace(/\/[^/]+$/, "");
  }

  return { name, path };
}
