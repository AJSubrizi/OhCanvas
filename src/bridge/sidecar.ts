import { useCanvasStore } from "../state/store";
import {
  type CanvasNodeInfo,
  type ClientMsg,
  type ServerMsg,
  type SpawnAgentMsg,
  type TerminalKind,
  SIDECAR_URL,
} from "./protocol";
import {
  retileTerminalsIfAuto,
  selectTerminalNode,
  spawnBrowserNode,
  spawnNoteNode,
  spawnShapeNode,
  spawnTerminalNode,
  spawnTextNode,
  tileTerminals,
  nextAgentName,
} from "../canvas/nodes";
import { llmComplete, llmSupported } from "../ui/llm";
import { activeWorkspaceProject } from "../ui/projectFolders";

type TerminalOutputListener = (chunk: string) => void;
type SpotifyAuthListener = (payload: { code: string; state: string }) => void;
const TERMINAL_BUFFER_CAP = 20000;

/**
 * Singleton client for the Node sidecar. Routes incoming events into the
 * zustand store and exposes a typed API for canvas nodes and the command bar.
 */
class SidecarClient {
  private ws: WebSocket | null = null;
  private queue: ClientMsg[] = [];
  private reconnectTimer: number | null = null;
  private terminalOutput = new Map<string, string>();
  private terminalListeners = new Map<string, Set<TerminalOutputListener>>();
  private sttFinalListeners = new Set<(text: string) => void>();
  private spotifyAuthListeners = new Set<SpotifyAuthListener>();
  private agentErrorListeners = new Set<(agentId: string, message: string) => void>();
  private attachmentRequests = new Map<string, { resolve: (path: string) => void; reject: (error: Error) => void }>();

  connect() {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    try {
      this.ws = new WebSocket(SIDECAR_URL);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      useCanvasStore.getState().setConnected(true);
      const pending = this.queue;
      this.queue = [];
      pending.forEach((m) => this.send(m));
    };

    this.ws.onclose = () => {
      useCanvasStore.getState().setConnected(false);
      this.scheduleReconnect();
    };

    this.ws.onerror = () => this.ws?.close();

    this.ws.onmessage = (ev) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      this.handle(msg);
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer != null) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 1200);
  }

  private handle(msg: ServerMsg) {
    const s = useCanvasStore.getState();
    switch (msg.type) {
      case "ready":
        break;
      case "spotify_auth_callback":
        for (const listener of this.spotifyAuthListeners) listener({ code: msg.code, state: msg.state });
        break;
      case "agent_status":
        s.setStatus(msg.agentId, msg.status, msg.detail);
        break;
      case "agent_text":
        s.appendDelta(msg.agentId, msg.delta);
        break;
      case "agent_message_end":
        s.closeStreaming(msg.agentId);
        break;
      case "agent_tool":
        if (msg.phase === "start") {
          s.pushLine(
            msg.agentId,
            "tool",
            `↪ ${msg.toolName}${msg.summary ? " " + msg.summary : ""}`,
          );
        }
        break;
      case "agent_turn_end":
        s.closeStreaming(msg.agentId);
        s.setStatus(msg.agentId, "done");
        break;
      case "agent_stats":
        s.setStats(msg.agentId, {
          tokens: msg.tokens,
          cost: msg.cost,
          contextUsage: msg.contextUsage,
        });
        break;
      case "agent_error":
        s.closeStreaming(msg.agentId);
        s.pushLine(msg.agentId, "error", msg.message);
        s.setStatus(msg.agentId, "error", msg.message);
        // Notify subscribers (the command bar surfaces conductor errors).
        for (const listener of this.agentErrorListeners) {
          listener(msg.agentId, msg.message);
        }
        break;
      case "agent_commands":
        s.setCommands(msg.agentId, msg.commands);
        break;

      case "canvas_spawn_browser":
        spawnBrowserNode(msg.url);
        useCanvasStore.getState().pushCanvasActivity(`Opened browser ${msg.url}`);
        break;
      case "canvas_spawn_agent":
        // Always spawn as a real terminal (product direction: no more fake agent cards)
        this.startTerminal({
          kind: msg.agentType ?? "pi",
          title: msg.name,
          cwd: msg.cwd ?? activeWorkspaceProject()?.path ?? undefined,
          initialInput: msg.task,
        });
        useCanvasStore.getState().pushCanvasActivity(`Opened ${msg.name ?? msg.agentType ?? "agent"}`);
        break;
      case "canvas_add_note":
        spawnNoteNode(msg.text, msg.x, msg.y);
        useCanvasStore.getState().pushCanvasActivity("Added note");
        break;
      case "canvas_add_text":
        spawnTextNode(msg.text, msg.x, msg.y);
        useCanvasStore.getState().pushCanvasActivity("Added text");
        break;
      case "canvas_add_shape":
        spawnShapeNode(msg.shape, msg.label, msg.x, msg.y);
        useCanvasStore.getState().pushCanvasActivity(`Added ${msg.shape}`);
        break;
      case "canvas_tile_windows":
        tileTerminals();
        useCanvasStore.getState().pushCanvasActivity("Arranged windows");
        break;
      case "canvas_close_browsers": {
        const store = useCanvasStore.getState();
        const count = store.flowNodes.filter((node) => node.type === "browser").length;
        store.setFlowNodes(store.flowNodes.filter((node) => node.type !== "browser"));
        retileTerminalsIfAuto();
        store.pushCanvasActivity(count ? `Closed ${count} browser preview${count === 1 ? "" : "s"}` : "No browser previews to close");
        break;
      }
      case "canvas_close_terminals": {
        const store = useCanvasStore.getState();
        const ids = new Set<string>();
        Object.keys(store.terminals).forEach((id) => {
          if (id !== msg.exceptTerminalId) ids.add(id);
        });
        store.flowNodes.forEach((node) => {
          if (node.type !== "terminal" && node.type !== "shell") return;
          const data = node.data as Record<string, unknown>;
          const id = String(data.terminalId ?? data.shellId ?? node.id);
          if (id && id !== msg.exceptTerminalId) ids.add(id);
        });
        ids.forEach((id) => this.killTerminal(id));
        store.setFlowNodes(
          store.flowNodes.filter((node) => {
            if (node.type !== "terminal" && node.type !== "shell") return true;
            const data = node.data as Record<string, unknown>;
            const id = String(data.terminalId ?? data.shellId ?? node.id);
            return id === msg.exceptTerminalId;
          }),
        );
        retileTerminalsIfAuto();
        store.pushCanvasActivity(
          ids.size ? `Closed ${ids.size} terminal${ids.size === 1 ? "" : "s"}` : "No terminals to close",
        );
        break;
      }
      case "canvas_focus_terminal":
        selectTerminalNode(msg.terminalId);
        useCanvasStore.getState().pushCanvasActivity(`Focused terminal ${msg.terminalId}`);
        break;
      case "canvas_open_preview":
        useCanvasStore.getState().openPreview(msg.url, msg.terminalId);
        useCanvasStore.getState().pushCanvasActivity(`Opened preview ${msg.url}`);
        break;
      case "canvas_activity":
        useCanvasStore.getState().pushCanvasActivity(msg.text);
        break;

      case "terminal_create":
        s.ensureTerminal(msg.terminalId, {
          kind: msg.kind,
          title: msg.title,
          command: msg.command,
          cwd: msg.cwd,
        });
        spawnTerminalNode({
          terminalId: msg.terminalId,
          kind: msg.kind,
          title: msg.title,
          command: msg.command,
          cwd: msg.cwd,
        });
        break;
      case "terminal_output":
        this.pushTerminalOutput(msg.terminalId, msg.chunk);
        break;
      case "terminal_exit":
        s.terminalExit(msg.terminalId, msg.code);
        break;
      case "terminal_url_detected": {
        // A dev-server URL was detected in the terminal's PTY output. Offer it
        // as a preview (non-invasive toast). Resolve a friendly terminal label.
        const runtime = useCanvasStore.getState().terminals[msg.terminalId];
        const title = runtime?.title ?? "Terminal";
        s.addPreviewSuggestion({ terminalId: msg.terminalId, terminalTitle: title, url: msg.url });
        break;
      }
      case "attachment_saved": {
        const pending = this.attachmentRequests.get(msg.requestId);
        if (!pending) break;
        this.attachmentRequests.delete(msg.requestId);
        pending.resolve(msg.path);
        break;
      }
      case "attachment_error": {
        const pending = this.attachmentRequests.get(msg.requestId);
        if (!pending) break;
        this.attachmentRequests.delete(msg.requestId);
        pending.reject(new Error(msg.message));
        break;
      }

      case "canvas_shell_create":
        // Legacy path — unify to terminal
        s.ensureTerminal(msg.shellId, {
          kind: "shell",
          title: "Shell",
          command: msg.command,
          cwd: msg.cwd,
        });
        spawnTerminalNode({
          terminalId: msg.shellId,
          kind: "shell",
          title: "Shell",
          command: msg.command,
          cwd: msg.cwd,
        });
        break;
      case "shell_output":
        this.pushTerminalOutput(msg.shellId, msg.chunk);
        break;
      case "shell_exit":
        s.terminalExit(msg.shellId, msg.code);
        break;

      case "stt_partial":
        s.setVoicePartial(msg.text);
        break;
      case "stt_final":
        s.setVoicePartial("");
        for (const l of this.sttFinalListeners) l(msg.text);
        break;
      case "stt_status":
        s.setVoiceStatus(msg.state, msg.message);
        if (msg.state === "listening") s.setVoiceListening(true);
        if (["stopped", "denied", "error"].includes(msg.state)) s.setVoiceListening(false);
        // If permission was denied, open the macOS Microphone privacy pane so the
        // user can grant access to the STT helper app (required once, manually,
        // because the helper is ad-hoc signed and TCC won't prompt automatically).
        if (msg.state === "denied") {
          try {
            window.open(
              "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
              "_blank",
            );
          } catch {
            /* ignore — non-macOS / web context */
          }
        }
        break;

      case "llm_conductor_request":
        // The sidecar asks us to run the local SmolLM2 conductor (only the
        // frontend can reach the Tauri plugin IPC). Run it and ship the result
        // back; the sidecar parses OHCANVAS actions from the generated text.
        void this.runConductorRequest(msg.reqId, msg.prompt);
        break;
    }
  }

  private send(msg: ClientMsg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this.queue.push(msg);
      this.connect();
    }
  }

  private pushTerminalOutput(terminalId: string, chunk: string) {
    const previous = this.terminalOutput.get(terminalId) ?? "";
    const next = (previous + chunk).slice(-TERMINAL_BUFFER_CAP);
    this.terminalOutput.set(terminalId, next);
    const listeners = this.terminalListeners.get(terminalId);
    if (!listeners) return;
    for (const listener of listeners) listener(chunk);
  }

  onTerminalOutput(terminalId: string, listener: TerminalOutputListener) {
    let listeners = this.terminalListeners.get(terminalId);
    if (!listeners) {
      listeners = new Set();
      this.terminalListeners.set(terminalId, listeners);
    }
    listeners.add(listener);

    const existing = this.terminalOutput.get(terminalId);
    if (existing) queueMicrotask(() => listener(existing));

    return () => {
      const current = this.terminalListeners.get(terminalId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.terminalListeners.delete(terminalId);
    };
  }

  getTerminalOutput(terminalId: string) {
    return this.terminalOutput.get(terminalId) ?? "";
  }

  // === Legacy conductor-only methods (not for user-visible agents) ===
  spawnAgent(opts: Omit<SpawnAgentMsg, "type">) {
    // Only used by the hidden conductor
    useCanvasStore.getState().ensureAgent(opts.agentId);
    useCanvasStore.getState().setStatus(opts.agentId, "starting");
    this.send({ type: "spawn_agent", ...opts });
  }

  prompt(agentId: string, message: string, streamingBehavior?: "steer" | "followUp") {
    useCanvasStore.getState().pushLine(agentId, "user", message);
    useCanvasStore.getState().setStatus(agentId, "running");
    this.send({ type: "prompt", agentId, message, streamingBehavior });
  }

  stop(agentId: string) {
    this.send({ type: "stop_agent", agentId });
  }

  remove(agentId: string) {
    this.send({ type: "remove_agent", agentId });
    useCanvasStore.getState().removeAgent(agentId);
  }

  startTerminal(args: {
    kind: TerminalKind;
    title?: string;
    command?: string;
    cwd?: string;
    terminalId?: string;
    initialInput?: string;
  }) {
    const hasExplicitCwd = Object.prototype.hasOwnProperty.call(args, "cwd");
    const cwd = hasExplicitCwd ? args.cwd : undefined;
    const title = args.title ?? (args.kind !== "shell" ? nextAgentName() : undefined);
    if (args.terminalId) this.clearTerminalSession(args.terminalId);
    this.send({ type: "start_terminal", ...args, cwd, title });
  }

  /** Clear buffered output before restarting a terminal with the same id. */
  clearTerminalSession(terminalId: string) {
    this.terminalOutput.delete(terminalId);
    useCanvasStore.getState().resetTerminalOutput(terminalId);
    const listeners = this.terminalListeners.get(terminalId);
    if (listeners) {
      for (const listener of listeners) listener("\x1bc");
    }
  }

  startPiTerminal(initialInput?: string) {
    const terminalId = `pi_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    this.startTerminal({ kind: "pi", terminalId, initialInput });
    return terminalId;
  }

  /** @deprecated use startPiTerminal */
  startPiCli(initialInput?: string) {
    return this.startPiTerminal(initialInput);
  }

  writeTerminal(terminalId: string, data: string) {
    this.send({ type: "terminal_input", terminalId, data });
  }

  saveAttachment(dataUrl: string, filename?: string) {
    const requestId = `attachment_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    return new Promise<string>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.attachmentRequests.delete(requestId);
        reject(new Error("Attachment save timed out."));
      }, 8000);
      this.attachmentRequests.set(requestId, {
        resolve: (path) => {
          window.clearTimeout(timeout);
          resolve(path);
        },
        reject: (error) => {
          window.clearTimeout(timeout);
          reject(error);
        },
      });
      this.send({ type: "save_attachment", requestId, dataUrl, filename });
    });
  }

  resizeTerminal(terminalId: string, cols: number, rows: number) {
    this.send({ type: "terminal_resize", terminalId, cols, rows });
  }

  stopTerminal(terminalId: string) {
    this.send({ type: "kill_terminal", terminalId });
  }

  killTerminal(terminalId: string) {
    this.send({ type: "kill_terminal", terminalId });
    const store = useCanvasStore.getState();
    store.removeTerminal(terminalId);
    this.terminalOutput.delete(terminalId);
  }

  /** @deprecated use killTerminal */
  killShell(shellId: string) {
    this.killTerminal(shellId);
  }

  /** @deprecated use stopTerminal */
  stopShell(shellId: string) {
    this.stopTerminal(shellId);
  }

  /** @deprecated use startTerminal */
  startShell(command: string, opts?: { cwd?: string; shellId?: string; initialInput?: string }) {
    this.startTerminal({
      kind: "shell",
      command,
      cwd: opts?.cwd,
      terminalId: opts?.shellId,
      initialInput: opts?.initialInput,
    });
  }

  /** @deprecated use writeTerminal */
  writeShell(shellId: string, input: string) {
    this.writeTerminal(shellId, input);
  }

  /** @deprecated use resizeTerminal */
  resizeShell(shellId: string, cols: number, rows: number) {
    this.resizeTerminal(shellId, cols, rows);
  }

  sendCanvasState(nodes: CanvasNodeInfo[]) {
    this.send({ type: "canvas_state", nodes });
  }

  // ---- speech-to-text + conductor ----
  sttStart() {
    this.send({ type: "stt_start" });
  }

  sttStop() {
    this.send({ type: "stt_stop" });
  }

  /** Subscribe to finalized transcripts. Returns an unsubscribe function. */
  onSttFinal(listener: (text: string) => void) {
    this.sttFinalListeners.add(listener);
    return () => {
      this.sttFinalListeners.delete(listener);
    };
  }

  onSpotifyAuth(listener: SpotifyAuthListener) {
    this.spotifyAuthListeners.add(listener);
    return () => {
      this.spotifyAuthListeners.delete(listener);
    };
  }

  /** Subscribe to agent errors (e.g. the invisible conductor failing). */
  onAgentError(listener: (agentId: string, message: string) => void) {
    this.agentErrorListeners.add(listener);
    return () => {
      this.agentErrorListeners.delete(listener);
    };
  }

  /** Send a natural-language command to the conductor (the LLM brain). */
  conductorInput(text: string) {
    this.send({ type: "conductor_input", text });
  }

  /**
   * Run a SmolLM2 conductor completion requested by the sidecar and ship the
   * result back. The sidecar can't reach Tauri IPC, so it asks the frontend;
   * the frontend runs the local model and returns the generated text, which
   * the sidecar parses into OHCANVAS canvas actions.
   */
  private async runConductorRequest(reqId: string, prompt: string): Promise<void> {
    if (!llmSupported()) {
      this.send({
        type: "llm_conductor_result",
        reqId,
        error: "Local LLM needs the Tauri desktop app.",
      });
      return;
    }
    try {
      const text = await llmComplete(prompt);
      this.send({ type: "llm_conductor_result", reqId, text });
    } catch (err) {
      this.send({
        type: "llm_conductor_result",
        reqId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  getActiveTerminalCount(): number {
    // best effort - sidecar doesn't push counts yet, we can count from store
    return Object.keys(useCanvasStore.getState().terminals).filter(
      (id) => useCanvasStore.getState().terminals[id]?.running,
    ).length;
  }
}

export const sidecar = new SidecarClient();
