import { CaptureSessionPanel } from "./CaptureSessionPanel";
import { ConversationPanel } from "./ConversationPanel";
import { ReferenceVault } from "./ReferenceVault";
import { VaultAccessGate } from "./VaultAccessGate";

export default function HomePage() {
  return (
    <VaultAccessGate>
      <CaptureSessionPanel />
      <ConversationPanel />
      <ReferenceVault />
    </VaultAccessGate>
  );
}
