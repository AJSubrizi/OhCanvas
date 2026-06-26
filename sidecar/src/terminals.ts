import os from "node:os";
import path from "node:path";
import pty, { type IPty } from "@lydell/node-pty";
import type { ServerMsg, TerminalKind } from "./protocol.ts";
import { buildTerminalCommand } from "./terminal-commands.ts";

let counter = 0;
export const newTerminalId = (prefix = "term") => `${prefix}_${Date.now().toString(36)}_${counter++}`;

/** Expand a leading ~ (or ~/) to the user's home directory. */
function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(os.homedir(), p.slice(2));
  return p;
}

// Strip ANSI/VT escape sequences so URL detection works on clean text.
// Also strips other common CSI sequences (cursor moves, etc.).
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\x1b[=>]/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

// Detect a dev-server URL in a line of PTY output.
// Matches:
//   - explicit http(s)://localhost:PORT  / 127.0.0.1:PORT  / 0.0.0.0:PORT
//   - bare "localhost:PORT" / "0.0.0.0:PORT" (vite sometimes prints without scheme)
// Returns the normalized http:// URL, or null.
const URL_RE =
  /(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::(\d{1,5}))?(?:\/[^\s]*)?/i;
function detectDevServerUrl(line: string): string | null {
  const clean = stripAnsi(line).trim();
  const match = clean.match(URL_RE);
  if (!match) return null;
  // Require a port — otherwise "localhost" alone is noise (prompts, PS1, etc.).
  const port = match[1];
  if (!port) return null;
  const raw = match[0];
  if (/^https?:\/\//i.test(raw)) return raw.replace(/\/$/, "");
  return `http://${raw.replace(/\/$/, "")}`;
}

export interface StartTerminalOptions {
  terminalId?: string;
  kind: TerminalKind;
  title?: string;
  command?: string;
  cwd?: string;
  initialInput?: string;
}

export function resolveTerminalWorkdir(cwd?: string): string {
  return cwd && cwd.trim() ? expandHome(cwd.trim()) : os.homedir();
}

export class TerminalManager {
  private procs = new Map<string, IPty>();
  // Per-terminal line buffer for dev-server URL detection. PTY chunks can split
  // a single line (and thus a URL) across onData callbacks, so we accumulate
  // bytes and only scan complete lines.
  private lineBuffers = new Map<string, string>();
  // Per-terminal set of URLs already reported, to avoid spamming the frontend
  // with the same detection every time the dev server recompiles/restarts.
  private reportedUrls = new Map<string, Set<string>>();

  constructor(private send: (msg: ServerMsg) => void) {}

  start(opts: StartTerminalOptions): string {
    const terminalId = opts.terminalId ?? newTerminalId(opts.kind);
    const workdir = resolveTerminalWorkdir(opts.cwd);
    const built = buildTerminalCommand(opts.kind, terminalId, opts.command);
    const title = opts.title ?? built.title;

    this.send({
      type: "terminal_create",
      terminalId,
      kind: opts.kind,
      title,
      command: built.command,
      cwd: workdir,
    });

    let child: IPty;
    try {
      const shell = process.env.SHELL || "/bin/zsh";
      const spawnEnv = {
        ...process.env,
        TERM: "xterm-256color",
        // Help some CLIs detect they are not in a full TTY
        FORCE_COLOR: process.env.FORCE_COLOR ?? "1",
      } as Record<string, string>;

      child = pty.spawn(shell, ["-lc", built.command], {
        name: "xterm-256color",
        cols: 100,
        rows: 30,
        cwd: path.resolve(workdir),
        env: spawnEnv,
      });
    } catch (err) {
      this.send({
        type: "terminal_output",
        terminalId,
        chunk: `failed to start: ${err instanceof Error ? err.message : String(err)}\r\n`,
      });
      this.send({ type: "terminal_exit", terminalId, code: -1 });
      return terminalId;
    }

    this.procs.set(terminalId, child);
    child.onData((chunk) => {
      // Forward raw output to the terminal renderer (unchanged behavior).
      this.send({ type: "terminal_output", terminalId, chunk });
      // In parallel, scan complete lines for a dev-server URL. Non-blocking:
      // detection only emits an extra message when a NEW url is found.
      this.scanForDevServerUrl(terminalId, chunk);
    });
    if (opts.initialInput) child.write(`${opts.initialInput}\r`);
    child.onExit(({ exitCode }) => {
      this.procs.delete(terminalId);
      this.lineBuffers.delete(terminalId);
      this.reportedUrls.delete(terminalId);
      this.send({ type: "terminal_exit", terminalId, code: exitCode });
    });

    return terminalId;
  }

  write(terminalId: string, data: string): void {
    const child = this.procs.get(terminalId);
    if (!child) {
      // Silent when closed (prevents spam on explicit × close)
      return;
    }
    try {
      child.write(data);
    } catch (err) {
      this.send({
        type: "terminal_output",
        terminalId,
        chunk: `\r\n[write error]\r\n`,
      });
    }
  }

  resize(terminalId: string, cols: number, rows: number): void {
    const child = this.procs.get(terminalId);
    if (!child) return;
    try {
      child.resize(Math.max(2, cols), Math.max(2, rows));
    } catch {
      // ignore transient resize errors during teardown
    }
  }

  kill(terminalId: string): void {
    const child = this.procs.get(terminalId);
    if (!child) return;
    try {
      // Prevent noisy "terminal closed" messages on explicit user close
      child.kill();
    } catch {}
    this.procs.delete(terminalId);
    this.lineBuffers.delete(terminalId);
    this.reportedUrls.delete(terminalId);
  }

  killAll(): void {
    for (const id of [...this.procs.keys()]) this.kill(id);
  }

  getActiveCount(): number {
    return this.procs.size;
  }

  listActive(): string[] {
    return [...this.procs.keys()];
  }

  /**
   * Accumulate raw PTY bytes per terminal, scan each complete line for a
   * dev-server URL, and emit terminal_url_detected once per unique URL.
   * A line is "complete" when terminated by \n (or \r alone, for CR-only PTYs).
   */
  private scanForDevServerUrl(terminalId: string, chunk: string): void {
    const prev = this.lineBuffers.get(terminalId) ?? "";
    const acc = prev + chunk;
    // Split on newlines, keeping a possible trailing partial line buffered.
    const parts = acc.split(/\r?\n/);
    const remainder = parts.pop() ?? "";
    this.lineBuffers.set(terminalId, remainder);
    const reported = this.reportedUrls.get(terminalId) ?? new Set<string>();
    for (const line of parts) {
      const url = detectDevServerUrl(line);
      if (!url) continue;
      if (reported.has(url)) continue;
      reported.add(url);
      this.reportedUrls.set(terminalId, reported);
      this.send({ type: "terminal_url_detected", terminalId, url });
    }
  }
}
