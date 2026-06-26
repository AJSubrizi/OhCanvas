import { memo, useEffect, useState } from "react";
import { useCanvasStore } from "../../state/store";
import type { CanvasNodeProps } from "../types";

export interface NoteNodeData {
  text: string;
  [key: string]: unknown;
}

function NoteNode({ id, data, selected }: CanvasNodeProps<NoteNodeData>) {
  const d = data;
  const [text, setText] = useState(d.text);

  useEffect(() => {
    if (text === d.text) return;
    const timer = window.setTimeout(() => updateNodeData(id, { text }), 180);
    return () => window.clearTimeout(timer);
  }, [d.text, id, text]);

  return (
    <div className={`note-node ${selected ? "is-selected" : ""}`}>
      <button
        className="note-node__close nodrag"
        onClick={() => useCanvasStore.getState().removeFlowNode(id)}
        title="Delete note"
        aria-label="Delete note"
      >
        ×
      </button>
      <textarea
        className="note-node__textarea nodrag"
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

export default memo(NoteNode);

function updateNodeData(id: string, patch: Partial<NoteNodeData>) {
  const nodes = useCanvasStore.getState().flowNodes;
  useCanvasStore.setState({
    flowNodes: nodes.map((node) =>
      node.id === id ? { ...node, data: { ...(node.data as NoteNodeData), ...patch } } : node,
    ),
  });
}
