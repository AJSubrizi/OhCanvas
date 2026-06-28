//! Shared conductor logic: the OHCANVAS system prompt + a free-function version
//! of the canvas-action executor.
//!
//! Both the user-facing CLI agents (`ExternalRunner`) and the internal SmolLM2
//! conductor turn natural language into canvas actions by emitting OHCANVAS
//! lines. This module holds the prompt builder and the action runner so neither
//! caller has to depend on `ExternalRunner`.

import type { CanvasNodeInfo, ServerMsg } from "./protocol.ts";
import { CONDUCTOR_ID } from "./protocol.ts";
import type { CanvasCliAction } from "./canvas-actions.ts";

/** Deps needed to execute an OHCANVAS action against the canvas. */
export interface CanvasActionDeps {
  send: (msg: ServerMsg) => void;
  getCanvasState: () => CanvasNodeInfo[];
  runShell: (command: string, cwd?: string) => string;
  killTerminal?: (terminalId: string) => void;
  writeTerminal?: (terminalId: string, input: string) => void;
}

/**
 * Build the OHCANVAS system prompt the conductor uses. Same instructions the
 * Pi-backed conductor used, so any model (Pi or SmolLM2) emits the same
 * `OHCANVAS {…}` action lines the parser understands.
 */
export function buildConductorPrompt(message: string, cwd: string, nodes: CanvasNodeInfo[]): string {
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
    "If the user asks for multiple things, emit one OHCANVAS line per action.",
    "",
    "User request:",
    message,
  ].join("\n");
}

/** SmolLM2 is an instruct model: wrap the prompt in its chat template.
 *
 * We force-start the assistant response with "OHCANVAS {" so the 135M model
 * only has to complete the JSON object (action + fields). The generated text
 * will be the continuation after that prefix; the receiver reconstructs the
 * full OHCANVAS line for the parser.
 */
export function wrapSmolLm2Chat(systemPrompt: string): string {
  // SmolLM2-135M-Instruct uses the ChatML-style template with these tokens.
  return [
    "<|im_start|>system",
    systemPrompt,
    "<|im_end|>",
    "<|im_start|>assistant",
    "OHCANVAS {",
  ].join("\n");
}

/**
 * Run a single parsed OHCANVAS action. Mirrors `ExternalRunner.executeCanvasAction`
 * but as a free function so the SmolLM2 conductor (which is not an ExternalRunner)
 * can reuse it. Returns a short human-readable summary for logging/feedback.
 */
export function runCanvasAction(
  action: CanvasCliAction,
  deps: CanvasActionDeps,
  agentId = CONDUCTOR_ID,
): string {
  switch (action.action) {
    case "open_browser": {
      deps.send({ type: "canvas_spawn_browser", url: action.url, title: action.title });
      return `Open browser ${action.url}`;
    }
    case "run_shell": {
      const shellId = deps.runShell(action.command, action.cwd);
      return `Run shell ${action.command.slice(0, 60)} (${shellId})`;
    }
    case "spawn_agent": {
      deps.send({
        type: "canvas_spawn_agent",
        agentType: action.agentType,
        name: action.name,
        task: action.task,
        cwd: action.cwd,
      });
      return `Spawn ${action.name ?? action.agentType ?? "agent"}`;
    }
    case "add_note": {
      deps.send({ type: "canvas_add_note", text: action.text, x: action.x, y: action.y });
      return "Add note";
    }
    case "add_text": {
      deps.send({ type: "canvas_add_text", text: action.text, x: action.x, y: action.y });
      return "Add text";
    }
    case "add_shape": {
      deps.send({
        type: "canvas_add_shape",
        shape: action.shape,
        label: action.label,
        x: action.x,
        y: action.y,
      });
      return `Add ${action.shape}`;
    }
    case "kill_terminal": {
      deps.killTerminal?.(action.terminalId);
      deps.send({ type: "canvas_activity", text: `Closed terminal ${action.terminalId}` });
      return `Kill ${action.terminalId}`;
    }
    case "focus_terminal": {
      deps.send({ type: "canvas_focus_terminal", terminalId: action.terminalId });
      return `Focus ${action.terminalId}`;
    }
    case "send_terminal": {
      let terminalId = action.terminalId;
      if (!terminalId && action.name) {
        const match = findTerminalByName(deps.getCanvasState(), action.name);
        terminalId = match?.id;
      }
      if (!terminalId) {
        deps.send({
          type: "agent_error",
          agentId,
          message: `No terminal named "${action.name ?? action.terminalId}" on the canvas.`,
        });
        return `No terminal "${action.name ?? action.terminalId}"`;
      }
      deps.writeTerminal?.(terminalId, ensureSubmit(action.input));
      deps.send({
        type: "canvas_activity",
        text: `Sent to ${action.name ?? terminalId}: ${action.input.slice(0, 80)}`,
      });
      return `Send to ${action.name ?? terminalId}`;
    }
    case "broadcast_terminal": {
      const targets = deps
        .getCanvasState()
        .filter((n) => n.kind === "terminal")
        .filter((n) => n.id !== action.excludeTerminalId)
        .filter((n) => !action.kind || n.terminalKind === action.kind);
      for (const target of targets) deps.writeTerminal?.(target.id, ensureSubmit(action.input));
      deps.send({
        type: "canvas_activity",
        text: `Broadcast to ${targets.length} terminal${targets.length === 1 ? "" : "s"}`,
      });
      return `Broadcast to ${targets.length} terminal${targets.length === 1 ? "" : "s"}`;
    }
    case "tile_windows": {
      deps.send({ type: "canvas_tile_windows" });
      return "Tile windows";
    }
    case "close_browsers": {
      deps.send({ type: "canvas_close_browsers" });
      return "Close browsers";
    }
    case "close_terminals": {
      let exceptTerminalId = action.exceptTerminalId;
      if (!exceptTerminalId && action.exceptName) {
        exceptTerminalId = findTerminalByName(deps.getCanvasState(), action.exceptName)?.id;
      }
      deps.send({ type: "canvas_close_terminals", exceptTerminalId });
      return exceptTerminalId ? `Close terminals except ${exceptTerminalId}` : "Close terminals";
    }
    case "open_preview": {
      deps.send({ type: "canvas_open_preview", url: action.url, terminalId: action.terminalId });
      return `Open preview ${action.url}`;
    }
  }
}

export function findTerminalByName(nodes: CanvasNodeInfo[], name: string): CanvasNodeInfo | undefined {
  const wanted = normalizeName(name);
  return nodes.find((n) => {
    if (n.kind !== "terminal") return false;
    const title = normalizeName(n.title);
    const id = normalizeName(n.id);
    return title === wanted || id === wanted || title.startsWith(wanted) || title.includes(wanted);
  });
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+·\s+.*/, "")
    .replace(/[^a-z0-9_-]+/g, " ")
    .trim();
}

function ensureSubmit(input: string): string {
  return /[\r\n]$/.test(input) ? input : `${input}\r`;
}
