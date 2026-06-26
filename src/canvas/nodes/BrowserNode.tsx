import { memo, useEffect, useMemo, useRef, useState } from "react";

import { useCanvasStore } from "../../state/store";
import { sidecar } from "../../bridge/sidecar";
import type { TerminalKind } from "../../bridge/protocol";
import type { CanvasNodeProps } from "../types";
import { retileTerminalsIfAuto } from "../nodes";
import { AnnotationOverlay, COLORS } from "../annotations/AnnotationOverlay";
import { useAnnotations } from "../annotations/useAnnotations";
import type { Annotation, Point } from "../annotations/AnnotationOverlay";

export interface BrowserNodeData {
  url: string;
  title: string;
  [key: string]: unknown;
}

function normalizeUrl(raw: string): string {
  const v = raw.trim();
  if (!v) return v;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^localhost(:\d+)?(\/|$)/i.test(v) || /^\d+\.\d+\.\d+\.\d+/.test(v)) {
    return `http://${v}`;
  }
  return `https://${v}`;
}

function kindLabel(kind: TerminalKind) {
  if (kind === "pi") return "Pi";
  if (kind === "claude-code") return "Claude";
  if (kind === "codex") return "Codex";
  if (kind === "cursor") return "Cursor";
  return "Shell";
}

/** Render annotations to an SVG data URL sized to the preview, for sending to a terminal. */
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
  // No `;utf8` charset param — the sidecar's data-URL parser only accepts an
  // optional `;base64`; a non-standard `;utf8` made attachment saves fail.
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function BrowserNode({ id, data }: CanvasNodeProps<BrowserNodeData>) {
  const d = data;
  const terminals = useCanvasStore((s) => s.terminals);
  const flowNodes = useCanvasStore((s) => s.flowNodes);
  const [address, setAddress] = useState(d.url);
  const [src, setSrc] = useState(d.url);
  const [nonce, setNonce] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [targetTerminalId, setTargetTerminalId] = useState("");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [sendState, setSendState] = useState<"idle" | "saving" | "sent" | "error">("idle");
  const [previewSize, setPreviewSize] = useState({ width: 560, height: 369 });
  const frameRef = useRef<HTMLIFrameElement>(null);

  const editor = useAnnotations({});

  const terminalOptions = useMemo(() => {
    const nodesById = new Map(flowNodes.map((node) => [node.id, node]));
    return Object.entries(terminals)
      .filter(([, runtime]) => runtime.kind !== "shell" || runtime.running)
      .map(([terminalId, runtime]) => ({
        id: terminalId,
        label: `${runtime.title || kindLabel(runtime.kind)} · ${kindLabel(runtime.kind)}`,
        selected: Boolean(nodesById.get(terminalId)?.selected),
      }));
  }, [flowNodes, terminals]);

  const selectedTerminalId = terminalOptions.find((option) => option.selected)?.id ?? "";
  const resolvedTerminalId = selectedTerminalId || targetTerminalId || terminalOptions[0]?.id || "";

  useEffect(() => {
    setAddress(d.url);
    setSrc(d.url);
  }, [d.url]);

  // Track the iframe's rendered size so annotations map to the right pixels.
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
  }, [editor.editing]);

  const go = () => {
    const next = normalizeUrl(address);
    setLoading(true);
    setFailed(false);
    setSrc(next);
    setNonce((n) => n + 1);
    const nodes = useCanvasStore.getState().flowNodes;
    useCanvasStore.setState({
      flowNodes: nodes.map((node) =>
        node.id === id ? { ...node, data: { ...(node.data as BrowserNodeData), url: next } } : node,
      ),
    });
  };

  const close = () => {
    useCanvasStore.getState().removeFlowNode(id);
    retileTerminalsIfAuto();
  };

  const toggleEditing = () => {
    editor.toggleEditing();
    setSendState("idle");
  };

  const sendImageToTerminal = async () => {
    if (!resolvedTerminalId || editor.annotations.length === 0) return;
    setSendState("saving");
    try {
      const dataUrl = annotationsToSvgDataUrl(editor.annotations, previewSize.width, previewSize.height);
      const path = await sidecar.saveAttachment(dataUrl, "preview-annotation.svg");
      sidecar.writeTerminal(resolvedTerminalId, `@image ${path} `);
      setSendState("sent");
      setTimeout(() => setSendState("idle"), 2000);
    } catch (err) {
      console.error("[BrowserNode] send to terminal failed", err);
      setSendState("error");
      setTimeout(() => setSendState("idle"), 2500);
    }
  };

  const canSend = editor.annotations.length > 0;

  return (
    <div className={`browser-card ${editor.editing ? "is-editing" : ""} ${device === "mobile" ? "is-mobile" : ""}`}>
      <div className="browser-card__bar">
        <span className="browser-card__handle">Browser</span>
        <input
          className="nodrag"
          value={address}
          spellCheck={false}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") go();
          }}
        />
        <button className="nodrag" onClick={go} title="Reload">⟳</button>
        <button
          className="nodrag"
          onClick={() => setDevice((d) => (d === "desktop" ? "mobile" : "desktop"))}
          title={device === "mobile" ? "Mobile view" : "Desktop view"}
          aria-label="Toggle device"
        >
          {device === "mobile" ? "📱" : "💻"}
        </button>
        <button
          className={`nodrag ${editor.editing ? "is-active" : ""}`}
          onClick={toggleEditing}
          title="Annotate"
          aria-label="Toggle annotation mode"
        >
          ✎
        </button>
        <button className="browser-card__close nodrag" onClick={close} title="Close browser">
          ×
        </button>
      </div>

      {editor.editing && (
        <div className="browser-card__edit-tools nodrag" aria-label="Preview annotation tools">
          <button
            className={editor.tool === "text" ? "is-active" : ""}
            onClick={() => editor.setTool(editor.tool === "text" ? null : "text")}
            title="Text"
            aria-label="Text tool"
          >
            T
          </button>
          <button
            className={editor.tool === "arrow" ? "is-active" : ""}
            onClick={() => editor.setTool(editor.tool === "arrow" ? null : "arrow")}
            title="Arrow"
            aria-label="Arrow tool"
          >
            ↗
          </button>
          <button
            className={editor.tool === "pen" ? "is-active" : ""}
            onClick={() => editor.setTool(editor.tool === "pen" ? null : "pen")}
            title="Freehand"
            aria-label="Freehand pencil tool"
          >
            ✎
          </button>
          <span className="browser-card__tool-sep" />
          {COLORS.map((color) => (
            <button
              key={color}
              className={`browser-card__swatch ${editor.color === color ? "is-active" : ""}`}
              onClick={() => editor.setColor(color)}
              title={color}
              aria-label={`Color ${color}`}
              style={{ backgroundColor: color }}
            />
          ))}
          <input
            type="color"
            value={editor.color}
            onChange={(event) => editor.setColor(event.target.value)}
            title="Custom color"
            aria-label="Custom annotation color"
          />
          <span className="browser-card__tool-sep" />
          <button
            onClick={editor.clear}
            disabled={editor.annotations.length === 0}
            title="Clear all annotations"
            aria-label="Clear all annotations"
          >
            ✕
          </button>
          <span className="browser-card__tool-sep" />
          <button
            className={`browser-card__send ${canSend ? "" : "is-disabled"}`}
            onClick={sendImageToTerminal}
            disabled={!canSend}
            title="Send annotated screenshot to terminal"
          >
            {sendState === "saving" ? "…" : sendState === "sent" ? "✓" : "↑"}
          </button>
        </div>
      )}

      {editor.editing && (
        <select
          className="browser-card__target nodrag"
          value={targetTerminalId}
          onChange={(e) => setTargetTerminalId(e.target.value)}
          aria-label="Target terminal"
        >
          <option value="">Auto: {terminalOptions[0]?.label ?? "no terminal"}</option>
          {terminalOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      )}

      <div className={`browser-card__frame-wrap ${device === "mobile" ? "is-mobile" : ""}`}>
        <div className="browser-card__viewport">
          <iframe
            ref={frameRef}
            key={nonce}
            className={`browser-card__frame nodrag nowheel ${editor.editing ? "is-muted" : ""}`}
            src={src}
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            onLoad={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setFailed(true);
            }}
          />
          {editor.editing && (
            <AnnotationOverlay
              width={previewSize.width}
              height={previewSize.height}
              editor={editor}
            />
          )}
        </div>
      </div>

      {loading && <div className="browser-card__status">Loading…</div>}
      {failed && <div className="browser-card__status browser-card__status--error">Preview failed</div>}
      {editor.editing && terminalOptions.length === 0 && (
        <div className="browser-card__status browser-card__status--error">Open a terminal to attach</div>
      )}
      {editor.editing && sendState === "error" && (
        <div className="browser-card__status browser-card__status--error">Attach failed</div>
      )}
    </div>
  );
}

export default memo(BrowserNode);

// Re-export so callers importing the Point type from here still compile.
export type { Point };
