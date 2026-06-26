import test from "node:test";
import assert from "node:assert/strict";
import { resolveTerminalWorkdir } from "./terminals.ts";

test("resolveTerminalWorkdir uses explicit cwd", () => {
  assert.equal(resolveTerminalWorkdir("/tmp/project"), "/tmp/project");
});

test("resolveTerminalWorkdir falls back to homedir", () => {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  assert.equal(resolveTerminalWorkdir(), home || resolveTerminalWorkdir());
});
