"use client";
import { Popover } from "./Popover";

import { useState, type FormEvent } from "react";
import { viewLabels, type VaultView } from "./VaultNavigation";
import {
  createSavedSearch,
  removeSavedSearch,
  updateSavedSearch,
  useSavedSearches,
  type SavedSearch,
} from "./useSavedSearches";

export function SavedSearchPanel({
  activeView,
  query,
  onApply,
}: {
  activeView: VaultView;
  query: string;
  onApply: (search: Pick<SavedSearch, "view" | "query">) => void;
}) {
  const searches = useSavedSearches();
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const canSaveCurrent = Boolean(query.trim()) || activeView !== "all";

  async function saveCurrent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const savedName = name.trim();
    if (!savedName || !canSaveCurrent) return;

    setBusy(true);
    setStatus("Saving search…");
    try {
      await createSavedSearch({ name: savedName, query, view: activeView });
      setName("");
      setStatus(`Saved “${savedName}”.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save search.");
    } finally {
      setBusy(false);
    }
  }

  async function replaceSearch(search: SavedSearch) {
    if (!canSaveCurrent) return;
    setBusy(true);
    setStatus(`Updating “${search.name}”…`);
    try {
      await updateSavedSearch({
        savedSearchId: search._id,
        name: search.name,
        query,
        view: activeView,
      });
      setStatus(`Updated “${search.name}” from the current view.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not update search.");
    } finally {
      setBusy(false);
    }
  }

  async function renameSearch(search: SavedSearch) {
    const nextName = editName.trim();
    if (!nextName || nextName === search.name) return;

    setBusy(true);
    setStatus("Renaming search…");
    try {
      await updateSavedSearch({
        savedSearchId: search._id,
        name: nextName,
        query: search.query,
        view: search.view,
      });
      setEditing(null);
      setStatus(`Renamed to “${nextName}”.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not rename search.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteSearch(search: SavedSearch) {
    setBusy(true);
    setStatus("Deleting search…");
    try {
      await removeSavedSearch(search._id);
      setDeleting(null);
      setStatus(`Deleted “${search.name}”.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not delete search.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover className="saved-search-panel" label={<>
        <span>Saved searches</span>
        {searches.length > 0 ? <span>{searches.length}</span> : null}
      </>}>
      <form className="saved-search-create" onSubmit={saveCurrent}>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Name this search"
          maxLength={80}
          disabled={busy}
        />
        <button
          type="submit"
          className="button secondary"
          disabled={busy || !name.trim() || !canSaveCurrent}
        >
          Save current
        </button>
      </form>
      {!canSaveCurrent ? (
        <p className="saved-search-hint">
          Enter a search or switch to a focused vault view before saving.
        </p>
      ) : null}
      {searches.length > 0 ? (
        <div className="saved-search-list">
          {searches.map((search) => (
            <div key={search._id}>
              <button
                type="button"
                className="saved-search-apply"
                onClick={(event) => { const menu = event.currentTarget.closest("details"); if (menu) { menu.open = false; menu.querySelector("summary")?.focus(); } onApply(search); }}
                disabled={busy}
              >
                <strong>{search.name}</strong>
                <span>{describeSearch(search)}</span>
              </button>
              <button
                type="button"
                className="button ghost"
                onClick={() => void replaceSearch(search)}
                disabled={busy || !canSaveCurrent}
                title="Replace with the current view and query"
              >
                Replace
              </button>
              <button
                type="button"
                className="button ghost"
                onClick={() => { setEditing(search._id); setEditName(search.name); setDeleting(null); }}
                disabled={busy}
              >
                Rename
              </button>
              <button
                type="button"
                className="button ghost danger"
                onClick={() => { setDeleting(search._id); setEditing(null); }}
                disabled={busy}
              >
                Delete
              </button>
              {editing === search._id ? <form className="saved-search-inline" onSubmit={(event) => { event.preventDefault(); void renameSearch(search); }}>
                <input autoFocus aria-label="Search name" value={editName} maxLength={80} disabled={busy} onChange={(event) => setEditName(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setEditing(null); } }} />
                <button type="submit" className="button secondary" disabled={busy || !editName.trim() || editName.trim() === search.name}>Save</button>
                <button type="button" className="button ghost" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
              </form> : null}
              {deleting === search._id ? <div className="saved-search-inline">
                <span>Delete this saved search?</span>
                <button type="button" className="button ghost danger" disabled={busy} onClick={() => void deleteSearch(search)}>Delete search</button>
                <button type="button" className="button ghost" disabled={busy} onClick={() => setDeleting(null)}>Cancel</button>
              </div> : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="saved-search-hint">Saved searches will appear here.</p>
      )}
      {status ? (
        <p className="saved-search-status" aria-live="polite">
          {status}
        </p>
      ) : null}
    </Popover>
  );
}

function describeSearch(search: SavedSearch) {
  const view = viewLabels[search.view];
  return search.query ? `${view} · ${search.query}` : view;
}

