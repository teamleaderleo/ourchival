import { CaptureSessionPanel } from "./CaptureSessionPanel";
import { ReferenceVault } from "./ReferenceVault";
import { VaultAccessGate } from "./VaultAccessGate";
import { VaultLauncher } from "./VaultLauncher";

export default function HomePage() {
  if (process.env.VERCEL === "1") return <VaultLauncher />;
  return (
    <VaultAccessGate>
      <CaptureSessionPanel />
      <ReferenceVault />
    </VaultAccessGate>
  );
}
