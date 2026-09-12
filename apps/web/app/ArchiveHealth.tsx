"use client";

import { useEffect, useState } from "react";
import { privateFetch } from "./privateAccess";

type MigrationStatus = {
  status: string;
  scanned: number;
  upgraded: number;
  alreadyCurrent: number;
  skipped: number;
  failed: number;
  reclaimedBytes: number;
  pending: number;
  message: string | null;
  updatedAt: number;
};

type PipelineStatus = {
  ok: boolean;
  migration: MigrationStatus | null;
  drive: Record<string, number>;
  backgroundYielding: boolean;
  error?: string;
};

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

function migrationLine(migration: MigrationStatus | null) {
  if (!migration) return "Not started yet.";
  const parts = [`${migration.upgraded.toLocaleString()} previews refreshed`];
  if (migration.failed > 0) parts.push(`${migration.failed} need retry`);
  if (migration.status === "paused") parts.push("paused — will resume");
  if (migration.status === "complete") parts.push("complete");
  return parts.join(" · ") + ".";
}

// Secondary disclosure inside Settings: background copy progress in plain
// language. Mounts when the panel opens; polls gently while visible.
export function ArchiveHealth({ siteUrl }: { siteUrl: string }) {
  const [status, setStatus] = useState<PipelineStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await privateFetch(`${siteUrl}/pipeline-status`, {
          cache: "no-store",
        });
        if (cancelled) return;
        setStatus((await response.json()) as PipelineStatus);
      } catch {
        if (!cancelled) setStatus({ ok: false, migration: null, drive: {}, backgroundYielding: false });
      }
    };
    void load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [siteUrl]);

  const drive = status?.drive ?? {};
  const done = drive.succeeded ?? 0;
  const active = (drive.queued ?? 0) + (drive.running ?? 0);
  return (
    <details className="browser-connection">
      <summary>Archive health</summary>
      {!status ? (
        <p>Checking background work…</p>
      ) : !status.ok ? (
        <p>Couldn&apos;t load health right now. Your archive is unaffected.</p>
      ) : (
        <>
          <p>
            <strong>Smaller previews:</strong> {migrationLine(status.migration)}{" "}
            {status.migration && status.migration.reclaimedBytes > 0
              ? `${formatBytes(status.migration.reclaimedBytes)} reclaimed.`
              : null}
          </p>
          <p>
            <strong>Drive copies:</strong>{" "}
            {done === 0 && active === 0
              ? "Not started yet."
              : `${done.toLocaleString()} done${active > 0 ? ` · ${active} in progress` : ""}.`}
          </p>
          <p>
            {status.backgroundYielding
              ? "Background work is paused while you browse."
              : "Background work is running."}
          </p>
        </>
      )}
    </details>
  );
}
