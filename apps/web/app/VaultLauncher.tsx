"use client";

import { useEffect, useState } from "react";
import { BrandMark } from "./BrandMark";
import Link from "next/link";

export function VaultLauncher() {
  const [destination, setDestination] = useState("http://127.0.0.1:3000/");
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    const target = new URL("http://127.0.0.1:3000/");
    target.pathname = window.location.pathname;
    target.search = window.location.search;
    target.hash = window.location.hash;
    setDestination(target.href);
    const timer = window.setTimeout(() => setShowHelp(true), 4000);
    // Replace the launcher so Back does not immediately send the user here again.
    window.location.replace(target.href);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <main className="access-screen">
      <section className="access-card">
        <BrandMark />
        <p className="eyebrow">Your archive</p>
        <h1 aria-live="polite">{showHelp ? "Still here?" : "Opening your archive…"}</h1>
        <p>{showHelp
          ? "If your browser stopped the automatic opening, continue below."
          : "Taking you to Ourchival on Air Blue."}</p>
        <a className="button primary" href={destination}>
          Continue to archive
        </a>
        {showHelp && <p>
          Open this on Air Blue with the archive running. Files in Google Drive
          remain saved when the Mac is offline.
        </p>}
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
