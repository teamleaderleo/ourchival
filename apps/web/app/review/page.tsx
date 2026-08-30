import { VaultAccessGate } from "../VaultAccessGate";
import { ReviewDeck } from "./ReviewDeck";

export default function ReviewPage() {
  return (
    <VaultAccessGate>
      <ReviewDeck />
    </VaultAccessGate>
  );
}
