import { VaultAccessGate } from "../../VaultAccessGate";
import { BlueArchiveReviewDeck } from "../BlueArchiveReviewDeck";

export default function BlueArchiveReviewPage() {
  return (
    <VaultAccessGate>
      <BlueArchiveReviewDeck />
    </VaultAccessGate>
  );
}
