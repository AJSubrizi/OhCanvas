import { useCanvasStore } from "../state/store";
import { pickFolder, type PickedFolder } from "./workspacePicker";

export function activeWorkspaceProject(): PickedFolder | null {
  const state = useCanvasStore.getState();
  const ws = state.workspaces.find((item) => item.id === state.activeWorkspaceId);
  if (!ws?.folderName && !ws?.folderPath) return null;
  return { name: ws.folderName || "Project", path: ws.folderPath ?? null };
}

export async function chooseWorkspaceProject(): Promise<PickedFolder | null> {
  const folder = await pickFolder("Choose a project folder for this workspace");
  if (!folder) return null;
  useCanvasStore.getState().setActiveWorkspaceFolder(folder);
  return folder;
}

export async function resolveTerminalFolder(): Promise<PickedFolder | null> {
  const state = useCanvasStore.getState();
  if (state.multiFolderSameProject) return pickFolder("Choose a folder for this terminal");
  return activeWorkspaceProject() ?? chooseWorkspaceProject();
}

export function activeWorkspaceLabel(): string {
  const project = activeWorkspaceProject();
  return project?.name ?? "No project";
}
