// Wire protocol between the React frontend and this sidecar.
// Mirror of src/bridge/protocol.ts — keep both in sync.

export type AgentType = "pi" | "claude-code" | "cursor" | "codex" | "hermes";

export interface SpawnAgentMsg {
  type: "spawn_agent";
  agentId: string;
  name: string;
  agentType: AgentType;
  provider?: string;
  model?: string;
  cwd?: string;
}

export interface PromptMsg {
  type: "prompt";
  agentId: string;
  message: string;
  streamingBehavior?: "steer" | "followUp";
}

export interface StopAgentMsg {
  type: "stop_agent";
  agentId: string;
}

export interface RemoveAgentMsg {
  type: "remove_agent";
  agentId: string;
}

export interface CanvasNodeInfo {
  id: string;
  kind: "browser" | "shell" | "terminal" | "note" | "text" | "shape";
  title: string;
  x: number;
  y: number;
  /** For terminal nodes */
  terminalKind?: TerminalKind;
}

export interface CanvasStateMsg {
  type: "canvas_state";
  nodes: CanvasNodeInfo[];
}

export interface KillShellMsg {
  type: "kill_shell";
  shellId: string;
}

export interface StartShellMsg {
  type: "start_shell";
  command: string;
  cwd?: string;
  shellId?: string;
  initialInput?: string;
}

export interface ShellInputMsg {
  type: "shell_input";
  shellId: string;
  input: string;
}

export interface ShellResizeMsg {
  type: "shell_resize";
  shellId: string;
  cols: number;
  rows: number;
}

export type TerminalKind = "pi" | "shell" | "claude-code" | "cursor" | "codex" | "hermes";

export interface StartTerminalMsg {
  type: "start_terminal";
  terminalId?: string;
  kind: TerminalKind;
  title?: string;
  command?: string;
  cwd?: string;
  initialInput?: string;
}

export interface TerminalInputMsg {
  type: "terminal_input";
  terminalId: string;
  data: string;
}

export interface TerminalResizeMsg {
  type: "terminal_resize";
  terminalId: string;
  cols: number;
  rows: number;
}

export interface KillTerminalMsg {
  type: "kill_terminal";
  terminalId: string;
}

export interface SttStartMsg {
  type: "stt_start";
}
export interface SttStopMsg {
  type: "stt_stop";
}
export interface ConductorInputMsg {
  type: "conductor_input";
  text: string;
  cwd?: string;
}

export interface SaveAttachmentMsg {
  type: "save_attachment";
  requestId: string;
  dataUrl: string;
  filename?: string;
}

/**
 * Frontend → sidecar: result of a conductor LLM completion. The sidecar asked
 * the frontend to run SmolLM2 (via `llm_conductor_request`); this carries the
 * generated text (or an error) back so the sidecar can parse OHCANVAS actions.
 */
export interface LlmConductorResultMsg {
  type: "llm_conductor_result";
  reqId: string;
  text?: string;
  error?: string;
}

export type ClientMsg =
  | SpawnAgentMsg
  | PromptMsg
  | StopAgentMsg
  | RemoveAgentMsg
  | CanvasStateMsg
  | KillShellMsg
  | StartShellMsg
  | ShellInputMsg
  | ShellResizeMsg
  | StartTerminalMsg
  | TerminalInputMsg
  | TerminalResizeMsg
  | KillTerminalMsg
  | SttStartMsg
  | SttStopMsg
  | ConductorInputMsg
  | SaveAttachmentMsg
  | LlmConductorResultMsg;

export const CONDUCTOR_ID = "__conductor__";

export type AgentStatusValue =
  | "idle"
  | "starting"
  | "running"
  | "done"
  | "error";

export interface AgentCommand {
  name: string;
  description: string;
}

export type ServerMsg =
  | { type: "ready" }
  | { type: "spotify_auth_callback"; code: string; state: string }
  | { type: "agent_status"; agentId: string; status: AgentStatusValue; detail?: string }
  | { type: "agent_text"; agentId: string; delta: string }
  | { type: "agent_message_end"; agentId: string }
  | { type: "agent_tool"; agentId: string; phase: "start" | "end"; toolName: string; summary?: string }
  | { type: "agent_turn_end"; agentId: string }
  | { type: "agent_stats"; agentId: string; tokens?: number; cost?: number; contextUsage?: number }
  | { type: "agent_error"; agentId: string; message: string }
  | { type: "agent_commands"; agentId: string; commands: AgentCommand[] }
  | { type: "canvas_spawn_browser"; url: string; title?: string }
  | { type: "canvas_spawn_agent"; agentType?: TerminalKind; name?: string; model?: string; task?: string; cwd?: string }
  | { type: "canvas_add_note"; text: string; x?: number; y?: number }
  | { type: "canvas_add_text"; text: string; x?: number; y?: number }
  | { type: "canvas_add_shape"; shape: "rect" | "ellipse"; label?: string; x?: number; y?: number }
  | { type: "canvas_shell_create"; shellId: string; command: string; cwd?: string }
  | { type: "shell_output"; shellId: string; chunk: string }
  | { type: "shell_exit"; shellId: string; code: number | null }
  | { type: "terminal_create"; terminalId: string; kind: TerminalKind; title: string; command: string; cwd?: string }
  | { type: "terminal_output"; terminalId: string; chunk: string }
  | { type: "terminal_exit"; terminalId: string; code: number | null }
  | { type: "terminal_url_detected"; terminalId: string; url: string }
  | { type: "attachment_saved"; requestId: string; path: string }
  | { type: "attachment_error"; requestId: string; message: string }
  | { type: "stt_status"; state: string; message?: string }
  | { type: "stt_partial"; text: string }
  | { type: "stt_final"; text: string }
  | { type: "llm_conductor_request"; reqId: string; prompt: string };

export const SIDECAR_PORT = 8787;
