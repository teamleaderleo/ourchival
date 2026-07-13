"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  filterReferences,
  getSelectedReference,
  referenceCollection,
  type ReferenceCollection,
  type ReferenceLane,
  type SavedReference,
} from "./referenceVaultModel";
import { type VaultView } from "./VaultNavigation";

type ReferencesResponse = {
  ok: boolean;
  references?: SavedReference[];
  error?: string;
};

type CaptureResponse = {
  ok?: boolean;
  error?: string;
  storageStatus?: string;
  alreadySaved?: boolean;
  referenceId?: string;
  existingReference?: {
    title?: string;
    sourceUrl: string;
    capturedAt: number;
    favorite: boolean;
    boardCount: number;
  };
};

type StatusTone = "info" | "success" | "error";
export type TriageDestination = "keep" | "later" | "archive" | "trash" | "restore";

type UndoMove = {
  referenceId: string;
  title: string;
  previous: Pick<SavedReference, "triageState" | "archived" | "deleted">;
};

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
  const [activeView, setActiveView] = useState<VaultView>("inbox");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [undoMove, setUndoMove] = useState<UndoMove | null>(null);

  function report(message: string, tone: StatusTone = "info") {
    setStatus(message);
    setStatusTone(tone);
  }

  const collection = collectionForView(activeView);
  const lane: ReferenceLane =
    activeView === "images" || activeView === "links" ? activeView : "all";
  const favoritesOnly = activeView === "favorites";
  const filteredReferences = useMemo(
    () =>
      filterReferences(references, {
        query,
        favoritesOnly,
        lane,
        collection,
      }),
    [query, references, favoritesOnly, lane, collection],
  );
  const selectedReference = getSelectedReference(
    filteredReferences,
    selectedId,
  );

  const libraryReferences = useMemo(
    () => filterReferences(references, { collection: "library" }),
    [references],
  );
  const inboxCount = filterReferences(references, { collection: "inbox" }).length;
  const laterCount = filterReferences(references, { collection: "later" }).length;
  const archiveCount = filterReferences(references, { collection: "archive" }).length;
  const trashCount = filterReferences(references, { collection: "trash" }).length;
  const favoriteCount = filterReferences(libraryReferences, { favoritesOnly: true }).length;
  const imageCount = filterReferences(libraryReferences, { lane: "images" }).length;
  const linkCount = filterReferences(libraryReferences, { lane: "links" }).length;

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
        if (!response.ok || body.ok === false) {
          report(body.error ?? response.statusText, "error");
          return;
        }
        setReferences(body.references ?? []);
        report(`Synced ${body.references?.length ?? 0} references.`);
      } catch (error) {
        if (!cancelled) {
          report(
            error instanceof Error
              ? error.message
              : "Could not load saved references.",
            "error",
          );
        }
      }
    }

    void loadReferences();
    const timer = window.setInterval(loadReferences, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [siteUrl, refreshKey]);

  useEffect(() => {
    if (activeView !== "inbox" && activeView !== "later") return;

    function handleReviewKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }

      if (!selectedReference) return;
      const key = event.key.toLowerCase();

      if (key === "arrowright" || key === "arrowdown") {
        event.preventDefault();
        selectRelative(1);
      } else if (key === "arrowleft" || key === "arrowup") {
        event.preventDefault();
        selectRelative(-1);
      } else if (key === "k") {
        event.preventDefault();
        void moveReference(selectedReference._id, "keep");
      } else if (key === "l") {
        event.preventDefault();
        void moveReference(selectedReference._id, "later");
      } else if (key === "a") {
        event.preventDefault();
        void moveReference(selectedReference._id, "archive");
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        void moveReference(selectedReference._id, "trash");
      } else if (key === "o") {
        event.preventDefault();
        window.open(selectedReference.sourceUrl, "_blank", "noopener,noreferrer");
        void markReferenceOpened(selectedReference);
      }
    }

    window.addEventListener("keydown", handleReviewKey);
    return () => window.removeEventListener("keydown", handleReviewKey);
  }, [activeView, filteredReferences, selectedReference]);

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
      const body = (await response.json().catch(() => ({}))) as CaptureResponse;
      if (!response.ok || body.ok === false) {
        report(body.error ?? response.statusText, "error");
        return;
      }

      setSourceUrl("");
      setAssetUrl("");
      setPageTitle("");
      setCaptureOpen(false);
      setRefreshKey((key) => key + 1);

      if (body.alreadySaved) {
        setActiveView("all");
        setSelectedId(body.referenceId ?? null);
        report(formatDuplicateStatus(body.existingReference), "success");
        return;
      }

      setActiveView("inbox");
      setSelectedId(body.referenceId ?? null);
      report(`Saved to Inbox. ${body.storageStatus ?? ""}`.trim(), "success");
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
    if (await patchReference(reference._id, { favorite: next })) {
      report(
        next ? "Added to favorites." : "Removed from favorites.",
        "success",
      );
    }
  }

  async function saveDetails(
    referenceId: string,
    patch: { title?: string; notes?: string },
  ) {
    const ok = await patchReference(referenceId, patch);
    if (ok) report("Reference details saved.", "success");
    return ok;
  }

  async function moveReference(
    referenceId: string,
    destination: TriageDestination,
  ) {
    const reference = references.find((item) => item._id === referenceId);
    if (!reference) return false;

    const nextId = nextVisibleReferenceId(referenceId);
    const patch = triagePatch(reference, destination, Date.now());
    const previous: UndoMove["previous"] = {
      triageState: reference.triageState,
      archived: reference.archived,
      deleted: reference.deleted,
    };

    if (!(await patchReference(referenceId, patch))) return false;

    setSelectedId(nextId);
    setUndoMove({
      referenceId,
      title: reference.title || reference.sourceUrl,
      previous,
    });
    report(triageStatus(destination), "success");
    return true;
  }

  async function undoLastMove() {
    if (!undoMove) return;

    const current = references.find((item) => item._id === undoMove.referenceId);
    if (!current) {
      setUndoMove(null);
      return;
    }

    const patch: Partial<SavedReference> = {
      triageState: undoMove.previous.triageState ?? "kept",
      archived: Boolean(undoMove.previous.archived),
      deleted: Boolean(undoMove.previous.deleted),
    };

    if (await patchReference(undoMove.referenceId, patch)) {
      const restored = { ...current, ...patch };
      setActiveView(viewForCollection(referenceCollection(restored)));
      setSelectedId(undoMove.referenceId);
      report(`Restored “${undoMove.title}”.`, "success");
      setUndoMove(null);
    }
  }

  async function markReferenceOpened(reference: SavedReference) {
    await patchReference(reference._id, { lastOpenedAt: Date.now() });
  }

  async function copyEndpoint() {
    if (!siteUrl) {
      report("Add a Convex site URL before copying the endpoint.", "error");
      return;
    }

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

  function selectRelative(offset: number) {
    if (!filteredReferences.length) return;
    const currentIndex = selectedReference
      ? filteredReferences.findIndex((item) => item._id === selectedReference._id)
      : 0;
    const nextIndex = Math.min(
      filteredReferences.length - 1,
      Math.max(0, currentIndex + offset),
    );
    setSelectedId(filteredReferences[nextIndex]?._id ?? null);
  }

  function nextVisibleReferenceId(referenceId: string) {
    const index = filteredReferences.findIndex((item) => item._id === referenceId);
    return (
      filteredReferences[index + 1]?._id ??
      filteredReferences[index - 1]?._id ??
      null
    );
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
    libraryCount: libraryReferences.length,
    inboxCount,
    laterCount,
    archiveCount,
    trashCount,
    favoriteCount,
    imageCount,
    linkCount,
    selectedId,
    setSelectedId,
    captureOpen,
    setCaptureOpen,
    setupOpen,
    setSetupOpen,
    undoMove,
    saveManualReference,
    toggleFavorite,
    saveDetails,
    moveReference,
    undoLastMove,
    markReferenceOpened,
    copyEndpoint,
    changeView,
  };
}

function collectionForView(view: VaultView): ReferenceCollection {
  if (view === "inbox") return "inbox";
  if (view === "later") return "later";
  if (view === "archive") return "archive";
  if (view === "trash") return "trash";
  return "library";
}

function viewForCollection(collection: ReferenceCollection): VaultView {
  if (collection === "inbox") return "inbox";
  if (collection === "later") return "later";
  if (collection === "archive") return "archive";
  if (collection === "trash") return "trash";
  return "all";
}

function triagePatch(
  reference: SavedReference,
  destination: TriageDestination,
  reviewedAt: number,
): Partial<SavedReference> {
  if (destination === "keep") {
    return {
      triageState: "kept",
      reviewedAt,
      archived: false,
      deleted: false,
    };
  }
  if (destination === "later") {
    return {
      triageState: "later",
      reviewedAt,
      archived: false,
      deleted: false,
    };
  }
  if (destination === "archive") {
    return { reviewedAt, archived: true, deleted: false };
  }
  if (destination === "trash") {
    return { reviewedAt, archived: true, deleted: true };
  }
  return reference.deleted
    ? {
        triageState: "inbox",
        reviewedAt,
        archived: false,
        deleted: false,
      }
    : {
        triageState: "kept",
        reviewedAt,
        archived: false,
        deleted: false,
      };
}

function triageStatus(destination: TriageDestination) {
  if (destination === "keep") return "Kept in Library. Undo is available.";
  if (destination === "later") return "Moved to Later. Undo is available.";
  if (destination === "archive") return "Archived. Undo is available.";
  if (destination === "trash") return "Moved to Trash. Undo is available.";
  return "Reference restored.";
}

function formatDuplicateStatus(existingReference: CaptureResponse["existingReference"]) {
  const title = existingReference?.title?.trim();
  const savedDate = existingReference?.capturedAt
    ? new Date(existingReference.capturedAt).toLocaleDateString()
    : undefined;
  const boardNote = existingReference?.boardCount
    ? ` It is already in ${existingReference.boardCount} ${existingReference.boardCount === 1 ? "board" : "boards"}.`
    : "";

  return `Already saved${title ? ` as “${title}”` : ""}${savedDate ? ` on ${savedDate}` : ""}.${boardNote}`;
}

function resolveConvexSiteUrl() {
  const explicit = process.env.NEXT_PUBLIC_CONVEX_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  if (!convexUrl) return undefined;
  return convexUrl.replace(/\.convex\.cloud\/?$/, ".convex.site");
}
