"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  filterReferences,
  getSelectedReference,
  referenceCollection,
  referenceMode,
  type ReferenceCollection,
  type ReferenceLane,
  type SavedReference,
} from "./referenceVaultModel";
import { restoreReferenceMove } from "./referenceUndoClient";
import { type VaultView } from "./VaultNavigation";

type VaultCounts = Record<VaultView, number>;

type ReferencesResponse = {
  ok: boolean;
  references?: SavedReference[];
  continueCursor?: string | null;
  hasMore?: boolean;
  counts?: VaultCounts;
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
  before: SavedReference;
  after: SavedReference;
};

const pageSize = 48;

export function useReferenceVault() {
  const siteUrl = useMemo(resolveConvexSiteUrl, []);
  const [references, setReferences] = useState<SavedReference[]>([]);
  const [counts, setCounts] = useState<VaultCounts>(emptyCounts);
  const [currentCursor, setCurrentCursor] = useState<string | null>(null);
  const [continueCursor, setContinueCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([]);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingPage, setIsLoadingPage] = useState(false);
  const [status, setStatus] = useState("Loading saved references…");
  const [statusTone, setStatusTone] = useState<StatusTone>("info");
  const [refreshKey, setRefreshKey] = useState(0);
  const [sourceUrl, setSourceUrl] = useState("");
  const [assetUrl, setAssetUrl] = useState("");
  const [pageTitle, setPageTitle] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [activeView, setActiveView] = useState<VaultView>("inbox");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [undoMove, setUndoMove] = useState<UndoMove | null>(null);
  const requestSerial = useRef(0);
  const pendingSelectionRef = useRef<string | null>(null);

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
  const selectedReference = getSelectedReference(filteredReferences, selectedId);
  const activeCount = countForView(counts, activeView);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!siteUrl) {
      report(
        "Add NEXT_PUBLIC_CONVEX_URL or NEXT_PUBLIC_CONVEX_SITE_URL in setup to load saved references.",
        "error",
      );
      setIsLoading(false);
      return;
    }

    setReferences([]);
    setCurrentCursor(null);
    setContinueCursor(null);
    setCursorHistory([]);
    setHasMore(false);
    setIsLoadingPage(false);
    void requestReferencePage(null, []);
  }, [siteUrl, refreshKey, activeView, debouncedQuery]);

  useEffect(() => {
    if (
      (activeView === "inbox" || activeView === "later") &&
      filteredReferences.length === 0 &&
      hasMore &&
      !isLoading &&
      !isLoadingPage
    ) {
      void loadOlderPage();
    }
  }, [activeView, filteredReferences.length, hasMore, isLoading, isLoadingPage]);

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

  async function requestReferencePage(
    cursor: string | null,
    history: Array<string | null>,
  ) {
    if (!siteUrl) return;
    const serial = requestSerial.current + 1;
    requestSerial.current = serial;

    if (history.length === 0 && cursor === null) setIsLoading(true);
    else setIsLoadingPage(true);

    try {
      const params = new URLSearchParams({
        limit: String(pageSize),
        collection,
        lane,
      });
      if (favoritesOnly) params.set("favorites", "true");
      if (debouncedQuery) params.set("query", debouncedQuery);
      if (cursor) params.set("cursor", cursor);

      const response = await fetch(`${siteUrl}/references?${params.toString()}`);
      const body = (await response.json()) as ReferencesResponse;
      if (serial !== requestSerial.current) return;
      if (!response.ok || body.ok === false) {
        report(body.error ?? response.statusText, "error");
        return;
      }

      const incoming = body.references ?? [];
      setReferences(incoming);
      setCurrentCursor(cursor);
      setCursorHistory(history);
      setContinueCursor(body.continueCursor ?? null);
      setHasMore(Boolean(body.hasMore));
      const pendingSelection = pendingSelectionRef.current;
      setSelectedId(
        pendingSelection && incoming.some((item) => item._id === pendingSelection)
          ? pendingSelection
          : null,
      );
      pendingSelectionRef.current = null;
      if (body.counts) setCounts(body.counts);
      report(
        `Loaded page ${history.length + 1} with ${incoming.length} ${incoming.length === 1 ? "reference" : "references"}${body.hasMore ? "; older pages available." : "."}`,
        "success",
      );
    } catch (error) {
      if (serial === requestSerial.current) {
        report(
          error instanceof Error ? error.message : "Could not load saved references.",
          "error",
        );
      }
    } finally {
      if (serial === requestSerial.current) {
        setIsLoading(false);
        setIsLoadingPage(false);
      }
    }
  }

  async function loadOlderPage() {
    if (!continueCursor || !hasMore || isLoadingPage) return;
    await requestReferencePage(continueCursor, [...cursorHistory, currentCursor]);
  }

  async function loadNewerPage() {
    if (cursorHistory.length === 0 || isLoadingPage) return;
    const previousCursor = cursorHistory[cursorHistory.length - 1] ?? null;
    await requestReferencePage(previousCursor, cursorHistory.slice(0, -1));
  }

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
      pendingSelectionRef.current = body.referenceId ?? null;

      if (body.alreadySaved) {
        setActiveView("all");
        setRefreshKey((key) => key + 1);
        report(formatDuplicateStatus(body.existingReference), "success");
        return;
      }

      setActiveView("inbox");
      setRefreshKey((key) => key + 1);
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
    previousOverride?: SavedReference,
  ) {
    if (!siteUrl) {
      report("Add a Convex site URL in setup before editing.", "error");
      setSetupOpen(true);
      return false;
    }

    const previous =
      previousOverride ?? references.find((item) => item._id === referenceId);

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
      if (previous) {
        setCounts((current) =>
          updateCountsForReferenceChange(current, previous, {
            ...previous,
            ...patch,
          }),
        );
      }
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
      report(next ? "Added to favorites." : "Removed from favorites.", "success");
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
    const after = { ...reference, ...patch };

    if (!(await patchReference(referenceId, patch, reference))) return false;

    setSelectedId(nextId);
    setUndoMove({
      referenceId,
      title: reference.title || reference.sourceUrl,
      before: reference,
      after,
    });
    report(triageStatus(destination), "success");
    return true;
  }

  async function undoLastMove() {
    if (!undoMove) return;

    try {
      const restoredPatch = await restoreReferenceMove(undoMove.before);
      const restored: SavedReference = {
        ...undoMove.before,
        ...restoredPatch,
      };
      setReferences((items) =>
        items.map((item) =>
          item._id === undoMove.referenceId ? restored : item,
        ),
      );
      setCounts((current) =>
        updateCountsForReferenceChange(current, undoMove.after, restored),
      );
      pendingSelectionRef.current = undoMove.referenceId;
      setQuery("");
      setDebouncedQuery("");
      setActiveView(viewForCollection(referenceCollection(restored)));
      setSelectedId(undoMove.referenceId);
      setRefreshKey((key) => key + 1);
      report(`Restored “${undoMove.title}”.`, "success");
      setUndoMove(null);
    } catch (error) {
      report(
        error instanceof Error ? error.message : "Could not restore the reference.",
        "error",
      );
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
    pendingSelectionRef.current = null;
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
    activeCount,
    selectedReference,
    filteredReferences,
    libraryCount: counts.all,
    inboxCount: counts.inbox,
    laterCount: counts.later,
    archiveCount: counts.archive,
    trashCount: counts.trash,
    favoriteCount: counts.favorites,
    imageCount: counts.images,
    linkCount: counts.links,
    selectedId,
    setSelectedId,
    captureOpen,
    setCaptureOpen,
    setupOpen,
    setSetupOpen,
    undoMove,
    hasMore,
    canLoadNewer: cursorHistory.length > 0,
    pageNumber: cursorHistory.length + 1,
    isLoading,
    isLoadingPage,
    loadOlderPage,
    loadNewerPage,
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

function countForView(counts: VaultCounts, view: VaultView) {
  return counts[view];
}

function updateCountsForReferenceChange(
  counts: VaultCounts,
  before: SavedReference,
  after: SavedReference,
): VaultCounts {
  const next = { ...counts };
  for (const key of referenceCountKeys(before)) next[key] = Math.max(0, next[key] - 1);
  for (const key of referenceCountKeys(after)) next[key] += 1;
  return next;
}

function referenceCountKeys(reference: SavedReference): VaultView[] {
  const collection = referenceCollection(reference);
  if (collection === "inbox") return ["inbox"];
  if (collection === "later") return ["later"];
  if (collection === "archive") return ["archive"];
  if (collection === "trash") return ["trash"];

  const keys: VaultView[] = ["all", referenceMode(reference.kind)];
  if (reference.favorite) keys.push("favorites");
  return keys;
}

function emptyCounts(): VaultCounts {
  return {
    inbox: 0,
    all: 0,
    images: 0,
    links: 0,
    favorites: 0,
    later: 0,
    archive: 0,
    trash: 0,
  };
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
