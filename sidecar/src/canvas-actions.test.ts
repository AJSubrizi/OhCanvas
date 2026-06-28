import test from "node:test";
import assert from "node:assert/strict";
import { parseCanvasActionLine } from "./canvas-actions.ts";

test("ignores ordinary output", () => {
  assert.deepEqual(parseCanvasActionLine("hello world"), {
    kind: "none",
    line: "hello world",
  });
});

test("parses open_browser action", () => {
  assert.deepEqual(
    parseCanvasActionLine('OHCANVAS {"action":"open_browser","url":"http://localhost:3000","title":"Preview"}'),
    {
      kind: "action",
      action: { action: "open_browser", url: "http://localhost:3000", title: "Preview" },
    },
  );
});

test("parses run_shell action", () => {
  assert.deepEqual(
    parseCanvasActionLine('OHCANVAS {"action":"run_shell","command":"pnpm dev","cwd":"/tmp/app"}'),
    {
      kind: "action",
      action: { action: "run_shell", command: "pnpm dev", cwd: "/tmp/app" },
    },
  );
});

test("rejects invalid json", () => {
  const parsed = parseCanvasActionLine("OHCANVAS {");
  assert.equal(parsed.kind, "invalid");
  if (parsed.kind === "invalid") {
    assert.match(parsed.error, /Invalid OHCANVAS JSON/);
  }
});

test("rejects unsupported agent type", () => {
  const parsed = parseCanvasActionLine('OHCANVAS {"action":"spawn_agent","agentType":"unknown"}');
  assert.equal(parsed.kind, "invalid");
  if (parsed.kind === "invalid") {
    assert.equal(parsed.error, "Unsupported agentType: unknown");
  }
});

test("parses spawn_agent with cwd", () => {
  const parsed = parseCanvasActionLine(
    'OHCANVAS {"action":"spawn_agent","agentType":"codex","name":"Vale","cwd":"/tmp/app"}',
  );
  assert.equal(parsed.kind, "action");
  if (parsed.kind === "action") {
    assert.equal(parsed.action.action, "spawn_agent");
    assert.equal(parsed.action.agentType, "codex");
    assert.equal(parsed.action.name, "Vale");
    assert.equal(parsed.action.cwd, "/tmp/app");
  }
});

test("parses hermes spawn_agent", () => {
  const parsed = parseCanvasActionLine('OHCANVAS {"action":"spawn_agent","agentType":"hermes","name":"Scout"}');
  assert.equal(parsed.kind, "action");
  if (parsed.kind === "action") {
    assert.equal(parsed.action.action, "spawn_agent");
    assert.equal(parsed.action.agentType, "hermes");
  }
});

test("parses kill_terminal action", () => {
  const parsed = parseCanvasActionLine('OHCANVAS {"action":"kill_terminal","terminalId":"term_abc123"}');
  assert.deepEqual(parsed, {
    kind: "action",
    action: { action: "kill_terminal", terminalId: "term_abc123" },
  });
});

test("rejects kill_terminal without id", () => {
  const parsed = parseCanvasActionLine('OHCANVAS {"action":"kill_terminal"}');
  assert.equal(parsed.kind, "invalid");
});

test("parses broadcast_terminal with kind filter", () => {
  assert.deepEqual(parseCanvasActionLine('OHCANVAS {"action":"broadcast_terminal","input":"run tests","kind":"cursor"}'), {
    kind: "action",
    action: { action: "broadcast_terminal", input: "run tests", kind: "cursor", excludeTerminalId: undefined },
  });
});

test("parses window control actions", () => {
  assert.deepEqual(parseCanvasActionLine('OHCANVAS {"action":"tile_windows"}'), {
    kind: "action",
    action: { action: "tile_windows" },
  });
  assert.deepEqual(parseCanvasActionLine('OHCANVAS {"action":"close_browsers"}'), {
    kind: "action",
    action: { action: "close_browsers" },
  });
  assert.deepEqual(parseCanvasActionLine('OHCANVAS {"action":"close_terminals","exceptName":"Codex"}'), {
    kind: "action",
    action: { action: "close_terminals", exceptName: "Codex", exceptTerminalId: undefined },
  });
});

test("parses open_preview action", () => {
  assert.deepEqual(parseCanvasActionLine('OHCANVAS {"action":"open_preview","url":"http://localhost:5173"}'), {
    kind: "action",
    action: { action: "open_preview", url: "http://localhost:5173", terminalId: undefined },
  });
});
