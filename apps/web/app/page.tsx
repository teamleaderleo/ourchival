import { CaptureSessionPanel } from "./CaptureSessionPanel";
import { ReferenceVault } from "./ReferenceVault";
import { VaultAccessGate } from "./VaultAccessGate";

export default function HomePage() {
  return (
    <VaultAccessGate>
      <CaptureSessionPanel />
      <ReferenceVault />
    </VaultAccessGate>
  );
}
