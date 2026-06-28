import { create } from "zustand";
import type { CanvasNode } from "../canvas/types";
import type { AgentCommand, TerminalKind } from "../bridge/protocol";
import { BACKGROUND_VIDEOS, DEFAULT_BACKGROUND_VIDEO } from "../ui/backgrounds";
import { persistence } from "./persistence";

export type CanvasTool =
  | "select"
  | "pan"
  | "pen"
  | "arrow"
  | "eraser"
  | "note"
  | "text"
  | "browser"
  | "shell"
  | "pi";

export type LineRole = "user" | "assistant" | "tool" | "error" | "system";

export interface TranscriptLine {
  id: string;
  role: LineRole;
  text: string;
  /** assistant lines stay "open" while text deltas stream in */
  streaming?: boolean;
}

// Legacy agent types kept only for conductor (hidden __conductor__)
export interface AgentRuntime {
  status: string;
  detail?: string;
  lines: TranscriptLine[];
  tokens?: number;
  cost?: number;
  contextUsage?: number;
  commands?: AgentCommand[];
}

export interface ShellRuntime {
  command: string;
  output: string;
  running: boolean;
  exitCode?: number | null;
}

export interface TerminalRuntime {
  kind: TerminalKind;
  title: string;
  command: string;
  output: string;
  running: boolean;
  exitCode?: number | null;
  cwd?: string;
}

export interface DockPosition {
  x: number;
  y: number;
}

export type BoardMark =
  | { id: string; kind: "pen"; points: number[]; color: string; strokeWidth: number }
  | { id: string; kind: "arrow"; points: number[]; color: string; strokeWidth: number };

export type PreviewDevice = "mobile" | "desktop";

/** A dev-server URL detected in a terminal's output, offered to the user. */
export interface PreviewSuggestion {
  id: string;
  terminalId: string;
  terminalTitle: string;
  url: string;
}

export interface CanvasActivity {
  id: string;
  text: string;
  at: number;
}

export const WORKSPACE_COLORS = [
  "#7c9cff", // blu
  "#67e8f9", // ciano
  "#f472b6", // rosa
  "#4ade80", // verde
  "#facc15", // giallo
  "#c084fc", // viola
  "#fb923c", // arancione
  "#f87171", // rosso
  "#a78bfa", // lavanda
  "#34d399", // smeraldo
];

export interface Workspace {
  id: string;
  label: string;
  color: string;
  folderName?: string;
  folderPath?: string | null;
  remoteUrl?: string;
  remoteHost?: string;
  remoteUser?: string;
  remotePath?: string;
}

// Disk-side keys. The persistence adapter prefixes these with "ohcanvas:"
// before writing to localStorage fallback / to <app_data_dir>/state/.
// Files keep the same shape as the old localStorage entries so a v1 user
// upgrading to the file backend reads existing data without a manual
// migration step (the adapter handles it on first read).
const CANVAS_STORAGE_KEY = 'v1';
const WORKSPACES_STORAGE_KEY = "ohcanvas:workspaces";
const GLOBAL_MEDIA_KEY = "ohcanvas:global-media";
const GLOBAL_SETTINGS_KEY = "ohcanvas:global-settings";

const workspaceKey = (wsId: string) => `${CANVAS_STORAGE_KEY}:${wsId}`;

const DEFAULT_SPOTIFY_EMBED_URL =
  "https://open.spotify.com/embed/playlist/37i9dQZF1DWZeKCadgRdKQ?utm_source=generator&theme=0";

function defaultWorkspaces(): Workspace[] {
  return [{ id: "ws-1", label: "1", color: WORKSPACE_COLORS[0] }];
}

function loadWorkspaces(): Workspace[] {
  try {
    const raw = localStorage.getItem(WORKSPACES_STORAGE_KEY);
    if (!raw) return defaultWorkspaces();
    const parsed = JSON.parse(raw) as Workspace[];
    if (!Array.isArray(parsed) || parsed.length === 0) return defaultWorkspaces();
    return parsed
      .map((raw, index) => ({
        id: typeof raw.id === "string" && raw.id ? raw.id : `ws-${index + 1}`,
        label: typeof raw.label === "string" && raw.label ? raw.label : String(index + 1),
        color: typeof raw.color === "string" && raw.color ? raw.color : WORKSPACE_COLORS[index % WORKSPACE_COLORS.length],
        folderName: typeof raw.folderName === "string" ? raw.folderName : undefined,
        folderPath: typeof raw.folderPath === "string" || raw.folderPath === null ? raw.folderPath : undefined,
        remoteUrl: typeof raw.remoteUrl === "string" ? raw.remoteUrl : undefined,
        remoteHost: typeof raw.remoteHost === "string" ? raw.remoteHost : undefined,
        remoteUser: typeof raw.remoteUser === "string" ? raw.remoteUser : undefined,
        remotePath: typeof raw.remotePath === "string" ? raw.remotePath : undefined,
      }));
  } catch {
    return defaultWorkspaces();
  }
}

function persistWorkspaces(workspaces: Workspace[]) {
  try {
    localStorage.setItem(WORKSPACES_STORAGE_KEY, JSON.stringify(workspaces));
  } catch {
    /* ignore */
  }
}

function loadGlobalMedia() {
  try {
    const raw = localStorage.getItem(GLOBAL_MEDIA_KEY);
    if (!raw) {
      return {
        spotifyEmbedUrl: DEFAULT_SPOTIFY_EMBED_URL,
        spotifyPlayerOpen: false,
        spotifyPosition: null as DockPosition | null,
      };
    }
    const parsed = JSON.parse(raw) as Partial<{
      spotifyEmbedUrl: string | null;
      spotifyPlayerOpen: boolean;
      spotifyPosition: DockPosition | null;
    }>;
    return {
      spotifyEmbedUrl:
        typeof parsed.spotifyEmbedUrl === "string" || parsed.spotifyEmbedUrl === null
          ? parsed.spotifyEmbedUrl
          : DEFAULT_SPOTIFY_EMBED_URL,
      spotifyPlayerOpen: typeof parsed.spotifyPlayerOpen === "boolean" ? parsed.spotifyPlayerOpen : false,
      spotifyPosition:
        typeof parsed.spotifyPosition?.x === "number" && typeof parsed.spotifyPosition?.y === "number"
          ? parsed.spotifyPosition
          : null,
    };
  } catch {
    return {
      spotifyEmbedUrl: DEFAULT_SPOTIFY_EMBED_URL,
      spotifyPlayerOpen: false,
      spotifyPosition: null as DockPosition | null,
    };
  }
}

function persistGlobalMedia(media: {
  spotifyEmbedUrl: string | null;
  spotifyPlayerOpen: boolean;
  spotifyPosition: DockPosition | null;
}) {
  try {
    localStorage.setItem(GLOBAL_MEDIA_KEY, JSON.stringify(media));
  } catch {
    /* ignore */
  }
}

function loadGlobalSettings() {
  try {
    const raw = localStorage.getItem(GLOBAL_SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) as Partial<{ multiFolderSameProject: boolean }> : {};
    return { multiFolderSameProject: parsed.multiFolderSameProject === true };
  } catch {
    return { multiFolderSameProject: false };
  }
}

function persistGlobalSettings(settings: { multiFolderSameProject: boolean }) {
  try {
    localStorage.setItem(GLOBAL_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

interface CanvasStore {
  /** sidecar connection state, surfaced in the navbar */
  connected: boolean;
  /** Legacy: only used by the hidden conductor for now */
  agents: Record<string, AgentRuntime>;
  /** @deprecated - use terminals */
  shells: Record<string, ShellRuntime>;
  terminals: Record<string, TerminalRuntime>;
  /** Canvas nodes (positions + per-node data) */
  flowNodes: CanvasNode[];
  boardMarks: BoardMark[];
  boardDrawColor: string;
  tool: CanvasTool;
  backgroundImage: string | null;
  /** filename of the animated background video under /backgrounds, or null */
  backgroundVideo: string | null;
  spotifyEmbedUrl: string | null;
  spotifyPlayerOpen: boolean;
  spotifyPosition: DockPosition | null;
  multiFolderSameProject: boolean;
  /** auto-tile terminals side-by-side as they open/close */
  autoArrange: boolean;
  /** active theme id (accent + backdrop) */
  themeId: string;
  /** speech-to-text live state */
  voiceListening: boolean;
  voicePartial: string;
  voiceStatus: string;
  voiceMessage: string;
  lastCanvasAction: string | null;
  canvasActivity: CanvasActivity[];

  /** Workspace management (Ubuntu-style virtual desktops) */
  workspaces: Workspace[];
  activeWorkspaceId: string;

  addWorkspace: (folder?: { name: string; path: string | null } | null) => void;
  removeWorkspace: (id: string) => void;
  switchWorkspace: (id: string) => void;

  /** Right-docked live preview panel (mirrors the dev server of a terminal). */
  previewOpen: boolean;
  previewUrl: string;
  previewTerminalId: string | null;
  previewDevice: PreviewDevice;
  /** Pending dev-server URL detections offered to the user (toast queue). */
  previewSuggestions: PreviewSuggestion[];

  setConnected: (v: boolean) => void;
  setTool: (tool: CanvasTool) => void;
  setBackgroundImage: (image: string | null) => void;
  setBackgroundVideo: (video: string | null) => void;
  setSpotifyEmbedUrl: (url: string | null) => void;
  setSpotifyPlayerOpen: (open: boolean) => void;
  setSpotifyPosition: (position: DockPosition | null) => void;
  setMultiFolderSameProject: (enabled: boolean) => void;
  setActiveWorkspaceFolder: (folder: { name: string; path: string | null } | null) => void;
  setActiveWorkspaceRemoteUrl: (url: string) => void;
  setActiveWorkspaceRemoteServer: (fields: Partial<Pick<Workspace, "remoteHost" | "remoteUser" | "remotePath">>) => void;
  setAutoArrange: (v: boolean) => void;
  setThemeId: (id: string) => void;
  setVoiceListening: (v: boolean) => void;
  setVoicePartial: (text: string) => void;
  setVoiceStatus: (state: string, message?: string) => void;
  setLastCanvasAction: (action: string | null) => void;
  pushCanvasActivity: (text: string) => void;
  // Workspace actions
  loadWorkspaceState: (wsId: string) => Promise<void>;
  // Preview dock
  setPreviewOpen: (open: boolean) => void;
  setPreviewUrl: (url: string) => void;
  setPreviewTerminal: (terminalId: string | null) => void;
  /** Open the dock and load a URL (optionally bound to a source terminal). */
  openPreview: (url: string, terminalId?: string | null) => void;
  closePreview: () => void;
  cyclePreviewDevice: () => void;
  /** Enqueue a dev-server URL detected in a terminal (shown as a toast offer). */
  addPreviewSuggestion: (suggestion: Omit<PreviewSuggestion, "id">) => void;
  dismissPreviewSuggestion: (id: string) => void;
  setBoardDrawColor: (color: string) => void;
  setBoardMarks: (marks: BoardMark[]) => void;
  addBoardMark: (mark: BoardMark) => void;
  clearBoardMarks: () => void;
  setFlowNodes: (nodes: CanvasNode[]) => void;
  addFlowNode: (node: CanvasNode) => void;

  // Legacy conductor support (kept for __conductor__)
  ensureAgent: (agentId: string) => void;
  setStatus: (agentId: string, status: string, detail?: string) => void;
  pushLine: (agentId: string, role: LineRole, text: string) => void;
  appendDelta: (agentId: string, delta: string) => void;
  closeStreaming: (agentId: string) => void;
  setStats: (
    agentId: string,
    stats: Pick<AgentRuntime, "tokens" | "cost" | "contextUsage">,
  ) => void;
  removeAgent: (agentId: string) => void;
  setCommands: (agentId: string, commands: AgentCommand[]) => void;

  /** @deprecated use ensureTerminal */
  ensureShell: (shellId: string, command: string) => void;
  /** @deprecated */
  shellExit: (shellId: string, code: number | null) => void;
  /** @deprecated */
  removeShell: (shellId: string) => void;

  ensureTerminal: (terminalId: string, runtime: Omit<TerminalRuntime, "output" | "running" | "exitCode">) => void;
  terminalExit: (terminalId: string, code: number | null) => void;
  removeTerminal: (terminalId: string) => void;
  resetTerminalOutput: (terminalId: string) => void;
  removeFlowNode: (id: string) => void;

  // Persistence
  saveCanvas: () => void;
  loadCanvas: () => Promise<void>;
  clearCanvas: () => void;
}

const empty = (): AgentRuntime => ({ status: "idle", lines: [] });
const uid = () => Math.random().toString(36).slice(2, 9);
const INITIAL_WORKSPACES = loadWorkspaces();

export const useCanvasStore = create<CanvasStore>((set) => ({
  connected: false,
  agents: {},
  shells: {},
  terminals: {},
  flowNodes: [],
  boardMarks: [],
  boardDrawColor: "#facc15",
  tool: "select",
  backgroundImage: null,
  backgroundVideo: DEFAULT_BACKGROUND_VIDEO,
  spotifyEmbedUrl: loadGlobalMedia().spotifyEmbedUrl,
  spotifyPlayerOpen: loadGlobalMedia().spotifyPlayerOpen,
  spotifyPosition: loadGlobalMedia().spotifyPosition,
  multiFolderSameProject: loadGlobalSettings().multiFolderSameProject,
  autoArrange: true,
  themeId: (() => {
    try {
      return localStorage.getItem("ohcanvas:theme") || "midnight";
    } catch {
      return "midnight";
    }
  })(),
  voiceListening: false,
  voicePartial: "",
  voiceStatus: "",
  voiceMessage: "",
  lastCanvasAction: null,
  canvasActivity: [],
  workspaces: INITIAL_WORKSPACES,
  activeWorkspaceId: INITIAL_WORKSPACES[0]?.id ?? "ws-1",
  previewOpen: false,
  previewUrl: "",
  previewTerminalId: null,
  previewDevice: "desktop",
  previewSuggestions: [],

  setConnected: (v) => set({ connected: v }),
  setTool: (tool) => set({ tool }),
  setBackgroundImage: (image) => set({ backgroundImage: image }),
  setBackgroundVideo: (video) => set({ backgroundVideo: video }),
  setSpotifyEmbedUrl: (url) =>
    set((s) => {
      persistGlobalMedia({ spotifyEmbedUrl: url, spotifyPlayerOpen: s.spotifyPlayerOpen, spotifyPosition: s.spotifyPosition });
      return { spotifyEmbedUrl: url };
    }),
  setSpotifyPlayerOpen: (open) =>
    set((s) => {
      persistGlobalMedia({ spotifyEmbedUrl: s.spotifyEmbedUrl, spotifyPlayerOpen: open, spotifyPosition: s.spotifyPosition });
      return { spotifyPlayerOpen: open };
    }),
  setSpotifyPosition: (position) =>
    set((s) => {
      persistGlobalMedia({ spotifyEmbedUrl: s.spotifyEmbedUrl, spotifyPlayerOpen: s.spotifyPlayerOpen, spotifyPosition: position });
      return { spotifyPosition: position };
    }),
  setMultiFolderSameProject: (enabled) => {
    persistGlobalSettings({ multiFolderSameProject: enabled });
    set({ multiFolderSameProject: enabled });
  },
  setActiveWorkspaceFolder: (folder) =>
    set((s) => {
      const workspaces = s.workspaces.map((ws) =>
        ws.id === s.activeWorkspaceId
          ? { ...ws, folderName: folder?.name, folderPath: folder?.path ?? null }
          : ws,
      );
      persistWorkspaces(workspaces);
      return { workspaces };
    }),
  setActiveWorkspaceRemoteUrl: (url) =>
    set((s) => {
      const clean = url.trim();
      const workspaces = s.workspaces.map((ws) =>
        ws.id === s.activeWorkspaceId ? { ...ws, remoteUrl: clean || undefined } : ws,
      );
      persistWorkspaces(workspaces);
      return { workspaces };
    }),
  setActiveWorkspaceRemoteServer: (fields) =>
    set((s) => {
      const workspaces = s.workspaces.map((ws) => {
        if (ws.id !== s.activeWorkspaceId) return ws;
        const next = { ...ws };
        if ("remoteHost" in fields) next.remoteHost = fields.remoteHost?.trim() || undefined;
        if ("remoteUser" in fields) next.remoteUser = fields.remoteUser?.trim() || undefined;
        if ("remotePath" in fields) next.remotePath = fields.remotePath?.trim() || undefined;
        return next;
      });
      persistWorkspaces(workspaces);
      return { workspaces };
    }),
  setAutoArrange: (v) => set({ autoArrange: v }),
  setThemeId: (id) => {
    try {
      localStorage.setItem("ohcanvas:theme", id);
    } catch {
      /* ignore */
    }
    set({ themeId: id });
  },
  setVoiceListening: (v) => set({ voiceListening: v }),
  setVoicePartial: (text) => set({ voicePartial: text }),
  setVoiceStatus: (state, message) => set({ voiceStatus: state, voiceMessage: message ?? "" }),
  setLastCanvasAction: (action: string | null) => set({ lastCanvasAction: action }),
  pushCanvasActivity: (text) =>
    set((s) => ({
      lastCanvasAction: text,
      canvasActivity: [{ id: uid(), text, at: Date.now() }, ...s.canvasActivity].slice(0, 8),
    })),

  // --- Workspace actions ---
  loadWorkspaceState: async (wsId: string) => {
    let raw: string | null = null;
    try {
      raw = await persistence().read(workspaceKey(wsId));
    } catch (e) {
      console.warn(`[canvas] read workspace ${wsId} failed`, e);
    }
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      if (!data?.nodes) return;
      const restoredNodes = (data.nodes as CanvasNode[])
        .filter((node) => node.type !== "agent")
        .map((node) => {
          if (node.type !== "terminal" && node.type !== "shell") return node;
          const terminalId = String((node.data as Record<string, unknown>).terminalId ?? node.id);
          const saved = (data.terminals as Record<string, TerminalRuntime> | undefined)?.[terminalId];
          if (!saved?.cwd) return node;
          return { ...node, data: { ...(node.data as Record<string, unknown>), cwd: saved.cwd } };
        });
      const savedVideo = data.backgroundVideo;
      const hasVideo = typeof savedVideo === "string" && savedVideo.length > 0;
      const explicitNoVideo = savedVideo === null;
      const restoredVideo = hasVideo ? savedVideo : explicitNoVideo ? null : DEFAULT_BACKGROUND_VIDEO;
      set({
        flowNodes: restoredNodes,
        boardMarks: Array.isArray(data.boardMarks) ? data.boardMarks : [],
        terminals: (data.terminals as Record<string, TerminalRuntime>) ?? {},
        backgroundImage: hasVideo ? null : typeof data.backgroundImage === "string" ? data.backgroundImage : null,
        backgroundVideo: restoredVideo,
        autoArrange: typeof data.settings?.autoArrange === "boolean" ? data.settings.autoArrange : true,
        previewOpen: typeof data.preview?.open === "boolean" ? data.preview.open : false,
        previewUrl: typeof data.preview?.url === "string" ? data.preview.url : "",
        previewTerminalId: typeof data.preview?.terminalId === "string" ? data.preview.terminalId : null,
        previewDevice: data.preview?.device === "mobile" ? "mobile" : "desktop",
        previewSuggestions: [],
      });
      set((current) => {
        const next: Record<string, TerminalRuntime> = {};
        for (const [id, raw] of Object.entries(current.terminals)) {
          const t = raw as TerminalRuntime;
          next[id] = { ...t, running: false, exitCode: t.exitCode ?? -1 };
        }
        return { terminals: next };
      });
    } catch (e) {
      console.warn(`[canvas] load workspace ${wsId} failed`, e);
    }
  },
  addWorkspace: (folder?: { name: string; path: string | null } | null) =>
    set((s) => {
      // Save current workspace state first
      const snapshot = {
        version: 1,
        timestamp: Date.now(),
        nodes: s.flowNodes,
        boardMarks: s.boardMarks,
        backgroundImage: s.backgroundImage,
        backgroundVideo: s.backgroundVideo,
        settings: { autoArrange: s.autoArrange },
        preview: { open: s.previewOpen, url: s.previewUrl, terminalId: s.previewTerminalId, device: s.previewDevice },
        terminals: s.terminals,
      };
      persistence().write(workspaceKey(s.activeWorkspaceId), JSON.stringify(snapshot));
      const nextIdx = Math.max(0, ...s.workspaces.map((ws) => Number.parseInt(ws.label, 10)).filter(Number.isFinite)) + 1;
      const color = WORKSPACE_COLORS[(nextIdx - 1) % WORKSPACE_COLORS.length];
      const newWs: Workspace = {
        id: `ws-${nextIdx}`,
        label: String(nextIdx),
        color,
        folderName: folder?.name,
        folderPath: folder?.path ?? null,
      };
      const workspaces = [...s.workspaces, newWs];
      persistWorkspaces(workspaces);
      // Assign a different animated background for each workspace, cycling through available ones
      const bgIndex = (nextIdx - 1) % BACKGROUND_VIDEOS.length;
      return {
        workspaces,
        activeWorkspaceId: newWs.id,
        backgroundImage: null,
        backgroundVideo: BACKGROUND_VIDEOS[bgIndex].file,
      };
    }),
  removeWorkspace: (id) =>
    set((s) => {
      if (s.workspaces.length <= 1) return s;
      const remaining = s.workspaces.filter((ws) => ws.id !== id);
      const wasActive = s.activeWorkspaceId === id;
      persistence().remove(workspaceKey(id));
      persistWorkspaces(remaining);
      const nextActiveId = wasActive ? remaining[remaining.length - 1].id : s.activeWorkspaceId;
      // If removing the active workspace, load the next one
      if (wasActive) {
        setTimeout(() => {
          useCanvasStore.getState().loadWorkspaceState(nextActiveId).catch((e) => {
            console.warn(`[canvas] reload after remove failed`, e);
          });
        }, 0);
      }
      return { workspaces: remaining, activeWorkspaceId: nextActiveId };
    }),
  switchWorkspace: (id) =>
    set((s) => {
      if (s.activeWorkspaceId === id || !s.workspaces.some((ws) => ws.id === id)) return s;
      // Save current state per-workspace
      const snapshot = {
        version: 1,
        timestamp: Date.now(),
        nodes: s.flowNodes,
        boardMarks: s.boardMarks,
        backgroundImage: s.backgroundImage,
        backgroundVideo: s.backgroundVideo,
        settings: {
          autoArrange: s.autoArrange,
        },
        preview: {
          open: s.previewOpen,
          url: s.previewUrl,
          terminalId: s.previewTerminalId,
          device: s.previewDevice,
        },
        terminals: s.terminals,
      };
      try {
        persistence().write(workspaceKey(s.activeWorkspaceId), JSON.stringify(snapshot));
      } catch (e) {
        console.warn("[canvas] save workspace state failed", e);
      }
      // Load the new workspace state after the set completes
      setTimeout(() => {
        useCanvasStore.getState().loadWorkspaceState(id).catch((e) => {
          console.warn(`[canvas] switch load failed`, e);
        });
      }, 0);
      return { activeWorkspaceId: id };
    }),

  // --- Preview dock ---
  setPreviewOpen: (open) => set({ previewOpen: open }),
  setPreviewUrl: (url) => set({ previewUrl: url }),
  setPreviewTerminal: (terminalId) => set({ previewTerminalId: terminalId }),
  openPreview: (url, terminalId) =>
    set((s) => ({
      previewOpen: true,
      previewUrl: url,
      previewTerminalId: terminalId ?? s.previewTerminalId,
    })),
  closePreview: () => set({ previewOpen: false }),
  cyclePreviewDevice: () =>
    set((s) => ({ previewDevice: s.previewDevice === "desktop" ? "mobile" : "desktop" })),
  addPreviewSuggestion: (suggestion) =>
    set((s) => {
      // De-dupe by url: don't re-offer a URL already pending or already shown.
      const seen = s.previewSuggestions.some((item) => item.url === suggestion.url);
      if (seen) return s;
      return {
        previewSuggestions: [...s.previewSuggestions, { ...suggestion, id: uid() }],
      };
    }),
  dismissPreviewSuggestion: (id) =>
    set((s) => ({ previewSuggestions: s.previewSuggestions.filter((item) => item.id !== id) })),

  setBoardDrawColor: (color) => set({ boardDrawColor: color }),
  setBoardMarks: (marks) => set({ boardMarks: marks }),
  addBoardMark: (mark) => set((s) => ({ boardMarks: [...s.boardMarks, mark] })),
  clearBoardMarks: () => set({ boardMarks: [] }),
  setFlowNodes: (nodes) => set({ flowNodes: nodes }),
  addFlowNode: (node) =>
    set((s) => {
      if (s.flowNodes.some((existing) => existing.id === node.id)) return s;
      return { flowNodes: [...s.flowNodes, node] };
    }),

  // --- Legacy conductor support (internal, not user-facing) ---
  ensureAgent: (agentId) =>
    set((s) =>
      s.agents[agentId]
        ? s
        : { agents: { ...s.agents, [agentId]: empty() } },
    ),

  setStatus: (agentId, status, detail) =>
    set((s) => {
      const a = s.agents[agentId] ?? empty();
      return { agents: { ...s.agents, [agentId]: { ...a, status, detail } } };
    }),

  pushLine: (agentId, role, text) =>
    set((s) => {
      const a = s.agents[agentId] ?? empty();
      const line: TranscriptLine = { id: uid(), role, text };
      return {
        agents: { ...s.agents, [agentId]: { ...a, lines: [...a.lines, line] } },
      };
    }),

  appendDelta: (agentId, delta) =>
    set((s) => {
      const a = s.agents[agentId] ?? empty();
      const lines = a.lines.slice();
      const last = lines[lines.length - 1];
      if (last && last.role === "assistant" && last.streaming) {
        lines[lines.length - 1] = { ...last, text: last.text + delta };
      } else {
        lines.push({ id: uid(), role: "assistant", text: delta, streaming: true });
      }
      return { agents: { ...s.agents, [agentId]: { ...a, lines } } };
    }),

  closeStreaming: (agentId) =>
    set((s) => {
      const a = s.agents[agentId];
      if (!a) return s;
      const lines = a.lines.map((l) =>
        l.streaming ? { ...l, streaming: false } : l,
      );
      return { agents: { ...s.agents, [agentId]: { ...a, lines } } };
    }),

  setStats: (agentId, stats) =>
    set((s) => {
      const a = s.agents[agentId] ?? empty();
      return { agents: { ...s.agents, [agentId]: { ...a, ...stats } } };
    }),

  removeAgent: (agentId) =>
    set((s) => {
      const agents = { ...s.agents };
      delete agents[agentId];
      return { agents };
    }),

  setCommands: (agentId, commands) =>
    set((s) => {
      const a = s.agents[agentId] ?? empty();
      return { agents: { ...s.agents, [agentId]: { ...a, commands } } };
    }),

  // --- Legacy shell shims (forward to terminals) ---
  ensureShell: (shellId, command) =>
    set((s) => ({
      shells: s.shells[shellId] ? s.shells : { ...s.shells, [shellId]: { command, output: "", running: true } },
      terminals: s.terminals[shellId] ? s.terminals : {
        ...s.terminals,
        [shellId]: { kind: "shell", title: "Shell", command, output: "", running: true },
      },
    })),

  shellExit: (shellId, code) => set((s) => {
    const existing = s.terminals[shellId];
    return {
      shells: s.shells[shellId] ? { ...s.shells, [shellId]: { ...s.shells[shellId], running: false, exitCode: code } } : s.shells,
      terminals: existing ? { ...s.terminals, [shellId]: { ...existing, running: false, exitCode: code } } : s.terminals,
    };
  }),

  removeShell: (shellId) => set((s) => {
    const shells = { ...s.shells }; delete shells[shellId];
    const terminals = { ...s.terminals }; delete terminals[shellId];
    return { shells, terminals };
  }),

  ensureTerminal: (terminalId, runtime) =>
    set((s) => {
      const existing = s.terminals[terminalId];
      return {
        terminals: {
          ...s.terminals,
          [terminalId]: existing
            ? {
                ...existing,
                ...runtime,
                running: true,
                exitCode: null,
              }
            : { ...runtime, output: "", running: true, exitCode: null },
        },
      };
    }),

  terminalExit: (terminalId, code) =>
    set((s) => {
      const existing = s.terminals[terminalId];
      if (!existing) return s;
      return {
        terminals: {
          ...s.terminals,
          [terminalId]: { ...existing, running: false, exitCode: code },
        },
      };
    }),

  removeTerminal: (terminalId) =>
    set((s) => {
      const terminals = { ...s.terminals };
      delete terminals[terminalId];
      return { terminals };
    }),

  resetTerminalOutput: (terminalId) =>
    set((s) => {
      const existing = s.terminals[terminalId];
      if (!existing) return s;
      return { terminals: { ...s.terminals, [terminalId]: { ...existing, output: "" } } };
    }),

  removeFlowNode: (id) =>
    set((s) => ({ flowNodes: s.flowNodes.filter((n) => n.id !== id) })),

  saveCanvas: () => {
    try {
      const state = useCanvasStore.getState();
      const snapshot = {
        version: 1,
        timestamp: Date.now(),
        nodes: state.flowNodes,
        boardMarks: state.boardMarks,
        backgroundImage: state.backgroundImage,
        backgroundVideo: state.backgroundVideo,
        settings: {
          autoArrange: state.autoArrange,
        },
        preview: {
          open: state.previewOpen,
          url: state.previewUrl,
          terminalId: state.previewTerminalId,
          device: state.previewDevice,
        },
        // Persist only terminal metadata (kind/title/cwd/…). Live PTY output is
        // never mirrored into the store — it streams straight from the sidecar
        // buffer to xterm — so there is nothing to serialize here.
        terminals: state.terminals,
      };
      const payload = JSON.stringify(snapshot);
      // Write both the global (legacy-compatible) and workspace-scoped copies.
      // The adapter coalesces overlapping writes so a burst of saves only
      // hits disk with the latest snapshot per key.
      persistence().write(CANVAS_STORAGE_KEY, payload);
      try {
        persistence().write(workspaceKey(state.activeWorkspaceId), payload);
      } catch (e) {
        console.warn("[canvas] save failed", e);
      }
    } catch (e) {
      console.warn("[canvas] save failed", e);
    }
  },

  loadCanvas: async () => {
    try {
      // Try loading from active workspace first, fall back to global.
      // The adapter also handles the localStorage→file migration on first
      // read: any old ohcanvas:v1* keys still in localStorage get mirrored
      // to disk and removed, so legacy users don't lose their canvas.
      const activeId = useCanvasStore.getState().activeWorkspaceId || "ws-1";
      let raw = await persistence().read(workspaceKey(activeId));
      if (!raw) raw = await persistence().read(CANVAS_STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as any;
      if (!data?.nodes) return;

      const restoredNodes = (data.nodes as CanvasNode[])
        .filter((node) => node.type !== "agent") // legacy fake agent cards are gone
        .map((node) => {
          if (node.type !== "terminal" && node.type !== "shell") return node;
          const terminalId = String((node.data as Record<string, unknown>).terminalId ?? node.id);
          const saved = (data.terminals as Record<string, TerminalRuntime> | undefined)?.[terminalId];
          if (!saved?.cwd) return node;
          return {
            ...node,
            data: { ...(node.data as Record<string, unknown>), cwd: saved.cwd },
          };
        });

      // Animated video is now the default (static removed).
      // Distinguish:
      // - explicit video filename → use it (clear image)
      // - explicit null → user chose custom static image, keep the image
      // - missing/absent → legacy save → force beautiful default video
      const savedVideo = data.backgroundVideo;
      const hasVideo = typeof savedVideo === "string" && savedVideo.length > 0;
      const explicitNoVideo = savedVideo === null;

      const restoredVideo = hasVideo
        ? savedVideo
        : explicitNoVideo
        ? null
        : DEFAULT_BACKGROUND_VIDEO;

      set({
        flowNodes: restoredNodes,
        boardMarks: Array.isArray(data.boardMarks) ? data.boardMarks : [],
        terminals: (data.terminals as Record<string, TerminalRuntime>) ?? {},
        backgroundImage: hasVideo
          ? null
          : typeof data.backgroundImage === "string"
          ? data.backgroundImage
          : null,
        backgroundVideo: restoredVideo,
        autoArrange: typeof data.settings?.autoArrange === "boolean" ? data.settings.autoArrange : true,
        previewOpen: typeof data.preview?.open === "boolean" ? data.preview.open : false,
        previewUrl: typeof data.preview?.url === "string" ? data.preview.url : "",
        previewTerminalId:
          typeof data.preview?.terminalId === "string" ? data.preview.terminalId : null,
        previewDevice:
          data.preview?.device === "mobile" ? "mobile" : "desktop",
        previewSuggestions: [],
      });

      // Mark restored terminals as not running (real PTY died)
      set((current) => {
        const next: Record<string, TerminalRuntime> = {};
        for (const [id, raw] of Object.entries(current.terminals)) {
          const t = raw as TerminalRuntime;
          next[id] = { ...t, running: false, exitCode: t.exitCode ?? -1 };
        }
        return { terminals: next };
      });
    } catch (e) {
      console.warn("[canvas] load failed", e);
    }
  },

  clearCanvas: () => {
    const activeId = useCanvasStore.getState().activeWorkspaceId;
    persistence().remove(CANVAS_STORAGE_KEY);
    if (activeId) persistence().remove(workspaceKey(activeId));
    // Keep current background when clearing (don't reset to default)
    set({
      flowNodes: [],
      boardMarks: [],
      terminals: {},
      shells: {},
      agents: {},
      previewOpen: false,
      previewUrl: "",
      previewTerminalId: null,
      previewSuggestions: [],
    });
  },
}));
