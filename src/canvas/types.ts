export interface CanvasNode<TData = Record<string, unknown>> {
  id: string;
  type?: string;
  position: { x: number; y: number };
  style?: { width?: number; height?: number; [key: string]: unknown };
  data: TData;
  selected?: boolean;
}

export interface CanvasNodeProps<TData = Record<string, unknown>> {
  id: string;
  data: TData;
  selected: boolean;
}

export function nodeWidth(node: CanvasNode, fallback = 240): number {
  const width = Number(node.style?.width);
  return Number.isFinite(width) && width > 0 ? width : fallback;
}

export function nodeHeight(node: CanvasNode, fallback = 160): number {
  const height = Number(node.style?.height);
  return Number.isFinite(height) && height > 0 ? height : fallback;
}
