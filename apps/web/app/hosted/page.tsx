import { CaptureSessionPanel } from "../CaptureSessionPanel";
import { ReferenceVault } from "../ReferenceVault";
import { VaultAccessGate } from "../VaultAccessGate";

export default function EarlierHostedCatalog() {
  return (
    <>
      <p className="access-message">
        Earlier hosted catalog · This is separate from Air Blue’s working archive.
        {" "}<a href="/">Return to the working archive</a>
      </p>
      <VaultAccessGate>
        <CaptureSessionPanel />
        <ReferenceVault />
      </VaultAccessGate>
    </>
  );
}
