import { CaptureSessionPanel } from "../CaptureSessionPanel";
import { ReferenceVault } from "../ReferenceVault";
import { VaultAccessGate } from "../VaultAccessGate";
import Link from "next/link";

export default function EarlierHostedCatalog() {
  return (
    <>
      <p className="access-message">
        Earlier hosted catalog · This is separate from Air Blue’s working archive.
        {" "}<Link href="/">Return to the working archive</Link>
      </p>
      <VaultAccessGate>
        <CaptureSessionPanel />
        <ReferenceVault />
      </VaultAccessGate>
    </>
  );
}
