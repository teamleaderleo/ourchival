import { VaultAccessGate } from "../VaultAccessGate";
import { VaultLauncher } from "../VaultLauncher";
import { MissingWorks } from "./MissingWorks";
export default function MissingPage() {
  if (process.env.VERCEL === "1") return <VaultLauncher />;
  return (
    <VaultAccessGate>
      <MissingWorks />
    </VaultAccessGate>
  );
}
