import { ArtworkCorpus } from "../ArtworkCorpus";
import { VaultAccessGate } from "../VaultAccessGate";
import { VaultLauncher } from "../VaultLauncher";

export default function ArtworksPage() {
  if (process.env.VERCEL === "1") return <VaultLauncher />;
  return (
    <VaultAccessGate>
      <ArtworkCorpus />
    </VaultAccessGate>
  );
}
