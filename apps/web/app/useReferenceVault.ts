"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  filterReferences,
  hasImageAsset,
  getSelectedReference,
  referenceCollection,
  referenceMode,
  type ReferenceCollection,
  type ReferenceLane,
  type SavedReference,
} from "./referenceVaultModel";
import { type VaultView } from "./VaultNavigation";
import { appendPage } from "./viewPages";
import { type ArchiveSort } from "../../../packages/shared/src/archiveSort";
import {
  browseViewKey,
  clearPosition,
  readBrowseView,
  saveBrowseView,
} from "./archivePosition";
import { useArchivePosition } from "./useArchivePosition";

type VaultCounts = Record<VaultView, number>;
type CachedView = {
  references: SavedReference[];
  cursor: string | null;
  hasMore: boolean;
  scroll: number;
};

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
export type TriageDestination =
  "keep" | "later" | "archive" | "trash" | "restore";

type UndoMove = {
  referenceId: string;
  title: string;
  previous: Pick<SavedReference, "triageState" | "archived" | "deleted">;
};

const defaultPageSize = 48;

export function useReferenceVault(pageSize = defaultPageSize) {
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
  const [activeView, setActiveView] = useState<VaultView>("all");
  const [imagesOnly, setImagesOnly] = useState(false);
  const [revealSensitive, setRevealSensitive] = useState(true);
  useEffect(() => {
    try { setRevealSensitive(localStorage.getItem("ourchival-sensitive-previews") !== "hide"); } catch { /* Session preference still works. */ }
  }, []);
  function changeSensitiveVisibility(show: boolean) {
    requestSerial.current++;
    setReferences([]);
    setRevealSensitive(show);
    try { localStorage.setItem("ourchival-sensitive-previews", show ? "show" : "hide"); } catch { /* Session preference still works. */ }
  }
  const [sort, setSort] = useState<ArchiveSort>("saved-desc");
  const [positionReady, setPositionReady] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [undoMove, setUndoMove] = useState<UndoMove | null>(null);
  const requestSerial = useRef(0);
  const viewCache = useRef(new Map<string, CachedView>());
  const inFlight = useRef<string | null>(null);
  const positionKey = browseViewKey(siteUrl ?? "", {
    view: activeView,
    query: debouncedQuery,
    sort,
    imagesOnly,
  });
  const cacheKey = `${refreshKey}:${revealSensitive}:${positionKey}`;
  const position = useArchivePosition(
    positionKey,
    references,
    isLoading || isLoadingPage || statusTone === "error",
  );
  const { beginRestore } = position;
  const pageRequest = useRef(requestReferencePage);
  useEffect(() => {
    pageRequest.current = requestReferencePage;
  });

  useEffect(() => {
    if (!siteUrl) {
      setPositionReady(true);
      return;
    }
    try {
      const saved = readBrowseView(window.localStorage, siteUrl);
      if (saved) {
        setActiveView(saved.view as VaultView);
        setQuery(saved.query);
        setDebouncedQuery(saved.query);
        setSort(saved.sort);
        setImagesOnly(saved.imagesOnly);
      }
    } catch {
      /* Browsing also works without local storage. */
    }
    setPositionReady(true);
  }, [siteUrl]);
  useEffect(() => {
    if (!positionReady || !siteUrl) return;
    try {
      saveBrowseView(window.localStorage, siteUrl, {
        view: activeView,
        query: debouncedQuery,
        sort,
        imagesOnly,
      });
    } catch {
      /* Optional persistence. */
    }
  }, [positionReady, siteUrl, activeView, debouncedQuery, sort, imagesOnly]);

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
      filterReferences(
        (imagesOnly && activeView !== "links") || activeView === "images"
          ? references.filter(hasImageAsset)
          : references,
        {
          query,
          favoritesOnly,
          lane,
          collection,
          includeUnreviewed: true,
        },
      ),
    [
      query,
      references,
      favoritesOnly,
      lane,
      collection,
      imagesOnly,
      activeView,
    ],
  );
  const selectedReference = getSelectedReference(
    filteredReferences,
    selectedId,
  );
  const activeCount = countForView(counts, activeView);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!positionReady) return;
    if (!siteUrl) {
      report(
        "Add NEXT_PUBLIC_CONVEX_URL or NEXT_PUBLIC_CONVEX_SITE_URL in setup to load saved references.",
        "error",
      );
      setIsLoading(false);
      return;
    }

    requestSerial.current++;
    const marker = beginRestore();
    const cached = viewCache.current.get(cacheKey);
    if (cached) {
      setReferences(cached.references);
      setContinueCursor(cached.cursor);
      setHasMore(cached.hasMore);
      setIsLoading(false);
      setIsLoadingPage(false);
      report("", "success");
      return;
    }
    setCurrentCursor(null);
    setContinueCursor(null);
    setCursorHistory([]);
    setHasMore(false);
    setIsLoadingPage(false);
    void pageRequest.current(marker?.cursor ?? null, [], true);
  }, [
    siteUrl,
    refreshKey,
    activeView,
    debouncedQuery,
    cacheKey,
    positionReady,
    beginRestore,
  ]);

  useEffect(() => {
    if (
      (imagesOnly || activeView === "inbox" || activeView === "later") &&
      filteredReferences.length === 0 &&
      hasMore &&
      !isLoading &&
      !isLoadingPage
    ) {
      void loadOlderPage();
    }
  }, [
    activeView,
    filteredReferences.length,
    imagesOnly,
    hasMore,
    activeCount,
    isLoading,
    isLoadingPage,
  ]);

  useEffect(() => {
    if (activeView !== "inbox" && activeView !== "later") return;

    function handleReviewKey(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.isComposing ||
        document.querySelector("[aria-modal=true], .popover[open]")
      )
        return;
      if (
        event.repeat &&
        ["k", "l", "a", "o", "delete", "backspace"].includes(
          event.key.toLowerCase(),
        )
      ) {
        event.preventDefault();
        return;
      }
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
        window.open(
          selectedReference.sourceUrl,
          "_blank",
          "noopener,noreferrer",
        );
        void markReferenceOpened(selectedReference);
      }
    }

    window.addEventListener("keydown", handleReviewKey);
    return () => window.removeEventListener("keydown", handleReviewKey);
  }, [activeView, filteredReferences, selectedReference]);

  async function requestReferencePage(
    cursor: string | null,
    history: Array<string | null>,
    replace = false,
  ) {
    if (!siteUrl) return;
    const flightKey = `${cacheKey}:${cursor}`;
    if (inFlight.current === flightKey) return;
    inFlight.current = flightKey;
    const serial = requestSerial.current + 1;
    requestSerial.current = serial;

    if (replace || (history.length === 0 && cursor === null))
      setIsLoading(true);
    else setIsLoadingPage(true);

    try {
      const params = new URLSearchParams({
        limit: String(pageSize),
        collection,
        scope: "active",
        lane,
        sort,
        imagesOnly: String(imagesOnly),
        revealSensitive: String(revealSensitive),
      });
      if (favoritesOnly) params.set("favorites", "true");
      if (debouncedQuery) params.set("query", debouncedQuery);
      if (cursor) params.set("cursor", cursor);

      const response = await fetch(
        `${siteUrl}/references?${params.toString()}`,
      );
      const body = (await response.json()) as ReferencesResponse;
      if (serial !== requestSerial.current) return;
      if (!response.ok || body.ok === false) {
        report(body.error ?? response.statusText, "error");
        return;
      }

      const incoming = body.references ?? [];
      const combined =
        cursor && !replace ? appendPage(references, incoming) : incoming;
      setReferences(combined);
      viewCache.current.set(cacheKey, {
        references: combined,
        cursor: body.continueCursor ?? null,
        hasMore: Boolean(body.hasMore),
        scroll: window.scrollY,
      });
      if (viewCache.current.size > 10)
        viewCache.current.delete(viewCache.current.keys().next().value!);
      setCurrentCursor(cursor);
      setCursorHistory(history);
      setContinueCursor(body.continueCursor ?? null);
      setHasMore(Boolean(body.hasMore));
      if (!cursor) setSelectedId(null);
      if (body.counts) setCounts(body.counts);
      report("", "success");
    } catch (error) {
      if (serial === requestSerial.current) {
        report(
          error instanceof Error
            ? error.message
            : "Could not load saved references.",
          "error",
        );
      }
    } finally {
      if (inFlight.current === flightKey) inFlight.current = null;
      if (serial === requestSerial.current) {
        setIsLoading(false);
        setIsLoadingPage(false);
      }
    }
  }

  async function loadOlderPage() {
    if (!continueCursor || !hasMore || isLoadingPage) return;
    await requestReferencePage(continueCursor, [
      ...cursorHistory,
      currentCursor,
    ]);
  }

  async function loadNewerPage() {
    if (cursorHistory.length === 0 || isLoadingPage) return;
    const previousCursor = cursorHistory[cursorHistory.length - 1] ?? null;
    await requestReferencePage(previousCursor, cursorHistory.slice(0, -1));
  }

  async function saveManualReference(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!siteUrl) {
      report("Ourchival is missing its archive connection.", "error");
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

      if (body.alreadySaved) {
        setActiveView("all");
        setSelectedId(body.referenceId ?? null);
        setRefreshKey((key) => key + 1);
        report(formatDuplicateStatus(body.existingReference), "success");
        return;
      }

      setActiveView("inbox");
      setSelectedId(body.referenceId ?? null);
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
  ) {
    if (!siteUrl) {
      report("Ourchival is missing its archive connection.", "error");
      return false;
    }

    const previous = references.find((item) => item._id === referenceId);

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

      viewCache.current.clear();
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

    const current = references.find(
      (item) => item._id === undoMove.referenceId,
    );
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

  function selectRelative(offset: number) {
    if (!filteredReferences.length) return;
    const currentIndex = selectedReference
      ? filteredReferences.findIndex(
          (item) => item._id === selectedReference._id,
        )
      : 0;
    const nextIndex = Math.min(
      filteredReferences.length - 1,
      Math.max(0, currentIndex + offset),
    );
    setSelectedId(filteredReferences[nextIndex]?._id ?? null);
  }

  function nextVisibleReferenceId(referenceId: string) {
    const index = filteredReferences.findIndex(
      (item) => item._id === referenceId,
    );
    return (
      filteredReferences[index + 1]?._id ??
      filteredReferences[index - 1]?._id ??
      null
    );
  }

  function changeView(view: VaultView) {
    if (view === activeView) return;
    position.capture();
    requestSerial.current++;
    const current = viewCache.current.get(cacheKey);
    if (current) current.scroll = window.scrollY;
    const cached = viewCache.current.get(
      `${refreshKey}:${revealSensitive}:${browseViewKey(siteUrl ?? "", { view, query: debouncedQuery, sort, imagesOnly })}`,
    );
    setReferences(cached?.references ?? []);
    setIsLoading(!cached);
    window.scrollTo({ top: 0, behavior: "instant" });
    setActiveView(view);
    setSelectedId(null);
    setUndoMove(null);
  }

  function retryLoad() {
    position.reset();
    try {
      clearPosition(window.localStorage, positionKey);
    } catch {
      /* Optional persistence. */
    }
    setReferences([]);
    setSelectedId(null);
    window.scrollTo({ top: 0, behavior: "instant" });
    setRefreshKey((key) => key + 1);
  }

  function changeSort(next: ArchiveSort) {
    if (next === sort) return;
    position.capture();
    requestSerial.current++;
    setReferences([]);
    setIsLoading(true);
    setSelectedId(null);
    window.scrollTo({ top: 0, behavior: "instant" });
    setSort(next);
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
    imagesOnly,
    sort,
    changeSort,
    positionNotice: position.notice,
    restoreReferenceId: position.restoreReferenceId,
    setImagesOnly,
    revealSensitive,
    changeSensitiveVisibility,
    selectedReference,
    filteredReferences,
    libraryCount: counts.all + counts.inbox + counts.later,
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
    undoMove,
    hasMore: hasMore && activeCount > 0,
    canLoadNewer: cursorHistory.length > 0,
    pageNumber: cursorHistory.length + 1,
    isLoading,
    isLoadingPage,
    loadFailed: statusTone === "error" && references.length === 0 && !isLoading,
    retryLoad,
    loadOlderPage,
    loadNewerPage,
    saveManualReference,
    toggleFavorite,
    saveDetails,
    moveReference,
    undoLastMove,
    markReferenceOpened,
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
  for (const key of referenceCountKeys(before))
    next[key] = Math.max(0, next[key] - 1);
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
  if (destination === "trash")
    return "Moved to Trash; recapture blocked. Undo is available.";
  return "Reference restored.";
}

function formatDuplicateStatus(
  existingReference: CaptureResponse["existingReference"],
) {
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
