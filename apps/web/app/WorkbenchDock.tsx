import { CaptureSessionPanel } from "./CaptureSessionPanel";
import { ConversationPanel } from "./ConversationPanel";
import { WorkbenchController } from "./WorkbenchController";

export function WorkbenchDock() {
  return (
    <div className="workbench-dock" aria-label="Archive workbench">
      <WorkbenchController />
      <span className="workbench-dock-label" aria-hidden="true">
        Workbench
      </span>
      <CaptureSessionPanel />
      <ConversationPanel />
    </div>
  );
}
