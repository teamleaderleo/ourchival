import { CaptureSessionPanel } from "./CaptureSessionPanel";
import { ReferenceVault } from "./ReferenceVault";
import { VaultAccessGate } from "./VaultAccessGate";
import { VaultKeyboardShortcuts } from "./VaultKeyboardShortcuts";

export default function HomePage() {
  return (
    <VaultAccessGate>
      <VaultKeyboardShortcuts />
      <CaptureSessionPanel />
      <ReferenceVault />
    </VaultAccessGate>
  );
}
