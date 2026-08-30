"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { GoogleOwnerSignIn } from "./GoogleOwnerSignIn";
import {
  clearOwnerAccessKey,
  getOwnerAccessKey,
  isOwnerCredentialRejection,
  onOwnerAccessChange,
  ownerAuthRequestErrorMessage,
  resolveConvexSiteUrl,
  saveOwnerAccessKey,
} from "./privateAccess";

const ownerAuthCheckTimeoutMs = 8_000;

type ClipperDevice = {
  _id: string;
  name: string;
  createdAt: number;
  lastUsedAt?: number;
  revokedAt?: number;
  extensionVersion?: string;
};

export function VaultAccessGate({ children }: { children: React.ReactNode }) {
  const [accessKey, setAccessKey] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [checking, setChecking] = useState(true);
  const [sessionUnavailable, setSessionUnavailable] = useState(false);
  const [message, setMessage] = useState("");
  const verificationSequence = useRef(0);
  const googleEnabled = Boolean(
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim(),
  );

  useEffect(() => {
    const refresh = () => {
      const stored = getOwnerAccessKey();
      setAccessKey(stored);
      if (stored) {
        setSessionUnavailable(false);
        void verify(stored, true);
      } else {
        setUnlocked(false);
        setSessionUnavailable(false);
        setChecking(false);
      }
    };
    refresh();
    return onOwnerAccessChange(refresh);
  }, []);

  async function verify(key: string, quiet = false) {
    const sequence = ++verificationSequence.current;
    const siteUrl = resolveConvexSiteUrl();
    if (!siteUrl) {
      setMessage(
        "Add NEXT_PUBLIC_CONVEX_URL or NEXT_PUBLIC_CONVEX_SITE_URL first.",
      );
      setChecking(false);
      return false;
    }

    setChecking(true);
    setSessionUnavailable(false);
    if (!quiet) setMessage("Signing in…");
    try {
      const response = await fetch(`${siteUrl}/auth-check`, {
        headers: { Authorization: `Bearer ${key.trim()}` },
        signal: AbortSignal.timeout(ownerAuthCheckTimeoutMs),
      });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        credential?: string;
      };
      if (sequence !== verificationSequence.current) return false;
      if (!response.ok || body.ok === false) {
        if (!isOwnerCredentialRejection(response.status)) {
          setUnlocked(false);
          setSessionUnavailable(Boolean(getOwnerAccessKey()));
          setMessage(
            "Ourchival is temporarily unreachable. Your saved session is still available.",
          );
          return false;
        }
        clearOwnerAccessKey();
        setUnlocked(false);
        setSessionUnavailable(false);
        setMessage(body.error ?? "That sign-in or recovery key was rejected.");
        return false;
      }
      const verifiedCredential = body.credential?.trim() || key;
      saveOwnerAccessKey(verifiedCredential, { broadcast: false });
      setAccessKey(verifiedCredential);
      setUnlocked(true);
      setSessionUnavailable(false);
      setMessage("");
      return true;
    } catch (error) {
      if (sequence !== verificationSequence.current) return false;
      const hasSavedSession = Boolean(quiet && getOwnerAccessKey());
      setUnlocked(false);
      setSessionUnavailable(hasSavedSession);
      setMessage(ownerAuthRequestErrorMessage(error, hasSavedSession));
      return false;
    } finally {
      if (sequence === verificationSequence.current) setChecking(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessKey.trim()) return;
    await verify(accessKey);
  }

  async function acceptGoogleCredential(credential: string) {
    setAccessKey(credential);
    await verify(credential);
  }

  function forgetSavedSession() {
    setSessionUnavailable(false);
    setMessage("");
    clearOwnerAccessKey();
  }

  if (checking && !unlocked) {
    return (
      <AccessStatusCard
        title="Opening your vault"
        message="Checking the saved Ourchival session…"
        busy
      />
    );
  }

  if (sessionUnavailable && accessKey) {
    return (
      <AccessStatusCard
        title="Vault temporarily unavailable"
        message={message}
        primaryLabel="Try again"
        onPrimary={() => void verify(accessKey, true)}
        secondaryLabel="Sign in again"
        onSecondary={forgetSavedSession}
      />
    );
  }

  if (unlocked) {
    return <UnlockedVault>{children}</UnlockedVault>;
  }

  return (
    <main className="access-screen">
      <section className="access-card" aria-busy={checking}>
        <div className="brand-mark" aria-hidden="true">
          O
        </div>
        <p className="eyebrow">Private archive</p>
        <h1>Sign in to Ourchival</h1>
        <p>
          Continue with the Google account connected to this vault. A recovery
          key stays available as a fallback.
        </p>

        <GoogleOwnerSignIn
          onCredential={acceptGoogleCredential}
          disabled={checking}
        />

        <details className="recovery-access" open={!googleEnabled}>
          <summary>Use recovery key</summary>
          <form onSubmit={submit}>
            <label>
              Owner recovery key
              <input
                type="password"
                autoComplete="current-password"
                value={accessKey}
                onChange={(event) => setAccessKey(event.target.value)}
                autoFocus={!googleEnabled}
              />
            </label>
            <button
              className="button primary"
              disabled={checking || !accessKey.trim()}
            >
              {checking ? "Checking…" : "Unlock vault"}
            </button>
          </form>
        </details>
        {message ? (
          <p className="access-message" role="alert">
            {message}
          </p>
        ) : null}
      </section>
    </main>
  );
}

function AccessStatusCard({
  title,
  message,
  busy = false,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
}: {
  title: string;
  message: string;
  busy?: boolean;
  primaryLabel?: string;
  onPrimary?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}) {
  return (
    <main className="access-screen">
      <section className="access-card access-status-card" aria-busy={busy}>
        <div className="brand-mark" aria-hidden="true">
          O
        </div>
        <p className="eyebrow">Private archive</p>
        <h1>{title}</h1>
        <p>{message}</p>
        {busy ? <span className="access-progress" aria-hidden="true" /> : null}
        {primaryLabel && onPrimary ? (
          <div className="access-status-actions">
            <button
              type="button"
              className="button primary"
              onClick={onPrimary}
            >
              {primaryLabel}
            </button>
            {secondaryLabel && onSecondary ? (
              <button
                type="button"
                className="button ghost"
                onClick={onSecondary}
              >
                {secondaryLabel}
              </button>
            ) : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}

function UnlockedVault({ children }: { children: React.ReactNode }) {
  const siteUrl = useMemo(resolveConvexSiteUrl, []);
  const [panelOpen, setPanelOpen] = useState(false);
  const [pairingCode, setPairingCode] = useState("");
  const [pairingExpiresAt, setPairingExpiresAt] = useState<
    number | undefined
  >();
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
      if (!response.ok || body.ok === false)
        throw new Error(body.error || response.statusText);
      setDevices(body.devices ?? []);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not load paired devices.",
      );
    }
  }

  async function createPairing() {
    if (!siteUrl) return;
    setBusy(true);
    setMessage("Creating a one-time code…");
    try {
      const response = await fetch(`${siteUrl}/clipper-pairing`, {
        method: "POST",
      });
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
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not create a pairing code.",
      );
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
      if (!response.ok || body.ok === false)
        throw new Error(body.error || response.statusText);
      setMessage("Clipper revoked.");
      await loadDevices();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not revoke that Clipper.",
      );
    } finally {
      setBusy(false);
    }
  }

  function lockVault() {
    clearOwnerAccessKey();
  }

  return (
    <>
      <div className="vault-session-controls">
        <button
          type="button"
          className="button ghost"
          aria-expanded={panelOpen}
          aria-controls="vault-account-panel"
          onClick={() => setPanelOpen((open) => !open)}
        >
          Account
        </button>
      </div>

      {panelOpen ? (
        <aside
          id="vault-account-panel"
          className="clipper-access-panel"
          aria-label="Account and Clipper access"
        >
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
            Generate a short-lived code, then enter it in the browser extension.
            Each browser receives its own revocable credential.
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
                Expires{" "}
                {pairingExpiresAt
                  ? formatRelativeExpiry(pairingExpiresAt)
                  : "soon"}
              </span>
            </div>
          ) : null}
          {message ? <p className="clipper-access-message">{message}</p> : null}

          <div className="paired-device-list">
            <div>
              <strong>Paired browsers</strong>
              <span>
                {devices.filter((device) => !device.revokedAt).length} active
              </span>
            </div>
            {devices.length > 0 ? (
              devices.map((device) => (
                <article
                  key={device._id}
                  className={device.revokedAt ? "revoked" : ""}
                >
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

          <div className="clipper-access-footer">
            <span>Finished on this device?</span>
            <button
              type="button"
              className="button ghost"
              onClick={lockVault}
            >
              Lock vault
            </button>
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
