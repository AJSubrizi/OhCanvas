import path from "node:path";
import fs from "node:fs";
import type {
  CanvasNodeInfo,
  ClientMsg,
  ServerMsg,
  SpawnAgentMsg,
} from "./protocol.ts";
import { CONDUCTOR_ID } from "./protocol.ts";
import { TerminalManager } from "./terminals.ts";
import { ExternalRunner, type ExternalRunnerDeps } from "./external-agent.ts";
import { SttManager } from "./stt.ts";
import {
  buildConductorPrompt,
  runCanvasAction,
  wrapSmolLm2Chat,
  type CanvasActionDeps,
} from "./conductor-action.ts";
import { parseCanvasActionLine, type CanvasCliAction } from "./canvas-actions.ts";

type AgentHandle = { runner: ExternalRunner };

const DEFAULT_WORKSPACE =
  process.env.CANVAS_WORKSPACE ??
  (path.basename(process.cwd()) === "sidecar"
    ? path.resolve(process.cwd(), "..")
    : process.cwd());

/** A pending conductor completion waiting for the frontend's LLM result. */
interface PendingConductor {
  cwd: string;
}

function ensureTerminalSubmit(input: string): string {
  return /[\r\n]$/.test(input) ? input : `${input}\r`;
}

/**
 * Hosts CLI agents (legacy one-shot cards) and PTY-backed terminal sessions.
 */
export class Orchestrator {
  private agents = new Map<string, AgentHandle>();
  private terminals: TerminalManager;
  private canvasState: CanvasNodeInfo[] = [];
  private stt: SttManager;
  /** Pending SmolLM2 conductor completions, keyed by request id. */
  private pendingConductor = new Map<string, PendingConductor>();

  constructor(private send: (msg: ServerMsg) => void) {
    this.terminals = new TerminalManager(send, (sourceTerminalId, action) =>
      this.runTerminalCanvasAction(sourceTerminalId, action),
    );
    this.stt = new SttManager(send);
  }

  /** Shared deps for CLI runners (canvas control plane). */
  private runnerDeps(cwd: string): ExternalRunnerDeps {
    return {
      send: this.send,
      getCanvasState: () => this.canvasState,
      runShell: (command, requestedCwd) =>
        this.terminals.start({ kind: "shell", command, cwd: requestedCwd ?? cwd }),
      killTerminal: (terminalId) => this.terminals.kill(terminalId),
      writeTerminal: (terminalId, input) => this.terminals.write(terminalId, ensureTerminalSubmit(input)),
    };
  }

  /** Canvas-action deps bound to a cwd, used by the SmolLM2 conductor. */
  private conductorDeps(cwd: string): CanvasActionDeps {
    return {
      send: this.send,
      getCanvasState: () => this.canvasState,
      runShell: (command, requestedCwd) =>
        this.terminals.start({ kind: "shell", command, cwd: requestedCwd ?? cwd }),
      killTerminal: (terminalId) => this.terminals.kill(terminalId),
      writeTerminal: (terminalId, input) => this.terminals.write(terminalId, ensureTerminalSubmit(input)),
    };
  }

  /** Execute OHCANVAS lines printed by real interactive PTY terminals. */
  private runTerminalCanvasAction(sourceTerminalId: string, action: CanvasCliAction): string {
    return runCanvasAction(action, this.conductorDeps(DEFAULT_WORKSPACE), sourceTerminalId);
  }

  async handle(msg: ClientMsg): Promise<void> {
    switch (msg.type) {
      case "spawn_agent":
        return this.spawn(msg);
      case "prompt":
        return this.prompt(msg.agentId, msg.message, msg.streamingBehavior);
      case "stop_agent": {
        const h = this.agents.get(msg.agentId);
        h?.runner.abort();
        return;
      }
      case "remove_agent":
        return this.remove(msg.agentId);
      case "canvas_state":
        this.canvasState = msg.nodes;
        return;
      case "start_terminal":
        this.terminals.start(msg);
        return;
      case "terminal_input":
        this.terminals.write(msg.terminalId, msg.data);
        return;
      case "terminal_resize":
        this.terminals.resize(msg.terminalId, msg.cols, msg.rows);
        return;
      case "kill_terminal":
        this.terminals.kill(msg.terminalId);
        return;
      case "start_shell":
        this.terminals.start({
          terminalId: msg.shellId,
          kind: "shell",
          command: msg.command,
          cwd: msg.cwd,
          initialInput: msg.initialInput,
        });
        return;
      case "shell_input":
        this.terminals.write(msg.shellId, msg.input);
        return;
      case "shell_resize":
        this.terminals.resize(msg.shellId, msg.cols, msg.rows);
        return;
      case "kill_shell":
        this.terminals.kill(msg.shellId);
        return;
      case "stt_start":
        this.stt.start();
        return;
      case "stt_stop":
        this.stt.stop();
        return;
      case "conductor_input":
        return this.runConductor(msg.text, msg.cwd);
      case "llm_conductor_result":
        return this.handleLlmResult(msg.reqId, msg.text, msg.error);
      case "save_attachment":
        return this.saveAttachment(msg.requestId, msg.dataUrl, msg.filename);
    }
  }

  private async saveAttachment(requestId: string, dataUrl: string, filename = "ohcanvas-preview.svg"): Promise<void> {
    try {
      const match = dataUrl.match(/^data:([^;,]+)(;base64)?,(.*)$/);
      if (!match) throw new Error("Unsupported attachment data.");

      const [, mime, base64, payload] = match;
      const allowed = new Set(["image/svg+xml", "image/png", "image/jpeg", "image/webp"]);
      if (!allowed.has(mime)) throw new Error("Only image attachments are supported.");

      const ext =
        mime === "image/svg+xml" ? ".svg" :
        mime === "image/png" ? ".png" :
        mime === "image/jpeg" ? ".jpg" :
        ".webp";
      const safeBase = filename
        .replace(/\.[a-z0-9]+$/i, "")
        .replace(/[^a-z0-9._-]+/gi, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80) || "ohcanvas-preview";
      const dir = path.join(DEFAULT_WORKSPACE, ".ohcanvas", "attachments");
      fs.mkdirSync(dir, { recursive: true });

      const filePath = path.join(dir, `${safeBase}-${Date.now().toString(36)}${ext}`);
      const buffer = base64 ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload), "utf8");
      fs.writeFileSync(filePath, buffer);
      this.send({ type: "attachment_saved", requestId, path: filePath });
    } catch (error) {
      this.send({
        type: "attachment_error",
        requestId,
        message: error instanceof Error ? error.message : "Failed to save attachment.",
      });
    }
  }

  /**
   * The conductor "brain". Instead of spawning the Pi CLI, we route the request
   * through the frontend to the local SmolLM2 model (via `tauri-plugin-llm`).
   * The sidecar can't reach Tauri IPC directly, so we ask the frontend to run
   * the completion and send the result back via `llm_conductor_result`.
   *
   * The router is intentionally invisible — no terminal is spawned. Feedback
   * flows back through `lastCanvasAction` and the agent-error channel.
   */
  private runConductor(text: string, cwd = DEFAULT_WORKSPACE): void {
    const prompt = buildConductorPrompt(text, cwd, this.canvasState);
    const chat = wrapSmolLm2Chat(prompt);
    const reqId = `conductor_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    this.pendingConductor.set(reqId, { cwd });
    this.send({ type: "llm_conductor_request", reqId, prompt: chat });
  }

  /** Frontend returned the SmolLM2 completion — parse OHCANVAS lines & act. */
  private handleLlmResult(reqId: string, text: string | undefined, error: string | undefined): void {
    const pending = this.pendingConductor.get(reqId);
    this.pendingConductor.delete(reqId);
    const cwd = pending?.cwd ?? DEFAULT_WORKSPACE;

    if (error || typeof text !== "string") {
      this.send({
        type: "agent_error",
        agentId: CONDUCTOR_ID,
        message: error || "conductor (SmolLM2) returned no output",
      });
      return;
    }

    // SmolLM2 prompt ends with force-prefix "OHCANVAS {"; the model emits only
    // the JSON continuation (e.g. `"action":"open_browser",...}`). Reconstruct
    // a full parseable "OHCANVAS {json}" line. Also collapse internal newlines
    // so pretty-printed JSON still parses as a single OHCANVAS line.
    let effective = text;
    const t = text.trim();
    if (!t.startsWith("OHCANVAS")) {
      const jsonPart = t.replace(/^[\s{]+/, "");
      effective = `OHCANVAS {${jsonPart}`;
    }
    // Collapse whitespace inside the OHCANVAS payload (handles multi-line JSON).
    effective = effective.replace(/(OHCANVAS\s*\{)[\s\S]*$/, (m) =>
      m.replace(/\s+/g, " ")
    );

    const deps = this.conductorDeps(cwd);
    let actions = 0;
    let lastSummary = "";
    let firstError: string | null = null;

    for (const line of effective.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parsed = parseCanvasActionLine(trimmed);
      if (parsed.kind === "none") {
        // Plain prose from the model — ignore. (Only OHCANVAS lines matter.)
        continue;
      }
      if (parsed.kind === "invalid") {
        if (!firstError) firstError = parsed.error;
        continue;
      }
      lastSummary = runCanvasAction(parsed.action, deps);
      actions += 1;
    }

    // Surface a concise outcome so the UI flash reflects what actually happened.
    if (actions > 0) {
      this.send({
        type: "canvas_add_note",
        text: actions > 1 ? `Conductor: ${actions} actions (${lastSummary})` : `Conductor: ${lastSummary}`,
        x: undefined,
        y: undefined,
      });
    } else if (firstError) {
      this.send({ type: "agent_error", agentId: CONDUCTOR_ID, message: firstError });
    } else {
      this.send({
        type: "agent_error",
        agentId: CONDUCTOR_ID,
        message: "conductor (SmolLM2) didn't emit any OHCANVAS action",
      });
    }
  }

  private async spawn(msg: SpawnAgentMsg): Promise<void> {
    if (this.agents.has(msg.agentId)) return;

    const cwd = msg.cwd ?? DEFAULT_WORKSPACE;
    try {
      fs.mkdirSync(cwd, { recursive: true });
    } catch {
      /* ignore */
    }

    const runner = new ExternalRunner(msg.agentId, msg.agentType, cwd, this.runnerDeps(cwd));
    this.agents.set(msg.agentId, { runner });
    this.send({
      type: "agent_status",
      agentId: msg.agentId,
      status: runner.supported ? "idle" : "error",
      detail: runner.supported ? `${msg.agentType} CLI` : `${msg.agentType} not configured`,
    });
  }

  private async prompt(
    agentId: string,
    message: string,
    _streamingBehavior?: "steer" | "followUp",
  ): Promise<void> {
    const h = this.agents.get(agentId);
    if (!h) {
      this.send({ type: "agent_error", agentId, message: "Agent is not ready yet." });
      return;
    }

    h.runner.prompt(message);
  }

  private remove(agentId: string): void {
    const h = this.agents.get(agentId);
    if (!h) return;
    try {
      h.runner.dispose();
    } catch {
      /* ignore */
    }
    this.agents.delete(agentId);
  }

  disposeAll(): void {
    for (const id of [...this.agents.keys()]) this.remove(id);
    this.terminals.killAll();
    this.stt.dispose();
    // No conductor process to dispose — SmolLM2 runs in the Rust plugin and
    // is cleaned up when the app exits. Just drop any pending requests.
    this.pendingConductor.clear();
  }
}
