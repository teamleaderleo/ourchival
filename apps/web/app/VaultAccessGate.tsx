"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  clearOwnerAccessKey,
  getOwnerAccessKey,
  onOwnerAccessChange,
  resolveConvexSiteUrl,
  saveOwnerAccessKey,
} from "./privateAccess";

export function VaultAccessGate({ children }: { children: React.ReactNode }) {
  const [accessKey, setAccessKey] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [checking, setChecking] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const refresh = () => {
      const stored = getOwnerAccessKey();
      setAccessKey(stored);
      if (stored) void verify(stored, true);
      else {
        setUnlocked(false);
        setChecking(false);
      }
    };
    refresh();
    return onOwnerAccessChange(refresh);
  }, []);

  async function verify(key: string, quiet = false) {
    const siteUrl = resolveConvexSiteUrl();
    if (!siteUrl) {
      setMessage("Add NEXT_PUBLIC_CONVEX_URL or NEXT_PUBLIC_CONVEX_SITE_URL first.");
      setChecking(false);
      return false;
    }

    setChecking(true);
    if (!quiet) setMessage("Unlocking…");
    try {
      const response = await fetch(`${siteUrl}/auth-check`, {
        headers: { Authorization: `Bearer ${key.trim()}` },
      });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || body.ok === false) {
        clearOwnerAccessKey();
        setUnlocked(false);
        setMessage(body.error ?? "That access key was rejected.");
        return false;
      }
      saveOwnerAccessKey(key);
      setUnlocked(true);
      setMessage("");
      return true;
    } catch (error) {
      setUnlocked(false);
      setMessage(error instanceof Error ? error.message : "Ourchival could not be reached.");
      return false;
    } finally {
      setChecking(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessKey.trim()) return;
    await verify(accessKey);
  }

  if (unlocked) return <>{children}</>;

  return (
    <main className="access-screen">
      <section className="access-card" aria-busy={checking}>
        <div className="brand-mark" aria-hidden="true">O</div>
        <p className="eyebrow">Private archive</p>
        <h1>Unlock Ourchival</h1>
        <p>
          Enter the owner access key configured for this vault. It stays on this browser
          until you lock the app.
        </p>
        <form onSubmit={submit}>
          <label>
            Owner access key
            <input
              type="password"
              autoComplete="current-password"
              value={accessKey}
              onChange={(event) => setAccessKey(event.target.value)}
              autoFocus
            />
          </label>
          <button className="button primary" disabled={checking || !accessKey.trim()}>
            {checking ? "Checking…" : "Unlock vault"}
          </button>
        </form>
        {message ? <p className="access-message" role="alert">{message}</p> : null}
      </section>
    </main>
  );
}
