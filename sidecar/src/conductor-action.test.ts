import test from "node:test";
import assert from "node:assert/strict";
import { findTerminalByName, runCanvasAction } from "./conductor-action.ts";
import type { CanvasNodeInfo, ServerMsg } from "./protocol.ts";

const nodes: CanvasNodeInfo[] = [
  { id: "term_codex_1", kind: "terminal", title: "Codex · /Users/me/app", x: 0, y: 0 },
  { id: "term_claude_1", kind: "terminal", title: "Claude Code", x: 0, y: 0 },
  { id: "note_1", kind: "note", title: "Claude note", x: 0, y: 0 },
];

test("findTerminalByName matches title prefix and ignores non-terminals", () => {
  assert.equal(findTerminalByName(nodes, "Codex")?.id, "term_codex_1");
  assert.equal(findTerminalByName(nodes, "claude")?.id, "term_claude_1");
  assert.equal(findTerminalByName(nodes, "note"), undefined);
});

test("send_terminal resolves by name and appends enter", () => {
  const sent: ServerMsg[] = [];
  const writes: Array<{ terminalId: string; input: string }> = [];

  const summary = runCanvasAction(
    { action: "send_terminal", name: "Claude", input: "pnpm test" },
    {
      send: (msg) => sent.push(msg),
      getCanvasState: () => nodes,
      runShell: () => "shell_1",
      writeTerminal: (terminalId, input) => writes.push({ terminalId, input }),
    },
  );

  assert.equal(summary, "Send to Claude");
  assert.deepEqual(sent, []);
  assert.deepEqual(writes, [{ terminalId: "term_claude_1", input: "pnpm test\r" }]);
});
