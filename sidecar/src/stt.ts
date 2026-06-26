/**
 * Speech-to-text manager (sidecar side).
 *
 * The macOS helper (stt/OhCanvasSTT.app) is launched via `open` so that macOS
 * LaunchServices resolves its bundle + Info.plist. This is required for the
 * microphone / speech TCC permission to be granted — a bare Mach-O binary is
 * killed by TCC with __TCC_CRASHING_DUE_TO_PRIVACY_VIOLATION.
 *
 * Because `open` does not expose the child's stdio, we talk to the helper over
 * a Unix domain socket: the sidecar is the client, the helper is the server.
 * Commands are newline-delimited ("start"/"stop"/"quit"); the helper broadcasts
 * one JSON object per line back (status / partial / final).
 */
import { spawn } from "node:child_process";
import { createConnection, type Socket } from "node:net";
import fs from "node:fs";
import path from "node:path";

import type { ServerMsg } from "./protocol.js";

export type Sender = (msg: ServerMsg) => void;

// MUST match the Swift helper's default in stt/main.swift. The helper binds
// `/tmp/ohcanvas-stt-<uid>.sock`, and `open -n` does NOT propagate the
// OHCANVAS_STT_SOCKET env var to the launched .app — so we both default to /tmp.
// (Previously the sidecar used os.tmpdir() = /var/folders/.../T, so the socket
// paths never matched and the helper was unreachable.)
const SOCKET_PATH = `/tmp/ohcanvas-stt-${process.getuid?.() ?? 0}.sock`;
const STT_LOCALE = process.env.STT_LOCALE || "it-IT";

/** Resolve the compiled .app bundle (built via stt/build.sh). */
function resolveAppPath(): string | null {
  const root =
    path.basename(process.cwd()) === "sidecar"
      ? path.resolve(process.cwd(), "..")
      : process.cwd();
  const candidates = [
    path.join(root, "stt", "OhCanvasSTT.app"),
    path.resolve(process.cwd(), "..", "stt", "OhCanvasSTT.app"),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

export class SttManager {
  private send: Sender;
  private socket: Socket | null = null;
  /** guard so we only spawn the helper once until it connects (or fails). */
  private starting = false;
  /** true while the helper is actively transcribing. */
  private listening = false;
  /** interval handle waiting for the socket to come up after `start`. */
  private pendingStart: NodeJS.Timeout | null = null;

  constructor(send: Sender) {
    this.send = send;
  }

  /** Start the helper (if not running) and begin transcribing. */
  start(): void {
    // Already connected -> just send start.
    if (this.socket && !this.listening) {
      this.socket.write("start\n");
      return;
    }
    if (this.listening) return;

    if (!this.socket && !this.starting) {
      this.spawnHelper();
    }
    // Once connected (async), flush a "start" command.
    if (!this.socket) {
      this.pendingStart = setInterval(() => {
        if (this.socket) {
          this.socket.write("start\n");
          if (this.pendingStart) {
            clearInterval(this.pendingStart);
            this.pendingStart = null;
          }
        }
      }, 150);
      setTimeout(() => {
        if (this.pendingStart) {
          clearInterval(this.pendingStart);
          this.pendingStart = null;
        }
      }, 8000);
    }
  }

  /** Stop transcribing (keeps the helper alive for the next session). */
  stop(): void {
    this.socket?.write("stop\n");
  }

  /** Tear everything down. */
  dispose(): void {
    if (this.pendingStart) {
      clearInterval(this.pendingStart);
      this.pendingStart = null;
    }
    this.socket?.write("quit\n");
    this.socket?.destroy();
    this.socket = null;
    this.listening = false;
    this.starting = false;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private spawnHelper(): boolean {
    const appPath = resolveAppPath();
    if (!appPath) {
      this.sendStatus("error", "stt-helper not built — run `bash stt/build.sh`");
      return false;
    }

    this.starting = true;
    this.sendStatus("starting");

    // Launch via `open` so the bundle Info.plist + TCC prompt are honoured.
    spawn("open", ["-n", appPath, "--args", "--locale", STT_LOCALE], { stdio: "ignore", detached: true }).unref();
    this.connectWithRetry();
    return true;
  }

  /** Try to connect to the helper socket, retrying for up to ~8s. */
  private connectWithRetry(attempt = 0): void {
    if (attempt > 40) {
      this.starting = false;
      this.sendStatus("error", "could not reach stt-helper socket");
      return;
    }
    const delay = attempt === 0 ? 150 : 200;
    setTimeout(() => {
      const sock = createConnection(SOCKET_PATH);
      sock.setTimeout(3000);
      sock.once("connect", () => {
        sock.setTimeout(0);
        this.onConnected(sock);
      });
      sock.once("error", () => {
        sock.destroy();
        this.connectWithRetry(attempt + 1);
      });
      sock.once("timeout", () => {
        sock.destroy();
        this.connectWithRetry(attempt + 1);
      });
    }, delay);
  }

  private onConnected(sock: Socket): void {
    this.socket = sock;
    this.starting = false;
    sock.setEncoding("utf8");
    let buf = "";
    sock.on("data", (data: string) => {
      buf += data;
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (line) this.handleLine(line);
      }
    });
    sock.on("close", () => {
      this.socket = null;
      const was = this.listening;
      this.listening = false;
      this.starting = false;
      if (was) this.sendStatus("stopped", "helper disconnected");
    });
    sock.on("error", () => {
      this.socket = null;
      this.listening = false;
      this.starting = false;
    });
  }

  private handleLine(line: string): void {
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line);
    } catch {
      return;
    }
    const type = obj.type as string | undefined;
    if (type === "status") {
      const state = obj.state as string;
      if (state === "listening") this.listening = true;
      else if (state === "stopped" || state === "denied" || state === "error") {
        this.listening = false;
      }
      this.sendStatus(state, obj.message as string | undefined);
    } else if (type === "partial" || type === "final") {
      this.send({
        type: type === "final" ? "stt_final" : "stt_partial",
        text: obj.text as string,
      });
    }
  }

  private sendStatus(state: string, message?: string): void {
    this.send({ type: "stt_status", state, message });
  }
}
