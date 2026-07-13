"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  filterReferences,
  getSelectedReference,
  type ReferenceLane,
  type SavedReference,
} from "./referenceVaultModel";
import { type VaultView } from "./VaultNavigation";

type ReferencesResponse = {
  ok: boolean;
  references?: SavedReference[];
  error?: string;
};
type StatusTone = "info" | "success" | "error";

export function useReferenceVault() {
  const siteUrl = useMemo(resolveConvexSiteUrl, []);
  const [references, setReferences] = useState<SavedReference[]>([]);
  const [status, setStatus] = useState("Loading saved references…");
  const [statusTone, setStatusTone] = useState<StatusTone>("info");
  const [refreshKey, setRefreshKey] = useState(0);
  const [sourceUrl, setSourceUrl] = useState("");
  const [assetUrl, setAssetUrl] = useState("");
  const [pageTitle, setPageTitle] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [activeView, setActiveView] = useState<VaultView>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);

  function report(message: string, tone: StatusTone = "info") {
    setStatus(message);
    setStatusTone(tone);
  }
  const lane: ReferenceLane =
    activeView === "images" || activeView === "links" ? activeView : "all";
  const favoritesOnly = activeView === "favorites";
  const filteredReferences = useMemo(
    () => filterReferences(references, { query, favoritesOnly, lane }),
    [query, references, favoritesOnly, lane],
  );
  const selectedReference = getSelectedReference(
    filteredReferences,
    selectedId,
  );
  const favoriteCount = references.filter(
    (reference) => reference.favorite,
  ).length;
  const imageCount = filterReferences(references, { lane: "images" }).length;
  const linkCount = filterReferences(references, { lane: "links" }).length;

  useEffect(() => {
    if (!siteUrl) {
      report(
        "Add NEXT_PUBLIC_CONVEX_URL or NEXT_PUBLIC_CONVEX_SITE_URL in setup to load saved references.",
        "error",
      );
      return;
    }
    let cancelled = false;
    async function loadReferences() {
      try {
        const response = await fetch(`${siteUrl}/references`);
        const body = (await response.json()) as ReferencesResponse;
        if (cancelled) return;
        if (!response.ok || body.ok === false)
          return report(body.error ?? response.statusText, "error");
        setReferences(body.references ?? []);
        report(`Synced ${body.references?.length ?? 0} references.`);
      } catch (error) {
        if (!cancelled)
          report(
            error instanceof Error
              ? error.message
              : "Could not load saved references.",
            "error",
          );
      }
    }
    void loadReferences();
    const timer = window.setInterval(loadReferences, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [siteUrl, refreshKey]);

  async function saveManualReference(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!siteUrl) {
      report("Add a Convex site URL in setup before saving.", "error");
      setSetupOpen(true);
      return;
    }
    setIsSaving(true);
    report("Saving reference…");
    try {
      const response = await fetch(`${siteUrl}/capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: assetUrl.trim() ? "image" : "link",
          sourceUrl,
          assetUrl,
          pageTitle,
          capturedAt: new Date().toISOString(),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        storageStatus?: string;
      };
      if (!response.ok || body.ok === false)
        return report(body.error ?? response.statusText, "error");
      setSourceUrl("");
      setAssetUrl("");
      setPageTitle("");
      setCaptureOpen(false);
      setRefreshKey((key) => key + 1);
      report(`Saved reference. ${body.storageStatus ?? ""}`.trim(), "success");
    } catch (error) {
      report(
        error instanceof Error ? error.message : "Could not save reference.",
        "error",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function patchReference(
    referenceId: string,
    patch: Partial<SavedReference>,
  ) {
    if (!siteUrl) {
      report("Add a Convex site URL in setup before editing.", "error");
      setSetupOpen(true);
      return false;
    }
    try {
      const response = await fetch(
        `${siteUrl}/reference?id=${encodeURIComponent(referenceId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || body.ok === false) {
        report(body.error ?? response.statusText, "error");
        return false;
      }
      setReferences((items) =>
        items.map((item) =>
          item._id === referenceId ? { ...item, ...patch } : item,
        ),
      );
      return true;
    } catch (error) {
      report(
        error instanceof Error ? error.message : "Could not update reference.",
        "error",
      );
      return false;
    }
  }

  async function toggleFavorite(reference: SavedReference) {
    const next = !reference.favorite;
    if (await patchReference(reference._id, { favorite: next }))
      report(
        next ? "Added to favorites." : "Removed from favorites.",
        "success",
      );
  }

  async function saveDetails(
    referenceId: string,
    patch: { title?: string; notes?: string },
  ) {
    const ok = await patchReference(referenceId, patch);
    if (ok) report("Reference details saved.", "success");
    return ok;
  }

  async function deleteReference(referenceId: string) {
    if (
      !siteUrl ||
      !window.confirm(
        "Remove this reference from Reliquary? The original Drive file will stay in place.",
      )
    )
      return;
    try {
      const response = await fetch(
        `${siteUrl}/reference?id=${encodeURIComponent(referenceId)}`,
        { method: "DELETE" },
      );
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || body.ok === false)
        return report(body.error ?? response.statusText, "error");
      setReferences((items) =>
        items.filter((item) => item._id !== referenceId),
      );
      setSelectedId(null);
      report("Reference removed. Original file kept.", "success");
    } catch (error) {
      report(
        error instanceof Error ? error.message : "Could not delete reference.",
        "error",
      );
    }
  }

  async function copyEndpoint() {
    if (!siteUrl)
      return report(
        "Add a Convex site URL before copying the endpoint.",
        "error",
      );
    try {
      await navigator.clipboard.writeText(`${siteUrl}/capture`);
      report("Clipper endpoint copied.", "success");
    } catch {
      report(
        "Could not copy the endpoint. Select the text and copy it manually.",
        "error",
      );
    }
  }

  function changeView(view: VaultView) {
    setActiveView(view);
    setSelectedId(null);
  }

  return {
    siteUrl,
    references,
    status,
    statusTone,
    sourceUrl,
    setSourceUrl,
    assetUrl,
    setAssetUrl,
    pageTitle,
    setPageTitle,
    isSaving,
    query,
    setQuery,
    activeView,
    selectedReference,
    filteredReferences,
    favoriteCount,
    imageCount,
    linkCount,
    selectedId,
    setSelectedId,
    captureOpen,
    setCaptureOpen,
    setupOpen,
    setSetupOpen,
    saveManualReference,
    toggleFavorite,
    saveDetails,
    deleteReference,
    copyEndpoint,
    changeView,
  };
}

function resolveConvexSiteUrl() {
  const explicit = process.env.NEXT_PUBLIC_CONVEX_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  if (!convexUrl) return undefined;
  return convexUrl.replace(/\.convex\.cloud\/?$/, ".convex.site");
}
