"use client";

import { ReferenceCard } from "./ReferenceCards";
import { SelectedReference } from "./SelectedReference";
import { VaultSidebar, viewLabels } from "./VaultNavigation";
import { referenceKindLabel } from "./referenceVaultModel";
import { useReferenceVault } from "./useReferenceVault";

export function ReferenceVault() {
  const vault = useReferenceVault();
  const currentViewLabel = viewLabels[vault.activeView];

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
            {vault.isSaving ? "Saving…" : "Save to Reliquary"}
          </button>
        </form>
      ) : null}

      <section className="vault-workspace">
        <VaultSidebar
          activeView={vault.activeView}
          counts={{
            all: vault.references.length,
            images: vault.imageCount,
            links: vault.linkCount,
            favorites: vault.favoriteCount,
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
              <strong>{vault.filteredReferences.length}</strong>
              <span>
                {vault.filteredReferences.length === 1
                  ? "reference"
                  : "references"}
              </span>
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
          <div className="result-summary">
            <span>{vault.references.length} total</span>
            <span>{vault.imageCount} images</span>
            <span>{vault.linkCount} links</span>
            {vault.query ? <span>Filtered by “{vault.query}”</span> : null}
          </div>
          <section
            className={`reference-grid ${vault.activeView === "links" ? "link-grid" : ""}`}
          >
            {vault.filteredReferences.length === 0 ? (
              <article className="empty-card">
                <span className="empty-mark" aria-hidden="true">
                  ◇
                </span>
                <h2>
                  {vault.query
                    ? "No matching saves"
                    : `No ${currentViewLabel.toLowerCase()} yet`}
                </h2>
                <p>
                  {vault.query
                    ? "Try a source domain, artist name, title, or phrase from your notes."
                    : "Capture something from Edge or use Add reference to begin."}
                </p>
                {!vault.query ? (
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
              onDelete={vault.deleteReference}
              onToggleFavorite={vault.toggleFavorite}
              onSaveDetails={vault.saveDetails}
            />
          ) : (
            <div className="inspector-empty">
              <span aria-hidden="true">↖</span>
              <p>
                Select a reference to inspect its source, notes, and saved file.
              </p>
            </div>
          )}
        </aside>
      </section>
    </div>
  );
}
