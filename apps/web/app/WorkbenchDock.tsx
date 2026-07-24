import { CaptureSessionPanel } from "./CaptureSessionPanel";
import { ConversationPanel } from "./ConversationPanel";

export function WorkbenchDock() {
  return (
    <div className="workbench-dock" aria-label="Archive workbench">
      <span className="workbench-dock-label" aria-hidden="true">
        Workbench
      </span>
      <CaptureSessionPanel />
      <ConversationPanel />
    </div>
  );
}
