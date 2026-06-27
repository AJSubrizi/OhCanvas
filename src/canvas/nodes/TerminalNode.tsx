import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { memo, useEffect, useRef, useState } from "react";
import { sidecar } from "../../bridge/sidecar";
import type { TerminalKind } from "../../bridge/protocol";
import { useCanvasStore } from "../../state/store";
import { retileTerminalsIfAuto, subscribeToViewport, getLatestViewportRect } from "../nodes";
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

    // Offscreen culling: when the terminal node is scrolled out of the
    // viewport (Canvas is infinite, most terminals are off-screen at any
    // given moment), skip xterm.write() — the user can't see the output
    // anyway, and each write triggers a render. We accumulate chunks in a
    // bounded offscreen buffer; when the terminal becomes visible again
    // we replay the buffer in a single write() call. xterm serializes
    // write() calls internally, so live output that arrives mid-replay
    // gets queued behind it without any extra coordination.
    //
    // Buffer cap: ~512 KB covers more than the 3000-line scrollback
    // (~360 KB at ~120 B/line) so the user can still scroll back to the
    // last visible content when the terminal returns. Older chunks are
    // dropped FIFO — if a terminal stays offscreen long enough to
    // overflow, the user loses the earliest chunks, which is the same
    // behavior xterm's own scrollback trim would have produced anyway.
    let isVisible = true;
    let offscreenBuffer: string[] = [];
    let offscreenBytes = 0;
    const OFFSCREEN_CAP_BYTES = 512 * 1024;
    const MAX_OFFSCREEN_CHUNKS = 4096; // belt-and-suspenders against pathological bursts

    const scheduleWrite = () => {
      if (writeScheduled) return;
      if (!isVisible) return; // skip RAF — chunks are already in offscreenBuffer
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
      if (!isVisible) {
        // Track FIFO drop: if appending would overflow the cap, shift the
        // oldest chunk first. Bounded cost (one shift per overflow).
        offscreenBuffer.push(chunk);
        offscreenBytes += chunk.length;
        while (
          (offscreenBytes > OFFSCREEN_CAP_BYTES || offscreenBuffer.length > MAX_OFFSCREEN_CHUNKS) &&
          offscreenBuffer.length > 0
        ) {
          const dropped = offscreenBuffer.shift()!;
          offscreenBytes -= dropped.length;
        }
        return;
      }
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

    // Offscreen culling: subscribe to the canvas viewport, compute this
    // terminal's intersection against it, and toggle `isVisible` accordingly.
    // On transition hidden→visible, replay the offscreen buffer in one big
    // write() so the terminal catches up to the latest output.
    //
    // The subscription is module-level (not gated on Canvas having registered
    // its imperative API) so we can attach from inside the child useEffect —
    // React fires child effects before parent effects, so a Canvas-gated
    // subscribe would miss the initial registration.
    const recomputeVisibility = (rect: { x: number; y: number; width: number; height: number } | null) => {
      if (!rect) return;
      const node = useCanvasStore.getState().flowNodes.find(
        (n) => n.id === d.terminalId || (n.data as Record<string, unknown> | undefined)?.terminalId === d.terminalId,
      );
      const nw = Number(node?.style?.width ?? 540);
      const nh = Number(node?.style?.height ?? 320);
      const nx = node?.position.x ?? 0;
      const ny = node?.position.y ?? 0;
      // AABB intersection in canvas coordinates.
      const nextVisible =
        nx + nw >= rect.x &&
        ny + nh >= rect.y &&
        nx <= rect.x + rect.width &&
        ny <= rect.y + rect.height;
      if (nextVisible === isVisible) return;
      isVisible = nextVisible;
      if (isVisible && offscreenBuffer.length) {
        // Replay the accumulated chunks in a single write; xterm serializes
        // writes internally so any chunk that arrives mid-replay gets queued
        // behind it without extra coordination.
        terminal.write(offscreenBuffer.join(""));
        offscreenBuffer = [];
        offscreenBytes = 0;
      }
    };
    const unsubscribeViewport = subscribeToViewport(recomputeVisibility);

    // Visibility also depends on this node's own position (user drags,
    // auto-tile moves it). Re-check on any flowNodes change that affects
    // our row. The selector is intentionally narrow so we don't re-run on
    // every canvas mutation — only on terminal moves.
    const unsubscribeFlowNodes = useCanvasStore.subscribe((state, prev) => {
      if (state.flowNodes === prev.flowNodes) return;
      // Recompute against the latest known viewport rect (the subscription
      // already kept `isVisible` in sync on every viewport change).
      recomputeVisibility(getLatestViewportRect());
    });

    terminalRef.current = terminal;

    return () => {
      unsubscribeOutput();
      if (resizeFrameRef.current != null) cancelAnimationFrame(resizeFrameRef.current);
      if (liveTimerRef.current != null) window.clearTimeout(liveTimerRef.current);
      observer.disconnect();
      unsubscribeViewport();
      unsubscribeFlowNodes();
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
