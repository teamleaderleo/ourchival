import { cp, lstat, readFile, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Only the canonical checkout may refresh Air Blue's established installation.
// Copy compiled application files only; browser storage never enters this flow.
const canonical = "/Users/leoli/Projects/ourchival";
const installed = "/Users/leoli/Projects/ourchival-air-blue-runtime";
const root = fileURLToPath(new URL("../", import.meta.url)).replace(/\/$/, "");
if (root === canonical && await realpath(root) === canonical) {
  const marker = await readFile(`${installed}/.ourchival-extension-install`, "utf8").catch(() => "");
  if (marker === `Managed build output from ${canonical} only.\n`) {
    if (!(await lstat(installed)).isDirectory()) throw new Error("Installation must be a physical directory");
    await cp(`${root}/apps/extension/dist`, `${installed}/apps/extension/dist`, { recursive: true });
    console.log("Refreshed established Edge installation; reload Ourchival Clipper in Edge.");
  }
}
