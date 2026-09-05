import { VaultAccessGate } from "../VaultAccessGate";
import { CatalogExportPanel } from "./CatalogExportPanel";

export default function CatalogExportPage() {
  return (
    <VaultAccessGate>
      <CatalogExportPanel />
    </VaultAccessGate>
  );
}
