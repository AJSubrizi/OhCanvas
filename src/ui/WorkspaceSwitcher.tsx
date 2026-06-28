import { useCanvasStore } from "../state/store";
import { pickFolder } from "./workspacePicker";

export default function WorkspaceSwitcher() {
  const workspaces = useCanvasStore((s) => s.workspaces);
  const activeId = useCanvasStore((s) => s.activeWorkspaceId);
  const switchWs = useCanvasStore((s) => s.switchWorkspace);
  const addWs = useCanvasStore((s) => s.addWorkspace);
  const removeWs = useCanvasStore((s) => s.removeWorkspace);

  const createWorkspace = async () => {
    const folder = await pickFolder("Choose a project folder for the new workspace");
    if (!folder) return;
    addWs(folder);
  };

  return (
    <div className="workspace-switcher" data-tauri-drag-region="false">
      {workspaces.map((ws) => (
        <div key={ws.id} className="workspace-switcher__slot">
          <button
            className={`workspace-switcher__item ${ws.id === activeId ? "is-active" : ""}`}
            style={{
              backgroundColor: ws.id === activeId ? ws.color : "transparent",
              borderColor: ws.color,
              color: ws.id === activeId ? "#06070c" : ws.color,
            }}
            onClick={() => switchWs(ws.id)}
            title={ws.folderName ? `Workspace ${ws.label}: ${ws.folderName}` : `Workspace ${ws.label}`}
            aria-label={`Switch to workspace ${ws.label}`}
            data-tauri-drag-region="false"
          >
            {ws.label}
          </button>
          {ws.label !== "1" && (
            <button
              className="workspace-switcher__close"
              onClick={() => removeWs(ws.id)}
              title={`Close workspace ${ws.label}`}
              aria-label={`Close workspace ${ws.label}`}
              data-tauri-drag-region="false"
            >
              ×
            </button>
          )}
        </div>
      ))}
      <button
        className="workspace-switcher__add"
        onClick={() => void createWorkspace()}
        title="Add workspace"
        aria-label="Add new workspace"
        data-tauri-drag-region="false"
      >
        +
      </button>
    </div>
  );
}
