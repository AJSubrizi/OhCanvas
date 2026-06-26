import { memo } from "react";
import type { CanvasNodeProps } from "../types";

export interface ShapeNodeData {
  shape: "rect" | "ellipse";
  label?: string;
  [key: string]: unknown;
}

function ShapeNode({ data }: CanvasNodeProps<ShapeNodeData>) {
  const d = data;
  return (
    <div className={`shape-node shape-node--${d.shape}`}>
      {d.label && <span className="shape-node__label">{d.label}</span>}
    </div>
  );
}

export default memo(ShapeNode);
