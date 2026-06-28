import { spawn, type ChildProcess } from "node:child_process";
import os from "node:os";
import type { AgentType, CanvasNodeInfo, ServerMsg } from "./protocol.ts";
import { parseCanvasActionLine, type CanvasCliAction } from "./canvas-actions.ts";
import { runCanvasAction } from "./conductor-action.ts";

/**
 * Best-effort adapter for CLI coding agents. Each prompt runs the CLI in a
 * non-interactive print mode and streams stdout into the agent card.
 */
interface CliConfig {
  /** Build the shell command line for a one-shot prompt. */
  command: (prompt: string, sessionId: string) => string;
  label: string;
}

const CONFIGS: Partial<Record<AgentType, CliConfig>> = {
  pi: {
    label: "Pi CLI",
    command: (p, sessionId) => `pi --session-id ${shq(sessionId)} -p ${shq(p)}`,
  },
  cursor: { label: "Cursor CLI", command: (p) => `cursor-agent --print ${shq(p)}` },
  "claude-code": { label: "Claude CLI", command: (p) => `claude -p ${shq(p)}` },
  codex: { label: "Codex CLI", command: (p) => `codex exec ${shq(p)}` },
};

function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function withCanvasContext(message: string, cwd: string, nodes: CanvasNodeInfo[]): string {
  const canvas =
    nodes.length === 0
      ? "Canvas is currently empty."
      : nodes
          .map((n) =>
            n.kind === "terminal"
              ? `- terminal "${n.title}" (id ${n.id}) — an agent you can address by name`
              : `- ${n.kind} ${n.id}: ${n.title} at ${Math.round(n.x)},${Math.round(n.y)}`,
          )
          .join("\n");

  return [
    "You are the conductor inside OhCanvas. The user directs an army of named CLI agents.",
    `Your working folder: ${cwd}`,
    "Each terminal may have its own folder. Do not assume a shared workspace unless agents were opened in the same folder.",
    "Each terminal is a named agent (e.g. Vale, North). To delegate a task to one, send it as input by name.",
    "If the user asks to open a browser, preview, web page, localhost, or a browser window, use open_browser. Do not send that request to a terminal.",
    "Current canvas:",
    canvas,
    "",
    "To act, print EXACTLY ONE line starting with OHCANVAS followed by a single compact JSON. Output nothing else before or after that line (no thinking, no prose, no ```). Examples:",
    'OHCANVAS {"action":"send_terminal","name":"Vale","input":"refactor the hero section"}',
    'OHCANVAS {"action":"run_shell","command":"pnpm dev"}',
    'OHCANVAS {"action":"open_browser","url":"http://localhost:3000"}',
    'OHCANVAS {"action":"open_preview","url":"http://localhost:3000"}',
    'OHCANVAS {"action":"spawn_agent","agentType":"pi","name":"Wren","task":"write tests","cwd":"/path/to/project"}',
    'OHCANVAS {"action":"broadcast_terminal","input":"run pnpm test"}',
    'OHCANVAS {"action":"tile_windows"}',
    'OHCANVAS {"action":"close_browsers"}',
    'OHCANVAS {"action":"add_note","text":"Next: polish the hero section"}',
    'OHCANVAS {"action":"kill_terminal","terminalId":"term_xxx"}',
    "Prefer send_terminal to delegate to an existing named agent. Do not wrap OHCANVAS lines in markdown fences.",
    "",
    "User request:",
    message,
  ].join("\n");
}

export interface ExternalRunnerDeps {
  send: (msg: ServerMsg) => void;
  getCanvasState: () => CanvasNodeInfo[];
  runShell: (command: string, cwd?: string) => string;
  killTerminal?: (terminalId: string) => void;
  writeTerminal?: (terminalId: string, input: string) => void;
}

export class ExternalRunner {
  private child: ChildProcess | null = null;
  private stdoutBuffer = "";
  private stderrBuffer = "";

  constructor(
    private agentId: string,
    private agentType: AgentType,
    private cwd: string,
    private deps: ExternalRunnerDeps,
  ) {}

  get supported(): boolean {
    return this.agentType in CONFIGS;
  }

  prompt(message: string): void {
    const cfg = CONFIGS[this.agentType];
    if (!cfg) {
      this.deps.send({
        type: "agent_error",
        agentId: this.agentId,
        message: `No CLI invocation configured for ${this.agentType}.`,
      });
      return;
    }
    if (this.child) {
      this.deps.send({
        type: "agent_error",
        agentId: this.agentId,
        message: "This agent is still running the previous task.",
      });
      return;
    }

    this.stdoutBuffer = "";
    this.stderrBuffer = "";

    const prompt = withCanvasContext(message, this.cwd, this.deps.getCanvasState());
    const cmd = cfg.command(prompt, this.agentId);
    this.deps.send({ type: "agent_status", agentId: this.agentId, status: "running" });
    this.deps.send({
      type: "agent_tool",
      agentId: this.agentId,
      phase: "start",
      toolName: cfg.label,
      summary: this.cwd,
    });

    let child: ChildProcess;
    try {
      child = spawn(cmd, {
        shell: true,
        cwd: this.cwd || os.homedir(),
        env: process.env,
      });
    } catch (err) {
      this.fail((err as Error).message);
      return;
    }
    this.child = child;

    child.stdout?.on("data", (c: Buffer) => this.handleChunk("stdout", c));
    child.stderr?.on("data", (c: Buffer) => this.handleChunk("stderr", c));
    child.on("error", (err) => this.fail(err.message));
    child.on("close", (code) => {
      this.child = null;
      this.flushOutputBuffers();
      this.deps.send({ type: "agent_message_end", agentId: this.agentId });
      if (code && code !== 0) {
        this.deps.send({
          type: "agent_error",
          agentId: this.agentId,
          message: `${this.agentType} exited with code ${code}. Is the CLI installed and authenticated?`,
        });
      }
      this.deps.send({ type: "agent_turn_end", agentId: this.agentId });
    });
  }

  private handleChunk(kind: "stdout" | "stderr", chunk: Buffer): void {
    const text = chunk.toString();
    const next = (kind === "stdout" ? this.stdoutBuffer : this.stderrBuffer) + text;
    const lines = next.split(/\r?\n/);
    const remainder = lines.pop() ?? "";
    if (kind === "stdout") this.stdoutBuffer = remainder;
    else this.stderrBuffer = remainder;

    for (const line of lines) {
      this.handleLine(line);
    }
  }

  private flushOutputBuffers(): void {
    if (this.stdoutBuffer) {
      this.handleLine(this.stdoutBuffer);
      this.stdoutBuffer = "";
    }
    if (this.stderrBuffer) {
      this.handleLine(this.stderrBuffer);
      this.stderrBuffer = "";
    }
  }

  private handleLine(line: string): void {
    const parsed = parseCanvasActionLine(line);
    if (parsed.kind === "none") {
      this.deps.send({ type: "agent_text", agentId: this.agentId, delta: `${line}\n` });
      return;
    }
    if (parsed.kind === "invalid") {
      this.deps.send({ type: "agent_text", agentId: this.agentId, delta: `${line}\n` });
      this.deps.send({ type: "agent_error", agentId: this.agentId, message: parsed.error });
      return;
    }
    this.executeCanvasAction(parsed.action);
  }

  private executeCanvasAction(action: CanvasCliAction): void {
    const summary = runCanvasAction(action, this.deps, this.agentId);
    this.deps.send({
      type: "agent_tool",
      agentId: this.agentId,
      phase: "start",
      toolName: `canvas.${action.action}`,
      summary: summary.slice(0, 120),
    });
  }

  private fail(msg: string): void {
    this.child = null;
    this.deps.send({
      type: "agent_error",
      agentId: this.agentId,
      message: `Could not run ${this.agentType}: ${msg}`,
    });
  }

  abort(): void {
    this.child?.kill("SIGTERM");
    this.child = null;
  }

  dispose(): void {
    this.abort();
  }
}
