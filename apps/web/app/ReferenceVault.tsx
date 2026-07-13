"use client";

import { ReferenceCard } from "./ReferenceCards";
import { SelectedReference } from "./SelectedReference";
import { VaultSidebar, viewLabels } from "./VaultNavigation";
import { referenceKindLabel } from "./referenceVaultModel";
import { useReferenceVault } from "./useReferenceVault";

export function ReferenceVault() {
  const vault = useReferenceVault();
  const currentViewLabel = viewLabels[vault.activeView];
  const isReviewView = vault.activeView === "inbox" || vault.activeView === "later";
  const displayedCount = vault.query
    ? `${vault.filteredReferences.length}${vault.hasMore ? "+" : ""}`
    : String(vault.activeCount);

  return (
    <div className="app-frame">
      <header className="app-header">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            O
          </div>
          <div>
            <p className="brand-name">Ourchival</p>
            <p className="brand-subtitle">Reliquary</p>
          </div>
        </div>
        <div className="header-actions">
          <div
            className={`sync-status status-${vault.statusTone}`}
            title={vault.status}
          >
            <span aria-hidden="true" />
            <span>{vault.status}</span>
          </div>
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
            onClick={() => vault.setSetupOpen((open) => !open)}
          >
            Setup
          </button>
          <button
            type="button"
            className="button primary"
            onClick={() => vault.setCaptureOpen((open) => !open)}
          >
            {vault.captureOpen ? "Close" : "+ Add reference"}
          </button>
        </div>
      </header>

      {vault.setupOpen ? (
        <section
          className="utility-panel setup-panel"
          aria-label="Clipper setup"
        >
          <div>
            <p className="eyebrow">Clipper setup</p>
            <h2>Connect the browser extension</h2>
            <p>Use this capture endpoint in the Ourchival Clipper popup.</p>
          </div>
          <div className="endpoint-row">
            <code>
              {vault.siteUrl
                ? `${vault.siteUrl}/capture`
                : "Missing Convex site URL"}
            </code>
            <button
              type="button"
              className="button secondary"
              onClick={vault.copyEndpoint}
              disabled={!vault.siteUrl}
            >
              Copy
            </button>
          </div>
        </section>
      ) : null}

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
            {vault.isSaving ? "Saving…" : "Save to Inbox"}
          </button>
        </form>
      ) : null}

      <section className="vault-workspace">
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
          <div className="vault-heading">
            <div>
              <p className="eyebrow">{currentViewLabel}</p>
              <h1>{currentViewLabel}</h1>
            </div>
            <p className="vault-count">
              <strong>{displayedCount}</strong>
              <span>{vault.query ? "matches on page" : "references"}</span>
            </p>
          </div>
          <div className="vault-toolbar">
            <label className="search-field">
              <span className="sr-only">Search Ourchival</span>
              <span className="search-icon" aria-hidden="true">
                ⌕
              </span>
              <input
                type="search"
                value={vault.query}
                onChange={(event) => vault.setQuery(event.target.value)}
                placeholder="Search artist, source, lighting, notes, domain…"
              />
              {vault.query ? (
                <button
                  type="button"
                  className="clear-search"
                  onClick={() => vault.setQuery("")}
                >
                  Clear
                </button>
              ) : null}
            </label>
          </div>

          {isReviewView && vault.selectedReference ? (
            <div className="review-strip">
              <div>
                <strong>Review queue</strong>
                <span>←/→ move · K keep · L later · A archive · O open · Delete trash</span>
              </div>
              <div className="review-actions">
                <button
                  type="button"
                  className="button primary"
                  onClick={() =>
                    void vault.moveReference(vault.selectedReference!._id, "keep")
                  }
                >
                  Keep <kbd>K</kbd>
                </button>
                {vault.activeView !== "later" ? (
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() =>
                      void vault.moveReference(vault.selectedReference!._id, "later")
                    }
                  >
                    Later <kbd>L</kbd>
                  </button>
                ) : null}
                <button
                  type="button"
                  className="button ghost"
                  onClick={() =>
                    void vault.moveReference(vault.selectedReference!._id, "archive")
                  }
                >
                  Archive <kbd>A</kbd>
                </button>
              </div>
            </div>
          ) : null}

          <div className="result-summary">
            <span>Page {vault.pageNumber}</span>
            <span>{vault.filteredReferences.length} mounted</span>
            <span>{vault.libraryCount} in Library</span>
            <span>{vault.inboxCount} in Inbox</span>
            <span>{vault.laterCount} for Later</span>
            {vault.query ? <span>Filtered by “{vault.query}”</span> : null}
          </div>
          <section
            className={`reference-grid ${vault.activeView === "links" ? "link-grid" : ""}`}
          >
            {vault.isLoading && vault.filteredReferences.length === 0 ? (
              <article className="empty-card loading-card" aria-live="polite">
                <span className="empty-mark" aria-hidden="true">
                  ◌
                </span>
                <h2>Loading {currentViewLabel.toLowerCase()}</h2>
                <p>Fetching the first page and current archive counts.</p>
              </article>
            ) : vault.filteredReferences.length === 0 ? (
              <article className="empty-card">
                <span className="empty-mark" aria-hidden="true">
                  ◇
                </span>
                <h2>
                  {vault.query
                    ? vault.hasMore
                      ? "No matches on this page"
                      : "No matching saves"
                    : emptyHeading(vault.activeView, currentViewLabel)}
                </h2>
                <p>
                  {vault.query
                    ? vault.hasMore
                      ? "Move to the next older page to continue this search."
                      : "Try a source domain, artist name, title, or phrase from your notes."
                    : emptyMessage(vault.activeView)}
                </p>
                {!vault.query && vault.activeView === "inbox" ? (
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => vault.setCaptureOpen(true)}
                  >
                    Add a reference
                  </button>
                ) : null}
              </article>
            ) : (
              vault.filteredReferences.map((reference) => (
                <ReferenceCard
                  key={reference._id}
                  reference={reference}
                  selected={reference._id === vault.selectedReference?._id}
                  onSelect={() => vault.setSelectedId(reference._id)}
                  onToggleFavorite={() => void vault.toggleFavorite(reference)}
                />
              ))
            )}
          </section>

          {!vault.isLoading ? (
            <div className="pagination-bar" aria-live="polite">
              <p>
                Page {vault.pageNumber} · {vault.filteredReferences.length} mounted
                {vault.query ? " for this search" : ` · ${vault.activeCount} total`}
              </p>
              <div className="pagination-actions">
                <button
                  type="button"
                  className="button ghost"
                  onClick={() => void vault.loadNewerPage()}
                  disabled={!vault.canLoadNewer || vault.isLoadingPage}
                >
                  Newer
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => void vault.loadOlderPage()}
                  disabled={!vault.hasMore || vault.isLoadingPage}
                >
                  {vault.isLoadingPage ? "Loading…" : vault.hasMore ? "Older" : "End reached"}
                </button>
              </div>
            </div>
          ) : null}
        </main>
        <aside className="inspector" aria-label="Selected reference inspector">
          <div className="inspector-label-row">
            <p className="eyebrow">Inspector</p>
            {vault.selectedReference ? (
              <span>{referenceKindLabel(vault.selectedReference.kind)}</span>
            ) : null}
          </div>
          {vault.selectedReference ? (
            <SelectedReference
              key={vault.selectedReference._id}
              reference={vault.selectedReference}
              onMove={vault.moveReference}
              onOpen={vault.markReferenceOpened}
              onToggleFavorite={vault.toggleFavorite}
              onSaveDetails={vault.saveDetails}
            />
          ) : (
            <div className="inspector-empty">
              <span aria-hidden="true">↖</span>
              <p>
                Select a reference to inspect its source, notes, and workflow actions.
              </p>
            </div>
          )}
        </aside>
      </section>
    </div>
  );
}

function emptyHeading(view: string, label: string) {
  if (view === "inbox") return "Inbox cleared";
  if (view === "later") return "Nothing waiting for later";
  if (view === "archive") return "Archive is empty";
  if (view === "trash") return "Trash is empty";
  return `No ${label.toLowerCase()} yet`;
}

function emptyMessage(view: string) {
  if (view === "inbox") return "New captures will arrive here for a quick decision.";
  if (view === "later") return "Defer an Inbox item when it deserves another look.";
  if (view === "archive") return "Archived references stay available without filling the Library.";
  if (view === "trash") return "Items in Trash can be restored to Inbox.";
  return "Keep an Inbox reference to add it to this collection.";
}