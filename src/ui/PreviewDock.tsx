import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useCanvasStore } from "../state/store";
import { sidecar } from "../bridge/sidecar";
import { AnnotationOverlay, COLORS } from "../canvas/annotations/AnnotationOverlay";
import { useAnnotations } from "../canvas/annotations/useAnnotations";
import type { Annotation } from "../canvas/annotations/AnnotationOverlay";

/** Normalize a raw address bar input into a loadable URL. */
function normalizeUrl(raw: string): string {
  const v = raw.trim();
  if (!v) return v;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^localhost(:\d+)?(\/|$)/i.test(v) || /^\d+\.\d+\.\d+\.\d+/.test(v)) {
    return `http://${v}`;
  }
  return `https://${v}`;
}

/** Extract :PORT from a URL string for the status badge, or null. */
function portOf(url: string): string | null {
  const match = url.match(/:(\d{2,5})(?:\/|$)/);
  return match ? match[1] : null;
}

/** Render annotations to an SVG data URL sized to the preview. */
function annotationsToSvgDataUrl(annotations: Annotation[], width: number, height: number): string {
  const parts: string[] = [];
  for (const ann of annotations) {
    if (ann.kind === "pen") {
      const pts = ann.points.map((p) => `${p.x},${p.y}`).join(" ");
      parts.push(
        `<polyline points="${pts}" stroke="${ann.color}" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
      );
    } else if (ann.kind === "arrow") {
      const angle = Math.atan2(ann.to.y - ann.from.y, ann.to.x - ann.from.x);
      const len = 22;
      const w = 16;
      const base = { x: ann.to.x - len * Math.cos(angle), y: ann.to.y - len * Math.sin(angle) };
      const left = { x: base.x + (w / 2) * Math.cos(angle + Math.PI / 2), y: base.y + (w / 2) * Math.sin(angle + Math.PI / 2) };
      const right = { x: base.x + (w / 2) * Math.cos(angle - Math.PI / 2), y: base.y + (w / 2) * Math.sin(angle - Math.PI / 2) };
      parts.push(
        `<line x1="${ann.from.x}" y1="${ann.from.y}" x2="${base.x}" y2="${base.y}" stroke="${ann.color}" stroke-width="4" stroke-linecap="round"/>`,
        `<polygon points="${ann.to.x},${ann.to.y} ${left.x},${left.y} ${right.x},${right.y}" fill="${ann.color}"/>`,
      );
    } else if (ann.kind === "text") {
      const esc = ann.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      parts.push(
        `<text x="${ann.point.x}" y="${ann.point.y}" fill="${ann.color}" font-size="${ann.fontSize}" font-weight="700" font-family="sans-serif">${esc}</text>`,
      );
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join(
    "",
  )}</svg>`;
  // NB: no `;utf8` charset param — the sidecar's data-URL parser only accepts an
  // optional `;base64`, and a non-standard `;utf8` made attachment saves (and thus
  // "send to terminal") fail. Percent-encoded payload with no charset param.
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export default function PreviewDock() {
  const open = useCanvasStore((s) => s.previewOpen);
  const url = useCanvasStore((s) => s.previewUrl);
  const terminalId = useCanvasStore((s) => s.previewTerminalId);
  const device = useCanvasStore((s) => s.previewDevice);
  const terminals = useCanvasStore((s) => s.terminals);
  const flowNodes = useCanvasStore((s) => s.flowNodes);

  const setUrl = useCanvasStore((s) => s.setPreviewUrl);
  const setPreviewTerminal = useCanvasStore((s) => s.setPreviewTerminal);
  const openPreview = useCanvasStore((s) => s.openPreview);
  const closePreview = useCanvasStore((s) => s.closePreview);
  const cycleDevice = useCanvasStore((s) => s.cyclePreviewDevice);

  const [draft, setDraft] = useState(url);
  const [nonce, setNonce] = useState(0);
  const [loading, setLoading] = useState(false);
  const [sendState, setSendState] = useState<"idle" | "saving" | "sent" | "error">("idle");
  const [targetTerminalId, setTargetTerminalId] = useState("");

  const editor = useAnnotations({});
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [previewSize, setPreviewSize] = useState({ width: 420, height: 600 });

  // Resizable dock: width/height the user can drag (left edge, bottom edge, or
  // bottom-left corner), persisted across sessions.
  const [dockSize, setDockSize] = useState<{ width: number; height: number }>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("ohcanvas:preview-size") || "");
      if (saved && saved.width > 0 && saved.height > 0) return saved;
    } catch {
      /* ignore */
    }
    return { width: 560, height: Math.max(320, window.innerHeight - 66) };
  });
  const [resizing, setResizing] = useState(false);
  const dockSizeRef = useRef(dockSize);
  dockSizeRef.current = dockSize;

  useEffect(() => {
    try {
      localStorage.setItem("ohcanvas:preview-size", JSON.stringify(dockSize));
    } catch {
      /* ignore */
    }
  }, [dockSize]);

  const startResize = (edge: "w" | "s" | "sw") => (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const start = { x: e.clientX, y: e.clientY, w: dockSizeRef.current.width, h: dockSizeRef.current.height };
    setResizing(true);
    const onMove = (ev: PointerEvent) => {
      let w = start.w;
      let h = start.h;
      if (edge.includes("w")) w = start.w + (start.x - ev.clientX); // anchored top-right → grows leftward
      if (edge.includes("s")) h = start.h + (ev.clientY - start.y);
      w = Math.min(Math.max(w, 360), window.innerWidth - 28);
      h = Math.min(Math.max(h, 260), window.innerHeight - 66);
      setDockSize({ width: Math.round(w), height: Math.round(h) });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setResizing(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Terminal picker: prefer the dock's bound terminal, then the selected
  // terminal on canvas, then the user's dropdown choice, then the first.
  const terminalOptions = useMemo(() => {
    const nodesById = new Map(flowNodes.map((node) => [node.id, node]));
    return Object.entries(terminals)
      .filter(([, runtime]) => runtime.kind !== "shell" || runtime.running)
      .map(([tid, runtime]) => ({
        id: tid,
        label: runtime.title || tid,
        selected: Boolean(nodesById.get(tid)?.selected),
      }));
  }, [flowNodes, terminals]);

  const selectedTerminalId = terminalOptions.find((o) => o.selected)?.id ?? "";
  const resolvedTerminalId =
    terminalId || selectedTerminalId || targetTerminalId || terminalOptions[0]?.id || "";

  // Keep the address bar in sync when the URL changes externally.
  useEffect(() => {
    setDraft(url);
    setLoading(Boolean(url));
    setNonce((n) => n + 1);
  }, [url]);

  // Track the iframe's rendered size for annotation mapping.
  useEffect(() => {
    if (!editor.editing || !frameRef.current) return;
    const updateSize = () => {
      const rect = frameRef.current?.getBoundingClientRect();
      if (!rect) return;
      const next = {
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
      };
      setPreviewSize((current) =>
        current.width === next.width && current.height === next.height ? current : next,
      );
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(frameRef.current);
    return () => observer.disconnect();
  }, [editor.editing, device]);

  const runtime = terminalId ? terminals[terminalId] : null;
  const live = Boolean(runtime?.running);
  const port = useMemo(() => portOf(url), [url]);

  const go = () => {
    const next = normalizeUrl(draft);
    setUrl(next);
    openPreview(next, terminalId);
  };

  const reload = () => {
    if (!url) return;
    setLoading(true);
    setNonce((n) => n + 1);
  };

  const sendImageToTerminal = async () => {
    if (!resolvedTerminalId || editor.annotations.length === 0) return;
    setSendState("saving");
    try {
      const dataUrl = annotationsToSvgDataUrl(editor.annotations, previewSize.width, previewSize.height);
      const path = await sidecar.saveAttachment(dataUrl, "preview-annotation.svg");
      sidecar.writeTerminal(resolvedTerminalId, `@image ${path} `);
      // Persist the chosen target so subsequent sends reuse it.
      setPreviewTerminal(resolvedTerminalId);
      setSendState("sent");
      setTimeout(() => setSendState("idle"), 2000);
    } catch (err) {
      console.error("[PreviewDock] send to terminal failed", err);
      setSendState("error");
      setTimeout(() => setSendState("idle"), 2500);
    }
  };

  const canSend = editor.annotations.length > 0;

  if (!open) return null;

  const hasContent = Boolean(url);

  return (
    <aside
      className={`preview-dock ${resizing ? "is-resizing" : ""}`}
      style={{ width: dockSize.width, height: dockSize.height }}
      aria-label="Live preview panel"
    >
      <div
        className="preview-dock__resize preview-dock__resize--w"
        onPointerDown={startResize("w")}
        aria-hidden="true"
      />
      <div
        className="preview-dock__resize preview-dock__resize--s"
        onPointerDown={startResize("s")}
        aria-hidden="true"
      />
      <div
        className="preview-dock__resize preview-dock__resize--sw"
        onPointerDown={startResize("sw")}
        aria-hidden="true"
      />
      <header className="preview-dock__header">
        <span
          className={`preview-dock__dot ${live ? "is-live" : "is-idle"}`}
          title={live ? `Live${port ? ` · :${port}` : ""}` : "Idle"}
        />
        <div className="preview-dock__urlbar">
          <input
            className="preview-dock__input"
            value={draft}
            spellCheck={false}
            placeholder="http://localhost:3000"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") go();
            }}
          />
          <button className="preview-dock__go" onClick={go} title="Go">
            Go
          </button>
        </div>
        {live && port && <span className="preview-dock__port">:{port}</span>}
        <div className="preview-dock__actions">
          <button
            className={`preview-dock__btn ${editor.editing ? "is-active" : ""}`}
            onClick={editor.toggleEditing}
            disabled={!hasContent}
            title={editor.editing ? "Exit annotation mode" : "Annotate preview"}
            aria-label="Toggle annotation mode"
          >
            ✏️
          </button>
          <button
            className="preview-dock__btn"
            onClick={cycleDevice}
            title={device === "mobile" ? "Mobile view" : "Desktop view"}
            aria-label="Toggle device"
          >
            {device === "mobile" ? "📱" : "💻"}
          </button>
          <button
            className="preview-dock__btn"
            onClick={reload}
            disabled={!hasContent}
            title="Reload"
            aria-label="Reload preview"
          >
            ⟳
          </button>
          <button
            className="preview-dock__btn preview-dock__close"
            onClick={closePreview}
            title="Close preview"
            aria-label="Close preview"
          >
            ×
          </button>
        </div>
      </header>

      {editor.editing && (
        <div className="preview-dock__tools" aria-label="Annotation tools">
          {(["text", "arrow", "pen"] as const).map((t) => (
            <button
              key={t}
              className={`preview-dock__tool ${editor.tool === t ? "is-active" : ""}`}
              onClick={() => editor.setTool(editor.tool === t ? null : t)}
              title={t === "text" ? "Text" : t === "arrow" ? "Arrow" : "Freehand"}
            >
              {t === "text" ? "T" : t === "arrow" ? "→" : "✎"}
            </button>
          ))}
          <span className="preview-dock__tool-sep" />
          {COLORS.slice(0, 4).map((c) => (
            <button
              key={c}
              className={`preview-dock__swatch ${editor.color === c ? "is-active" : ""}`}
              style={{ background: c }}
              onClick={() => editor.setColor(c)}
              aria-label={`Color ${c}`}
            />
          ))}
          <span className="preview-dock__tool-sep" />
          <button
            className="preview-dock__tool preview-dock__clear"
            onClick={editor.clear}
            disabled={editor.annotations.length === 0}
            title="Clear all annotations"
            aria-label="Clear all annotations"
          >
            ✕
          </button>
          <div className="preview-dock__tools-right">
            <select
              className="preview-dock__terminal-select"
              value={targetTerminalId}
              onChange={(e) => setTargetTerminalId(e.target.value)}
              aria-label="Target terminal"
            >
              <option value="">
                {terminalOptions[0] ? `Auto: ${terminalOptions[0].label}` : "No terminal"}
              </option>
              {terminalOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <button
              className={`preview-dock__send ${canSend ? "" : "is-disabled"}`}
              onClick={sendImageToTerminal}
              disabled={!canSend}
              title="Send annotated screenshot to terminal"
            >
              {sendState === "saving" ? "…" : sendState === "sent" ? "✓" : "Send"}
            </button>
          </div>
        </div>
      )}

      <div className={`preview-dock__body ${device === "mobile" ? "is-mobile" : ""}`}>
        {hasContent ? (
          <div className="preview-dock__viewport">
            {loading && <div className="preview-dock__loading">Loading…</div>}
            <iframe
              ref={frameRef}
              key={`${url}-${nonce}-${device}`}
              className="preview-dock__frame"
              src={url}
              title="Preview"
              referrerPolicy="no-referrer"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              onLoad={() => setLoading(false)}
            />
            {editor.editing && (
              <AnnotationOverlay
                width={previewSize.width}
                height={previewSize.height}
                editor={editor}
              />
            )}
          </div>
        ) : (
          <div className="preview-dock__empty">
            <div className="preview-dock__empty-icon">🪟</div>
            <div className="preview-dock__empty-title">No preview yet</div>
            <div className="preview-dock__empty-hint">
              Launch a dev server (e.g. <code>pnpm dev</code>) in a terminal, or
              paste a URL above. When a server is detected you'll get a prompt to
              open it here.
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
