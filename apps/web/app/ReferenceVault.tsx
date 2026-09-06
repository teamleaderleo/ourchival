"use client";
import { ArchiveSortPicker, ArchiveSourcePicker } from "./ArchiveBrowseControls";

import { BrandMark } from "./BrandMark";
import { ArchiveSearch } from "./ArchiveSearch";
import { ActiveSourceFilters } from "./ArchiveBrowseControls";
import { Masonry } from "./Masonry";
import { LoadMore } from "./LoadMore";

import { useEffect, useState } from "react";
import { InspectorOrganization } from "./InspectorOrganization";
import { ReferenceCard } from "./ReferenceCards";
import { ReferenceQuickLook } from "./ReferenceQuickLook";
import { SavedSearchPanel } from "./SavedSearchPanel";
import { SelectedReference } from "./SelectedReference";
import { TagFilterBar } from "./TagFilterBar";
import { VaultSidebar, viewLabels } from "./VaultNavigation";
import { referenceKindLabel } from "./referenceVaultModel";
import { useReferenceVault } from "./useReferenceVault";

export function ReferenceVault() {
  const vault = useReferenceVault();
  const [linkDomain, setLinkDomain] = useState("");
  const [linkType, setLinkType] = useState("");
  const [quickLookId, setQuickLookId] = useState<string | null>(null);
  const currentViewLabel = viewLabels[vault.activeView];
  const isReviewView =
    vault.activeView === "inbox" || vault.activeView === "later";
  const quickLookReference = quickLookId
    ? (vault.filteredReferences.find(
        (reference) => reference._id === quickLookId,
      ) ?? null)
    : null;

  useEffect(() => {
    function handleQuickLookKey(event: KeyboardEvent) {
      if (event.key !== " " || quickLookReference) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }
      if (!vault.selectedReference) return;
      event.preventDefault();
      setQuickLookId(vault.selectedReference._id);
    }

    window.addEventListener("keydown", handleQuickLookKey);
    return () => window.removeEventListener("keydown", handleQuickLookKey);
  }, [quickLookReference, vault.selectedReference]);

  function openQuickLook(referenceId: string) {
    setQuickLookId(referenceId);
  }

  function selectQuickLookReference(referenceId: string) {
    setQuickLookId(referenceId);
  }

  function applyLinkFilters() {
    const freeText = stripLinkFilterTokens(vault.query);
    const domain = normalizeDomainToken(linkDomain);
    vault.setQuery(
      [
        freeText,
        domain ? `site:${domain}` : "",
        linkType ? `type:${linkType}` : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
  }

  function clearLinkFilters() {
    setLinkDomain("");
    setLinkType("");
    vault.setQuery(stripLinkFilterTokens(vault.query));
  }

  function applySavedSearch(search: {
    view: typeof vault.activeView;
    query: string;
  }) {
    setLinkDomain("");
    setLinkType("");
    vault.changeView(search.view);
    vault.setQuery(search.query);
  }

  return (
    <div className="app-frame">
      <header className="app-header">
        <div className="brand-lockup">
          <BrandMark />
          <div>
            <p className="brand-name">Ourchival</p>
          </div>
        </div>
        <ArchiveSearch query={vault.query} onChange={vault.setQuery} />
        <div className="header-actions">
          {vault.status ? (
            <div
              className={`sync-status status-${vault.statusTone}`}
              role={vault.statusTone === "error" ? "alert" : "status"}
            >
              <span aria-hidden="true" />
              <span>{vault.status}</span>
            </div>
          ) : null}
          {vault.undoMove ? (
            <button
              type="button"
              className="button ghost"
              onClick={() => void vault.undoLastMove()}
            >
              Undo move
            </button>
          ) : null}
          <button
            type="button"
            className="button ghost"
            onClick={() => vault.setCaptureOpen((open) => !open)}
          >
            {vault.captureOpen ? "Close" : "Save a link"}
          </button>
        </div>
          <div className="vault-toolbar">
            <ArchiveSortPicker value={vault.sort} onChange={vault.changeSort} />
            <ArchiveSourcePicker query={vault.query} onChange={vault.setQuery} />
            <SavedSearchPanel
              activeView={vault.activeView}
              query={vault.query}
              onApply={applySavedSearch}
            />
            <TagFilterBar
              query={vault.query}
              onChange={vault.setQuery}
              imagesOnly={vault.imagesOnly}
              onImagesOnly={vault.setImagesOnly}
            />
          </div>
      </header>

      {vault.captureOpen ? (
        <form
          className="utility-panel capture-panel"
          onSubmit={vault.saveManualReference}
        >
          <div className="capture-heading">
            <div>
              <p className="eyebrow">Quick capture</p>
              <h2>Add a reference or link</h2>
            </div>
            <p>
              Paste a source URL. Add an image URL when the save should become a
              visual reference.
            </p>
          </div>
          <label>
            Source URL
            <input
              required
              type="url"
              value={vault.sourceUrl}
              onChange={(event) => vault.setSourceUrl(event.target.value)}
              placeholder="https://example.com/post-or-article"
            />
          </label>
          <label>
            Image URL <span>optional</span>
            <input
              type="url"
              value={vault.assetUrl}
              onChange={(event) => vault.setAssetUrl(event.target.value)}
              placeholder="https://example.com/image.jpg"
            />
          </label>
          <label>
            Title <span>optional</span>
            <input
              value={vault.pageTitle}
              onChange={(event) => vault.setPageTitle(event.target.value)}
              placeholder="Give future-you a useful clue"
            />
          </label>
          <button
            className="button primary capture-submit"
            disabled={vault.isSaving}
          >
            {vault.isSaving ? "Saving…" : "Save"}
          </button>
        </form>
      ) : null}

      <section
        className={`vault-workspace ${vault.selectedReference ? "has-inspector" : ""}`}
      >
        <VaultSidebar
          activeView={vault.activeView}
          counts={{
            inbox: vault.inboxCount,
            all: vault.libraryCount,
            images: vault.imageCount,
            links: vault.linkCount,
            favorites: vault.favoriteCount,
            later: vault.laterCount,
            archive: vault.archiveCount,
            trash: vault.trashCount,
          }}
          onChange={vault.changeView}
        />
        <main className="vault-main">



          <div className="browse-context">
            <h1>{currentViewLabel}</h1>
            <ActiveSourceFilters query={vault.query} onChange={vault.setQuery} />
          </div>

          {vault.activeView === "links" ? (
            <form
              className="link-filter-bar"
              onSubmit={(event) => {
                event.preventDefault();
                applyLinkFilters();
              }}
            >
              <label>
                Domain
                <input
                  value={linkDomain}
                  onChange={(event) => setLinkDomain(event.target.value)}
                  placeholder="example.com"
                  inputMode="url"
                />
              </label>
              <label>
                Source type
                <select
                  value={linkType}
                  onChange={(event) => setLinkType(event.target.value)}
                >
                  <option value="">All link types</option>
                  <option value="page">Pages</option>
                  <option value="link">Links</option>
                  <option value="article">Articles</option>
                </select>
              </label>
              <button type="submit" className="button secondary">
                Apply filters
              </button>
              <button
                type="button"
                className="button ghost"
                onClick={clearLinkFilters}
              >
                Clear filters
              </button>
            </form>
          ) : null}

          {isReviewView && vault.selectedReference ? (
            <div className="review-strip">
              <div>
                <strong>Review queue</strong>
                <span>
                  ←/→ move · K keep · L later · A archive · O open · Delete
                  trash
                </span>
              </div>
              <div className="review-actions">
                <button
                  type="button"
                  className="button primary"
                  onClick={() =>
                    void vault.moveReference(
                      vault.selectedReference!._id,
                      "keep",
                    )
                  }
                >
                  Mark reviewed <kbd>K</kbd>
                </button>
                {vault.activeView !== "later" ? (
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() =>
                      void vault.moveReference(
                        vault.selectedReference!._id,
                        "later",
                      )
                    }
                  >
                    Review later <kbd>L</kbd>
                  </button>
                ) : null}
                <button
                  type="button"
                  className="button ghost"
                  onClick={() =>
                    void vault.moveReference(
                      vault.selectedReference!._id,
                      "archive",
                    )
                  }
                >
                  Archive <kbd>A</kbd>
                </button>
              </div>
            </div>
          ) : null}

          <section
            className={`reference-grid ${vault.activeView === "links" ? "link-grid" : ""} ${vault.filteredReferences.length === 0 ? "empty-grid" : ""}`}
          >
            {vault.isLoading && vault.filteredReferences.length === 0 ? (
              <div aria-label="Opening archive" aria-busy="true">
                <Masonry>
                  {Array.from({ length: 8 }, (_, index) => (
                    <div
                      key={index}
                      className="masonry-skeleton"
                      style={{ height: 180 + (index % 3) * 65 }}
                    />
                  ))}
                </Masonry>
              </div>
            ) : vault.loadFailed ? (
              <article className="empty-card load-error-card" role="alert">
                <span className="empty-mark" aria-hidden="true">
                  !
                </span>
                <h2>Couldn’t reach your archive</h2>
                <p>
                  Your signed-in session is still saved. Check the connection
                  and try loading this view again.
                </p>
                <button
                  type="button"
                  className="button secondary"
                  onClick={vault.retryLoad}
                >
                  Try again
                </button>
              </article>
            ) : vault.filteredReferences.length === 0 ? (
              <article className="empty-card">
                <span className="empty-mark" aria-hidden="true">
                  ◇
                </span>
                <h2>
                  {vault.hasMore ? "Finding saved items…" : vault.query
                    ? "No matching saves"
                    : emptyHeading(vault.activeView, currentViewLabel)}
                </h2>
                <p>
                  {vault.hasMore ? "Searching this view in the selected order." : vault.query
                    ? "Try a source domain, artist name, title, note, tag, board, project, or reuse reason."
                    : emptyMessage(vault.activeView)}
                </p>
              </article>
            ) : (
              <Masonry restoreId={vault.restoreReferenceId}>
                {vault.filteredReferences.map((reference, index) => (
                  <ReferenceCard
                    key={reference._id}
                    reference={reference}
                    priority={index < 4}
                    selected={reference._id === vault.selectedReference?._id}
                    onSelect={() => vault.setSelectedId(reference._id)}
                    onQuickLook={() => openQuickLook(reference._id)}
                    onToggleFavorite={() =>
                      void vault.toggleFavorite(reference)
                    }
                  />
                ))}
              </Masonry>
            )}
          </section>

          {!vault.isLoading && vault.hasMore ? (
            <LoadMore
              busy={vault.isLoadingPage}
              failed={vault.statusTone === "error"}
              auto={vault.statusTone !== "error" && !vault.restoreReferenceId}
              onLoad={vault.loadOlderPage}
            />
          ) : null}
        </main>
        {vault.selectedReference ? (
          <aside
            className="inspector"
            aria-label="Selected reference inspector"
          >
            <div className="inspector-label-row">
              <p className="eyebrow">Details</p>
              <div>
                <span>{referenceKindLabel(vault.selectedReference.kind)}</span>
                <button
                  type="button"
                  className="inspector-close"
                  onClick={() => vault.setSelectedId(null)}
                >
                  Close
                </button>
              </div>
            </div>
            <>
              <SelectedReference
                key={vault.selectedReference._id}
                reference={vault.selectedReference}
                onMove={vault.moveReference}
                onOpen={vault.markReferenceOpened}
                onToggleFavorite={vault.toggleFavorite}
                onSaveDetails={vault.saveDetails}
              />
              <InspectorOrganization
                key={`organization:${vault.selectedReference._id}`}
                reference={vault.selectedReference}
              />
            </>
          </aside>
        ) : null}
      </section>

      {quickLookReference ? (
        <ReferenceQuickLook
          reference={quickLookReference}
          references={vault.filteredReferences}
          onSelect={selectQuickLookReference}
          onClose={() => setQuickLookId(null)}
          onOpen={vault.markReferenceOpened}
          onToggleFavorite={vault.toggleFavorite}
          onInspect={() => {
            vault.setSelectedId(quickLookReference._id);
            setQuickLookId(null);
          }}
          onMove={async (action) => {
            const index = vault.filteredReferences.findIndex(
              (item) => item._id === quickLookReference._id,
            );
            const next =
              vault.filteredReferences[index + 1] ??
              vault.filteredReferences[index - 1];
            if (!(await vault.moveReference(quickLookReference._id, action)))
              return false;
            vault.setSelectedId(null);
            setQuickLookId(next?._id ?? null);
            return true;
          }}
        />
      ) : null}
    </div>
  );
}

function stripLinkFilterTokens(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .filter((token) => !/^(site|domain|type|kind):/i.test(token))
    .join(" ");
}

function normalizeDomainToken(value: string) {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    ?.replace(/^www\./, "")
    .replace(/\.$/, "");
}

function emptyHeading(view: string, label: string) {
  if (view === "inbox") return "All caught up";
  if (view === "later") return "Nothing waiting for later";
  if (view === "archive") return "Archive is empty";
  if (view === "trash") return "Trash is empty";
  return `No ${label.toLowerCase()} yet`;
}

function emptyMessage(view: string) {
  if (view === "inbox")
    return "New captures will arrive here for a quick decision.";
  if (view === "later")
    return "Defer a new save when it deserves another look.";
  if (view === "archive")
    return "Archived references stay available without filling the Library.";
  if (view === "trash") return "Items in Trash can be restored to New.";
  if (view === "favorites") return "Star any saved item to find it here.";
  if (view === "links") return "Saved links, including OneTab imports, appear here automatically.";
  return "Saved items appear here automatically, including unreviewed imports.";
}
