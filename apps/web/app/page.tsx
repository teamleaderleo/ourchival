import { ReferenceVault } from "./ReferenceVault";
import { VaultAccessGate } from "./VaultAccessGate";

export default function HomePage() {
  return (
    <VaultAccessGate>
      <ReferenceVault />
    </VaultAccessGate>
  );
}
