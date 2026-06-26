import { Suspense, lazy, memo, useCallback, useEffect, useRef, useState, type ComponentType, type PointerEvent as ReactPointerEvent } from "react";
import { Arrow, Layer, Line, Rect, Stage } from "react-konva";
import ShellNode from "./nodes/ShellNode";
import NoteNode from "./nodes/NoteNode";
import ShapeNode from "./nodes/ShapeNode";
import TextNode from "./nodes/TextNode";
import { retileTerminalsIfAuto, setCanvasViewportApi } from "./nodes";
import { nodeHeight, nodeWidth, type CanvasNode, type CanvasNodeProps } from "./types";
import { useCanvasStore } from "../state/store";
import { sidecar } from "../bridge/sidecar";
import type { CanvasNodeInfo } from "../bridge/protocol";
import type { BoardMark } from "../state/store";

// Heavy nodes (xterm, browser annotation layer) are code-split out of the main bundle.
const TerminalNode = lazy(() => import("./nodes/TerminalNode"));
const BrowserNode = lazy(() => import("./nodes/BrowserNode"));

type Viewport = { x: number; y: number; scale: number };
type Size = { width: number; height: number };
type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
type DragState =
  | {
      mode: "move";
      id: string;
      startClient: { x: number; y: number };
      startPosition: { x: number; y: number };
      tile: boolean;
    }
  | {
      mode: "resize";
      id: string;
      handle: ResizeHandle;
      startClient: { x: number; y: number };
      startPosition: { x: number; y: number };
      startSize: Size;
      minSize: Size;
      tile: boolean;
    };

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2;
const TILE_TYPES = new Set(["terminal", "shell", "browser"]);

function lazyNode<TData extends Record<string, unknown>>(
  Comp: ComponentType<CanvasNodeProps<TData>>,
  label: string,
  cls: string,
) {
  return function LazyNode(props: CanvasNodeProps<TData>) {
    return (
      <Suspense fallback={<div className={cls}>{label}</div>}>
        <Comp {...props} />
      </Suspense>
    );
  };
}

const nodeTypes: Record<string, ComponentType<CanvasNodeProps<any>>> = {
  browser: lazyNode(BrowserNode, "Loading...", "browser-card browser-card--loading"),
  shell: ShellNode,
  terminal: lazyNode(TerminalNode, "Loading terminal...", "terminal-node terminal-node--loading"),
  note: NoteNode,
  text: TextNode,
  shape: ShapeNode,
};

export default function Canvas() {
  const flowNodes = useCanvasStore((s) => s.flowNodes);
  const boardMarks = useCanvasStore((s) => s.boardMarks);
  const boardDrawColor = useCanvasStore((s) => s.boardDrawColor);
  const setFlowNodes = useCanvasStore((s) => s.setFlowNodes);
  const tool = useCanvasStore((s) => s.tool);
  const autoArrange = useCanvasStore((s) => s.autoArrange);
  const setAutoArrange = useCanvasStore((s) => s.setAutoArrange);
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<any>(null);
  const dragRef = useRef<DragState | null>(null);
  const lastCanvasStateRef = useRef("");
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
  const viewportRef = useRef(viewport);
  const [size, setSize] = useState<Size>({ width: 1, height: 1 });
  const [draftMark, setDraftMark] = useState<BoardMark | null>(null);
  const draftMarkRef = useRef<BoardMark | null>(null);

  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  const screenToCanvas = useCallback((point: { x: number; y: number }) => {
    const rect = containerRef.current?.getBoundingClientRect();
    const localX = point.x - (rect?.left ?? 0);
    const localY = point.y - (rect?.top ?? 0);
    const v = viewportRef.current;
    return {
      x: (localX - v.x) / v.scale,
      y: (localY - v.y) / v.scale,
    };
  }, []);

  const centerOn = useCallback((point: { x: number; y: number }, zoom?: number) => {
    setViewport((current) => {
      const scale = clamp(zoom ?? current.scale, MIN_ZOOM, MAX_ZOOM);
      return {
        scale,
        x: size.width / 2 - point.x * scale,
        y: size.height / 2 - point.y * scale,
      };
    });
  }, [size.height, size.width]);

  useEffect(() => {
    setCanvasViewportApi({ screenToCanvas, centerOn });
    return () => setCanvasViewportApi(null);
  }, [centerOn, screenToCanvas]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      setSize({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Keep the sidecar's canvas snapshot fresh (used by agents' canvas_list).
  useEffect(() => {
    const t = window.setTimeout(() => {
      const nodes: CanvasNodeInfo[] = flowNodes.map((n) => {
        const data = n.data as Record<string, unknown>;
        const isTerminal = n.type === "terminal" || n.type === "shell";
        const kind = (isTerminal ? "terminal" : (n.type ?? "note")) as CanvasNodeInfo["kind"];
        const title =
          kind === "browser"
            ? String(data.url ?? "")
            : isTerminal
              ? String(data.title ?? data.command ?? "Terminal")
              : kind === "note" || kind === "text" || kind === "shape"
                ? String((data.text as string) ?? (data.label as string) ?? kind)
                : String(data.command ?? "");
        return {
          id: n.id,
          kind,
          title,
          x: n.position.x,
          y: n.position.y,
          terminalKind: isTerminal ? (data.kind as any) : undefined,
        };
      });
      const signature = JSON.stringify(nodes);
      if (signature === lastCanvasStateRef.current) return;
      lastCanvasStateRef.current = signature;
      sidecar.sendCanvasState(nodes);
    }, 350);
    return () => window.clearTimeout(t);
  }, [flowNodes]);

  // Re-tile terminals when the window resizes so they keep fitting the viewport.
  useEffect(() => {
    let t: number | undefined;
    const onResize = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => retileTerminalsIfAuto(), 160);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.clearTimeout(t);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Backspace" && event.key !== "Delete") return;
      if (isEditableTarget(event.target)) return;
      const selected = useCanvasStore.getState().flowNodes.filter((node) => node.selected);
      if (!selected.length) return;
      event.preventDefault();
      removeNodes(selected);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const selectNode = useCallback((id: string | null, additive = false) => {
    const current = useCanvasStore.getState().flowNodes;
    const next = current.map((node) => ({
      ...node,
      selected: id ? (additive ? node.selected || node.id === id : node.id === id) : false,
    }));
    useCanvasStore.setState({ flowNodes: next });
  }, []);

  const updateNodeTransient = useCallback((id: string, updater: (node: CanvasNode) => CanvasNode) => {
    const nodes = useCanvasStore.getState().flowNodes;
    useCanvasStore.setState({ flowNodes: nodes.map((node) => (node.id === id ? updater(node) : node)) });
  }, []);

  const commitNodes = useCallback(() => {
    setFlowNodes(useCanvasStore.getState().flowNodes);
  }, [setFlowNodes]);

  const removeNodes = useCallback((nodes: CanvasNode[]) => {
    let removedTile = false;
    for (const node of nodes) {
      if (TILE_TYPES.has(node.type ?? "")) removedTile = true;
      if (node.type === "terminal" || node.type === "shell") {
        const data = node.data as Record<string, unknown>;
        const terminalId = String(data.terminalId ?? data.shellId ?? node.id);
        sidecar.killTerminal(terminalId);
      }
    }
    const ids = new Set(nodes.map((node) => node.id));
    setFlowNodes(useCanvasStore.getState().flowNodes.filter((node) => !ids.has(node.id)));
    if (removedTile) retileTerminalsIfAuto();
  }, [setFlowNodes]);

  const onWheel = useCallback((event: any) => {
    event.evt.preventDefault();
    const pointer = stageRef.current?.getPointerPosition();
    if (!pointer) return;
    const old = viewportRef.current;
    const scaleBy = 1.08;
    const direction = event.evt.deltaY > 0 ? -1 : 1;
    const nextScale = clamp(direction > 0 ? old.scale * scaleBy : old.scale / scaleBy, MIN_ZOOM, MAX_ZOOM);
    const world = {
      x: (pointer.x - old.x) / old.scale,
      y: (pointer.y - old.y) / old.scale,
    };
    setViewport({
      scale: nextScale,
      x: pointer.x - world.x * nextScale,
      y: pointer.y - world.y * nextScale,
    });
  }, []);

  const pointerCanvasPoint = useCallback(() => {
    const pointer = stageRef.current?.getPointerPosition();
    if (!pointer) return null;
    const v = viewportRef.current;
    return {
      x: (pointer.x - v.x) / v.scale,
      y: (pointer.y - v.y) / v.scale,
    };
  }, []);

  const eraseAt = useCallback((point: { x: number; y: number }) => {
    const current = useCanvasStore.getState().boardMarks;
    const index = current.findIndex((mark) => markDistance(mark, point) < 18 / viewportRef.current.scale);
    if (index < 0) return;
    useCanvasStore.getState().setBoardMarks(current.filter((_, i) => i !== index));
  }, []);

  const startBoardMark = useCallback(() => {
    if (tool !== "pen" && tool !== "arrow" && tool !== "eraser") return false;
    const point = pointerCanvasPoint();
    if (!point) return false;
    if (tool === "eraser") {
      eraseAt(point);
      return true;
    }
    const mark: BoardMark = {
      id: `mark_${Date.now().toString(36)}`,
      kind: tool,
      points: [point.x, point.y, point.x, point.y],
      color: boardDrawColor,
      strokeWidth: tool === "pen" ? 4 : 5,
    };
    draftMarkRef.current = mark;
    setDraftMark(mark);
    return true;
  }, [boardDrawColor, eraseAt, pointerCanvasPoint, tool]);

  const updateBoardMark = useCallback(() => {
    const mark = draftMarkRef.current;
    if (!mark) return;
    const point = pointerCanvasPoint();
    if (!point) return;
    const next: BoardMark =
      mark.kind === "pen"
        ? { ...mark, points: [...mark.points, point.x, point.y] }
        : { ...mark, points: [mark.points[0], mark.points[1], point.x, point.y] };
    draftMarkRef.current = next;
    setDraftMark(next);
  }, [pointerCanvasPoint]);

  const finishBoardMark = useCallback(() => {
    const mark = draftMarkRef.current;
    if (!mark) return;
    draftMarkRef.current = null;
    setDraftMark(null);
    if (mark.kind === "pen" && mark.points.length < 6) return;
    if (mark.kind === "arrow" && Math.hypot(mark.points[2] - mark.points[0], mark.points[3] - mark.points[1]) < 12) return;
    useCanvasStore.getState().addBoardMark(mark);
  }, []);

  const startNodeDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>, node: CanvasNode) => {
    if (tool === "pan" || isInteractiveTarget(event.target)) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    selectNode(node.id, event.shiftKey || event.metaKey);
    dragRef.current = {
      mode: "move",
      id: node.id,
      startClient: { x: event.clientX, y: event.clientY },
      startPosition: node.position,
      tile: TILE_TYPES.has(node.type ?? ""),
    };
  }, [selectNode, tool]);

  const startNodeResize = useCallback((
    event: ReactPointerEvent<HTMLButtonElement>,
    node: CanvasNode,
    handle: ResizeHandle,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    selectNode(node.id);
    dragRef.current = {
      mode: "resize",
      id: node.id,
      handle,
      startClient: { x: event.clientX, y: event.clientY },
      startPosition: node.position,
      startSize: { width: nodeWidth(node, fallbackWidth(node)), height: nodeHeight(node, fallbackHeight(node)) },
      minSize: minSizeFor(node),
      tile: TILE_TYPES.has(node.type ?? ""),
    };
  }, [selectNode]);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    event.preventDefault();
    const dx = (event.clientX - drag.startClient.x) / viewportRef.current.scale;
    const dy = (event.clientY - drag.startClient.y) / viewportRef.current.scale;
    if (drag.mode === "move") {
      updateNodeTransient(drag.id, (node) => ({
        ...node,
        position: {
          x: Math.round(drag.startPosition.x + dx),
          y: Math.round(drag.startPosition.y + dy),
        },
      }));
      return;
    }

    const next = resizeFromHandle(drag, dx, dy);
    updateNodeTransient(drag.id, (node) => ({
      ...node,
      position: next.position,
      style: { ...(node.style ?? {}), width: next.size.width, height: next.size.height },
    }));
  }, [updateNodeTransient]);

  const finishDrag = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (drag.tile && autoArrange) setAutoArrange(false);
    commitNodes();
  }, [autoArrange, commitNodes, setAutoArrange]);

  const stageDragBound = useCallback((pos: { x: number; y: number }) => {
    setViewport((current) => ({ ...current, x: pos.x, y: pos.y }));
    return pos;
  }, []);

  return (
    <div
      ref={containerRef}
      className="konva-canvas"
      onPointerMove={onPointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onPointerLeave={finishDrag}
    >
      <Stage
        ref={stageRef}
        width={size.width}
        height={size.height}
        x={viewport.x}
        y={viewport.y}
        scaleX={viewport.scale}
        scaleY={viewport.scale}
        // Pan by dragging empty space in select or pan mode. In draw modes
        // (pen/arrow/eraser) the stage is NOT draggable so pointer events flow
        // cleanly to the board-mark drawing logic.
        draggable={tool === "pan" || tool === "select"}
        dragBoundFunc={stageDragBound}
        onWheel={onWheel}
        onMouseDown={(event) => {
          // Only react to clicks directly on the empty stage background.
          if (event.target !== event.target.getStage()) return;
          if (startBoardMark()) return;
          selectNode(null);
        }}
        onMouseMove={() => {
          if (tool === "eraser") {
            const point = pointerCanvasPoint();
            if (point) eraseAt(point);
            return;
          }
          updateBoardMark();
        }}
        onMouseUp={finishBoardMark}
        onMouseLeave={finishBoardMark}
      >
        <Layer listening={false}>
          {[...boardMarks, ...(draftMark ? [draftMark] : [])].map((mark) =>
            mark.kind === "arrow" ? (
              <Arrow
                key={mark.id}
                points={mark.points}
                stroke={mark.color}
                fill={mark.color}
                strokeWidth={mark.strokeWidth}
                pointerLength={18}
                pointerWidth={18}
                lineCap="round"
                lineJoin="round"
                shadowColor="rgba(0,0,0,0.75)"
                shadowBlur={5}
                shadowOpacity={0.45}
              />
            ) : (
              <Line
                key={mark.id}
                points={mark.points}
                stroke={mark.color}
                strokeWidth={mark.strokeWidth}
                lineCap="round"
                lineJoin="round"
                tension={0.35}
                shadowColor="rgba(0,0,0,0.72)"
                shadowBlur={5}
                shadowOpacity={0.42}
              />
            ),
          )}
          {flowNodes.map((node) => (
            <Rect
              key={node.id}
              x={node.position.x}
              y={node.position.y}
              width={nodeWidth(node, fallbackWidth(node))}
              height={nodeHeight(node, fallbackHeight(node))}
              cornerRadius={node.type === "text" ? 4 : 10}
              fill={konvaFillFor(node)}
              stroke={node.selected ? "#facc15" : "rgba(255,255,255,0.14)"}
              strokeWidth={node.selected ? 2 : 1}
              shadowColor="rgba(0,0,0,0.35)"
              shadowBlur={node.selected ? 14 : 6}
              shadowOpacity={node.selected ? 0.4 : 0.18}
            />
          ))}
        </Layer>
      </Stage>

      <div className="canvas-html-layer">
        {flowNodes.map((node) => (
          <CanvasNodeFrame
            key={node.id}
            node={node}
            viewport={viewport}
            selected={Boolean(node.selected)}
            onPointerDown={startNodeDrag}
            onResizeStart={startNodeResize}
          />
        ))}
      </div>

      <ZoomControls
        scale={viewport.scale}
        onZoom={(scale) => setViewport((current) => ({ ...current, scale: clamp(scale, MIN_ZOOM, MAX_ZOOM) }))}
        onCenter={() =>
          setViewport({ scale: 1, x: size.width / 2, y: size.height / 2 })
        }
      />
    </div>
  );
}

/** Bottom-left zoom pill: − [ % ] +  with a click-to-reset on the percentage. */
function ZoomControls({
  scale,
  onZoom,
  onCenter,
}: {
  scale: number;
  onZoom: (scale: number) => void;
  onCenter: () => void;
}) {
  const percent = Math.round(scale * 100);
  return (
    <div className="zoom-controls" aria-label="Zoom controls">
      <button
        className="zoom-controls__btn"
        onClick={() => onZoom(scale / 1.2)}
        disabled={scale <= MIN_ZOOM + 0.001}
        aria-label="Zoom out"
        title="Zoom out"
      >
        −
      </button>
      <button
        className="zoom-controls__value"
        onClick={onCenter}
        title="Reset to 100% and center"
      >
        {percent}%
      </button>
      <button
        className="zoom-controls__btn"
        onClick={() => onZoom(scale * 1.2)}
        disabled={scale >= MAX_ZOOM - 0.001}
        aria-label="Zoom in"
        title="Zoom in"
      >
        +
      </button>
    </div>
  );
}

// Memoized so dragging/resizing one node doesn't re-render every other node's
// frame. During a drag only the dragged node's `node` ref changes (viewport and
// the callbacks stay referentially stable), so shallow-prop comparison lets the
// others skip rendering entirely. On pan/zoom the `viewport` ref changes, so all
// frames update — which is correct, their on-screen position depends on it.
const CanvasNodeFrame = memo(function CanvasNodeFrame({
  node,
  viewport,
  selected,
  onPointerDown,
  onResizeStart,
}: {
  node: CanvasNode;
  viewport: Viewport;
  selected: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>, node: CanvasNode) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>, node: CanvasNode, handle: ResizeHandle) => void;
}) {
  const Component = nodeTypes[node.type ?? "note"] ?? NoteNode;
  const width = nodeWidth(node, fallbackWidth(node));
  const height = nodeHeight(node, fallbackHeight(node));
  const left = viewport.x + node.position.x * viewport.scale;
  const top = viewport.y + node.position.y * viewport.scale;

  return (
    <div
      className={`canvas-node-frame canvas-node-frame--${node.type ?? "note"} ${selected ? "is-selected" : ""}`}
      style={{
        left,
        top,
        width,
        height,
        transform: `scale(${viewport.scale})`,
      }}
      onPointerDown={(event) => onPointerDown(event, node)}
    >
      <Component id={node.id} data={node.data} selected={selected} />
      {selected && (
        <div className="canvas-node-frame__resizers" aria-hidden="true">
          {(["nw", "n", "ne", "e", "se", "s", "sw", "w"] as ResizeHandle[]).map((handle) => (
            <button
              key={handle}
              className={`canvas-node-frame__resize canvas-node-frame__resize--${handle}`}
              onPointerDown={(event) => onResizeStart(event, node, handle)}
              tabIndex={-1}
            />
          ))}
        </div>
      )}
    </div>
  );
});

function resizeFromHandle(drag: Extract<DragState, { mode: "resize" }>, dx: number, dy: number) {
  let x = drag.startPosition.x;
  let y = drag.startPosition.y;
  let width = drag.startSize.width;
  let height = drag.startSize.height;

  if (drag.handle.includes("e")) width = drag.startSize.width + dx;
  if (drag.handle.includes("s")) height = drag.startSize.height + dy;
  if (drag.handle.includes("w")) {
    width = drag.startSize.width - dx;
    x = drag.startPosition.x + dx;
  }
  if (drag.handle.includes("n")) {
    height = drag.startSize.height - dy;
    y = drag.startPosition.y + dy;
  }

  const clampedWidth = Math.max(drag.minSize.width, Math.round(width));
  const clampedHeight = Math.max(drag.minSize.height, Math.round(height));
  if (drag.handle.includes("w")) x = Math.round(drag.startPosition.x + drag.startSize.width - clampedWidth);
  if (drag.handle.includes("n")) y = Math.round(drag.startPosition.y + drag.startSize.height - clampedHeight);

  return {
    position: { x: Math.round(x), y: Math.round(y) },
    size: { width: clampedWidth, height: clampedHeight },
  };
}

function isInteractiveTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement) && !(target instanceof SVGElement)) return false;
  if (target.closest(".nodrag, .nowheel")) return true;
  const tag = target.tagName.toLowerCase();
  return ["button", "input", "textarea", "select", "option", "iframe", "a"].includes(tag);
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return target.isContentEditable || ["input", "textarea", "select"].includes(tag);
}

function fallbackWidth(node: CanvasNode) {
  if (node.type === "browser") return 560;
  if (node.type === "terminal") return 560;
  if (node.type === "shell") return 540;
  if (node.type === "text") return 260;
  if (node.type === "shape") return 180;
  return 240;
}

function fallbackHeight(node: CanvasNode) {
  if (node.type === "browser") return 400;
  if (node.type === "terminal") return 340;
  if (node.type === "shell") return 320;
  if (node.type === "text") return 80;
  if (node.type === "shape") return 120;
  return 160;
}

function minSizeFor(node: CanvasNode): Size {
  if (node.type === "browser") return { width: 320, height: 240 };
  if (node.type === "terminal" || node.type === "shell") return { width: 300, height: 190 };
  if (node.type === "text") return { width: 120, height: 44 };
  if (node.type === "shape") return { width: 80, height: 60 };
  return { width: 180, height: 120 };
}

function konvaFillFor(node: CanvasNode): string {
  if (node.type === "terminal" || node.type === "shell") return "rgba(8, 11, 20, 0.64)";
  if (node.type === "browser") return "rgba(14, 18, 28, 0.55)";
  if (node.type === "note") return "rgba(250, 204, 21, 0.08)";
  if (node.type === "text") return "rgba(255, 255, 255, 0.03)";
  return "rgba(148, 163, 184, 0.08)";
}

function markDistance(mark: BoardMark, point: { x: number; y: number }) {
  let best = Infinity;
  for (let i = 0; i < mark.points.length - 2; i += 2) {
    best = Math.min(
      best,
      distanceToSegment(
        point,
        { x: mark.points[i], y: mark.points[i + 1] },
        { x: mark.points[i + 2], y: mark.points[i + 3] },
      ),
    );
  }
  return best;
}

function distanceToSegment(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = p.x - a.x;
  const wy = p.y - a.y;
  const lenSq = vx * vx + vy * vy;
  const t = lenSq > 0 ? clamp((wx * vx + wy * vy) / lenSq, 0, 1) : 0;
  const x = a.x + t * vx;
  const y = a.y + t * vy;
  return Math.hypot(p.x - x, p.y - y);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
