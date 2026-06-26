import test from "node:test";
import assert from "node:assert/strict";
import { buildTerminalCommand, shellQuote } from "./terminal-commands.ts";

test("builds Pi command with stable session id", () => {
  assert.deepEqual(buildTerminalCommand("pi", "pi_abc"), {
    command: "pi --session-id 'pi_abc'",
    title: "Pi",
  });
});

test("quotes session ids safely", () => {
  assert.equal(shellQuote("a'b"), "'a'\\''b'");
});

test("builds shell command from provided command", () => {
  assert.deepEqual(buildTerminalCommand("shell", "term_1", "pnpm dev"), {
    command: "pnpm dev",
    title: "Shell",
  });
});

test("builds secondary external agent commands", () => {
  assert.equal(buildTerminalCommand("codex", "term_2").command, "codex");
  assert.equal(buildTerminalCommand("claude-code", "term_3").command, "claude");
  assert.equal(buildTerminalCommand("cursor", "term_4").command, "cursor-agent");
});
