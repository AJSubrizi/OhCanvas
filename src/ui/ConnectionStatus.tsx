import { useCanvasStore } from "../state/store";

/**
 * Subtle indicator shown only while the sidecar WebSocket is not connected
 * (cold-start warm-up or a dropped connection). Hidden entirely once live, so
 * it adds no clutter in the normal case. Actions taken while disconnected are
 * queued by the bridge and flushed on connect — this just tells the user that.
 */
export default function ConnectionStatus() {
  const connected = useCanvasStore((s: any) => s.connected);
  if (connected) return null;
  return (
    <div className="conn-status" role="status" aria-live="polite">
      <span className="conn-status__dot" />
      Connecting to sidecar…
    </div>
  );
}
