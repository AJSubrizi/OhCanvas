import type { TerminalKind } from "../bridge/protocol";

export type CliKind = Exclude<TerminalKind, "shell">;

export const CLI_OPTIONS: { kind: CliKind; label: string; aliases: string[] }[] = [
  { kind: "pi", label: "Pi", aliases: ["pi", "pai", "piai"] },
  { kind: "codex", label: "Codex", aliases: ["codex", "openai"] },
  { kind: "claude-code", label: "Claude", aliases: ["claude", "cloud", "claude code", "claude-code"] },
  { kind: "cursor", label: "Cursor", aliases: ["cursor"] },
  { kind: "hermes", label: "Hermes", aliases: ["hermes", "ermes", "ermès"] },
];

export function labelForCli(kind: TerminalKind) {
  if (kind === "shell") return "Shell";
  return CLI_OPTIONS.find((option) => option.kind === kind)?.label ?? kind;
}

export function parseCliKind(text: string): CliKind | null {
  const normalized = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[-_]/g, " ");

  const words = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  const haystack = ` ${words.join(" ")} `;

  for (const option of CLI_OPTIONS) {
    for (const alias of option.aliases) {
      const aliasWords = alias.toLowerCase().replace(/[-_]/g, " ");
      if (haystack.includes(` ${aliasWords} `)) return option.kind;
    }
  }

  return null;
}
