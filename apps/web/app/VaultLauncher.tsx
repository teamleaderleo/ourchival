import { BrandMark } from "./BrandMark";
import Link from "next/link";

export function VaultLauncher() {
  return (
    <main className="access-screen">
      <section className="access-card">
        <BrandMark />
        <p className="eyebrow">Your archive</p>
        <h1>Open Ourchival on Air Blue</h1>
        <p>
          Your images, tags, and import progress live in the working vault on
          your Mac. Open it here when you’re using Air Blue.
        </p>
        <a className="button primary" href="http://127.0.0.1:3000/">
          Open the working archive
        </a>
        <p className="access-message">
          Air Blue needs to be awake. If the archive does not open, sign in to
          your Mac and try again.
        </p>
        <details>
          <summary>Backups and earlier captures</summary>
          <p>
            Drive backups preserve the catalog and locally stored files. A
            backup is a recovery copy; it does not run the archive while the Mac
            is off.
          </p>
          <Link href="/hosted" prefetch={false}>Open the separate earlier hosted catalog</Link>
        </details>
      </section>
    </main>
  );
}
