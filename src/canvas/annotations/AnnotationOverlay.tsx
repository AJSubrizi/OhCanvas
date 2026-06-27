import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";

export type Point = { x: number; y: number };
export type Annotation =
  | { kind: "text"; point: Point; text: string; color: string; fontSize: number }
  | { kind: "arrow"; from: Point; to: Point; color: string }
  | { kind: "pen"; points: Point[]; color: string };
export type DrawTool = "text" | "arrow" | "pen" | "select" | null;

export const COLORS = ["#facc15", "#67e8f9", "#f472b6", "#4ade80", "#f87171"];
export const DEFAULT_TEXT_SIZE = 22;

/** Pixel tolerance for hit-testing strokes/arrows under the cursor. */
const HIT_TOLERANCE = 10;

export interface AnnotationEditor {
  annotations: Annotation[];
  tool: DrawTool;
  color: string;
  editing: boolean;
  activeAnnotation: Annotation | null;
  pendingText: { point: Point; value: string; color: string; fontSize: number } | null;
  /** Index of the annotation currently selected (for move/edit/delete). */
  selectedIndex: number | null;
  setColor: (c: string) => void;
  setTool: (t: DrawTool) => void;
  setEditing: (e: boolean) => void;
  setPendingText: (p: AnnotationEditor["pendingText"]) => void;
  setSelectedIndex: (i: number | null) => void;
  setActiveAnnotation: (a: Annotation | null) => void;
  add: (ann: Annotation) => void;
  update: (updater: (prev: Annotation[]) => Annotation[]) => void;
  /** Remove the annotation at the given index. */
  removeAt: (index: number) => void;
  /** Patch a single annotation in place. */
  updateAnnotation: (index: number, updater: (ann: Annotation) => Annotation) => void;
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

/** Distance from point p to segment ab. */
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return Math.hypot(p.x - cx, p.y - cy);
}

/** Loose bounding box around a text annotation for hit-testing. */
function textHitBox(ann: Extract<Annotation, { kind: "text" }>): { x: number; y: number; w: number; h: number } {
  // Rough estimate: chars * 0.6 * fontSize width, 1.2 * fontSize height.
  const w = Math.max(40, ann.text.length * ann.fontSize * 0.6);
  const h = ann.fontSize * 1.4;
  return { x: ann.point.x - 4, y: ann.point.y - ann.fontSize, w, h };
}

/**
 * Hit-test an annotation at the given point. Returns the index in `annotations`
 * (matching the `index` used by `renderAnnotation`) or -1 if no hit.
 * Walks the array in reverse so the topmost (last-drawn) annotation wins.
 */
function hitTestAnnotation(annotations: Annotation[], p: Point): number {
  for (let i = annotations.length - 1; i >= 0; i--) {
    const ann = annotations[i];
    if (ann.kind === "text") {
      const box = textHitBox(ann);
      if (p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h) {
        return i;
      }
    } else if (ann.kind === "arrow") {
      // Shaft: distance to the line; head: inside the triangle.
      const dist = distanceToSegment(p, ann.from, ann.to);
      if (dist <= HIT_TOLERANCE) return i;
      // Quick head check: if the point is within the head triangle.
      const angle = Math.atan2(ann.to.y - ann.from.y, ann.to.x - ann.from.x);
      const headLen = 18;
      const headW = 14;
      const base = {
        x: ann.to.x - headLen * Math.cos(angle),
        y: ann.to.y - headLen * Math.sin(angle),
      };
      const left = {
        x: base.x + (headW / 2) * Math.cos(angle + Math.PI / 2),
        y: base.y + (headW / 2) * Math.sin(angle + Math.PI / 2),
      };
      const right = {
        x: base.x + (headW / 2) * Math.cos(angle - Math.PI / 2),
        y: base.y + (headW / 2) * Math.sin(angle - Math.PI / 2),
      };
      // Barycentric test for triangle (to, left, right).
      const sign = (
        p1: Point,
        p2: Point,
        p3: Point,
      ): number => (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
      const d1 = sign(p, ann.to, left);
      const d2 = sign(p, left, right);
      const d3 = sign(p, right, ann.to);
      const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
      const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
      if (!(hasNeg && hasPos)) return i;
    } else if (ann.kind === "pen") {
      for (let j = 0; j < ann.points.length - 1; j++) {
        const d = distanceToSegment(p, ann.points[j], ann.points[j + 1]);
        if (d <= HIT_TOLERANCE) return i;
      }
    }
  }
  return -1;
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
    selectedIndex,
    setActiveAnnotation,
    setPendingText,
    setSelectedIndex,
    add,
    update,
    removeAt,
    updateAnnotation,
  } = editor;

  const svgRef = useRef<SVGSVGElement>(null);
  const activeRef = useRef<Annotation | null>(null);
  // Drag state for moving a committed text annotation.
  const textDragRef = useRef<{
    index: number;
    offset: Point;
    moved: boolean;
  } | null>(null);
  /** When non-null, the next text commit patches this index instead of appending. */
  const textEditIndexRef = useRef<number | null>(null);
  // Latest editor functions, kept in a ref so the window listeners (bound once)
  // always call fresh callbacks without rebinding on every render.
  const editorRef = useRef({ setActiveAnnotation, setPendingText, setSelectedIndex, add, update, removeAt, updateAnnotation });
  editorRef.current = { setActiveAnnotation, setPendingText, setSelectedIndex, add, update, removeAt, updateAnnotation };

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

  // Keyboard shortcuts for the annotation editor:
  // - Delete / Backspace: remove the selected annotation
  // - Escape: clear the current selection (and cancel any pending text)
  // We only swallow the key when something is actually actionable, so the
  // editor never blocks normal typing in inputs outside the overlay.
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      // Don't intercept keys while the user is typing into the text input.
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        if (target !== document.body) return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedIndex !== null) {
        e.preventDefault();
        removeAt(selectedIndex);
        return;
      }
      if (e.key === "Escape") {
        if (selectedIndex !== null) {
          e.preventDefault();
          setSelectedIndex(null);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, selectedIndex, removeAt, setSelectedIndex]);

  const handlePointerDown = (e: ReactPointerEvent) => {
    if (!editing) return;
    e.preventDefault();
    e.stopPropagation();
    const pt = getPoint(e.clientX, e.clientY);

    if (tool === "select") {
      const idx = hitTestAnnotation(annotations, pt);
      editorRef.current.setSelectedIndex(idx >= 0 ? idx : null);
      return;
    }

    if (!tool) return;

    if (tool === "text") {
      editorRef.current.setPendingText({ point: pt, value: "", color, fontSize: DEFAULT_TEXT_SIZE });
      editorRef.current.setSelectedIndex(null);
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
    editorRef.current.setSelectedIndex(index);
  };

  /**
   * Open the text editor pre-filled with an existing text annotation. On commit
   * we patch the annotation in place rather than appending a new one.
   */
  const startTextEdit = (e: ReactMouseEvent, index: number, ann: Extract<Annotation, { kind: "text" }>) => {
    if (!editing) return;
    e.stopPropagation();
    e.preventDefault();
    textEditIndexRef.current = index;
    setPendingText({ point: ann.point, value: ann.text, color: ann.color, fontSize: ann.fontSize });
    setSelectedIndex(index);
  };

  const commitPendingText = () => {
    if (!pendingText || !pendingText.value.trim()) {
      setPendingText(null);
      textEditIndexRef.current = null;
      return;
    }
    const editIdx = textEditIndexRef.current;
    const value = pendingText.value.trim();
    if (editIdx !== null && annotations[editIdx]?.kind === "text") {
      updateAnnotation(editIdx, (ann) =>
        ann.kind === "text"
          ? { ...ann, text: value, color: pendingText.color, fontSize: pendingText.fontSize, point: pendingText.point }
          : ann,
      );
    } else {
      add({
        kind: "text",
        point: pendingText.point,
        text: value,
        color: pendingText.color,
        fontSize: pendingText.fontSize,
      });
    }
    setPendingText(null);
    textEditIndexRef.current = null;
  };

  const renderAnnotation = (ann: Annotation, idx: number) => {
    const isSelected = selectedIndex === idx;
    if (ann.kind === "pen") {
      return (
        <g key={idx}>
          <polyline
            points={ann.points.map((p) => `${p.x},${p.y}`).join(" ")}
            stroke={ann.color}
            strokeWidth={4}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {isSelected && (
            <polyline
              points={ann.points.map((p) => `${p.x},${p.y}`).join(" ")}
              stroke="#ffffff"
              strokeWidth={7}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="6 4"
              opacity={0.9}
            />
          )}
        </g>
      );
    }
    if (ann.kind === "arrow") {
      const shaft = arrowShaftEnd(ann.from, ann.to);
      const head = arrowHeadPoints(ann.from, ann.to);
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
          <polygon points={head} fill={ann.color} />
          {isSelected && (
            <g>
              <line
                x1={ann.from.x}
                y1={ann.from.y}
                x2={ann.to.x}
                y2={ann.to.y}
                stroke="#ffffff"
                strokeWidth={6}
                strokeLinecap="round"
                strokeDasharray="6 4"
                opacity={0.9}
              />
              <polygon
                points={head}
                fill="none"
                stroke="#ffffff"
                strokeWidth={2}
                strokeDasharray="4 3"
                opacity={0.9}
              />
            </g>
          )}
        </g>
      );
    }
    if (ann.kind === "text") {
      const box = textHitBox(ann);
      return (
        <g key={idx}>
          {isSelected && (
            <rect
              x={box.x - 2}
              y={box.y - 2}
              width={box.w + 4}
              height={box.h + 4}
              fill="none"
              stroke="#ffffff"
              strokeWidth={1.5}
              strokeDasharray="5 3"
              rx={3}
              opacity={0.9}
            />
          )}
          <text
            x={ann.point.x}
            y={ann.point.y}
            fill={ann.color}
            fontSize={ann.fontSize}
            fontWeight={700}
            style={{ cursor: editing ? (isSelected ? "move" : "pointer") : "default" }}
            onPointerDown={(e) => startTextDrag(e, idx, ann)}
            onDoubleClick={(e) => startTextEdit(e, idx, ann)}
          >
            {ann.text}
          </text>
        </g>
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
            if (e.key === "Escape") {
              textEditIndexRef.current = null;
              setPendingText(null);
            }
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
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const add = (ann: Annotation) => {
    setAnnotations((prev) => [...prev, ann]);
    setPendingText(null);
    setSelectedIndex(null);
  };

  const removeAt = (index: number) => {
    setAnnotations((prev) => prev.filter((_, i) => i !== index));
    setSelectedIndex(null);
  };

  const updateAnnotation = (index: number, updater: (ann: Annotation) => Annotation) => {
    setAnnotations((prev) => prev.map((ann, i) => (i === index ? updater(ann) : ann)));
  };

  return {
    annotations,
    tool,
    color,
    editing,
    activeAnnotation,
    pendingText,
    selectedIndex,
    setColor,
    setTool,
    setEditing,
    setPendingText,
    setSelectedIndex,
    setActiveAnnotation,
    add,
    update: setAnnotations,
    removeAt,
    updateAnnotation,
    clear: () => {
      setAnnotations([]);
      setPendingText(null);
      setSelectedIndex(null);
      setActiveAnnotation(null);
    },
    toggleEditing: () => setEditing((e) => !e),
  };
}
