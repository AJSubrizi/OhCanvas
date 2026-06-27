import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { memo, useEffect, useRef, useState } from "react";
import { sidecar } from "../../bridge/sidecar";
import type { TerminalKind } from "../../bridge/protocol";
import { useCanvasStore } from "../../state/store";
import { retileTerminalsIfAuto } from "../nodes";
import type { CanvasNodeProps } from "../types";
import {
  CheckIcon,
  CloseIcon,
  CopyIcon,
  FolderIcon,
  RestartIcon,
} from "../../ui/icons";

export interface TerminalNodeData {
  terminalId: string;
  kind: TerminalKind;
  title: string;
  command: string;
  cwd?: string;
  legacyShellId?: string;
  [key: string]: unknown;
}

function TerminalNode({ id, data }: CanvasNodeProps<TerminalNodeData>) {
  const d = data;
  const runtime = useCanvasStore((s: any) => s.terminals[d.terminalId]);
  const hostRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const lastSizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const lastLiveSetRef = useRef<number>(0);
  const [copied, setCopied] = useState(false);
  const [compact, setCompact] = useState(false);
  const [live, setLive] = useState(false);
  const liveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || terminalRef.current) return;

    const terminal = new Terminal({
      allowProposedApi: false,
      allowTransparency: true, // let the frosted card show through (CNVS-style window)
      cursorBlink: true,
      convertEol: false,
      // 3000 lines is plenty for "scroll back to read the last build error"
      // or copy a recent command. xterm.js default is 1000; the old 8000
      // (~1 MB per terminal at ~120 B/line) cost ~6 MB of RAM with 10
      // terminals open — most users never scrolled that far back anyway.
      scrollback: 3000,
      fontFamily: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace',
      fontSize: 12,
      lineHeight: 1.22,
      theme: {
        background: "rgba(8, 11, 20, 0)",
        foreground: "#dbe2f7",
        cursor: "#f8fafc",
        selectionBackground: "#334155",
        black: "#0f172a",
        red: "#f87171",
        green: "#4ade80",
        yellow: "#fbbf24",
        blue: "#7c9cff",
        magenta: "#c084fc",
        cyan: "#67e8f9",
        white: "#e5e7eb",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    terminal.focus();

    terminal.onData((dataChunk) => sidecar.writeTerminal(d.terminalId, dataChunk));

    // Batch xterm writes for performance (high-frequency output from PTY can cause jank)
    // Using array + join avoids quadratic string concat in hot path
    let outputChunks: string[] = [];
    let writeScheduled = false;
    const scheduleWrite = () => {
      if (writeScheduled) return;
      writeScheduled = true;
      requestAnimationFrame(() => {
        if (outputChunks.length) {
          terminal.write(outputChunks.join(""));
          outputChunks = [];
        }
        writeScheduled = false;
      });
    };

    const unsubscribeOutput = sidecar.onTerminalOutput(d.terminalId, (chunk) => {
      outputChunks.push(chunk);
      scheduleWrite();

      // Throttled "live" indicator to avoid re-render spam on bursty output
      if (chunk && chunk !== "\x1bc") {
        const now = Date.now();
        if (now - (lastLiveSetRef.current || 0) > 300) {  // max once every ~300ms
          lastLiveSetRef.current = now;
          setLive(true);
          if (liveTimerRef.current != null) window.clearTimeout(liveTimerRef.current);
          liveTimerRef.current = window.setTimeout(() => setLive(false), 1200);
        }
      }
    });

    const resize = () => {
      if (resizeFrameRef.current != null) return;
      resizeFrameRef.current = requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        try {
          const width = rootRef.current?.clientWidth ?? host.clientWidth;
          setCompact(width < 420);
          if (width < 420) terminal.options.fontSize = 11;
          else terminal.options.fontSize = 12;
          fit.fit();
          const next = { cols: terminal.cols, rows: terminal.rows };
          const last = lastSizeRef.current;
          if (!last || last.cols !== next.cols || last.rows !== next.rows) {
            lastSizeRef.current = next;
            sidecar.resizeTerminal(d.terminalId, next.cols, next.rows);
          }
        } catch {
          // The overlay frame can briefly report zero-sized bounds while resizing.
        }
      });
    };

    const observer = new ResizeObserver(resize);
    observer.observe(host);
    if (rootRef.current) observer.observe(rootRef.current);
    requestAnimationFrame(resize);

    terminalRef.current = terminal;

    return () => {
      unsubscribeOutput();
      if (resizeFrameRef.current != null) cancelAnimationFrame(resizeFrameRef.current);
      if (liveTimerRef.current != null) window.clearTimeout(liveTimerRef.current);
      observer.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      resizeFrameRef.current = null;
      lastSizeRef.current = null;
      lastLiveSetRef.current = 0;
      liveTimerRef.current = null;
    };
  }, [d.terminalId]);

  const running = runtime?.running ?? true;
  const title = runtime?.title ?? d.title;
  const cwd = runtime?.cwd ?? d.cwd;
  const copyOutput = async () => {
    await navigator.clipboard.writeText(sidecar.getTerminalOutput(d.terminalId));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  const restart = () => {
    // Kill existing if running, then start fresh with same id + cwd
    if (running) {
      sidecar.stopTerminal(d.terminalId);
    }
    // Small delay so the kill is processed
    setTimeout(() => {
      sidecar.startTerminal({
        terminalId: d.terminalId,
        kind: d.kind,
        command: d.command,
        cwd,
        title,
      });
    }, 80);
  };

  return (
    <div
      ref={rootRef}
      className={`terminal-node terminal-node--${d.kind} ${compact ? "terminal-node--compact" : ""} ${live && running ? "live" : ""}`}
    >
      <div className="terminal-node__chrome">
        <span
          className={`terminal-node__avatar terminal-node__avatar--${d.kind}`}
          title={running ? (live ? "Outputting" : "Running") : "Exited"}
          aria-hidden="true"
        >
          {markFor(d.kind)}
          <span
            className={`terminal-node__avatar-dot ${
              running ? (live ? "is-live" : "is-running") : "is-done"
            }`}
          />
        </span>
        <span className="terminal-node__title" title={title}>{title}</span>
        {d.kind !== "shell" && (
          <span className={`terminal-node__badge terminal-node__badge--${d.kind}`}>
            {badgeLabel(d.kind)}
          </span>
        )}
        {cwd && (
          <span className="terminal-node__path" title={cwd}>
            <FolderIcon className="terminal-node__path-icon" size={10} />
            <span className="terminal-node__path-text">{shortPath(cwd)}</span>
          </span>
        )}
        {!cwd && d.kind !== "shell" && (
          <span className="terminal-node__path" title="No specific folder">~</span>
        )}
        <span className="agent-card__spacer" />
        {!compact && (
          <button className="terminal-node__btn nodrag" onClick={copyOutput} title="Copy output" aria-label="Copy output">
            {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
          </button>
        )}
        <button
          className="terminal-node__btn nodrag"
          onClick={restart}
          title={running ? "Restart this terminal (same folder)" : "Restart in same folder"}
          aria-label="Restart terminal"
        >
          <RestartIcon size={13} />
        </button>
        <button
          className="terminal-node__btn terminal-node__btn--close nodrag"
          onClick={() => {
            sidecar.killTerminal(d.terminalId);
            useCanvasStore.getState().removeFlowNode(id);
            retileTerminalsIfAuto();
          }}
          title="Close terminal"
          aria-label="Close terminal"
        >
          <CloseIcon size={13} />
        </button>
        {!running && <span className="terminal-node__status">exited</span>}
      </div>
      <div
        ref={hostRef}
        className="terminal-node__surface nodrag nowheel"
        tabIndex={-1}
        onMouseDown={(event) => {
          event.stopPropagation();
          terminalRef.current?.focus();
        }}
        onDoubleClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      />
    </div>
  );
}

export default memo(TerminalNode);

function badgeLabel(kind: TerminalKind): string {
  if (kind === "pi") return "Pi";
  if (kind === "claude-code") return "Claude";
  if (kind === "codex") return "Codex";
  if (kind === "cursor") return "Cursor";
  if (kind === "hermes") return "Hermes";
  return "Shell";
}

/** A small distinctive glyph per CLI for the header avatar. */
function markFor(kind: TerminalKind): string {
  if (kind === "pi") return "π";
  if (kind === "claude-code") return "✦";
  if (kind === "codex") return "⬡";
  if (kind === "cursor") return "➤";
  if (kind === "hermes") return "ʜ";
  return "❯";
}

function shortPath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length === 0) return path;
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : parts.join("/");
}
