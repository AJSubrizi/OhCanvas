import { memo, useEffect, useState } from "react";
import { useCanvasStore } from "../../state/store";
import type { CanvasNodeProps } from "../types";

export interface TextNodeData {
  text: string;
  [key: string]: unknown;
}

function TextNode({ id, data, selected }: CanvasNodeProps<TextNodeData>) {
  const d = data;
  const [text, setText] = useState(d.text);

  useEffect(() => {
    if (text === d.text) return;
    const timer = window.setTimeout(() => updateNodeData(id, { text }), 180);
    return () => window.clearTimeout(timer);
  }, [d.text, id, text]);

  return (
    <div className={`text-node ${selected ? "is-selected" : ""}`}>
      <button
        className="text-node__close nodrag"
        onClick={() => useCanvasStore.getState().removeFlowNode(id)}
        title="Delete text"
        aria-label="Delete text"
      >
        ×
      </button>
      <textarea
        className="text-node__textarea nodrag"
        value={text}
        spellCheck={false}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          if (text !== d.text) updateNodeData(id, { text });
        }}
      />
    </div>
  );
}

export default memo(TextNode);

function updateNodeData(id: string, patch: Partial<TextNodeData>) {
  const nodes = useCanvasStore.getState().flowNodes;
  useCanvasStore.setState({
    flowNodes: nodes.map((node) =>
      node.id === id ? { ...node, data: { ...(node.data as TextNodeData), ...patch } } : node,
    ),
  });
}
