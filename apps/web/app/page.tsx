import { ReferenceVault } from "./ReferenceVault";
import { VaultAccessGate } from "./VaultAccessGate";
import { WorkbenchDock } from "./WorkbenchDock";

export default function HomePage() {
  return (
    <VaultAccessGate>
      <WorkbenchDock />
      <ReferenceVault />
    </VaultAccessGate>
  );
}
