import type { AgentType } from "./protocol.ts";

export type TerminalKind = AgentType | "shell";

export interface TerminalCommandSpec {
  command: string;
  title: string;
}

export function buildTerminalCommand(kind: TerminalKind, terminalId: string, command?: string): TerminalCommandSpec {
  switch (kind) {
    case "pi":
      return {
        command: `pi --session-id ${shellQuote(terminalId)}`,
        title: "Pi",
      };
    case "shell":
      return {
        command: command && command.trim() ? command : loginShellCommand(),
        title: command && command.trim() ? "Shell" : "Terminal",
      };
    case "codex":
      return {
        command: "codex",
        title: "Codex",
      };
    case "claude-code":
      return {
        command: "claude",
        title: "Claude Code",
      };
    case "cursor":
      return {
        command: "cursor-agent",
        title: "Cursor Agent",
      };
    case "hermes":
      return {
        command: "hermes",
        title: "Hermes",
      };
  }
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function loginShellCommand(): string {
  return process.env.SHELL || "/bin/zsh";
}
