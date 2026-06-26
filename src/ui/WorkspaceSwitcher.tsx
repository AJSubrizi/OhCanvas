import { useCanvasStore } from "../state/store";

export default function WorkspaceSwitcher() {
  const workspaces = useCanvasStore((s) => s.workspaces);
  const activeId = useCanvasStore((s) => s.activeWorkspaceId);
  const switchWs = useCanvasStore((s) => s.switchWorkspace);
  const addWs = useCanvasStore((s) => s.addWorkspace);

  return (
    <div className="workspace-switcher" data-tauri-drag-region="false">
      {workspaces.map((ws) => (
        <button
          key={ws.id}
          className={`workspace-switcher__item ${ws.id === activeId ? "is-active" : ""}`}
          style={{
            backgroundColor: ws.id === activeId ? ws.color : "transparent",
            borderColor: ws.color,
            color: ws.id === activeId ? "#06070c" : ws.color,
          }}
          onClick={() => switchWs(ws.id)}
          title={`Workspace ${ws.label}`}
          aria-label={`Switch to workspace ${ws.label}`}
          data-tauri-drag-region="false"
        >
          {ws.label}
        </button>
      ))}
      <button
        className="workspace-switcher__add"
        onClick={addWs}
        title="Add workspace"
        aria-label="Add new workspace"
        data-tauri-drag-region="false"
      >
        +
      </button>
    </div>
  );
}
