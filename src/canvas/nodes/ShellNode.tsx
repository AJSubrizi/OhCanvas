import { Suspense, lazy } from "react";
import type { CanvasNodeProps } from "../types";

const TerminalNode = lazy(() => import("./TerminalNode"));

/** @deprecated Shell nodes are now unified under TerminalNode. This is a thin compat layer. */
export interface ShellNodeData {
  shellId: string;
  command: string;
  [key: string]: unknown;
}

export default function ShellNode(props: CanvasNodeProps<ShellNodeData>) {
  const data = props.data as ShellNodeData;
  const isPi = /^pi(\s|$)/.test(data.command || "");

  return (
    <Suspense fallback={<div className="terminal-node terminal-node--loading">Loading terminal…</div>}>
      <TerminalNode
        {...props}
        data={{
          terminalId: data.shellId,
          legacyShellId: data.shellId,
          kind: isPi ? "pi" : "shell",
          title: isPi ? "Pi" : "Shell",
          command: data.command,
        }}
      />
    </Suspense>
  );
}
