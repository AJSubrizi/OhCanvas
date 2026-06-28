import { useCallback, useEffect, useRef, useState } from "react";
import { useCanvasStore } from "../state/store";
import { check } from "@tauri-apps/plugin-updater";
import { tileTerminals, nextAgentName, spawnBrowserNode, spawnNoteNode } from "../canvas/nodes";
import { sidecar } from "../bridge/sidecar";
import { CLI_OPTIONS } from "./cliOptions";
import type { CliKind } from "./cliOptions";
import { chooseWorkspaceProject, resolveTerminalFolder } from "./projectFolders";
import { THEMES } from "./themes";
import { BACKGROUND_VIDEOS, backgroundVideoUrl, DEFAULT_BACKGROUND_VIDEO } from "./backgrounds";
import { normalizeMediaEmbedUrl } from "./mediaProviders";
import {
  BrowserIcon,
  ArrowIcon,
  EraserIcon,
  NoteIcon,
  PanIcon,
  PenIcon,
  SelectIcon,
  SettingsIcon,
  ShellIcon,
  type IconProps,
} from "./icons";
import WorkspaceSwitcher from "./WorkspaceSwitcher";

// TODO: point this at the real repo once it's published.
const GITHUB_REPO_URL = "https://github.com/AJSubrizi/OhCanvas";

function normalizeRemoteUrl(url: string) {
  const trimmed = url.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export default function Navbar() {
  const [cliOpen, setCliOpen] = useState(false);
  const cliMenuRef = useRef<HTMLDivElement>(null);

  // Tool state (merged from old sidebar)
  const tool = useCanvasStore((s) => s.tool);
  const setTool = useCanvasStore((s) => s.setTool);

  // Settings (fused into navbar)
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mediaDraft, setMediaDraft] = useState("");
  const [mediaError, setMediaError] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const gearRef = useRef<HTMLButtonElement>(null);

  const autoArrange = useCanvasStore((s) => s.autoArrange);
  const setAutoArrange = useCanvasStore((s) => s.setAutoArrange);
  const setBackgroundImage = useCanvasStore((s) => s.setBackgroundImage);
  const backgroundVideo = useCanvasStore((s) => s.backgroundVideo);
  const setBackgroundVideo = useCanvasStore((s) => s.setBackgroundVideo);
  const boardDrawColor = useCanvasStore((s) => s.boardDrawColor);
  const setBoardDrawColor = useCanvasStore((s) => s.setBoardDrawColor);
  const themeId = useCanvasStore((s) => s.themeId);
  const setThemeId = useCanvasStore((s) => s.setThemeId);
  const spotifyEmbedUrl = useCanvasStore((s) => s.spotifyEmbedUrl);
  const spotifyPlayerOpen = useCanvasStore((s) => s.spotifyPlayerOpen);
  const setSpotifyEmbedUrl = useCanvasStore((s) => s.setSpotifyEmbedUrl);
  const setSpotifyPlayerOpen = useCanvasStore((s) => s.setSpotifyPlayerOpen);
  const workspaces = useCanvasStore((s) => s.workspaces);
  const activeWorkspaceId = useCanvasStore((s) => s.activeWorkspaceId);
  const multiFolderSameProject = useCanvasStore((s) => s.multiFolderSameProject);
  const setMultiFolderSameProject = useCanvasStore((s) => s.setMultiFolderSameProject);
  const setActiveWorkspaceRemoteUrl = useCanvasStore((s) => s.setActiveWorkspaceRemoteUrl);
  const activeWorkspace = workspaces.find((ws) => ws.id === activeWorkspaceId) ?? workspaces[0];

  const [updateState, setUpdateState] = useState<"idle" | "checking" | "available" | "downloading" | "ready" | "error">("idle");
  const [updateError, setUpdateError] = useState("");

  const handleUpdate = useCallback(async () => {
    try {
      setUpdateState("checking");
      setUpdateError("");
      const update = await check();
      if (!update) {
        setUpdateState("idle");
        return;
      }
      setUpdateState("available");
      const confirmed = confirm(`Update ${update.version} available. Download and install?`);
      if (!confirmed) {
        setUpdateState("idle");
        return;
      }
      setUpdateState("downloading");
      await update.downloadAndInstall();
      setUpdateState("ready");
      alert("Update installed. Please restart the app to apply.");
    } catch (err) {
      setUpdateState("error");
      setUpdateError(String(err));
      setTimeout(() => setUpdateState("idle"), 3000);
    }
  }, []);

  const toggleAuto = () => {
    const next = !autoArrange;
    setAutoArrange(next);
    if (next) tileTerminals();
  };

  useEffect(() => {
    if (!cliOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!cliMenuRef.current?.contains(event.target as Node)) setCliOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [cliOpen]);

  // Close settings panel on outside click or Escape (from old sidebar)
  useEffect(() => {
    if (!settingsOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (settingsRef.current?.contains(t) || gearRef.current?.contains(t)) return;
      setSettingsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSettingsOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [settingsOpen]);

  const openCli = async (kind: CliKind) => {
    const folder = await resolveTerminalFolder();
    if (!folder) return;
    const label = CLI_OPTIONS.find((option) => option.kind === kind)?.label ?? kind;
    sidecar.startTerminal({
      kind,
      cwd: folder.path ?? undefined,
      title: `${nextAgentName()} · ${label}`,
    });
    setCliOpen(false);

    // CLI spawn must not be random placement.
    // When a new CLI is spawned, format the view (nice grid layout for all terminals).
    setTimeout(() => {
      tileTerminals();
    }, 160);
  };

  const handleClear = () => {
    if (!confirm("Clear entire canvas? (processes will be killed)")) return;
    Object.keys(useCanvasStore.getState().terminals).forEach((id) => sidecar.killTerminal(id));
    useCanvasStore.getState().clearCanvas();
  };

  // Merged tools from old left sidebar
  type SidebarTool = "select" | "pan" | "pen" | "arrow" | "eraser" | "note" | "browser" | "shell";

  const TOOLS: {
    id: SidebarTool;
    title: string;
    Icon: (p: IconProps) => JSX.Element;
  }[] = [
    { id: "select", title: "Select", Icon: SelectIcon },
    { id: "pan", title: "Pan canvas", Icon: PanIcon },
    { id: "pen", title: "Draw on board", Icon: PenIcon },
    { id: "arrow", title: "Draw arrow", Icon: ArrowIcon },
    { id: "eraser", title: "Erase board marks", Icon: EraserIcon },
    { id: "note", title: "Note", Icon: NoteIcon },
    { id: "browser", title: "Browser", Icon: BrowserIcon },
    { id: "shell", title: "Shell", Icon: ShellIcon },
  ];

  const clickTool = async (id: SidebarTool) => {
    if (id === "browser") {
      spawnBrowserNode();
      setTool("select");
      return;
    }
    if (id === "shell") {
      const folder = await resolveTerminalFolder();
      if (folder) {
        sidecar.startTerminal({
          kind: "shell",
          cwd: folder.path ?? undefined,
          title: `Terminal · ${folder.name}`,
        });
        setTimeout(() => tileTerminals(), 160);
      }
      setTool("select");
      return;
    }
    if (id === "note") {
      spawnNoteNode();
      setTool("select");
      return;
    }
    setTool(id);
  };

  const chooseBackground = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setBackgroundVideo(null);
        setBackgroundImage(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const saveMedia = () => {
    const normalized = normalizeMediaEmbedUrl(mediaDraft || spotifyEmbedUrl || "");
    if (!normalized) {
      setMediaError(true);
      return;
    }
    setSpotifyEmbedUrl(normalized);
    setSpotifyPlayerOpen(true);
    setMediaDraft("");
    setMediaError(false);
  };

  return (
    <>
      <div className="navbar" aria-label="Canvas actions">
        <WorkspaceSwitcher />
        <button
          className="navbar__project"
          data-tauri-drag-region="false"
          title={activeWorkspace?.folderPath || "Choose project folder"}
          onClick={() => void chooseWorkspaceProject()}
        >
          <span className="navbar__project-dot" />
          <span>{activeWorkspace?.folderName ?? "Project"}</span>
        </button>

        {/* Merged tools from old left sidebar */}
        <div className="navbar__tools">
          {TOOLS.map((item) => (
            <button
              key={item.id}
              className={`navbar__tool-btn ${tool === item.id ? "is-active" : ""}`}
              data-tauri-drag-region="false"
              title={item.title}
              aria-label={item.title}
              onClick={() => void clickTool(item.id)}
            >
              <item.Icon size={15} />
            </button>
          ))}
        </div>

        <div className="navbar__menu" ref={cliMenuRef}>
          <button
            className={`navbar__btn ${cliOpen ? "is-active" : ""}`}
            onClick={() => setCliOpen((open) => !open)}
            data-tauri-drag-region="false"
            title="Open a CLI terminal"
            aria-haspopup="menu"
            aria-expanded={cliOpen}
          >
            + CLI
          </button>
          {cliOpen && (
            <div className="navbar__dropdown" role="menu" aria-label="Choose CLI">
              {CLI_OPTIONS.map((option) => (
                <button key={option.kind} role="menuitem" data-tauri-drag-region="false" onClick={() => openCli(option.kind)}>
                  <span>{option.label}</span>
                  <small>terminal</small>
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          className={`navbar__btn ${autoArrange ? "is-active" : ""}`}
          onClick={toggleAuto}
          data-tauri-drag-region="false"
          title="Auto-arrange terminals as they open/close"
        >
          {autoArrange ? "Tile ✓" : "Tile"}
        </button>

        <div className="navbar__draw-colors" aria-label="Board drawing color">
          {["#facc15", "#67e8f9", "#f472b6", "#4ade80"].map((color) => (
            <button
              key={color}
              className={`navbar__color ${boardDrawColor === color ? "is-active" : ""}`}
              style={{ backgroundColor: color }}
              data-tauri-drag-region="false"
              onClick={() => setBoardDrawColor(color)}
              title={`Draw color ${color}`}
              aria-label={`Draw color ${color}`}
            />
          ))}
        </div>

        <button className="navbar__btn" data-tauri-drag-region="false" onClick={handleClear} title="Clear canvas">
          Clear
        </button>
        {/* Settings gear (fused) */}
        <button
          ref={gearRef}
          className={`navbar__btn navbar__settings-btn ${settingsOpen ? "is-active" : ""}`}
          data-tauri-drag-region="false"
          title="Settings"
          aria-label="Settings"
          onClick={() => setSettingsOpen((open) => !open)}
        >
          <SettingsIcon size={15} />
        </button>
      </div>

      {/* Settings panel (repositioned for merged top bar) */}
      {settingsOpen && (
        <div ref={settingsRef} className="sidebar-settings" role="dialog" aria-label="Canvas settings">
          <div className="sidebar-settings__header">
            <span>Settings</span>
            <button onClick={() => setSettingsOpen(false)} aria-label="Close settings">×</button>
          </div>
          <button className="sidebar-settings__action" onClick={() => fileRef.current?.click()}>
            Change background
          </button>
          <button
            className="sidebar-settings__action"
            onClick={() => {
              setBackgroundImage(null);
              if (!backgroundVideo) {
                setBackgroundVideo(DEFAULT_BACKGROUND_VIDEO);
              }
            }}
          >
            Reset background
          </button>
          <div className="sidebar-settings__label">Animated background</div>
          <div className="bg-picker">
            {BACKGROUND_VIDEOS.map((v) => (
              <button
                key={v.file}
                className={`bg-thumb ${backgroundVideo === v.file ? "is-active" : ""}`}
                title={v.name}
                aria-label={`${v.name} background`}
                aria-pressed={backgroundVideo === v.file}
                onClick={() => {
                  setBackgroundVideo(v.file);
                  setBackgroundImage(null);
                }}
              >
                <video
                  src={backgroundVideoUrl(v.file)}
                  muted
                  loop
                  playsInline
                  preload="metadata"
                  onMouseEnter={(e) => void (e.currentTarget as HTMLVideoElement).play().catch(() => {})}
                  onMouseLeave={(e) => (e.currentTarget as HTMLVideoElement).pause()}
                  onDoubleClick={(e) => void (e.currentTarget as HTMLVideoElement).play().catch(() => {})}
                />
                <span className="bg-thumb__label">{v.name}</span>
              </button>
            ))}
          </div>
          <div className="sidebar-settings__label">Theme</div>
          <div className="theme-picker">
            {THEMES.map((t) => (
              <button
                key={t.id}
                className={`theme-swatch ${themeId === t.id ? "is-active" : ""}`}
                style={{ background: t.background }}
                title={t.name}
                aria-label={`${t.name} theme`}
                aria-pressed={themeId === t.id}
                onClick={() => {
                  setThemeId(t.id);
                  setBackgroundImage(null);
                }}
              >
                <span className="theme-swatch__dot" style={{ background: t.accent }} />
              </button>
            ))}
          </div>
          <label className="sidebar-settings__toggle">
            <input
              type="checkbox"
              checked={autoArrange}
              onChange={(event) => setAutoArrange(event.target.checked)}
            />
            <span>Auto arrange terminals</span>
          </label>
          <div className="sidebar-settings__label">Project</div>
          <button className="sidebar-settings__action" onClick={() => void chooseWorkspaceProject()}>
            {activeWorkspace?.folderName ? `Folder: ${activeWorkspace.folderName}` : "Choose workspace folder"}
          </button>
          {activeWorkspace?.folderPath && (
            <div className="sidebar-settings__hint" title={activeWorkspace.folderPath}>
              {activeWorkspace.folderPath}
            </div>
          )}
          <input
            className="sidebar-settings__input"
            value={activeWorkspace?.remoteUrl ?? ""}
            placeholder="Remote server URL"
            onChange={(event) => setActiveWorkspaceRemoteUrl(event.target.value)}
          />
          <button
            className="sidebar-settings__action"
            disabled={!activeWorkspace?.remoteUrl}
            onClick={() => activeWorkspace?.remoteUrl && useCanvasStore.getState().openPreview(normalizeRemoteUrl(activeWorkspace.remoteUrl))}
          >
            Open remote preview
          </button>
          <label className="sidebar-settings__toggle">
            <input
              type="checkbox"
              checked={multiFolderSameProject}
              onChange={(event) => setMultiFolderSameProject(event.target.checked)}
            />
            <span>Multi-folder on same project</span>
          </label>
          <div className="sidebar-settings__label">Media</div>
          <input
            className={`sidebar-settings__input ${mediaError ? "is-error" : ""}`}
            value={mediaDraft}
            placeholder="Paste Spotify, YouTube, YouTube Music, or Apple Music"
            onChange={(event) => {
              setMediaDraft(event.target.value);
              setMediaError(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") saveMedia();
            }}
          />
          <button className="sidebar-settings__action" onClick={saveMedia}>
            Set media
          </button>
          <button
            className="sidebar-settings__action"
            onClick={() => useCanvasStore.getState().clearBoardMarks()}
          >
            Clear drawings
          </button>
          <label className="sidebar-settings__toggle">
            <input
              type="checkbox"
              checked={spotifyPlayerOpen}
              onChange={(event) => setSpotifyPlayerOpen(event.target.checked)}
              disabled={!spotifyEmbedUrl}
            />
            <span>Show player</span>
          </label>
          {spotifyEmbedUrl && (
            <button
              className="sidebar-settings__action sidebar-settings__action--danger"
              onClick={() => {
                setSpotifyEmbedUrl(null);
                setSpotifyPlayerOpen(false);
                setMediaDraft("");
                setMediaError(false);
              }}
            >
              Remove
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => chooseBackground(event.target.files?.[0])}
          />
          <div className="sidebar-settings__label">Update</div>
          <button
            className="sidebar-settings__action"
            onClick={handleUpdate}
            disabled={updateState === "checking" || updateState === "downloading"}
          >
            {updateState === "checking" ? "Checking…" :
             updateState === "downloading" ? "Downloading…" :
             updateState === "ready" ? "Restart to apply ✓" :
             updateState === "error" ? `Error: ${updateError.slice(0, 40)}` :
             updateState === "available" ? "Update available — click to install" :
             "Check for updates"}
          </button>
        </div>
      )}

      <a
        className="github-star"
        data-tauri-drag-region="false"
        href={GITHUB_REPO_URL}
        target="_blank"
        rel="noreferrer noopener"
        title="Star this project on GitHub"
        aria-label="Star on GitHub"
      >
        <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
        </svg>
        <span className="github-star__icon" aria-hidden="true">★</span>
        <span className="github-star__label">Star</span>
      </a>
    </>
  );
}
