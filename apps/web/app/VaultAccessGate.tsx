"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@workos-inc/authkit-nextjs/components";
import { makeFunctionReference } from "convex/server";
import { useConvexAuth, useMutation } from "convex/react";
import {
  clearOwnerAccessKey,
  clearVaultAccessToken,
  getOwnerAccessKey,
  resolveConvexSiteUrl,
  saveOwnerAccessKey,
  setVaultAccessToken,
} from "./privateAccess";

type ClipperDevice = {
  _id: string;
  name: string;
  createdAt: number;
  lastUsedAt?: number;
  revokedAt?: number;
  extensionVersion?: string;
};

type VaultMode = "workos" | "recovery";

type MintOwnerSessionResult = {
  token: string;
  expiresAt: number;
  subject: string;
};

const mintOwnerSessionReference = makeFunctionReference<
  "mutation",
  Record<string, never>,
  MintOwnerSessionResult
>("workosSessions:mintOwnerSession");

export function VaultAccessGate({ children }: { children: React.ReactNode }) {
  const { user, loading: workosLoading, signOut } = useAuth();
  const { isAuthenticated, isLoading: convexLoading } = useConvexAuth();
  const mintOwnerSession = useMutation(mintOwnerSessionReference);
  const [recoveryKey, setRecoveryKey] = useState("");
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [mode, setMode] = useState<VaultMode>();
  const [checking, setChecking] = useState(true);
  const [message, setMessage] = useState("");

  const verifyRecovery = useCallback(async (key: string, quiet = false) => {
    const siteUrl = resolveConvexSiteUrl();
    if (!siteUrl) {
      setMessage("Add NEXT_PUBLIC_CONVEX_URL or NEXT_PUBLIC_CONVEX_SITE_URL first.");
      setChecking(false);
      return false;
    }

    setChecking(true);
    if (!quiet) setMessage("Unlocking with the recovery key…");
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
        setMode(undefined);
        setMessage(body.error ?? "That recovery key was rejected.");
        return false;
      }
      clearVaultAccessToken();
      saveOwnerAccessKey(key);
      setRecoveryKey(key);
      setMode("recovery");
      setUnlocked(true);
      setMessage("");
      return true;
    } catch (error) {
      setUnlocked(false);
      setMode(undefined);
      setMessage(
        error instanceof Error ? error.message : "Ourchival could not be reached.",
      );
      return false;
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;

    async function mintWorkosVaultSession() {
      setChecking(true);
      setMessage("Opening your private vault…");
      try {
        const session = await mintOwnerSession({});
        if (cancelled) return;
        clearOwnerAccessKey();
        setVaultAccessToken(session.token);
        setMode("workos");
        setUnlocked(true);
        setMessage("");
        const refreshDelay = Math.max(60_000, session.expiresAt - Date.now() - 90_000);
        refreshTimer = setTimeout(() => void mintWorkosVaultSession(), refreshDelay);
      } catch (error) {
        if (cancelled) return;
        clearVaultAccessToken();
        setMode(undefined);
        setUnlocked(false);
        setMessage(
          error instanceof Error
            ? error.message
            : "This WorkOS account could not open the vault.",
        );
      } finally {
        if (!cancelled) setChecking(false);
      }
    }

    if (workosLoading) return () => undefined;

    if (user) {
      clearOwnerAccessKey();
      if (convexLoading) return () => undefined;
      if (!isAuthenticated) {
        clearVaultAccessToken();
        setUnlocked(false);
        setMode(undefined);
        setChecking(false);
        setMessage("Convex could not verify the WorkOS session.");
        return () => undefined;
      }
      void mintWorkosVaultSession();
    } else {
      clearVaultAccessToken();
      const storedRecoveryKey = getOwnerAccessKey();
      setRecoveryKey(storedRecoveryKey);
      if (storedRecoveryKey) void verifyRecovery(storedRecoveryKey, true);
      else {
        setUnlocked(false);
        setMode(undefined);
        setChecking(false);
        setMessage("");
      }
    }

    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [convexLoading, isAuthenticated, mintOwnerSession, user, verifyRecovery, workosLoading]);

  async function submitRecovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!recoveryKey.trim()) return;
    await verifyRecovery(recoveryKey);
  }

  async function exitVault() {
    clearVaultAccessToken();
    setUnlocked(false);
    setMode(undefined);
    if (mode === "workos") {
      await signOut({ returnTo: "/" });
      return;
    }
    clearOwnerAccessKey();
    setRecoveryKey("");
  }

  if (unlocked && mode) {
    const accountLabel =
      mode === "workos"
        ? user?.email || [user?.firstName, user?.lastName].filter(Boolean).join(" ")
        : "Recovery access";
    return (
      <UnlockedVault
        mode={mode}
        accountLabel={accountLabel || "WorkOS account"}
        onExit={exitVault}
      >
        {children}
      </UnlockedVault>
    );
  }

  if (checking || workosLoading || (user && convexLoading)) {
    return (
      <main className="access-screen">
        <section className="access-card" aria-busy="true">
          <div className="brand-mark" aria-hidden="true">O</div>
          <p className="eyebrow">Private archive</p>
          <h1>Opening Ourchival</h1>
          <p>{message || "Checking your private session…"}</p>
        </section>
      </main>
    );
  }

  if (user) {
    return (
      <main className="access-screen">
        <section className="access-card">
          <div className="brand-mark" aria-hidden="true">O</div>
          <p className="eyebrow">Account needs access</p>
          <h1>This Google account is signed in</h1>
          <p>
            Add the WorkOS user ID below to the Convex owner allowlist, then reload the
            vault.
          </p>
          <div className="access-identity">
            <span>{user.email}</span>
            <code>{user.id}</code>
          </div>
          {message ? <p className="access-message" role="alert">{message}</p> : null}
          <button
            type="button"
            className="button ghost full-width"
            onClick={() => void signOut({ returnTo: "/" })}
          >
            Sign out
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="access-screen">
      <section className="access-card">
        <div className="brand-mark" aria-hidden="true">O</div>
        <p className="eyebrow">Private archive</p>
        <h1>Sign in to Ourchival</h1>
        <p>
          Continue with Google through WorkOS. Ourchival then creates a short-lived vault
          session for this browser.
        </p>
        <a className="button primary full-width" href="/sign-in">
          Continue with Google
        </a>
        <button
          type="button"
          className="button ghost full-width"
          onClick={() => setRecoveryOpen((open) => !open)}
        >
          {recoveryOpen ? "Hide recovery access" : "Use recovery key"}
        </button>
        {recoveryOpen ? (
          <form onSubmit={submitRecovery}>
            <label>
              Owner recovery key
              <input
                type="password"
                autoComplete="current-password"
                value={recoveryKey}
                onChange={(event) => setRecoveryKey(event.target.value)}
              />
            </label>
            <button className="button secondary" disabled={!recoveryKey.trim()}>
              Unlock with recovery key
            </button>
          </form>
        ) : null}
        {message ? <p className="access-message" role="alert">{message}</p> : null}
      </section>
    </main>
  );
}

function UnlockedVault({
  mode,
  accountLabel,
  onExit,
  children,
}: {
  mode: VaultMode;
  accountLabel: string;
  onExit: () => Promise<void>;
  children: React.ReactNode;
}) {
  const siteUrl = useMemo(resolveConvexSiteUrl, []);
  const [panelOpen, setPanelOpen] = useState(false);
  const [pairingCode, setPairingCode] = useState("");
  const [pairingExpiresAt, setPairingExpiresAt] = useState<number | undefined>();
  const [devices, setDevices] = useState<ClipperDevice[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (panelOpen) void loadDevices();
  }, [panelOpen]);

  async function loadDevices() {
    if (!siteUrl) return;
    try {
      const response = await fetch(`${siteUrl}/clipper-devices`);
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        devices?: ClipperDevice[];
      };
      if (!response.ok || body.ok === false) throw new Error(body.error || response.statusText);
      setDevices(body.devices ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load paired devices.");
    }
  }

  async function createPairing() {
    if (!siteUrl) return;
    setBusy(true);
    setMessage("Creating a one-time code…");
    try {
      const response = await fetch(`${siteUrl}/clipper-pairing`, { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        code?: string;
        expiresAt?: number;
      };
      if (!response.ok || body.ok === false || !body.code) {
        throw new Error(body.error || response.statusText);
      }
      setPairingCode(body.code);
      setPairingExpiresAt(body.expiresAt);
      setMessage("Enter this code in the Ourchival Clipper popup.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create a pairing code.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeDevice(deviceId: string) {
    if (!siteUrl) return;
    setBusy(true);
    setMessage("Revoking Clipper…");
    try {
      const response = await fetch(
        `${siteUrl}/clipper-devices?id=${encodeURIComponent(deviceId)}`,
        { method: "DELETE" },
      );
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || body.ok === false) throw new Error(body.error || response.statusText);
      setMessage("Clipper revoked.");
      await loadDevices();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not revoke that Clipper.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="vault-session-controls">
        <span className="vault-account-label" title={accountLabel}>{accountLabel}</span>
        <button
          type="button"
          className="button ghost"
          onClick={() => setPanelOpen((open) => !open)}
        >
          Clipper access
        </button>
        <button type="button" className="button ghost" onClick={() => void onExit()}>
          {mode === "workos" ? "Sign out" : "Lock"}
        </button>
      </div>

      {panelOpen ? (
        <aside className="clipper-access-panel" aria-label="Clipper access">
          <div className="clipper-access-heading">
            <div>
              <p className="eyebrow">Private capture</p>
              <h2>Pair Ourchival Clipper</h2>
            </div>
            <button
              type="button"
              className="button ghost"
              onClick={() => setPanelOpen(false)}
            >
              Close
            </button>
          </div>
          <p>
            Generate a short-lived code, then enter it in the browser extension. Each
            browser receives its own revocable credential.
          </p>
          <button
            type="button"
            className="button primary full-width"
            onClick={() => void createPairing()}
            disabled={busy}
          >
            {busy ? "Working…" : "Create pairing code"}
          </button>
          {pairingCode ? (
            <div className="pairing-code">
              <strong>{pairingCode}</strong>
              <span>
                Expires {pairingExpiresAt ? formatRelativeExpiry(pairingExpiresAt) : "soon"}
              </span>
            </div>
          ) : null}
          {message ? <p className="clipper-access-message">{message}</p> : null}

          <div className="paired-device-list">
            <div>
              <strong>Paired browsers</strong>
              <span>{devices.filter((device) => !device.revokedAt).length} active</span>
            </div>
            {devices.length > 0 ? (
              devices.map((device) => (
                <article key={device._id} className={device.revokedAt ? "revoked" : ""}>
                  <div>
                    <strong>{device.name}</strong>
                    <span>
                      {device.revokedAt
                        ? "Revoked"
                        : device.lastUsedAt
                          ? `Last used ${formatDate(device.lastUsedAt)}`
                          : `Paired ${formatDate(device.createdAt)}`}
                    </span>
                  </div>
                  {!device.revokedAt ? (
                    <button
                      type="button"
                      className="button danger"
                      onClick={() => void revokeDevice(device._id)}
                      disabled={busy}
                    >
                      Revoke
                    </button>
                  ) : null}
                </article>
              ))
            ) : (
              <p>No browsers paired yet.</p>
            )}
          </div>
        </aside>
      ) : null}

      {children}
    </>
  );
}

function formatDate(value: number) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatRelativeExpiry(value: number) {
  const minutes = Math.max(1, Math.ceil((value - Date.now()) / 60_000));
  return `in ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}
