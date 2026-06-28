import type { AgentType } from "./protocol.ts";

export type CanvasCliAction =
  | { action: "open_browser"; url: string; title?: string }
  | { action: "run_shell"; command: string; cwd?: string }
  | { action: "spawn_agent"; agentType?: AgentType; name?: string; task?: string; cwd?: string }
  | { action: "add_note"; text: string; x?: number; y?: number }
  | { action: "add_text"; text: string; x?: number; y?: number }
  | { action: "add_shape"; shape: "rect" | "ellipse"; label?: string; x?: number; y?: number }
  | { action: "kill_terminal"; terminalId: string }
  | { action: "focus_terminal"; terminalId: string }
  | { action: "send_terminal"; name?: string; terminalId?: string; input: string }
  | { action: "broadcast_terminal"; input: string; excludeTerminalId?: string; kind?: AgentType | "shell" }
  | { action: "tile_windows" }
  | { action: "close_browsers" }
  | { action: "close_terminals"; exceptTerminalId?: string; exceptName?: string }
  | { action: "open_preview"; url: string; terminalId?: string };

export type ParsedCanvasLine =
  | { kind: "none"; line: string }
  | { kind: "action"; action: CanvasCliAction }
  | { kind: "invalid"; line: string; error: string };

const PREFIX = "OHCANVAS ";

export function parseCanvasActionLine(line: string): ParsedCanvasLine {
  if (!line.startsWith(PREFIX)) return { kind: "none", line };

  const raw = line.slice(PREFIX.length).trim();
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (err) {
    return {
      kind: "invalid",
      line,
      error: `Invalid OHCANVAS JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!value || typeof value !== "object") {
    return { kind: "invalid", line, error: "OHCANVAS payload must be an object." };
  }

  const obj = value as Record<string, unknown>;
  switch (obj.action) {
    case "open_browser": {
      if (typeof obj.url !== "string" || obj.url.trim() === "") {
        return { kind: "invalid", line, error: "open_browser requires a non-empty url." };
      }
      return {
        kind: "action",
        action: {
          action: "open_browser",
          url: obj.url,
          title: typeof obj.title === "string" ? obj.title : undefined,
        },
      };
    }
    case "run_shell": {
      if (typeof obj.command !== "string" || obj.command.trim() === "") {
        return { kind: "invalid", line, error: "run_shell requires a non-empty command." };
      }
      return {
        kind: "action",
        action: {
          action: "run_shell",
          command: obj.command,
          cwd: typeof obj.cwd === "string" ? obj.cwd : undefined,
        },
      };
    }
    case "spawn_agent": {
      const agentType = typeof obj.agentType === "string" ? obj.agentType : undefined;
      if (agentType && !["codex", "claude-code", "cursor", "pi", "hermes"].includes(agentType)) {
        return { kind: "invalid", line, error: `Unsupported agentType: ${agentType}` };
      }
      return {
        kind: "action",
        action: {
          action: "spawn_agent",
          agentType: agentType as AgentType | undefined,
          name: typeof obj.name === "string" ? obj.name : undefined,
          task: typeof obj.task === "string" ? obj.task : undefined,
          cwd: typeof obj.cwd === "string" ? obj.cwd : undefined,
        },
      };
    }
    case "add_note": {
      if (typeof obj.text !== "string") {
        return { kind: "invalid", line, error: "add_note requires text." };
      }
      return {
        kind: "action",
        action: {
          action: "add_note",
          text: obj.text,
          x: numberOrUndefined(obj.x),
          y: numberOrUndefined(obj.y),
        },
      };
    }
    case "add_text": {
      if (typeof obj.text !== "string") {
        return { kind: "invalid", line, error: "add_text requires text." };
      }
      return {
        kind: "action",
        action: {
          action: "add_text",
          text: obj.text,
          x: numberOrUndefined(obj.x),
          y: numberOrUndefined(obj.y),
        },
      };
    }
    case "add_shape": {
      if (obj.shape !== "rect" && obj.shape !== "ellipse") {
        return { kind: "invalid", line, error: "add_shape requires shape rect or ellipse." };
      }
      return {
        kind: "action",
        action: {
          action: "add_shape",
          shape: obj.shape,
          label: typeof obj.label === "string" ? obj.label : undefined,
          x: numberOrUndefined(obj.x),
          y: numberOrUndefined(obj.y),
        },
      };
    }
    case "kill_terminal": {
      if (typeof obj.terminalId !== "string" || !obj.terminalId) {
        return { kind: "invalid", line, error: "kill_terminal requires terminalId." };
      }
      return { kind: "action", action: { action: "kill_terminal", terminalId: obj.terminalId } };
    }
    case "focus_terminal": {
      if (typeof obj.terminalId !== "string" || !obj.terminalId) {
        return { kind: "invalid", line, error: "focus_terminal requires terminalId." };
      }
      return { kind: "action", action: { action: "focus_terminal", terminalId: obj.terminalId } };
    }
    case "send_terminal": {
      if (typeof obj.input !== "string" || obj.input === "") {
        return { kind: "invalid", line, error: "send_terminal requires a non-empty input." };
      }
      const name = typeof obj.name === "string" ? obj.name : undefined;
      const terminalId = typeof obj.terminalId === "string" ? obj.terminalId : undefined;
      if (!name && !terminalId) {
        return { kind: "invalid", line, error: "send_terminal requires name or terminalId." };
      }
      return {
        kind: "action",
        action: { action: "send_terminal", name, terminalId, input: obj.input },
      };
    }
    case "broadcast_terminal": {
      if (typeof obj.input !== "string" || obj.input === "") {
        return { kind: "invalid", line, error: "broadcast_terminal requires a non-empty input." };
      }
      const kind = typeof obj.kind === "string" ? obj.kind : undefined;
      if (kind && !["codex", "claude-code", "cursor", "pi", "hermes", "shell"].includes(kind)) {
        return { kind: "invalid", line, error: `Unsupported terminal kind: ${kind}` };
      }
      return {
        kind: "action",
        action: {
          action: "broadcast_terminal",
          input: obj.input,
          excludeTerminalId: typeof obj.excludeTerminalId === "string" ? obj.excludeTerminalId : undefined,
          kind: kind as AgentType | "shell" | undefined,
        },
      };
    }
    case "tile_windows":
      return { kind: "action", action: { action: "tile_windows" } };
    case "close_browsers":
      return { kind: "action", action: { action: "close_browsers" } };
    case "close_terminals":
      return {
        kind: "action",
        action: {
          action: "close_terminals",
          exceptTerminalId: typeof obj.exceptTerminalId === "string" ? obj.exceptTerminalId : undefined,
          exceptName: typeof obj.exceptName === "string" ? obj.exceptName : undefined,
        },
      };
    case "open_preview": {
      if (typeof obj.url !== "string" || obj.url.trim() === "") {
        return { kind: "invalid", line, error: "open_preview requires a non-empty url." };
      }
      return {
        kind: "action",
        action: {
          action: "open_preview",
          url: obj.url,
          terminalId: typeof obj.terminalId === "string" ? obj.terminalId : undefined,
        },
      };
    }
    default:
      return { kind: "invalid", line, error: "Unsupported OHCANVAS action." };
  }
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
