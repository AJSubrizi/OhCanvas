import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

export type Point = { x: number; y: number };
export type Annotation =
  | { kind: "text"; point: Point; text: string; color: string; fontSize: number }
  | { kind: "arrow"; from: Point; to: Point; color: string }
  | { kind: "pen"; points: Point[]; color: string };
export type DrawTool = "text" | "arrow" | "pen" | null;

export const COLORS = ["#facc15", "#67e8f9", "#f472b6", "#4ade80", "#f87171"];
export const DEFAULT_TEXT_SIZE = 22;

export interface AnnotationEditor {
  annotations: Annotation[];
  tool: DrawTool;
  color: string;
  editing: boolean;
  activeAnnotation: Annotation | null;
  pendingText: { point: Point; value: string; color: string; fontSize: number } | null;
  selectedTextIndex: number | null;
  setColor: (c: string) => void;
  setTool: (t: DrawTool) => void;
  setEditing: (e: boolean) => void;
  setPendingText: (p: AnnotationEditor["pendingText"]) => void;
  setSelectedTextIndex: (i: number | null) => void;
  setActiveAnnotation: (a: Annotation | null) => void;
  add: (ann: Annotation) => void;
  update: (updater: (prev: Annotation[]) => Annotation[]) => void;
  clear: () => void;
  toggleEditing: () => void;
}

interface AnnotationOverlayProps {
  /** The editable region width/height (the iframe viewport, in CSS px). */
  width: number;
  height: number;
  editor: AnnotationEditor;
}

function arrowHeadPoints(from: Point, to: Point) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const length = 18;
  const width = 14;
  const base = {
    x: to.x - length * Math.cos(angle),
    y: to.y - length * Math.sin(angle),
  };
  const left = {
    x: base.x + (width / 2) * Math.cos(angle + Math.PI / 2),
    y: base.y + (width / 2) * Math.sin(angle + Math.PI / 2),
  };
  const right = {
    x: base.x + (width / 2) * Math.cos(angle - Math.PI / 2),
    y: base.y + (width / 2) * Math.sin(angle - Math.PI / 2),
  };
  return `${to.x.toFixed(1)},${to.y.toFixed(1)} ${left.x.toFixed(1)},${left.y.toFixed(
    1,
  )} ${right.x.toFixed(1)},${right.y.toFixed(1)}`;
}

function arrowShaftEnd(from: Point, to: Point) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const headInset = 12;
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const inset = Math.min(headInset, Math.max(0, length - 6));
  return { x: to.x - inset * Math.cos(angle), y: to.y - inset * Math.sin(angle) };
}

/**
 * Renders annotation strokes/text over a preview iframe and captures the
 * pointer interactions needed to draw them. Self-contained: the parent only
 * supplies an editor (state holder) and the viewport dimensions.
 */
export function AnnotationOverlay({ width, height, editor }: AnnotationOverlayProps) {
  const {
    annotations,
    tool,
    color,
    editing,
    activeAnnotation,
    pendingText,
    selectedTextIndex,
    setActiveAnnotation,
    setPendingText,
    setSelectedTextIndex,
    add,
    update,
  } = editor;

  const svgRef = useRef<SVGSVGElement>(null);
  const activeRef = useRef<Annotation | null>(null);
  // Drag state for moving a committed text annotation.
  const textDragRef = useRef<{
    index: number;
    offset: Point;
    moved: boolean;
  } | null>(null);
  // Latest editor functions, kept in a ref so the window listeners (bound once)
  // always call fresh callbacks without rebinding on every render.
  const editorRef = useRef({ setActiveAnnotation, setPendingText, setSelectedTextIndex, add, update });
  editorRef.current = { setActiveAnnotation, setPendingText, setSelectedTextIndex, add, update };

  const getPoint = (clientX: number, clientY: number): Point => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: Math.max(0, Math.min(width, ((clientX - rect.left) / rect.width) * width)),
      y: Math.max(0, Math.min(height, ((clientY - rect.top) / rect.height) * height)),
    };
  };

  const finishStroke = () => {
    const ann = activeRef.current;
    if (!ann) return;
    const { add: addFn } = editorRef.current;
    if (ann.kind === "pen" && ann.points.length > 3) {
      addFn(ann);
    } else if (ann.kind === "arrow") {
      const dist = Math.hypot(ann.to.x - ann.from.x, ann.to.y - ann.from.y);
      if (dist > 18) addFn(ann);
    }
    activeRef.current = null;
    editorRef.current.setActiveAnnotation(null);
  };

  const finishTextDrag = () => {
    if (!textDragRef.current) return;
    textDragRef.current = null;
  };

  // Window-level pointermove/up while a stroke or text-drag is in progress.
  // This is the critical fix: binding on window (not the SVG) guarantees the
  // stroke ENDS even if the pointer leaves the overlay or React re-renders the
  // captured element away. Without this, pointerup could be missed and the tool
  // appeared to "keep reading clicks".
  useEffect(() => {
    if (!editing) return;
    const onMove = (e: PointerEvent) => {
      const pt = getPoint(e.clientX, e.clientY);

      if (textDragRef.current) {
        const { index, offset } = textDragRef.current;
        textDragRef.current = { index, offset, moved: true };
        editorRef.current.update((prev) =>
          prev.map((ann, i) =>
            i === index && ann.kind === "text"
              ? { ...ann, point: { x: pt.x - offset.x, y: pt.y - offset.y } }
              : ann,
          ),
        );
        return;
      }
      if (!activeRef.current) return;
      if (activeRef.current.kind === "pen") {
        activeRef.current.points.push(pt);
      } else if (activeRef.current.kind === "arrow") {
        activeRef.current.to = pt;
      }
      editorRef.current.setActiveAnnotation({ ...activeRef.current });
    };
    const onUp = () => {
      finishStroke();
      finishTextDrag();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    // Only rebind when editing toggles; editor functions come via ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, width, height]);

  const handlePointerDown = (e: ReactPointerEvent) => {
    if (!editing || !tool) return;
    e.preventDefault();
    e.stopPropagation();
    const pt = getPoint(e.clientX, e.clientY);

    if (tool === "text") {
      editorRef.current.setPendingText({ point: pt, value: "", color, fontSize: DEFAULT_TEXT_SIZE });
      editorRef.current.setSelectedTextIndex(null);
      return;
    }

    if (tool === "pen") {
      activeRef.current = { kind: "pen", points: [pt], color };
    } else if (tool === "arrow") {
      activeRef.current = { kind: "arrow", from: pt, to: pt, color };
    }
    editorRef.current.setActiveAnnotation(activeRef.current);
  };

  const startTextDrag = (e: ReactPointerEvent, index: number, ann: Extract<Annotation, { kind: "text" }>) => {
    if (!editing) return;
    e.stopPropagation();
    e.preventDefault();
    const pt = getPoint(e.clientX, e.clientY);
    textDragRef.current = {
      index,
      offset: { x: pt.x - ann.point.x, y: pt.y - ann.point.y },
      moved: false,
    };
    editorRef.current.setSelectedTextIndex(index);
  };

  const commitPendingText = () => {
    if (!pendingText || !pendingText.value.trim()) {
      setPendingText(null);
      return;
    }
    add({
      kind: "text",
      point: pendingText.point,
      text: pendingText.value.trim(),
      color: pendingText.color,
      fontSize: pendingText.fontSize,
    });
    setPendingText(null);
  };

  const renderAnnotation = (ann: Annotation, idx: number) => {
    if (ann.kind === "pen") {
      return (
        <polyline
          key={idx}
          points={ann.points.map((p) => `${p.x},${p.y}`).join(" ")}
          stroke={ann.color}
          strokeWidth={4}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    }
    if (ann.kind === "arrow") {
      const shaft = arrowShaftEnd(ann.from, ann.to);
      return (
        <g key={idx}>
          <line
            x1={ann.from.x}
            y1={ann.from.y}
            x2={shaft.x}
            y2={shaft.y}
            stroke={ann.color}
            strokeWidth={3}
            strokeLinecap="round"
          />
          <polygon points={arrowHeadPoints(ann.from, ann.to)} fill={ann.color} />
        </g>
      );
    }
    if (ann.kind === "text") {
      const isSelected = selectedTextIndex === idx;
      return (
        <text
          key={idx}
          x={ann.point.x}
          y={ann.point.y}
          fill={ann.color}
          fontSize={ann.fontSize}
          fontWeight={700}
          style={{ cursor: editing ? (isSelected ? "move" : "pointer") : "default" }}
          onPointerDown={(e) => startTextDrag(e, idx, ann)}
        >
          {ann.text}
        </text>
      );
    }
    return null;
  };

  return (
    <div
      className="nodrag"
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: editing ? "auto" : "none",
        zIndex: 3,
      }}
    >
      <svg
        ref={svgRef}
        width={width}
        height={height}
        onPointerDown={handlePointerDown}
        style={{ touchAction: "none", width: "100%", height: "100%" }}
      >
        {annotations.map(renderAnnotation)}
        {activeAnnotation && renderAnnotation(activeAnnotation, -1)}
      </svg>

      {pendingText && (
        <input
          autoFocus
          value={pendingText.value}
          onChange={(e) => setPendingText({ ...pendingText, value: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitPendingText();
            if (e.key === "Escape") setPendingText(null);
          }}
          onBlur={commitPendingText}
          style={{
            position: "absolute",
            left: pendingText.point.x,
            top: pendingText.point.y - 24,
            background: "#0a0c14e6",
            color: pendingText.color,
            border: `1px solid ${pendingText.color}`,
            borderRadius: 6,
            padding: "4px 8px",
            fontSize: 18,
            fontWeight: 700,
            zIndex: 10,
            minWidth: 120,
          }}
        />
      )}
    </div>
  );
}

// --- Local fallback state hook (used when the parent doesn't supply one) -----
// Kept minimal so the overlay can also render in read-only contexts.
export function useLocalAnnotationEditor(): AnnotationEditor {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [tool, setTool] = useState<DrawTool>(null);
  const [color, setColor] = useState("#facc15");
  const [editing, setEditing] = useState(false);
  const [activeAnnotation, setActiveAnnotation] = useState<Annotation | null>(null);
  const [pendingText, setPendingText] = useState<AnnotationEditor["pendingText"]>(null);
  const [selectedTextIndex, setSelectedTextIndex] = useState<number | null>(null);

  const add = (ann: Annotation) => {
    setAnnotations((prev) => [...prev, ann]);
    setPendingText(null);
    setSelectedTextIndex(null);
  };

  return {
    annotations,
    tool,
    color,
    editing,
    activeAnnotation,
    pendingText,
    selectedTextIndex,
    setColor,
    setTool,
    setEditing,
    setPendingText,
    setSelectedTextIndex,
    setActiveAnnotation,
    add,
    update: setAnnotations,
    clear: () => {
      setAnnotations([]);
      setPendingText(null);
      setSelectedTextIndex(null);
      setActiveAnnotation(null);
    },
    toggleEditing: () => setEditing((e) => !e),
  };
}
