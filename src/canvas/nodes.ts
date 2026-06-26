import { useCanvasStore } from "../state/store";
import type { TerminalKind } from "../bridge/protocol";
import type { CanvasNode } from "./types";

interface CanvasViewportApi {
  screenToCanvas(point: { x: number; y: number }): { x: number; y: number };
  centerOn(point: { x: number; y: number }, zoom?: number): void;
}

let viewportApi: CanvasViewportApi | null = null;
let cascade = 0;

export function setCanvasViewportApi(api: CanvasViewportApi | null) {
  viewportApi = api;
}

let counter = 0;
const newId = (p: string) => `${p}_${Date.now().toString(36)}_${counter++}`;

/** A spot near the centre of the viewport, cascaded so nodes don't stack exactly. */
function nextSpot(w: number, h: number) {
  const offset = (cascade++ % 6) * 28;
  if (viewportApi) {
    const c = viewportApi.screenToCanvas({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    return { x: c.x - w / 2 + offset, y: c.y - h / 2 + offset };
  }
  return { x: 120 + offset, y: 120 + offset };
}

const NAMES = ["North", "Vale", "Kite", "Mira", "Sage", "Echo", "Rowan", "Juno", "Wren", "Dex"];
let nameIdx = 0;

/** A persistent, human-friendly name for a CLI window. */
export function nextAgentName(): string {
  return NAMES[nameIdx++ % NAMES.length];
}

export function spawnBrowserNode(url = "http://localhost:3000") {
  const w = 560;
  const h = 400;
  const node: CanvasNode = {
    id: newId("browser"),
    type: "browser",
    position: nextSpot(w, h),
    style: { width: w, height: h },
    data: { url, title: "Browser" },
  };
  useCanvasStore.getState().addFlowNode(node);
  retileTerminalsIfAuto();
  return { id: node.id };
}

/** @deprecated use spawnTerminalNode directly */
export function spawnShellNode(shellId: string, command: string, cwd?: string) {
  return spawnTerminalNode({
    terminalId: shellId,
    kind: /^pi(\s|$)/.test(command) ? "pi" : "shell",
    title: /^pi(\s|$)/.test(command) ? "Pi" : "Shell",
    command,
    cwd,
  });
}

export function spawnTerminalNode(args: {
  terminalId: string;
  kind: TerminalKind;
  title: string;
  command: string;
  cwd?: string;
  x?: number;
  y?: number;
}) {
  const existing = useCanvasStore.getState().flowNodes.find((node: CanvasNode) => node.id === args.terminalId);
  if (existing) {
    if (args.cwd) {
      useCanvasStore.getState().setFlowNodes(
        useCanvasStore.getState().flowNodes.map((node) =>
          node.id === args.terminalId
            ? { ...node, data: { ...(node.data as Record<string, unknown>), cwd: args.cwd } }
            : node,
        ),
      );
    }
    return { id: existing.id };
  }

  const w = args.kind === "pi" ? 620 : 540;
  const h = args.kind === "pi" ? 380 : 320;

  const store = useCanvasStore.getState();
  const position = args.x != null && args.y != null
    ? { x: args.x, y: args.y }
    : (store.autoArrange ? { x: 0, y: 0 } : getNextTerminalPosition(w, h)); // let tile handle if auto on, avoids temp bad pos

  const node: CanvasNode = {
    id: args.terminalId,
    type: "terminal",
    position,
    style: { width: w, height: h },
    data: {
      terminalId: args.terminalId,
      kind: args.kind,
      title: args.title,
      command: args.command,
      cwd: args.cwd,
    },
  };
  useCanvasStore.getState().addFlowNode(node);
  retileTerminalsIfAuto();
  return { id: node.id };
}

/** Node types that participate in auto-tiling (the "window-like" cards). */
const TILE_TYPES = new Set(["terminal", "shell", "browser"]);

/** Re-tile after an open/close when auto-arrange is on and there are 2+ tiles. */
export function retileTerminalsIfAuto() {
  const store = useCanvasStore.getState();
  if (!store.autoArrange) return;
  const count = store.flowNodes.filter((n) => TILE_TYPES.has(n.type ?? "")).length;
  if (count >= 2) tileTerminals();
}

/**
 * Auto-tile window cards (terminals + browsers) into a viewport-aware grid.
 * Prefer compact, window-like cells over full-width strips so multi-agent
 * sessions remain scannable.
 */
export function tileTerminals() {
  const store = useCanvasStore.getState();
  const tiles = store.flowNodes.filter((n) => TILE_TYPES.has(n.type ?? ""));
  const n = tiles.length;
  if (n === 0) return;

  const inset = { top: 64, left: 24, right: 24, bottom: 96 };
  let tl = { x: 160, y: 110 };
  let avail = { w: 1180, h: 720 };
  if (viewportApi) {
    const a = viewportApi.screenToCanvas({ x: inset.left, y: inset.top });
    const b = viewportApi.screenToCanvas({
      x: window.innerWidth - inset.right,
      y: window.innerHeight - inset.bottom,
    });
    tl = { x: a.x, y: a.y };
    avail = { w: Math.max(280, b.x - a.x), h: Math.max(240, b.y - a.y) };
  }

  const gap = 16;
  // Differentiate min sizes: browsers need more space than terminals for readability
  const hasBrowser = tiles.some((t) => t.type === "browser");
  const baseMinCellW = hasBrowser ? 420 : 340;
  const baseMinCellH = hasBrowser ? 320 : 260;
  // For many terminals, allow slightly smaller but still usable cells
  const scale = Math.max(0.65, 1 - Math.max(0, n - 3) * 0.05);
  const minCellW = Math.round(baseMinCellW * scale);
  const minCellH = Math.round(baseMinCellH * scale);
  const targetAspect = hasBrowser ? 1.25 : 1.35; // browsers more square-ish
  const viewportNarrow = window.innerWidth < 900;
  const maxCols = Math.min(n, viewportNarrow ? 2 : 4);
  const balancedCols = Math.min(maxCols, n <= 2 ? n : Math.ceil(Math.sqrt(n)));

  let bestCols = 1;
  let bestScore = -Infinity;
  for (let cols = 1; cols <= maxCols; cols++) {
    const rows = Math.ceil(n / cols);
    const rawCellW = (avail.w - gap * (cols - 1)) / cols;
    const rawCellH = (avail.h - gap * (rows - 1)) / rows;
    const cellW = Math.min(rawCellW, rawCellH * (hasBrowser ? 1.4 : 1.55));
    const cellH = Math.min(rawCellH, cellW / (hasBrowser ? 1.1 : 1.08));
    const widthDeficit = Math.max(0, minCellW - cellW);
    const heightDeficit = Math.max(0, minCellH - cellH);
    const meetsMin = widthDeficit === 0 && heightDeficit === 0;
    const aspect = cellW / Math.max(1, cellH);
    const aspectPenalty = Math.abs(Math.log(aspect / targetAspect)) * 520;
    const stripPenalty = Math.max(0, aspect - 1.9) * 900;
    const emptyCells = cols * rows - n;
    const singleRowPenalty = n > 2 && rows === 1 ? 900 : 0;
    const balancePenalty = Math.abs(cols - balancedCols) * 360;

    const score =
      (meetsMin ? 900 : 0) +
      Math.min(cellW, cellH * targetAspect) * 0.8 +
      cellH * 0.65 -
      widthDeficit * 7 -
      heightDeficit * 6 -
      aspectPenalty -
      stripPenalty -
      emptyCells * 220 -
      singleRowPenalty -
      balancePenalty -
      cols * 10;
    if (score > bestScore) {
      bestScore = score;
      bestCols = cols;
    }
  }

  const cols = bestCols;
  const rows = Math.ceil(n / cols);
  const rawCellW = Math.max(minCellW, Math.round((avail.w - gap * (cols - 1)) / cols));
  const rawCellH = Math.max(minCellH, Math.round((avail.h - gap * (rows - 1)) / rows));
  let cellW = Math.max(minCellW, Math.min(rawCellW, Math.round(rawCellH * (hasBrowser ? 1.4 : 1.55))));
  let cellH = Math.max(minCellH, Math.min(rawCellH, Math.round(cellW / (hasBrowser ? 1.1 : 1.08))));
  // Safety net: never let the grid exceed the visible area, so every card stays
  // on-screen even in small/narrow windows where the min-size floors would
  // otherwise push the last row/column off the canvas. No-op when it already fits.
  const fitScale = Math.min(
    1,
    avail.w / (cols * cellW + gap * (cols - 1)),
    avail.h / (rows * cellH + gap * (rows - 1)),
  );
  if (fitScale < 1) {
    cellW = Math.floor(cellW * fitScale);
    cellH = Math.floor(cellH * fitScale);
  }
  const gridW = cols * cellW + gap * (cols - 1);
  const gridH = rows * cellH + gap * (rows - 1);
  const origin = {
    // Bias towards top-left for better usability with many cards, but still centered if space
    x: Math.round(tl.x + Math.max(0, (avail.w - gridW) / 2 * 0.6)),
    y: Math.round(tl.y + Math.max(0, (avail.h - gridH) / 2 * 0.3)),
  };

  // Sort by current visual order (top-to-bottom, left-to-right) to keep stable layout when re-tiling
  const order = [...tiles].sort((a, b) => {
    const ay = a.position.y;
    const by = b.position.y;
    if (Math.abs(ay - by) > 50) return ay - by; // different rows
    return a.position.x - b.position.x;
  });

  const layout = new Map<string, { x: number; y: number }>();
  order.forEach((node, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const itemsInRow = Math.min(cols, n - r * cols);
    const rowW = itemsInRow * cellW + Math.max(0, itemsInRow - 1) * gap;
    const rowOffset = Math.max(0, gridW - rowW) / 2;
    layout.set(node.id, {
      x: Math.round(origin.x + rowOffset + c * (cellW + gap)),
      y: Math.round(origin.y + r * (cellH + gap)),
    });
  });

  const next = store.flowNodes.map((node) => {
    const pos = layout.get(node.id);
    if (!pos) return node;
    return {
      ...node,
      position: pos,
      style: { ...(node.style ?? {}), width: cellW, height: cellH },
    };
  });
  store.setFlowNodes(next);
}

/**
 * Smart layout: place new windows side-by-side (affiancati).
 * Finds the rightmost window card (terminal or browser) and places the new one
 * next to it. Falls back to a clean cascade if needed.
 */
function getNextTerminalPosition(width: number, height: number) {
  const windows = useCanvasStore
    .getState()
    .flowNodes.filter((n) => TILE_TYPES.has(n.type ?? ""));

  if (windows.length === 0) {
    // First window: center it nicely
    if (viewportApi) {
      const center = viewportApi.screenToCanvas({
        x: window.innerWidth * 0.45,
        y: window.innerHeight * 0.38,
      });
      return { x: center.x, y: center.y };
    }
    return { x: 180, y: 120 };
  }

  // Find the rightmost window
  const rightmost = windows.reduce((max, node) => {
    const nodeWidth = (node.style as any)?.width || (node as any).width || 540;
    const right = node.position.x + Number(nodeWidth);
    return right > max.right ? { right, y: node.position.y } : max;
  }, { right: 0, y: 120 });

  const gap = 28;
  let x = rightmost.right + gap;
  let y = rightmost.y; // straight, non-random placement

  // If it would go too far right, start a new row below
  const maxRight = (viewportApi?.screenToCanvas({ x: window.innerWidth - 80, y: 0 }).x || 1400) - width;
  if (x > maxRight) {
    x = 160;
    y = rightmost.y + height + 36;
    // when many, try to find a better vertical slot to reduce overlap risk
    const existingYs = windows.map(w => w.position.y);
    if (existingYs.length > 3) {
      y = Math.min(...existingYs) + (height + 20) * Math.floor(windows.length / 3);
    }
  }

  return { x, y };
}

function explicitOrNextSpot(w: number, h: number, x?: number, y?: number) {
  if (typeof x === "number" && typeof y === "number") return { x, y };
  return nextSpot(w, h);
}

export function spawnNoteNode(text = "Note", x?: number, y?: number) {
  const w = 240;
  const h = 160;
  const node: CanvasNode = {
    id: newId("note"),
    type: "note",
    position: explicitOrNextSpot(w, h, x, y),
    style: { width: w, height: h },
    data: { text },
  };
  useCanvasStore.getState().addFlowNode(node);
  return { id: node.id };
}

export function spawnTextNode(text = "Text", x?: number, y?: number) {
  const w = 260;
  const h = 80;
  const node: CanvasNode = {
    id: newId("text"),
    type: "text",
    position: explicitOrNextSpot(w, h, x, y),
    style: { width: w, height: h },
    data: { text },
  };
  useCanvasStore.getState().addFlowNode(node);
  return { id: node.id };
}

export function spawnShapeNode(shape: "rect" | "ellipse" = "rect", label?: string, x?: number, y?: number) {
  const w = 180;
  const h = 120;
  const node: CanvasNode = {
    id: newId("shape"),
    type: "shape",
    position: explicitOrNextSpot(w, h, x, y),
    style: { width: w, height: h },
    data: { shape, label },
  };
  useCanvasStore.getState().addFlowNode(node);
  return { id: node.id };
}

/** Select a terminal node on the canvas (used especially by voice commands).
 *  Also tries to center the view on it using the canvas viewport.
 */
export function selectTerminalNode(terminalId: string) {
  const store = useCanvasStore.getState();
  const updatedNodes = store.flowNodes.map((node) => {
    const data = node.data as any;
    const isTarget =
      node.id === terminalId ||
      data?.terminalId === terminalId ||
      data?.shellId === terminalId;
    return { ...node, selected: isTarget };
  });
  store.setFlowNodes(updatedNodes);

  // Try to center the view on the selected terminal (nice for voice)
  if (viewportApi) {
    const targetNode = updatedNodes.find(
      (n) =>
        n.id === terminalId ||
        (n.data as any)?.terminalId === terminalId ||
        (n.data as any)?.shellId === terminalId
    );
    if (targetNode) {
      const { x, y } = targetNode.position;
      const w = (targetNode.style as any)?.width || 500;
      const h = (targetNode.style as any)?.height || 320;
      viewportApi.centerOn({ x: x + w / 2, y: y + h / 2 }, 0.9);
    }
  }
}
